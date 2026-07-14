import { describe, it, expect, vi } from 'vitest';
import { withCircuitBreaker, withRateLimit } from '../index';
import { ProviderHealth } from '../ProviderHealth';
import { RequestRateLimiter } from '../RequestRateLimiter';
import type { ApiHandler, ApiStreamChunk, MessageParam } from '../types';

/**
 * IMP-41-02-03 / IMP-41-03-02 / ADR-146: the resilience decorators wrap
 * createMessage. buildApiHandler composes them as
 * withCircuitBreaker(withRateLimit(handler)) with the breaker OUTERMOST,
 * so an open circuit fails fast WITHOUT first consuming a rate-limit
 * token. This suite pins that invariant plus the health feedback (success
 * on stream completion, classified failure on throw) that the golden
 * wire-format suite -- which only exercises prepare-request payloads --
 * does not touch.
 */

function fakeHandler(overrides?: {
    createMessage?: () => AsyncIterable<ApiStreamChunk>;
}): ApiHandler & { createMessage: ReturnType<typeof vi.fn> } {
    const createMessage = vi.fn(
        overrides?.createMessage ??
            (() => (async function* () {
                yield { type: 'text', text: 'ok' };
            })()),
    );
    return {
        getModel: () => ({ id: 'claude-sonnet-5', info: { contextWindow: 200_000 } }),
        createMessage,
    } as unknown as ApiHandler & { createMessage: ReturnType<typeof vi.fn> };
}

async function drain(stream: AsyncIterable<ApiStreamChunk>): Promise<ApiStreamChunk[]> {
    const out: ApiStreamChunk[] = [];
    for await (const c of stream) out.push(c);
    return out;
}

/** Trip a fresh breaker into the open state (3 outage-class failures). */
function openBreaker(health: ProviderHealth, providerType: string): void {
    for (let i = 0; i < 3; i++) health.reportFailure(providerType, 'server');
    expect(health.canRequest(providerType)).toBe(false);
}

describe('withCircuitBreaker', () => {
    it('passes chunks through and reports success on clean completion', async () => {
        const health = new ProviderHealth();
        const reportSuccess = vi.spyOn(health, 'reportSuccess');
        const inner = fakeHandler();
        const wrapped = withCircuitBreaker(inner, 'anthropic', health);

        const chunks = await drain(wrapped.createMessage('sys', [] as MessageParam[], []));

        expect(chunks).toEqual([{ type: 'text', text: 'ok' }]);
        expect(reportSuccess).toHaveBeenCalledWith('anthropic');
    });

    it('reports a classified failure when the stream throws', async () => {
        const health = new ProviderHealth();
        const reportFailure = vi.spyOn(health, 'reportFailure');
        const inner = fakeHandler({
            createMessage: () => (async function* (): AsyncIterable<ApiStreamChunk> {
                yield { type: 'text', text: 'partial' };
                throw Object.assign(new Error('upstream 503'), { status: 503 });
            })(),
        });
        const wrapped = withCircuitBreaker(inner, 'anthropic', health);

        await expect(drain(wrapped.createMessage('sys', [], []))).rejects.toThrow('upstream 503');
        // 503 classifies as 'server' -> an outage class that opens the breaker.
        expect(reportFailure).toHaveBeenCalledWith('anthropic', 'server');
    });

    it('emits an [AuthDiag] warn line with model + provider on a 401 auth error (FIX-54-11 follow-up)', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const health = new ProviderHealth();
        const inner = fakeHandler({
            createMessage: () => (async function* (): AsyncIterable<ApiStreamChunk> {
                throw Object.assign(
                    new Error('401 You have insufficient permissions for this operation.'),
                    { status: 401, headers: { 'x-request-id': 'req_test123' } },
                );
            })(),
        });
        const wrapped = withCircuitBreaker(inner, 'openai', health);

        await expect(drain(wrapped.createMessage('sys', [], []))).rejects
            .toThrow(/insufficient permissions/);

        const authCall = warn.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('[AuthDiag]'));
        expect(authCall).toBeDefined();
        expect(authCall?.[1]).toMatchObject({
            providerType: 'openai',
            model: 'claude-sonnet-5',
            status: 401,
            requestId: 'req_test123',
        });
        warn.mockRestore();
    });

    it('does NOT log [AuthDiag] on non-auth failures (503 server error)', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const health = new ProviderHealth();
        const inner = fakeHandler({
            createMessage: () => (async function* (): AsyncIterable<ApiStreamChunk> {
                throw Object.assign(new Error('upstream 503'), { status: 503 });
            })(),
        });
        const wrapped = withCircuitBreaker(inner, 'openai', health);

        await expect(drain(wrapped.createMessage('sys', [], []))).rejects.toThrow('upstream 503');

        const authCall = warn.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('[AuthDiag]'));
        expect(authCall).toBeUndefined();
        warn.mockRestore();
    });

    it('fails fast with a descriptive error when the breaker is open, without calling the inner handler', async () => {
        const health = new ProviderHealth();
        openBreaker(health, 'anthropic');
        const inner = fakeHandler();
        const wrapped = withCircuitBreaker(inner, 'anthropic', health);

        await expect(drain(wrapped.createMessage('sys', [], []))).rejects.toThrow(/circuit open/);
        expect(inner.createMessage).not.toHaveBeenCalled();
    });
});

describe('composition order: breaker OUTERMOST (buildApiHandler invariant)', () => {
    it('an open breaker fails fast WITHOUT acquiring a rate-limit token', async () => {
        const health = new ProviderHealth();
        const limiter = new RequestRateLimiter();
        const acquire = vi.spyOn(limiter, 'acquire');
        openBreaker(health, 'anthropic');

        const inner = fakeHandler();
        // Same wrapping order as buildApiHandler: limiter inside, breaker outside.
        const limited = withRateLimit(inner, 'anthropic', limiter);
        const wrapped = withCircuitBreaker(limited, 'anthropic', health);

        await expect(drain(wrapped.createMessage('sys', [], []))).rejects.toThrow(/circuit open/);
        // The load-bearing claim: the limiter is never even consulted.
        expect(acquire).not.toHaveBeenCalled();
        expect(inner.createMessage).not.toHaveBeenCalled();
    });

    it('a closed breaker lets the request flow through the limiter to the handler', async () => {
        const health = new ProviderHealth();
        const limiter = new RequestRateLimiter();
        const acquire = vi.spyOn(limiter, 'acquire');
        const inner = fakeHandler();
        const limited = withRateLimit(inner, 'anthropic', limiter);
        const wrapped = withCircuitBreaker(limited, 'anthropic', health);

        const chunks = await drain(wrapped.createMessage('sys', [], []));

        expect(chunks).toEqual([{ type: 'text', text: 'ok' }]);
        expect(acquire).toHaveBeenCalledTimes(1);
        expect(inner.createMessage).toHaveBeenCalledTimes(1);
    });
});

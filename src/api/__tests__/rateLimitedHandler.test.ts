import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRateLimit } from '../index';
import { RequestRateLimiter } from '../RequestRateLimiter';
import type { ApiHandler, ApiStreamChunk, MessageParam } from '../types';

/**
 * IMP-41-02-03: the rate-limit decorator wraps createMessage so EVERY call
 * site (main loop, helpers, subtasks, FastPath planners) passes the bucket.
 * Local providers (ollama, lmstudio) are never wrapped.
 */

function fakeHandler(): ApiHandler {
    return {
        getModel: () => ({ id: 'claude-sonnet-5', info: { contextWindow: 200_000, supportsTools: true, supportsStreaming: true } }),
        createMessage: vi.fn(function (): AsyncIterable<ApiStreamChunk> {
            return (async function* () {
                yield { type: 'text', text: 'ok' } as ApiStreamChunk;
            })();
        }),
    } as unknown as ApiHandler;
}

describe('withRateLimit', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    async function drain(stream: AsyncIterable<ApiStreamChunk>): Promise<ApiStreamChunk[]> {
        const out: ApiStreamChunk[] = [];
        for await (const c of stream) out.push(c);
        return out;
    }

    it('passes chunks through unchanged', async () => {
        const limiter = new RequestRateLimiter();
        const inner = fakeHandler();
        const wrapped = withRateLimit(inner, 'anthropic', limiter);
        const chunks = await drain(wrapped.createMessage('sys', [] as MessageParam[], []));
        expect(chunks).toEqual([{ type: 'text', text: 'ok' }]);
    });

    it('waits for the bucket before dispatching', async () => {
        const limiter = new RequestRateLimiter();
        limiter.configure('anthropic', 'claude-sonnet-5', 6); // burst 1
        const inner = fakeHandler();
        const wrapped = withRateLimit(inner, 'anthropic', limiter);

        await drain(wrapped.createMessage('sys', [], []));      // consumes burst
        const secondDone = vi.fn();
        const second = (async () => { await drain(wrapped.createMessage('sys', [], [])); secondDone(); })();
        await vi.advanceTimersByTimeAsync(0);
        expect(secondDone).not.toHaveBeenCalled();               // still queued
        await vi.advanceTimersByTimeAsync(10_500);
        await second;
        expect(secondDone).toHaveBeenCalled();
    });

    it('preserves getModel and optional members', () => {
        const limiter = new RequestRateLimiter();
        const inner = fakeHandler();
        const wrapped = withRateLimit(inner, 'anthropic', limiter);
        expect(wrapped.getModel().id).toBe('claude-sonnet-5');
        expect(wrapped.countTokens).toBeUndefined();
    });
});

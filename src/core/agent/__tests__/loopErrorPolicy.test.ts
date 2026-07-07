import { describe, it, expect } from 'vitest';
import { decideLoopErrorAction } from '../loopErrorPolicy';

/**
 * IMP-41-01-01 / T2: loop-level error policy.
 *
 * Replaces the two message-regex checks in AgentTask.run()'s catch block
 * (context overflow, 429) with structured classification. New behaviour:
 * transient server/overloaded/network errors are retryable too, Retry-After
 * is honoured, and a 401 whose body mentions "rate limit" is a hard fail.
 */

function apiError(overrides: Record<string, unknown>): Error {
    const err = new Error((overrides.message as string) ?? 'API error');
    Object.assign(err, overrides);
    return err;
}

const BASE_STATE = {
    retriesUsed: 0,
    maxRetries: 3,
    emergencyRetried: false,
    outputCapRetried: false,
    historyLength: 10,
    rateLimitBaseWaitMs: 30_000,
};

describe('decideLoopErrorAction', () => {
    it('sends context overflow to emergency condensing', () => {
        const err = apiError({ status: 400, message: 'prompt is too long: 210000 tokens' });
        expect(decideLoopErrorAction(err, BASE_STATE)).toMatchObject({ action: 'emergency-condense' });
    });

    it('does not emergency-condense twice', () => {
        const err = apiError({ status: 400, message: 'prompt is too long' });
        const result = decideLoopErrorAction(err, { ...BASE_STATE, emergencyRetried: true });
        expect(result.action).toBe('fail');
    });

    it('does not emergency-condense tiny histories', () => {
        const err = apiError({ status: 400, message: 'prompt is too long' });
        const result = decideLoopErrorAction(err, { ...BASE_STATE, historyLength: 3 });
        expect(result.action).toBe('fail');
    });

    it('retries a 429 with the legacy 30s base when no Retry-After is present', () => {
        const err = apiError({ status: 429, message: 'rate limited' });
        const result = decideLoopErrorAction(err, BASE_STATE);
        expect(result).toMatchObject({ action: 'retry', retryNumber: 1, cls: 'rate-limit' });
        if (result.action === 'retry') {
            expect(result.waitMs).toBeGreaterThanOrEqual(30_000 * 0.8);
            expect(result.waitMs).toBeLessThanOrEqual(30_000 * 1.2);
        }
    });

    it('honours Retry-After over the legacy base', () => {
        const err = apiError({ status: 429, headers: { 'retry-after': '3' } });
        const result = decideLoopErrorAction(err, BASE_STATE);
        expect(result).toMatchObject({ action: 'retry', waitMs: 3000 });
    });

    it('retries transient 500/overloaded/network with the short base', () => {
        for (const overrides of [
            { status: 500, message: 'internal error' },
            { status: 529, error: { type: 'overloaded_error' }, message: 'Overloaded' },
            { code: 'ECONNRESET', message: 'socket hang up' },
        ]) {
            const result = decideLoopErrorAction(apiError(overrides), BASE_STATE);
            expect(result.action).toBe('retry');
            if (result.action === 'retry') {
                expect(result.waitMs).toBeLessThanOrEqual(2000 * 1.2);
            }
        }
    });

    it('escalates second retry exponentially', () => {
        const err = apiError({ status: 500 });
        const result = decideLoopErrorAction(err, { ...BASE_STATE, retriesUsed: 1 });
        expect(result).toMatchObject({ action: 'retry', retryNumber: 2 });
        if (result.action === 'retry') {
            expect(result.waitMs).toBeGreaterThanOrEqual(4000 * 0.8);
        }
    });

    it('fails after maxRetries is exhausted', () => {
        const err = apiError({ status: 500 });
        const result = decideLoopErrorAction(err, { ...BASE_STATE, retriesUsed: 3 });
        expect(result.action).toBe('fail');
    });

    it('fails immediately on auth even when the message mentions rate limits', () => {
        const err = apiError({ status: 401, message: 'rate limit plan required' });
        const result = decideLoopErrorAction(err, BASE_STATE);
        expect(result).toMatchObject({ action: 'fail', cls: 'auth' });
    });

    it('signals abort as its own action', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        expect(decideLoopErrorAction(err, BASE_STATE)).toMatchObject({ action: 'abort' });
    });

    it('keeps legacy behaviour: bare rate-limit message text still retries', () => {
        const err = new Error('Rate limit exceeded, please slow down');
        expect(decideLoopErrorAction(err, BASE_STATE)).toMatchObject({ action: 'retry', cls: 'rate-limit' });
    });
});

describe('output-cap corrective retry (ADR-148)', () => {
    it('sends an output-cap 400 to corrective-retry once', () => {
        const err = apiError({
            status: 400,
            message: 'max_tokens: 32000 > 8192, which is the maximum allowed number of output tokens',
        });
        expect(decideLoopErrorAction(err, BASE_STATE)).toMatchObject({ action: 'corrective-retry', cls: 'output-cap' });
    });

    it('fails hard when the corrective retry was already used', () => {
        const err = apiError({
            status: 400,
            message: 'max_tokens: 32000 > 8192, which is the maximum allowed number of output tokens',
        });
        expect(decideLoopErrorAction(err, { ...BASE_STATE, outputCapRetried: true }))
            .toMatchObject({ action: 'fail', cls: 'output-cap' });
    });

    it('handles Bedrock Smithy ValidationException shape', () => {
        const err = apiError({
            name: 'ValidationException',
            $metadata: { httpStatusCode: 400 },
            message: 'The maximum tokens you requested exceeds the model limit',
        });
        expect(decideLoopErrorAction(err, BASE_STATE)).toMatchObject({ action: 'corrective-retry' });
    });
});

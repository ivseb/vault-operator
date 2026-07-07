/**
 * IMP-41-01-01: Provider retry layer.
 *
 * classifyProviderError: structured detection (SDK status/error.type/headers)
 * before regex fallback. getRetryDelayMs: Retry-After header wins, else
 * exponential backoff with jitter. executeWithRetry: abort-aware retry wrapper.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    classifyProviderError,
    getRetryDelayMs,
    isRetryable,
    executeWithRetry,
    RETRY_BASE_DELAY_MS,
    RETRY_MAX_ATTEMPTS,
} from '../retry';

function apiError(overrides: Record<string, unknown>): Error {
    const err = new Error((overrides.message as string) ?? 'API error');
    Object.assign(err, overrides);
    return err;
}

describe('classifyProviderError', () => {
    it('classifies 429 status as rate-limit', () => {
        expect(classifyProviderError(apiError({ status: 429 }))).toBe('rate-limit');
    });

    it('classifies anthropic overloaded_error type as overloaded', () => {
        const err = apiError({ status: 529, error: { type: 'overloaded_error' } });
        expect(classifyProviderError(err)).toBe('overloaded');
    });

    it('classifies 5xx status as server', () => {
        expect(classifyProviderError(apiError({ status: 500 }))).toBe('server');
        expect(classifyProviderError(apiError({ status: 503 }))).toBe('server');
    });

    it('classifies network-level failures as network', () => {
        expect(classifyProviderError(apiError({ message: 'fetch failed' }))).toBe('network');
        expect(classifyProviderError(apiError({ code: 'ECONNRESET', message: 'socket hang up' }))).toBe('network');
        expect(classifyProviderError(apiError({ code: 'ETIMEDOUT', message: 'timed out' }))).toBe('network');
    });

    it('classifies 400 with prompt-too-long message as context-overflow', () => {
        const err = apiError({ status: 400, message: 'prompt is too long: 214000 tokens > 200000 maximum' });
        expect(classifyProviderError(err)).toBe('context-overflow');
    });

    it('classifies legacy context overflow messages without status as context-overflow', () => {
        expect(classifyProviderError(apiError({ message: 'This request exceeds the context length of the model' })))
            .toBe('context-overflow');
    });

    it('classifies 401/403 as auth', () => {
        expect(classifyProviderError(apiError({ status: 401 }))).toBe('auth');
        expect(classifyProviderError(apiError({ status: 403 }))).toBe('auth');
    });

    it('classifies other 4xx as client', () => {
        expect(classifyProviderError(apiError({ status: 404 }))).toBe('client');
        expect(classifyProviderError(apiError({ status: 422 }))).toBe('client');
    });

    it('classifies AbortError as abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        expect(classifyProviderError(err)).toBe('abort');
    });

    it('falls back to regex for bare rate limit messages', () => {
        expect(classifyProviderError(apiError({ message: 'Rate limit exceeded, slow down' }))).toBe('rate-limit');
        expect(classifyProviderError(apiError({ message: 'got HTTP 429 from upstream' }))).toBe('rate-limit');
    });

    it('returns unknown for unclassifiable errors', () => {
        expect(classifyProviderError(apiError({ message: 'something odd' }))).toBe('unknown');
        expect(classifyProviderError('not an error')).toBe('unknown');
    });

    it('prefers structured status over misleading message text', () => {
        // A 401 whose body mentions "rate limit" must stay auth (no retry storm on bad keys).
        const err = apiError({ status: 401, message: 'rate limit plan required' });
        expect(classifyProviderError(err)).toBe('auth');
    });
});

describe('isRetryable', () => {
    it('marks transient classes retryable', () => {
        expect(isRetryable('rate-limit')).toBe(true);
        expect(isRetryable('overloaded')).toBe(true);
        expect(isRetryable('server')).toBe(true);
        expect(isRetryable('network')).toBe(true);
    });

    it('marks terminal classes non-retryable', () => {
        expect(isRetryable('auth')).toBe(false);
        expect(isRetryable('client')).toBe(false);
        expect(isRetryable('abort')).toBe(false);
        expect(isRetryable('context-overflow')).toBe(false);
        expect(isRetryable('unknown')).toBe(false);
    });
});

describe('getRetryDelayMs', () => {
    it('uses Retry-After seconds header when present', () => {
        const err = apiError({ status: 429, headers: { 'retry-after': '5' } });
        expect(getRetryDelayMs(err, 1)).toBe(5000);
    });

    it('supports headers exposed via get()', () => {
        const headers = new Map([['retry-after', '7']]);
        const err = apiError({ status: 429, headers });
        expect(getRetryDelayMs(err, 1)).toBe(7000);
    });

    it('parses HTTP-date Retry-After relative to now', () => {
        const date = new Date(Date.now() + 10_000).toUTCString();
        const err = apiError({ status: 429, headers: { 'retry-after': date } });
        const delay = getRetryDelayMs(err, 1);
        expect(delay).toBeGreaterThan(8000);
        expect(delay).toBeLessThanOrEqual(11000);
    });

    it('clamps Retry-After to [1s, 120s]', () => {
        const low = apiError({ headers: { 'retry-after': '0' } });
        const high = apiError({ headers: { 'retry-after': '600' } });
        expect(getRetryDelayMs(low, 1)).toBe(1000);
        expect(getRetryDelayMs(high, 1)).toBe(120_000);
    });

    it('falls back to exponential backoff with jitter', () => {
        const err = apiError({ status: 500 });
        for (const [attempt, base] of [[1, RETRY_BASE_DELAY_MS], [2, RETRY_BASE_DELAY_MS * 2], [3, RETRY_BASE_DELAY_MS * 4]] as const) {
            const delay = getRetryDelayMs(err, attempt);
            expect(delay).toBeGreaterThanOrEqual(base * 0.8);
            expect(delay).toBeLessThanOrEqual(base * 1.2);
        }
    });
});

describe('executeWithRetry', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('retries transient failures and succeeds', async () => {
        let calls = 0;
        const fn = vi.fn(async () => {
            calls++;
            if (calls < 3) throw apiError({ status: 500 });
            return 'ok';
        });
        const promise = executeWithRetry(fn);
        await vi.runAllTimersAsync();
        await expect(promise).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('throws immediately on non-retryable errors', async () => {
        const fn = vi.fn(async () => { throw apiError({ status: 401, message: 'bad key' }); });
        await expect(executeWithRetry(fn)).rejects.toThrow('bad key');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('gives up after RETRY_MAX_ATTEMPTS', async () => {
        const fn = vi.fn(async () => { throw apiError({ status: 503, message: 'still down' }); });
        const promise = executeWithRetry(fn);
        promise.catch(() => { /* inspected below */ });
        await vi.runAllTimersAsync();
        await expect(promise).rejects.toThrow('still down');
        expect(fn).toHaveBeenCalledTimes(RETRY_MAX_ATTEMPTS);
    });

    it('aborts the backoff wait when the signal fires', async () => {
        const controller = new AbortController();
        const fn = vi.fn(async () => { throw apiError({ status: 500 }); });
        const promise = executeWithRetry(fn, { abortSignal: controller.signal });
        promise.catch(() => { /* inspected below */ });
        controller.abort();
        await vi.runAllTimersAsync();
        await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
        expect(fn).toHaveBeenCalledTimes(1);
    });
});

describe('output-cap classification (ADR-148)', () => {
    it('classifies an Anthropic max_tokens-over-limit 400 as output-cap and parses the limit', async () => {
        const { classifyProviderError, parseOutputCapLimit } = await import('../retry');
        const err = {
            status: 400,
            message: 'max_tokens: 32000 > 8192, which is the maximum allowed number of output tokens for this model',
        };
        expect(classifyProviderError(err)).toBe('output-cap');
        expect(parseOutputCapLimit(err)).toBe(8192);
    });

    it('classifies a Bedrock Smithy ValidationException via name/$metadata (no .status field)', async () => {
        const { classifyProviderError, parseOutputCapLimit } = await import('../retry');
        const err = {
            name: 'ValidationException',
            $metadata: { httpStatusCode: 400 },
            message: 'The maximum tokens you requested exceeds the model limit',
        };
        expect(classifyProviderError(err)).toBe('output-cap');
        expect(parseOutputCapLimit(err)).toBeNull();
    });

    it('does NOT classify budget_tokens validation errors as output-cap', async () => {
        const { classifyProviderError } = await import('../retry');
        const err = { status: 400, message: 'thinking.enabled.budget_tokens: Field required' };
        expect(classifyProviderError(err)).toBe('client');
    });

    it('keeps prompt-too-long as context-overflow, not output-cap', async () => {
        const { classifyProviderError } = await import('../retry');
        const err = { status: 400, message: 'prompt is too long: 214000 tokens > 200000 maximum' };
        expect(classifyProviderError(err)).toBe('context-overflow');
    });

    it('a Smithy throttling exception maps to rate-limit via $metadata', async () => {
        const { classifyProviderError } = await import('../retry');
        const err = { name: 'ThrottlingException', $metadata: { httpStatusCode: 429 }, message: 'Too many requests' };
        expect(classifyProviderError(err)).toBe('rate-limit');
    });
});

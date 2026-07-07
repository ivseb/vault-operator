import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RequestRateLimiter } from '../RequestRateLimiter';

/**
 * IMP-41-02-03 / ADR-146: token-bucket rate limiter per (provider, model).
 *
 * Replaces the fixed inter-iteration sleep in AgentTask: helper calls,
 * subtasks and FastPath planners all bypassed that sleep, and one global
 * value throttled every provider including local ones. The bucket sits in
 * the ApiHandler wrapper so EVERY call site passes through it. A 429
 * observed by the retry layer halves the rate for a cooldown window.
 */

describe('RequestRateLimiter', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('lets requests through immediately when unlimited (rpm 0)', async () => {
        const limiter = new RequestRateLimiter();
        limiter.configure('anthropic', 'claude-sonnet-5', 0);
        await expect(limiter.acquire('anthropic', 'claude-sonnet-5')).resolves.toBeUndefined();
    });

    it('lets burst-sized request groups through, then spaces them', async () => {
        const limiter = new RequestRateLimiter();
        limiter.configure('anthropic', 'claude-sonnet-5', 6); // burst = max(1, 6/6) = 1
        const order: number[] = [];
        const first = limiter.acquire('anthropic', 'claude-sonnet-5').then(() => order.push(1));
        const second = limiter.acquire('anthropic', 'claude-sonnet-5').then(() => order.push(2));
        await vi.advanceTimersByTimeAsync(0);
        expect(order).toEqual([1]);          // burst of 1 passes instantly
        await vi.advanceTimersByTimeAsync(10_000); // 6 rpm = 1 token / 10s
        await Promise.all([first, second]);
        expect(order).toEqual([1, 2]);
    });

    it('keeps separate buckets per model', async () => {
        const limiter = new RequestRateLimiter();
        limiter.configure('anthropic', 'model-a', 6);
        limiter.configure('anthropic', 'model-b', 6);
        const done: string[] = [];
        void limiter.acquire('anthropic', 'model-a').then(() => done.push('a1'));
        void limiter.acquire('anthropic', 'model-b').then(() => done.push('b1'));
        await vi.advanceTimersByTimeAsync(0);
        expect(done.sort()).toEqual(['a1', 'b1']); // no cross-model contention
    });

    it('aborts a pending acquire', async () => {
        const limiter = new RequestRateLimiter();
        limiter.configure('anthropic', 'm', 6);
        await limiter.acquire('anthropic', 'm'); // consume the burst token
        const controller = new AbortController();
        const pending = limiter.acquire('anthropic', 'm', controller.signal);
        pending.catch(() => { /* asserted below */ });
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('halves the rate after a reported 429 and restores it after the cooldown', async () => {
        const limiter = new RequestRateLimiter();
        limiter.configure('anthropic', 'm', 60); // 1/s
        limiter.reportRateLimited('anthropic', 'm');
        expect(limiter.getEffectiveRpm('anthropic', 'm')).toBe(30);
        await vi.advanceTimersByTimeAsync(5 * 60_000 + 1000);
        expect(limiter.getEffectiveRpm('anthropic', 'm')).toBe(60);
    });

    it('treats unconfigured keys as unlimited', async () => {
        const limiter = new RequestRateLimiter();
        await expect(limiter.acquire('ollama', 'qwen3:8b')).resolves.toBeUndefined();
        expect(limiter.getEffectiveRpm('ollama', 'qwen3:8b')).toBe(0);
    });
});

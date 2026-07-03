import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { wireApprovalTimeout } from '../approvalTimeout';

/**
 * IMP-41-01-02: approval cards auto-deny after a timeout and resolve
 * immediately when the task's abort signal fires, so the loop can never
 * hang forever on a walked-away user or an already-stopped task.
 */

describe('wireApprovalTimeout', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('fires onExpire after the timeout', () => {
        const onExpire = vi.fn();
        wireApprovalTimeout({ timeoutMs: 60_000, onExpire, onAbort: vi.fn() });
        vi.advanceTimersByTime(59_999);
        expect(onExpire).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it('does nothing when timeoutMs is 0 (disabled)', () => {
        const onExpire = vi.fn();
        wireApprovalTimeout({ timeoutMs: 0, onExpire, onAbort: vi.fn() });
        vi.advanceTimersByTime(3_600_000);
        expect(onExpire).not.toHaveBeenCalled();
    });

    it('fires onAbort when the signal fires and stops the timeout', () => {
        const onExpire = vi.fn();
        const onAbort = vi.fn();
        const controller = new AbortController();
        wireApprovalTimeout({ timeoutMs: 60_000, abortSignal: controller.signal, onExpire, onAbort });
        controller.abort();
        expect(onAbort).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(120_000);
        expect(onExpire).not.toHaveBeenCalled();
    });

    it('fires onAbort immediately for an already-aborted signal', () => {
        const onAbort = vi.fn();
        const controller = new AbortController();
        controller.abort();
        wireApprovalTimeout({ timeoutMs: 60_000, abortSignal: controller.signal, onExpire: vi.fn(), onAbort });
        expect(onAbort).toHaveBeenCalledTimes(1);
    });

    it('ticks the countdown only within the final 60 seconds', () => {
        const ticks: number[] = [];
        wireApprovalTimeout({
            timeoutMs: 90_000,
            onExpire: vi.fn(),
            onAbort: vi.fn(),
            onCountdownTick: (sec) => ticks.push(sec),
        });
        vi.advanceTimersByTime(29_000);
        expect(ticks.length).toBe(0);
        vi.advanceTimersByTime(31_000); // now 30s remaining
        expect(ticks.length).toBeGreaterThan(0);
        expect(Math.max(...ticks)).toBeLessThanOrEqual(60);
    });

    it('dispose() clears timers and listeners', () => {
        const onExpire = vi.fn();
        const onAbort = vi.fn();
        const controller = new AbortController();
        const handle = wireApprovalTimeout({
            timeoutMs: 60_000, abortSignal: controller.signal, onExpire, onAbort,
        });
        handle.dispose();
        vi.advanceTimersByTime(120_000);
        controller.abort();
        expect(onExpire).not.toHaveBeenCalled();
        expect(onAbort).not.toHaveBeenCalled();
    });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { scheduleRecurring } from '../scheduleRecurring';

describe('scheduleRecurring', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('runs the task on each interval', () => {
        let count = 0;
        const handle = scheduleRecurring(() => { count++; }, 100);
        vi.advanceTimersByTime(350);
        expect(count).toBe(3);
        handle.stop();
    });

    it('stop prevents further ticks (idempotent)', () => {
        let count = 0;
        const handle = scheduleRecurring(() => { count++; }, 100);
        vi.advanceTimersByTime(100);
        expect(count).toBe(1);
        handle.stop();
        handle.stop();
        vi.advanceTimersByTime(500);
        expect(count).toBe(1);
    });

    it('does not overlap async runs even if the task is slower than the interval', async () => {
        // FIX-PERF-31: previously the next tick was scheduled before the
        // awaited promise resolved, so a slow task could run in parallel
        // with the next tick. Now the next tick is scheduled only after
        // the previous one resolves.
        const starts: number[] = [];
        const completions: number[] = [];
        let inFlight = 0;
        let maxInFlight = 0;
        const handle = scheduleRecurring(async () => {
            starts.push(Date.now());
            inFlight++;
            if (inFlight > maxInFlight) maxInFlight = inFlight;
            await new Promise<void>((resolve) => setTimeout(resolve, 300));
            inFlight--;
            completions.push(Date.now());
        }, 50);

        // Advance enough wall-time for several intervals plus several task runs.
        for (let i = 0; i < 20; i++) {
            await vi.advanceTimersByTimeAsync(50);
        }

        handle.stop();
        // Drain whatever in-flight task is still going.
        await vi.advanceTimersByTimeAsync(500);

        expect(maxInFlight).toBe(1);
        // Each completion must precede the next start.
        for (let i = 1; i < starts.length; i++) {
            expect(starts[i]).toBeGreaterThanOrEqual(completions[i - 1]);
        }
    });

    it('a thrown error in the task does not break the recurrence', () => {
        let count = 0;
        const handle = scheduleRecurring(() => {
            count++;
            if (count === 1) throw new Error('boom');
        }, 100);
        vi.advanceTimersByTime(350);
        expect(count).toBe(3);
        handle.stop();
    });

    it('a rejected async task does not break the recurrence', async () => {
        let count = 0;
        const handle = scheduleRecurring(async () => {
            count++;
            if (count === 1) throw new Error('boom');
        }, 100);
        await vi.advanceTimersByTimeAsync(350);
        expect(count).toBeGreaterThanOrEqual(3);
        handle.stop();
    });
});

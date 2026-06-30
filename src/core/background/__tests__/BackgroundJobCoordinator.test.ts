import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BackgroundJobCoordinator } from '../BackgroundJobCoordinator';

describe('BackgroundJobCoordinator', () => {
    let coord: BackgroundJobCoordinator;

    beforeEach(() => {
        vi.useFakeTimers();
        coord = new BackgroundJobCoordinator();
    });

    afterEach(async () => {
        // Cancel future ticks first, then drain any in-flight setTimeout
        // waits, then dispose. Switching to real timers before draining
        // would orphan the pending fake setTimeouts inside running jobs.
        const reportBefore = coord.getReport();
        for (const r of reportBefore) coord.cancel(r.id);
        await vi.advanceTimersByTimeAsync(500);
        await coord.dispose();
        vi.useRealTimers();
    });

    it('register + interval triggers the job', async () => {
        let count = 0;
        coord.register({
            id: 'tick',
            resources: ['fake-db'],
            everyMs: 100,
            run: () => { count++; },
        });
        await vi.advanceTimersByTimeAsync(350);
        expect(count).toBe(3);
    });

    it('two jobs on the same resource serialize, no overlap', async () => {
        let inFlight = 0;
        let maxInFlight = 0;
        const make = (id: string) => coord.register({
            id,
            resources: ['shared'],
            everyMs: 50,
            run: async () => {
                inFlight++;
                if (inFlight > maxInFlight) maxInFlight = inFlight;
                await new Promise<void>((r) => setTimeout(r, 200));
                inFlight--;
            },
        });
        make('a'); make('b');
        for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(50);
        expect(maxInFlight).toBe(1);
    });

    it('two jobs on different resources run in parallel', async () => {
        let inFlight = 0;
        let maxInFlight = 0;
        const make = (id: string, res: string) => coord.register({
            id,
            resources: [res],
            everyMs: 50,
            run: async () => {
                inFlight++;
                if (inFlight > maxInFlight) maxInFlight = inFlight;
                await new Promise<void>((r) => setTimeout(r, 200));
                inFlight--;
            },
        });
        make('a', 'res-a'); make('b', 'res-b');
        for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(50);
        expect(maxInFlight).toBeGreaterThanOrEqual(2);
    });

    it('cancel stops future ticks', async () => {
        let count = 0;
        coord.register({
            id: 'killable',
            resources: ['x'],
            everyMs: 100,
            run: () => { count++; },
        });
        await vi.advanceTimersByTimeAsync(100);
        expect(count).toBe(1);
        coord.cancel('killable');
        await vi.advanceTimersByTimeAsync(500);
        expect(count).toBe(1);
    });

    it('re-register replaces the previous record', async () => {
        let countA = 0;
        let countB = 0;
        coord.register({ id: 'x', resources: ['r'], everyMs: 100, run: () => { countA++; } });
        coord.register({ id: 'x', resources: ['r'], everyMs: 100, run: () => { countB++; } });
        await vi.advanceTimersByTimeAsync(300);
        // The first registration was replaced; only countB grows.
        expect(countA).toBe(0);
        expect(countB).toBe(3);
    });

    it('thrown errors in a job are logged but do not break recurrence', async () => {
        let count = 0;
        coord.register({
            id: 'err',
            resources: ['r'],
            everyMs: 100,
            run: () => {
                count++;
                if (count === 1) throw new Error('boom');
            },
        });
        await vi.advanceTimersByTimeAsync(350);
        expect(count).toBe(3);
        const report = coord.getReport().find((r) => r.id === 'err');
        expect(report).toBeDefined();
    });

    it('dispose awaits in-flight runs and stops future ticks', async () => {
        let finishedInFlight = false;
        coord.register({
            id: 'slow',
            resources: ['r'],
            everyMs: 50,
            run: async () => {
                await new Promise<void>((r) => setTimeout(r, 200));
                finishedInFlight = true;
            },
        });
        await vi.advanceTimersByTimeAsync(50);
        // Job started. Now dispose with a slow run in flight.
        const disposePromise = coord.dispose();
        // Let the in-flight run complete.
        await vi.advanceTimersByTimeAsync(300);
        await disposePromise;
        expect(finishedInFlight).toBe(true);
    });

    it('getReport carries telemetry per registered job', async () => {
        coord.register({ id: 'a', resources: ['r'], everyMs: 100, run: () => {} });
        await vi.advanceTimersByTimeAsync(150);
        const report = coord.getReport();
        const entry = report.find((r) => r.id === 'a');
        expect(entry?.runCount).toBeGreaterThanOrEqual(1);
        expect(entry?.lastError).toBeNull();
    });
});

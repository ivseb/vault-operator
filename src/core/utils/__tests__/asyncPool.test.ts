import { describe, it, expect } from 'vitest';
import { Semaphore, mapWithConcurrency } from '../asyncPool';

const tick = (ms = 1) => new Promise((r) => setTimeout(r, ms));

describe('Semaphore', () => {
    it('never runs more than `limit` tasks at once', async () => {
        const sem = new Semaphore(3);
        let active = 0;
        let peak = 0;
        const task = async () => {
            active++;
            peak = Math.max(peak, active);
            await tick(3);
            active--;
        };
        await Promise.all(Array.from({ length: 20 }, () => sem.run(task)));
        expect(peak).toBe(3);
        expect(active).toBe(0);
    });

    it('releases the slot even when the task throws', async () => {
        const sem = new Semaphore(1);
        await expect(sem.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
        // A subsequent task must still be able to acquire the (released) slot.
        const ok = await sem.run(async () => 'ok');
        expect(ok).toBe('ok');
    });

    it('runs FIFO and returns each task result', async () => {
        const sem = new Semaphore(1);
        const order: number[] = [];
        const results = await Promise.all([1, 2, 3].map((n) => sem.run(async () => { order.push(n); await tick(1); return n * 10; })));
        expect(order).toEqual([1, 2, 3]);
        expect(results).toEqual([10, 20, 30]);
    });
});

describe('mapWithConcurrency', () => {
    it('processes every item, preserving input order in the results', async () => {
        const items = [5, 1, 4, 2, 3];
        const out = await mapWithConcurrency(items, 2, async (n) => { await tick(n); return n * 2; });
        expect(out).toEqual([10, 2, 8, 4, 6]);
    });

    it('never exceeds the concurrency limit', async () => {
        let active = 0;
        let peak = 0;
        await mapWithConcurrency(Array.from({ length: 15 }, (_, i) => i), 4, async () => {
            active++; peak = Math.max(peak, active); await tick(2); active--;
        });
        expect(peak).toBe(4);
    });

    it('handles an empty list and a limit larger than the list', async () => {
        expect(await mapWithConcurrency([], 4, async (x) => x)).toEqual([]);
        expect(await mapWithConcurrency([1, 2], 10, async (x: number) => x + 1)).toEqual([2, 3]);
    });

    // AUDIT 2026-07-07 POOL-1: after the first worker rejection settled
    // Promise.all, surviving runners kept pulling next++ and processed every
    // remaining item detached (orphaned LLM calls, later rejections silently
    // swallowed). Runners must stop picking up new items once one failed.
    it('POOL-1: stops picking up new items after the first worker rejection', async () => {
        const started: number[] = [];
        const items = Array.from({ length: 20 }, (_, i) => i);
        await expect(mapWithConcurrency(items, 2, async (n) => {
            started.push(n);
            if (n === 1) throw new Error('boom');
            await tick(3);
            return n;
        })).rejects.toThrow('boom');
        // Let any detached runners drain before asserting.
        await tick(20);
        // With 2 workers and item 1 failing immediately, only a handful of
        // items may have started; the pre-fix behaviour processed all 20.
        expect(started.length).toBeLessThan(6);
    });
});

describe('Semaphore constructor guard (POOL-1)', () => {
    it('rejects a non-positive limit instead of deadlocking every caller', () => {
        expect(() => new Semaphore(0)).toThrow();
        expect(() => new Semaphore(-1)).toThrow();
    });
});

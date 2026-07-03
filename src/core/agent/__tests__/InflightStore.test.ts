import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InflightStore } from '../InflightStore';
import { createInitialLoopState } from '../LoopState';
import type { InflightSnapshot } from '../InflightStore';

/**
 * IMP-41-03-01 / ADR-149: in-flight task persistence.
 *
 * One JSON file in the GlobalFS data root holds the snapshots of running
 * tasks (max one foreground task today). Saved at every turn boundary
 * (debounced), cleared on clean end, swept after 24h. A crash mid-run
 * leaves a loadable snapshot instead of losing the turn.
 */

function makeFs(): { files: Map<string, string>; exists: (p: string) => Promise<boolean>; read: (p: string) => Promise<string>; write: (p: string, c: string) => Promise<void> } {
    const files = new Map<string, string>();
    return {
        files,
        exists: async (p: string) => files.has(p),
        read: async (p: string) => files.get(p) ?? '',
        write: async (p: string, c: string) => { files.set(p, c); },
    };
}

function snap(taskId: string, savedAt: number): InflightSnapshot {
    return {
        taskId,
        conversationId: 'conv-1',
        mode: 'agent',
        savedAt,
        state: createInitialLoopState(),
        history: [{ role: 'user', content: 'do things' }],
    };
}

describe('InflightStore', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('persists a snapshot and lists it as recoverable', async () => {
        const fs = makeFs();
        const store = new InflightStore(fs);
        await store.saveSnapshot(snap('task-1', Date.now()));
        await vi.runAllTimersAsync();

        const recoverable = await store.listRecoverable(24 * 3600 * 1000, Date.now());
        expect(recoverable).toHaveLength(1);
        expect(recoverable[0].taskId).toBe('task-1');
        expect(recoverable[0].history[0].content).toBe('do things');
    });

    it('debounces rapid snapshots into one write', async () => {
        const fs = makeFs();
        const writeSpy = vi.spyOn(fs, 'write');
        const store = new InflightStore(fs);
        await store.saveSnapshot(snap('task-1', 1));
        await store.saveSnapshot(snap('task-1', 2));
        await store.saveSnapshot(snap('task-1', 3));
        await vi.runAllTimersAsync();
        expect(writeSpy.mock.calls.length).toBeLessThanOrEqual(2);
        const recoverable = await store.listRecoverable(Infinity, Date.now());
        expect(recoverable[0].savedAt).toBe(3); // latest wins
    });

    it('clear removes the task snapshot', async () => {
        const fs = makeFs();
        const store = new InflightStore(fs);
        await store.saveSnapshot(snap('task-1', Date.now()));
        await vi.runAllTimersAsync();
        await store.clear('task-1');
        expect(await store.listRecoverable(Infinity, Date.now())).toHaveLength(0);
    });

    it('sweeps snapshots older than the max age', async () => {
        const fs = makeFs();
        const store = new InflightStore(fs);
        const now = Date.now();
        await store.saveSnapshot(snap('old-task', now - 25 * 3600 * 1000));
        await store.saveSnapshot(snap('fresh-task', now - 3600 * 1000));
        await vi.runAllTimersAsync();

        const recoverable = await store.listRecoverable(24 * 3600 * 1000, now);
        expect(recoverable.map((s) => s.taskId)).toEqual(['fresh-task']);
    });

    it('survives a corrupt file gracefully', async () => {
        const fs = makeFs();
        fs.files.set('inflight-tasks.json', '{ not json');
        const store = new InflightStore(fs);
        await expect(store.listRecoverable(Infinity, Date.now())).resolves.toEqual([]);
    });
});

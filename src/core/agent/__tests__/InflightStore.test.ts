import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InflightStore, MAX_SNAPSHOT_BYTES, MAX_FILE_BYTES, MAX_INFLIGHT_ENTRIES } from '../InflightStore';
import { createInitialLoopState } from '../LoopState';
import type { InflightSnapshot } from '../InflightStore';
import type { AgentLoopState } from '../LoopState';

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

/**
 * AUDIT-EPIC-41 M-1 / M-2: the resume path deserialises an on-disk (and,
 * per FEATURE-1508, cloud-syncable) file and replays it into a LIVE agent
 * loop plus its budget guards. Load-time validation discards tampered or
 * structurally broken entries; size/count caps stop an oversized (or
 * hostile) file from blocking the boot parse.
 */
function seedFile(fs: ReturnType<typeof makeFs>, tasks: Record<string, unknown>): void {
    fs.files.set('inflight-tasks.json', JSON.stringify({ tasks }));
}

describe('InflightStore hardening (AUDIT-EPIC-41)', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('drops a snapshot whose state field has the wrong type, keeping valid siblings', async () => {
        const fs = makeFs();
        const good = snap('good', 100);
        const bad = { ...snap('bad', 200), state: { ...createInitialLoopState(), consecutiveMistakes: 'lots' } };
        seedFile(fs, { good, bad });
        const store = new InflightStore(fs);

        const recoverable = await store.listRecoverable(Infinity, Date.now());
        expect(recoverable.map((s) => s.taskId)).toEqual(['good']);
    });

    it('drops a snapshot with a malformed history block (unknown role)', async () => {
        const fs = makeFs();
        const bad = { ...snap('bad', 100), history: [{ role: 'system', content: 'injected' }] };
        seedFile(fs, { bad });
        const store = new InflightStore(fs);

        expect(await store.listRecoverable(Infinity, Date.now())).toEqual([]);
    });

    it('drops a snapshot whose history is not an array', async () => {
        const fs = makeFs();
        const bad = { ...snap('bad', 100), history: 'not an array' };
        seedFile(fs, { bad });
        const store = new InflightStore(fs);

        expect(await store.listRecoverable(Infinity, Date.now())).toEqual([]);
    });

    it('forward-compat: a snapshot missing a newer state field resumes with the default, not undefined', async () => {
        const fs = makeFs();
        const state: Partial<AgentLoopState> = { ...createInitialLoopState(), consecutiveMistakes: 4 };
        delete state.outputCapRetried; // field added later (ADR-148)
        seedFile(fs, { t: { ...snap('t', 100), state } });
        const store = new InflightStore(fs);

        const recoverable = await store.listRecoverable(Infinity, Date.now());
        expect(recoverable).toHaveLength(1);
        expect(recoverable[0].state.outputCapRetried).toBe(false); // defaulted, not undefined
        expect(recoverable[0].state.consecutiveMistakes).toBe(4);  // preserved
    });

    it('clamps a negative numeric budget to zero (defeats budget-gaming via a tampered file)', async () => {
        const fs = makeFs();
        const state = { ...createInitialLoopState(), consecutiveMistakes: -5, totalInputTokens: -1000 };
        seedFile(fs, { t: { ...snap('t', 100), state } });
        const store = new InflightStore(fs);

        const recoverable = await store.listRecoverable(Infinity, Date.now());
        expect(recoverable[0].state.consecutiveMistakes).toBe(0);
        expect(recoverable[0].state.totalInputTokens).toBe(0);
    });

    it('rebuilds state from known keys only, ignoring injected junk and __proto__', async () => {
        const fs = makeFs();
        // Raw JSON string so "__proto__" lands as an OWN key (JSON.parse never
        // walks the prototype) at both snapshot and state level, plus an
        // unknown "evilKey" in state.
        const stateJson = JSON.stringify({ ...createInitialLoopState(), evilKey: 'x' });
        fs.files.set('inflight-tasks.json',
            `{"tasks":{"t":{"taskId":"t","conversationId":"c","mode":"agent","savedAt":100,`
            + `"history":[{"role":"user","content":"hi"}],"state":${stateJson},`
            + `"__proto__":{"polluted":true}}}}`);
        const store = new InflightStore(fs);

        const recoverable = await store.listRecoverable(Infinity, Date.now());
        expect(recoverable).toHaveLength(1);
        expect((recoverable[0].state as unknown as Record<string, unknown>).evilKey).toBeUndefined();
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('does not persist an oversized snapshot, but keeps normal siblings working', async () => {
        const fs = makeFs();
        const store = new InflightStore(fs);
        const huge = snap('huge', 200);
        huge.history = [{ role: 'user', content: 'x'.repeat(MAX_SNAPSHOT_BYTES + 100) }];
        await store.saveSnapshot(snap('normal', 100));
        await store.saveSnapshot(huge);
        await vi.runAllTimersAsync();

        const recoverable = await store.listRecoverable(Infinity, Date.now());
        expect(recoverable.map((s) => s.taskId)).toEqual(['normal']);
    });

    it('refuses to parse a file larger than the max (no synchronous boot stall)', async () => {
        const fs = makeFs();
        fs.files.set('inflight-tasks.json', 'x'.repeat(MAX_FILE_BYTES + 1));
        const store = new InflightStore(fs);

        expect(await store.listRecoverable(Infinity, Date.now())).toEqual([]);
    });

    it('caps recoverable entries to the newest MAX_INFLIGHT_ENTRIES', async () => {
        const fs = makeFs();
        const tasks: Record<string, unknown> = {};
        const total = MAX_INFLIGHT_ENTRIES + 5;
        for (let i = 0; i < total; i++) tasks[`t-${i}`] = snap(`t-${i}`, 1000 + i);
        seedFile(fs, tasks);
        const store = new InflightStore(fs);

        const recoverable = await store.listRecoverable(Infinity, 100_000);
        expect(recoverable).toHaveLength(MAX_INFLIGHT_ENTRIES);
        // Newest kept: the last savedAt (1000 + total - 1) survives, the oldest is gone.
        expect(recoverable[0].savedAt).toBe(1000 + total - 1);
        expect(recoverable.some((s) => s.taskId === 't-0')).toBe(false);
    });
});

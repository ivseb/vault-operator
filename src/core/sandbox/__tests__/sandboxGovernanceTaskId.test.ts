/**
 * FIX-44-43: the governance taskId must travel PER EXECUTION, not as mutable
 * state on the shared bridge singleton.
 *
 * Adversarial review 2026-07-14 (CONFIRMED, P2). The FIX-44-04 mechanism
 * ref-counted the depth but kept a single last-writer-wins governanceTaskId
 * slot on SandboxBridge: with two overlapping sandbox executions from
 * different tasks, the earlier task's writes were checkpointed under the
 * WRONG taskId -- restore_checkpoint for the owning task missed them, and
 * after the second task released, the remaining writes were misattributed
 * too.
 *
 * The rule these tests pin:
 *   - SandboxBridge.vaultWrite / vaultWriteBinary take the governance taskId
 *     per operation and snapshot under exactly that task
 *   - the executors resolve the worker-echoed execId back to the taskId that
 *     was passed to execute(..., { governanceTaskId }) -- so overlapping
 *     executions from different tasks each keep their own attribution
 *   - no taskId in scope still means no snapshot (bare unit test, module
 *     validation probe)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TFile } from 'obsidian';
import { SandboxBridge } from '../SandboxBridge';
import { ProcessSandboxExecutor } from '../ProcessSandboxExecutor';

// ---------------------------------------------------------------------------
// Shared plugin fake (same shape as SandboxBridge.governance.test.ts)
// ---------------------------------------------------------------------------

function makePlugin(opts: {
    snapshot: (...a: unknown[]) => Promise<unknown>;
    tFiles?: Record<string, unknown>;
}) {
    const adapter = {
        exists: async () => true,
        read: async (p: string) => `content of ${p}`,
        readBinary: async () => new ArrayBuffer(4),
        write: async () => { /* no-op */ },
        writeBinary: async () => { /* no-op */ },
        list: async () => ({ files: [], folders: [] }),
        mkdir: async () => { /* no-op */ },
        rename: async () => { /* no-op */ },
        remove: async () => { /* no-op */ },
    };
    const vault = {
        adapter,
        configDir: '.obsidian',
        getAbstractFileByPath: (p: string) => opts.tFiles?.[p] ?? null,
        read: async () => 'tfile',
        modify: async () => { /* no-op */ },
        create: async () => { /* no-op */ },
        modifyBinary: async () => { /* no-op */ },
        createBinary: async () => { /* no-op */ },
    };
    return {
        app: { vault },
        settings: {
            agentFolderPath: '.vault-operator',
            layoutVersion: 2,
            enableCheckpoints: true,
        },
        ignoreService: undefined,
        checkpointService: { snapshot: opts.snapshot },
    } as unknown as import('../../../main').default;
}

function fakeTFile(): unknown {
    // No `as TFile` cast (review-bot rule) -- the bridge only needs the
    // object to pass its `instanceof TFile` check.
    return Object.create(TFile.prototype);
}

// ---------------------------------------------------------------------------
// Bridge level: taskId per operation
// ---------------------------------------------------------------------------

describe('SandboxBridge per-operation governance taskId (FIX-44-43)', () => {
    it('snapshots under the taskId passed with the write', async () => {
        const snapshot = vi.fn(async (..._a: unknown[]) => ({ commitOid: 'abc' }));
        const plugin = makePlugin({ snapshot, tFiles: { 'Notes/ok.md': fakeTFile() } });
        const bridge = new SandboxBridge(plugin);

        await bridge.vaultWrite('Notes/ok.md', 'hello', 'task-42');

        expect(snapshot).toHaveBeenCalledTimes(1);
        expect(snapshot.mock.calls[0][0]).toBe('task-42');
        expect(snapshot.mock.calls[0][1]).toEqual(['Notes/ok.md']);
    });

    it('attributes overlapping writes from two tasks to their own taskIds', async () => {
        const snapshot = vi.fn(async (..._a: unknown[]) => ({ commitOid: 'abc' }));
        const plugin = makePlugin({
            snapshot,
            tFiles: { 'Notes/a.md': fakeTFile(), 'Notes/b.md': fakeTFile() },
        });
        const bridge = new SandboxBridge(plugin);

        // Two in-flight executions interleave their writes on the shared bridge.
        await Promise.all([
            bridge.vaultWrite('Notes/a.md', 'from A', 'task-A'),
            bridge.vaultWrite('Notes/b.md', 'from B', 'task-B'),
        ]);

        const byPath = new Map(snapshot.mock.calls.map((c) => [(c[1] as string[])[0], c[0]]));
        expect(byPath.get('Notes/a.md')).toBe('task-A');
        expect(byPath.get('Notes/b.md')).toBe('task-B');
    });

    it('binary writes carry the per-operation taskId too', async () => {
        const snapshot = vi.fn(async (..._a: unknown[]) => ({ commitOid: 'abc' }));
        const plugin = makePlugin({ snapshot, tFiles: { 'Notes/bin.png': fakeTFile() } });
        const bridge = new SandboxBridge(plugin);

        await bridge.vaultWriteBinary('Notes/bin.png', new ArrayBuffer(4), 'task-bin');

        expect(snapshot).toHaveBeenCalledTimes(1);
        expect(snapshot.mock.calls[0][0]).toBe('task-bin');
    });

    it('does not snapshot when no taskId travels with the write', async () => {
        const snapshot = vi.fn(async (..._a: unknown[]) => ({ commitOid: 'abc' }));
        const plugin = makePlugin({ snapshot, tFiles: { 'Notes/ok.md': fakeTFile() } });
        const bridge = new SandboxBridge(plugin);

        await bridge.vaultWrite('Notes/ok.md', 'hello');

        expect(snapshot).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Executor level: execId resolves back to the execution's taskId
// ---------------------------------------------------------------------------

interface ExecutorPrivates {
    ready: boolean;
    worker: { send: (m: unknown) => void } | null;
    handleMessage(m: unknown): Promise<void>;
}

describe('ProcessSandboxExecutor threads the governance taskId per execution (FIX-44-43)', () => {
    const g = globalThis as { window?: unknown };
    let savedWindow: unknown;

    beforeEach(() => {
        savedWindow = g.window;
        // The executor uses window.setTimeout/clearTimeout (Obsidian renderer
        // convention); provide them in the node test environment.
        g.window = {
            setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
            clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
        };
    });

    afterEach(() => {
        g.window = savedWindow;
    });

    function makeExecutor(snapshot: (...a: unknown[]) => Promise<unknown>) {
        const plugin = makePlugin({
            snapshot,
            tFiles: { 'Notes/a.md': fakeTFile(), 'Notes/b.md': fakeTFile() },
        });
        const executor = new ProcessSandboxExecutor(plugin);
        const priv = executor as unknown as ExecutorPrivates;
        const sent: Array<Record<string, unknown>> = [];
        priv.ready = true;
        priv.worker = { send: (m: unknown) => sent.push(m as Record<string, unknown>) };
        return { executor, priv, sent };
    }

    /** execute() awaits ensureReady() before sending -- flush the microtasks. */
    async function flushSends(): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    it('overlapping executions from different tasks snapshot under their own taskIds', async () => {
        const snapshot = vi.fn(async (..._a: unknown[]) => ({ commitOid: 'abc' }));
        const { executor, priv, sent } = makeExecutor(snapshot);

        // Two overlapping executions: task A starts first, task B overlaps.
        const runA = executor.execute('codeA', {}, { governanceTaskId: 'task-A' });
        const runB = executor.execute('codeB', {}, { governanceTaskId: 'task-B' });
        await flushSends();
        const execIdA = sent[0]['id'] as string;
        const execIdB = sent[1]['id'] as string;

        // The worker echoes each bridge write with the execId of the execution
        // that issued it. Task A's write arrives while B is bound too -- the
        // old last-writer-wins slot attributed this to task-B.
        await priv.handleMessage({
            type: 'vault-write', callId: 'bc_1',
            path: 'Notes/a.md', content: 'from A', execId: execIdA,
        });
        await priv.handleMessage({
            type: 'vault-write', callId: 'bc_2',
            path: 'Notes/b.md', content: 'from B', execId: execIdB,
        });

        expect(snapshot).toHaveBeenCalledTimes(2);
        const byPath = new Map(snapshot.mock.calls.map((c) => [(c[1] as string[])[0], c[0]]));
        expect(byPath.get('Notes/a.md')).toBe('task-A');
        expect(byPath.get('Notes/b.md')).toBe('task-B');

        // Settle both executions.
        await priv.handleMessage({ type: 'result', id: execIdA, value: 'A done' });
        await priv.handleMessage({ type: 'result', id: execIdB, value: 'B done' });
        await expect(runA).resolves.toBe('A done');
        await expect(runB).resolves.toBe('B done');
    });

    it('a write from a finished execution no longer resolves a taskId (mapping is cleaned up)', async () => {
        const snapshot = vi.fn(async (..._a: unknown[]) => ({ commitOid: 'abc' }));
        const { executor, priv, sent } = makeExecutor(snapshot);

        const run = executor.execute('code', {}, { governanceTaskId: 'task-A' });
        await flushSends();
        const execId = sent[0]['id'] as string;
        await priv.handleMessage({ type: 'result', id: execId, value: 'done' });
        await run;

        await priv.handleMessage({
            type: 'vault-write', callId: 'bc_9',
            path: 'Notes/a.md', content: 'late', execId,
        });
        expect(snapshot).not.toHaveBeenCalled();
    });

    it('an execution without governanceTaskId writes without snapshot', async () => {
        const snapshot = vi.fn(async (..._a: unknown[]) => ({ commitOid: 'abc' }));
        const { executor, priv, sent } = makeExecutor(snapshot);

        const run = executor.execute('code', {});
        await flushSends();
        const execId = sent[0]['id'] as string;
        await priv.handleMessage({
            type: 'vault-write', callId: 'bc_1',
            path: 'Notes/a.md', content: 'x', execId,
        });
        expect(snapshot).not.toHaveBeenCalled();

        await priv.handleMessage({ type: 'result', id: execId, value: 1 });
        await run;
    });
});

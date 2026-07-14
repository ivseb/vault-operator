/**
 * FIX-44-13b: restore_checkpoint shows the files a restore would change,
 * with REAL diffs, before it rolls anything back.
 *
 * The restore target set is fully computable from the checkpoint
 * (filesChanged + newFiles, snapshot content via getSnapshotContent), so
 * unlike the internal-loop tools this one gets genuine before/after diffs.
 * Per-entry Skip is honoured: the approved subset travels through
 * context.approvedBatchPaths into GitCheckpointService.restore's pathFilter.
 *
 * The tool stays in SCOPE_GRANT_EXEMPT_TOOLS: a run/session grant for
 * vault-change never covers a mass rollback, every call re-asks.
 */

import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { RestoreCheckpointTool } from '../RestoreCheckpointTool';
import type { ToolCallbacks, ToolExecutionContext } from '../../types';

const CP = {
    taskId: 'task-1',
    commitOid: 'a'.repeat(40),
    timestamp: '2026-07-14T00:00:00Z',
    filesChanged: ['Notes/A.md', 'Notes/B.md'],
    newFiles: ['Notes/New.md'],
};

function makeHarness(opts: {
    snapshots?: Record<string, string | null>;
    current?: Record<string, string>;
    checkpoint?: typeof CP | null;
} = {}) {
    const snapshots = opts.snapshots ?? { 'Notes/A.md': 'snapA', 'Notes/B.md': 'snapB' };
    const current = new Map(Object.entries(opts.current ?? { 'Notes/A.md': 'curA', 'Notes/New.md': 'newContent' }));
    const cp = opts.checkpoint === undefined ? CP : opts.checkpoint;

    const restore = vi.fn((_cp: unknown, _filter?: (p: string) => boolean) =>
        Promise.resolve({ restored: ['Notes/A.md'], errors: [] }));
    const snapshot = vi.fn((_taskId: string, _paths: string[], _tool?: string) =>
        Promise.resolve({ ...CP, commitOid: 'pre' }));
    const getSnapshotContent = vi.fn((_cp: unknown, p: string) => Promise.resolve(snapshots[p] ?? null));
    const service = {
        getCheckpointByOid: vi.fn((oid: string) => Promise.resolve(cp && oid === cp.commitOid ? cp : null)),
        getSnapshotContent,
        restore,
        snapshot,
    };

    const fileFor = (p: string) => Object.assign(new TFile(), { path: p, extension: 'md' });
    const plugin = {
        app: {
            vault: {
                getAbstractFileByPath: (p: string) => (current.has(p) ? fileFor(p) : null),
                read: (f: TFile) => Promise.resolve(current.get(f.path) ?? ''),
                modify: () => Promise.resolve(),
                adapter: {
                    exists: (p: string) => Promise.resolve(current.has(p)),
                    read: (p: string) => Promise.resolve(current.get(p) ?? ''),
                    write: () => Promise.resolve(),
                },
            },
            workspace: { getLeavesOfType: () => [] },
        },
        checkpointService: service,
    };
    const tool = new RestoreCheckpointTool(plugin as never);
    return { tool, service, restore, snapshot, getSnapshotContent };
}

function makeCtx(approvedBatchPaths?: ReadonlySet<string>): { context: ToolExecutionContext; results: string[] } {
    const results: string[] = [];
    const callbacks: ToolCallbacks = {
        pushToolResult(c) { results.push(typeof c === 'string' ? c : JSON.stringify(c)); },
        handleError() { return Promise.resolve(); },
        log() { /* no-op */ },
    };
    return { context: { taskId: 't', mode: 'agent', callbacks, approvedBatchPaths }, results };
}

describe('FIX-44-13b: restore_checkpoint batch preview', () => {
    it('task mode: real diffs for restored files, deletion entries for newFiles', async () => {
        const { tool } = makeHarness();

        const batch = await tool.previewBatch({ commitOid: CP.commitOid });

        expect(batch).not.toBeNull();
        expect(batch!.scopeOnly).toBeFalsy();
        const byPath = new Map(batch!.entries.map((e) => [e.path, e]));
        // A: exists on disk, gets the snapshot content back.
        expect(byPath.get('Notes/A.md')).toMatchObject({ before: 'curA', after: 'snapA' });
        // B: deleted since the snapshot, restore recreates it.
        expect(byPath.get('Notes/B.md')).toMatchObject({ before: '', after: 'snapB', isNew: true });
        // New: created by the task, task-restore trashes it.
        expect(byPath.get('Notes/New.md')).toMatchObject({ before: 'newContent', after: '', isDeleted: true });
        expect(batch!.summary).toContain('3');
    });

    it('file mode: a single-entry diff for the named path', async () => {
        const { tool } = makeHarness();

        const batch = await tool.previewBatch({ commitOid: CP.commitOid, path: 'Notes/A.md' });

        expect(batch!.entries).toEqual([
            { path: 'Notes/A.md', before: 'curA', after: 'snapA', isNew: false },
        ]);
    });

    it('returns null for an unknown oid or missing service (card fallback)', async () => {
        const { tool } = makeHarness({ checkpoint: null });
        expect(await tool.previewBatch({ commitOid: CP.commitOid })).toBeNull();
        expect(await tool.previewBatch({})).toBeNull();
    });

    it('degrades to a scope-only list when a snapshot blob is unreadable', async () => {
        // A preview that silently omitted the unreadable file would show a
        // SMALLER scope than the restore touches. Degrade to the honest list.
        const { tool } = makeHarness({ snapshots: { 'Notes/A.md': 'snapA', 'Notes/B.md': null } });

        const batch = await tool.previewBatch({ commitOid: CP.commitOid });

        expect(batch!.scopeOnly).toBe(true);
        expect(batch!.entries.map((e) => e.path).sort()).toEqual(['Notes/A.md', 'Notes/B.md', 'Notes/New.md']);
    });

    it('caps diff reads for very large checkpoints (scope list, no content reads)', async () => {
        const files = Array.from({ length: 60 }, (_, i) => `Notes/F${i}.md`);
        const { tool, getSnapshotContent } = makeHarness({
            checkpoint: { ...CP, filesChanged: files, newFiles: [] },
        });

        const batch = await tool.previewBatch({ commitOid: CP.commitOid });

        expect(batch!.scopeOnly).toBe(true);
        expect(batch!.entries).toHaveLength(60);
        expect(getSnapshotContent).not.toHaveBeenCalled();
    });
});

describe('FIX-44-13b: restore_checkpoint honours the approved subset', () => {
    it('task mode: passes a pathFilter admitting only approved paths to service.restore', async () => {
        const { tool, restore, snapshot } = makeHarness();
        const { context } = makeCtx(new Set(['Notes/A.md']));

        await tool.execute({ commitOid: CP.commitOid }, context);

        expect(restore).toHaveBeenCalledTimes(1);
        const filter = restore.mock.calls[0][1] as ((p: string) => boolean) | undefined;
        expect(typeof filter).toBe('function');
        expect(filter!('Notes/A.md')).toBe(true);
        expect(filter!('Notes/B.md')).toBe(false);
        expect(filter!('Notes/New.md')).toBe(false);
        // The pre-restore snapshot covers only what will actually change.
        expect(snapshot.mock.calls[0][1]).toEqual(['Notes/A.md']);
    });

    it('task mode without a subset restores everything (no filter)', async () => {
        const { tool, restore } = makeHarness();
        const { context } = makeCtx();

        await tool.execute({ commitOid: CP.commitOid }, context);

        expect(restore.mock.calls[0][1]).toBeUndefined();
    });
});

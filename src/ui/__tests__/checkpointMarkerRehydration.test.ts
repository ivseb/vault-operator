/**
 * FIX-44-12: checkpoint markers must survive a conversation reload.
 *
 * Markers were NEVER persisted: during streaming they render as siblings of
 * the steps block in `.message-tools`, while UiMessage.toolStepsHtml snapshots
 * only `stepsBlockEl.outerHTML` -- so a reloaded chat had no marker data at
 * all. The old rehydration reconstructed purely from the shadow repo and
 * anchored EVERY checkpoint of a task at the task's last assistant bubble;
 * when the repo had nothing (pruned refs after REF_RETENTION_DAYS, deleted
 * shadow repo), the markers vanished silently.
 *
 * Now each assistant turn persists its markers (UiMessage.checkpoints) and
 * this module plans the rehydration: verified against the shadow repo they
 * come back LIVE (working Diff/Undo buttons via renderCheckpointMarker);
 * unverifiable ones come back EXPIRED (dimmed, tooltip) instead of dropped.
 * Conversations stored before this fix keep the legacy last-bubble behavior.
 */

import { describe, it, expect, vi } from 'vitest';
import type { CheckpointInfo } from '../../core/checkpoints/GitCheckpointService';
import {
    toPersistedCheckpointMarker,
    planCheckpointMarkerRehydration,
} from '../checkpointMarkerRehydration';

function cp(taskId: string, oid: string, files: string[] = ['Notes/a.md']): CheckpointInfo {
    return {
        taskId,
        commitOid: oid,
        timestamp: '2026-07-14T10:00:00.000Z',
        filesChanged: files,
        toolName: 'write_file',
        skipped: undefined,
    };
}

describe('toPersistedCheckpointMarker', () => {
    it('keeps the marker identity and drops the session-only fields', () => {
        const info = cp('task-1', 'a'.repeat(40), ['Notes/a.md']);
        info.newFiles = ['Notes/neu.md'];

        const persisted = toPersistedCheckpointMarker(info);

        expect(persisted).toEqual({
            taskId: 'task-1',
            commitOid: 'a'.repeat(40),
            timestamp: '2026-07-14T10:00:00.000Z',
            filesChanged: ['Notes/a.md'],
            newFiles: ['Notes/neu.md'],
        });
        expect('toolName' in persisted).toBe(false);
        expect('skipped' in persisted).toBe(false);
    });
});

describe('planCheckpointMarkerRehydration', () => {
    it('renders persisted markers LIVE at their own message when the shadow repo still has them', async () => {
        const live = cp('task-1', '1'.repeat(40));
        const loader = vi.fn(async () => [live]);

        const plan = await planCheckpointMarkerRehydration(
            [
                { taskId: 'task-1', checkpoints: [toPersistedCheckpointMarker(live)] },
                { taskId: 'task-1' }, // later bubble of the same task, no markers
            ],
            loader,
        );

        // Anchored at message 0, where it originally rendered -- NOT at the
        // task's last bubble.
        expect(plan.get(0)).toEqual([{ kind: 'live', checkpoint: live }]);
        expect(plan.has(1)).toBe(false);
    });

    it('renders persisted markers EXPIRED instead of dropping them when the repo returns nothing', async () => {
        const gone = toPersistedCheckpointMarker(cp('task-1', '2'.repeat(40)));
        const loader = vi.fn(async () => [] as CheckpointInfo[]);

        const plan = await planCheckpointMarkerRehydration(
            [{ taskId: 'task-1', checkpoints: [gone] }],
            loader,
        );

        expect(plan.get(0)).toEqual([{ kind: 'expired', marker: gone }]);
    });

    it('a failing loader degrades to EXPIRED too (never silently gone)', async () => {
        const marker = toPersistedCheckpointMarker(cp('task-x', '3'.repeat(40)));
        const loader = vi.fn(async () => { throw new Error('repo gone'); });

        const plan = await planCheckpointMarkerRehydration(
            [{ taskId: 'task-x', checkpoints: [marker] }],
            loader,
        );

        expect(plan.get(0)).toEqual([{ kind: 'expired', marker }]);
    });

    it('mixes live and expired per message, preserving marker order', async () => {
        const live = cp('task-1', '4'.repeat(40));
        const gone = toPersistedCheckpointMarker(cp('task-1', '5'.repeat(40)));
        const loader = vi.fn(async () => [live]);

        const plan = await planCheckpointMarkerRehydration(
            [{ taskId: 'task-1', checkpoints: [toPersistedCheckpointMarker(live), gone] }],
            loader,
        );

        expect(plan.get(0)).toEqual([
            { kind: 'live', checkpoint: live },
            { kind: 'expired', marker: gone },
        ]);
    });

    it('legacy messages (taskId, no persisted markers) keep the FIX-01-07-02 behavior: everything at the LAST bubble', async () => {
        const a = cp('task-old', '6'.repeat(40));
        const b = cp('task-old', '7'.repeat(40));
        const loader = vi.fn(async () => [a, b]);

        const plan = await planCheckpointMarkerRehydration(
            [{ taskId: 'task-old' }, { taskId: 'task-old' }],
            loader,
        );

        expect(plan.has(0)).toBe(false);
        expect(plan.get(1)).toEqual([
            { kind: 'live', checkpoint: a },
            { kind: 'live', checkpoint: b },
        ]);
    });

    it('legacy messages with an empty repo produce nothing (no persisted data to show)', async () => {
        const loader = vi.fn(async () => [] as CheckpointInfo[]);

        const plan = await planCheckpointMarkerRehydration(
            [{ taskId: 'task-old' }],
            loader,
        );

        expect(plan.size).toBe(0);
    });

    it('loads each task once, even across persisted and legacy messages', async () => {
        const live = cp('task-1', '8'.repeat(40));
        const loader = vi.fn(async () => [live]);

        await planCheckpointMarkerRehydration(
            [
                { taskId: 'task-1', checkpoints: [toPersistedCheckpointMarker(live)] },
                { taskId: 'task-1', checkpoints: [toPersistedCheckpointMarker(live)] },
            ],
            loader,
        );

        expect(loader).toHaveBeenCalledTimes(1);
        expect(loader).toHaveBeenCalledWith('task-1');
    });

    it('a task that persisted markers gets NO additional legacy anchor (no double render)', async () => {
        const live = cp('task-1', '9'.repeat(40));
        const loader = vi.fn(async () => [live]);

        const plan = await planCheckpointMarkerRehydration(
            [
                { taskId: 'task-1', checkpoints: [toPersistedCheckpointMarker(live)] },
                { taskId: 'task-1' }, // last bubble of the same task
            ],
            loader,
        );

        expect(plan.get(0)).toEqual([{ kind: 'live', checkpoint: live }]);
        expect(plan.has(1)).toBe(false);
    });

    it('messages without taskId and without markers are skipped', async () => {
        const loader = vi.fn(async () => [] as CheckpointInfo[]);

        const plan = await planCheckpointMarkerRehydration([{}, {}], loader);

        expect(plan.size).toBe(0);
        expect(loader).not.toHaveBeenCalled();
    });
});

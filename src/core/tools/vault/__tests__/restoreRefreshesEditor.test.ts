/**
 * FIX-44-11: restore_checkpoint reports success but the note stays as it was.
 *
 * Live incident 2026-07-12. The agent offered to restore a checkpoint, said it
 * had, and the note was unchanged. It had in fact written the snapshot to disk
 * correctly -- but the note was open in the editor (the skill calls open_note
 * right after writing), and the stale CodeMirror buffer saves itself back over
 * the file on the next sync. Disk gets restored, buffer wins, user sees nothing.
 *
 * This is FIX-01-07-03, which was wired into write_file, edit_file,
 * append_to_file, set_block_anchors, the post-task review and
 * GitCheckpointService.restore() -- and missed in the two places that restore a
 * SINGLE file: RestoreCheckpointTool's file mode and
 * GitCheckpointService.restoreLatestForTask.
 *
 * A restore that does not survive contact with an open editor is not a restore.
 */

import { describe, it, expect, vi } from 'vitest';

const refreshSpy = vi.fn();
vi.mock('../../../utils/refreshMarkdownView', () => ({
    refreshOpenMarkdownViewsFor: (...args: unknown[]) => {
        refreshSpy(...args);
        return Promise.resolve(1);
    },
}));

describe('FIX-44-11: a single-file restore must push into the open editor buffer', () => {
    it('RestoreCheckpointTool (mode=file) refreshes the open MarkdownView', async () => {
        refreshSpy.mockClear();
        const { TFile } = await import('obsidian');
        const { RestoreCheckpointTool } = await import('../RestoreCheckpointTool');

        const file = Object.assign(new TFile(), { path: 'Notes/a.md', extension: 'md' });
        const modified: string[] = [];

        const checkpoint = {
            commitOid: 'd5be3343aaaa',
            taskId: 'task-1',
            timestamp: Date.now(),
            filesChanged: ['Notes/a.md'],
            newFiles: [],
        };
        const plugin = {
            app: {
                vault: {
                    getAbstractFileByPath: () => file,
                    modify: (_f: unknown, c: string) => { modified.push(c); return Promise.resolve(); },
                    adapter: { write: () => Promise.resolve() },
                },
            },
            checkpointService: {
                getCheckpointByOid: () => Promise.resolve(checkpoint),
                snapshot: () => Promise.resolve(),
                getSnapshotContent: () => Promise.resolve('RESTORED CONTENT'),
            },
        };

        const tool = new (RestoreCheckpointTool as unknown as new (p: unknown) => InstanceType<typeof RestoreCheckpointTool>)(plugin);
        const pushed: string[] = [];
        await tool.execute(
            { commitOid: 'd5be3343aaaa', path: 'Notes/a.md', mode: 'file' },
            { callbacks: {
                pushToolResult: (c: unknown) => { if (typeof c === 'string') pushed.push(c); },
                handleError: () => Promise.resolve(),
                log: () => { /* no-op */ },
            } } as never,
        );

        // It wrote the snapshot...
        expect(modified).toEqual(['RESTORED CONTENT']);
        // ...and, crucially, pushed it into the open editor so the stale buffer
        // cannot save itself back over the restore.
        expect(refreshSpy).toHaveBeenCalledTimes(1);
        expect(refreshSpy.mock.calls[0][2]).toBe('RESTORED CONTENT');
    });
});

/**
 * FIX-44-44: the post-task review must open for writes the user never saw a
 * diff for -- and only for those.
 *
 * The review gate used to hang off `autoApproval.enabled`. But the "user saw
 * the diff at the gate" rationale only holds for tools with previewEdit: a
 * write approved on a NAME-ONLY card (generate_canvas, extract_zip, the office
 * creators, ...), a write auto-approved by settings, and every follow-up write
 * under a run-scope grant all land with no diff surface at all when the master
 * toggle is off.
 *
 * The Pipeline is the only place that knows, per call, whether a write was
 * individually diff-approved. It reports every OTHER successful write through
 * `extensions.onUnreviewedWrite`, and the sidebar opens the post-task review
 * exactly when at least one such write exists -- independent of the master
 * toggle.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ToolUse, ToolCallbacks } from '../../tools/types';
import type { EditPreview } from '../../tools/editPreview';

function makeCallbacks(): ToolCallbacks {
    return {
        pushToolResult: () => { /* no-op */ },
        handleError: () => Promise.resolve(),
        log: () => { /* no-op */ },
    };
}

function makeTool(name: string, opts?: { isWrite?: boolean; preview?: EditPreview | null }) {
    const tool: Record<string, unknown> = {
        name,
        isWriteOperation: opts?.isWrite ?? true,
        execute: vi.fn(async () => 'ok'),
        getDefinition: () => ({ name, description: 'stub', input_schema: { type: 'object' as const } }),
    };
    if (opts && 'preview' in opts) {
        tool.previewEdit = vi.fn(async () => opts.preview);
    }
    return tool as {
        name: string; isWriteOperation: boolean;
        execute: ReturnType<typeof vi.fn>;
        getDefinition: () => unknown;
        previewEdit?: ReturnType<typeof vi.fn>;
    };
}

async function buildPipeline(tools: ReturnType<typeof makeTool>[], autoApproval?: Record<string, boolean>) {
    const { ToolExecutionPipeline } = await import('../ToolExecutionPipeline');
    const map = new Map(tools.map((t) => [t.name, t]));
    const plugin = {
        app: { vault: {
            adapter: {
                exists: () => Promise.resolve(false), read: () => Promise.resolve(''),
                write: () => Promise.resolve(), mkdir: () => Promise.resolve(),
                rename: () => Promise.resolve(), remove: () => Promise.resolve(),
                list: () => Promise.resolve({ files: [], folders: [] }), stat: () => Promise.resolve(null),
            },
            // safeNoteWrite surface (finalContent path).
            getAbstractFileByPath: () => null,
            createFolder: () => Promise.resolve(),
        } },
        settings: {
            enableCheckpoints: false,
            agentFolderPath: '.vault-operator',
            autoApproval: {
                enabled: false, read: true, noteEdits: false, vaultChanges: false,
                web: false, mcp: false, subtasks: false, skills: false,
                pluginApiRead: true, pluginApiWrite: false, recipes: false, sandbox: false,
                ...(autoApproval ?? {}),
            },
        },
        ignoreService: { isIgnored: () => false, isProtected: () => false, getDenialReason: () => 'Denied' },
        operationLogger: { log: () => Promise.resolve() },
        checkpointService: null,
        trackChatLinkPath: () => { /* no-op */ },
    };
    const registry = { getTool: (n: string) => map.get(n), getAllTools: () => [...map.values()] };
    return new (ToolExecutionPipeline as unknown as new (
        p: unknown, r: unknown, t: string, m: string,
    ) => InstanceType<typeof ToolExecutionPipeline>)(plugin, registry, 'task-1', 'agent');
}

const call = (name: string, input: Record<string, unknown> = {}): ToolUse =>
    ({ type: 'tool_use', id: `tu-${name}`, name: name as ToolUse['name'], input });

const PREVIEW: EditPreview = { path: 'a.md', before: 'alt', after: 'neu' };

describe('FIX-44-44: unreviewed writes are reported, diff-approved writes are not', () => {
    it('a settings-auto-approved write fires onUnreviewedWrite', async () => {
        const write = makeTool('write_file');
        const pipeline = await buildPipeline([write], { enabled: true, noteEdits: true });
        const onUnreviewedWrite = vi.fn();

        await pipeline.executeTool(call('write_file', { path: 'a.md', content: 'x' }), makeCallbacks(), { onUnreviewedWrite });

        expect(write.execute).toHaveBeenCalledTimes(1);
        expect(onUnreviewedWrite).toHaveBeenCalledTimes(1);
        expect(onUnreviewedWrite).toHaveBeenCalledWith('write_file');
    });

    it('a name-only card approval (no previewEdit) fires onUnreviewedWrite', async () => {
        const canvas = makeTool('generate_canvas');
        const pipeline = await buildPipeline([canvas]);
        const onUnreviewedWrite = vi.fn();
        const onApprovalRequired = vi.fn(async () => ({ decision: 'approved' as const }));

        await pipeline.executeTool(call('generate_canvas', { source: 's.md', output_path: 'o.canvas' }), makeCallbacks(), { onApprovalRequired, onUnreviewedWrite });

        expect(canvas.execute).toHaveBeenCalledTimes(1);
        expect(onUnreviewedWrite).toHaveBeenCalledTimes(1);
    });

    it('a diff-approved write (previewEdit shown, user approved) does NOT fire', async () => {
        const edit = makeTool('edit_file', { preview: PREVIEW });
        const pipeline = await buildPipeline([edit]);
        const onUnreviewedWrite = vi.fn();
        const onApprovalRequired = vi.fn(
            async (_tool: string, _input: Record<string, unknown>, _preview?: EditPreview) =>
                ({ decision: 'approved' as const }),
        );

        await pipeline.executeTool(call('edit_file', { path: 'a.md', old_str: 'alt', new_str: 'neu' }), makeCallbacks(), { onApprovalRequired, onUnreviewedWrite });

        expect(edit.execute).toHaveBeenCalledTimes(1);
        // The card carried the real diff; the user individually reviewed it.
        expect(onApprovalRequired.mock.calls[0][2]).toEqual(PREVIEW);
        expect(onUnreviewedWrite).not.toHaveBeenCalled();
    });

    it('a previewEdit that returns null degrades to a name-only card and fires', async () => {
        const edit = makeTool('edit_file', { preview: null });
        const pipeline = await buildPipeline([edit]);
        const onUnreviewedWrite = vi.fn();
        const onApprovalRequired = vi.fn(async () => ({ decision: 'approved' as const }));

        await pipeline.executeTool(call('edit_file', { path: 'a.md', old_str: 'x', new_str: 'y' }), makeCallbacks(), { onApprovalRequired, onUnreviewedWrite });

        expect(onUnreviewedWrite).toHaveBeenCalledTimes(1);
    });

    it('run-scope grant: the first (diff-approved) write does not fire, the follow-up auto write does', async () => {
        const first = makeTool('write_file', { preview: PREVIEW });
        const second = makeTool('edit_file', { preview: PREVIEW });
        const pipeline = await buildPipeline([first, second]);
        const onUnreviewedWrite = vi.fn();
        const onApprovalRequired = vi.fn(async () => ({ decision: 'approved' as const, rememberForRun: true }));

        await pipeline.executeTool(call('write_file', { path: 'a.md', content: 'x' }), makeCallbacks(), { onApprovalRequired, onUnreviewedWrite });
        expect(onUnreviewedWrite).not.toHaveBeenCalled();

        // Same effect class, covered by the run grant: no card, no diff.
        await pipeline.executeTool(call('edit_file', { path: 'b.md', old_str: 'x', new_str: 'y' }), makeCallbacks(), { onApprovalRequired, onUnreviewedWrite });
        expect(onApprovalRequired).toHaveBeenCalledTimes(1);
        expect(onUnreviewedWrite).toHaveBeenCalledTimes(1);
        expect(onUnreviewedWrite).toHaveBeenCalledWith('edit_file');
    });

    it('reads never fire, and a rejected write never fires', async () => {
        const read = makeTool('read_file', { isWrite: false });
        const write = makeTool('write_file');
        const pipeline = await buildPipeline([read, write]);
        const onUnreviewedWrite = vi.fn();
        const onApprovalRequired = vi.fn(async () => ({ decision: 'rejected' as const }));

        await pipeline.executeTool(call('read_file', { path: 'a.md' }), makeCallbacks(), { onUnreviewedWrite });
        await pipeline.executeTool(call('write_file', { path: 'a.md', content: 'x' }), makeCallbacks(), { onApprovalRequired, onUnreviewedWrite });

        expect(write.execute).not.toHaveBeenCalled();
        expect(onUnreviewedWrite).not.toHaveBeenCalled();
    });

    it('the finalContent path (user edited in the gate) does not fire -- they saw and shaped the diff', async () => {
        const edit = makeTool('edit_file', { preview: PREVIEW });
        const pipeline = await buildPipeline([edit]);
        const onUnreviewedWrite = vi.fn();
        const onApprovalRequired = vi.fn(async () => ({ decision: 'approved' as const, finalContent: 'meine Version' }));

        const result = await pipeline.executeTool(call('edit_file', { path: 'a.md', old_str: 'alt', new_str: 'neu' }), makeCallbacks(), { onApprovalRequired, onUnreviewedWrite });

        expect(result.is_error).toBe(false);
        expect(edit.execute).not.toHaveBeenCalled(); // pipeline wrote the user's version
        expect(onUnreviewedWrite).not.toHaveBeenCalled();
    });

    it('a failed write does not fire (nothing reviewable landed)', async () => {
        const write = makeTool('write_file');
        write.execute.mockImplementation((_input: unknown, ctx: { callbacks: { pushToolResult: (s: string) => void } }) => {
            ctx.callbacks.pushToolResult('<error>boom</error>');
            return Promise.resolve();
        });
        const pipeline = await buildPipeline([write], { enabled: true, noteEdits: true });
        const onUnreviewedWrite = vi.fn();

        await pipeline.executeTool(call('write_file', { path: 'a.md', content: 'x' }), makeCallbacks(), { onUnreviewedWrite });

        expect(onUnreviewedWrite).not.toHaveBeenCalled();
    });
});

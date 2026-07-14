/**
 * FEAT-44-02b / FIX-44-13b: ONE approval for a whole multi-file operation.
 *
 * A tool that touches many files used to produce either one blind name card
 * (writes happen internally: vault_health_check, extract_zip) or a per-file
 * card storm. Both push the user toward the permanent Always-allow button,
 * which is the exact opposite of what an approval system is for.
 *
 * The batch contract: a tool that can enumerate its planned writes implements
 * `previewBatch` (editPreview.ts). The Pipeline hands the batch to the
 * approval callback as a FOURTH argument; the UI leads ONE approval over the
 * whole scope. The result may carry `approvedPaths` (per-entry Skip in the
 * gate); the Pipeline threads that subset into the tool via
 * `context.approvedBatchPaths`, and the tool MUST honour it.
 *
 * FIX-44-44 coupling: a batch whose entries carried REAL diffs counts as
 * diff-reviewed (no double post-task review). A scope-only batch (paths
 * without content) does NOT -- the user approved a file list, not diffs, so
 * the post-task review stays the diff surface for those writes.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ToolUse, ToolCallbacks, ToolExecutionContext } from '../../tools/types';
import type { EditPreview, BatchEditPreview } from '../../tools/editPreview';

function makeCallbacks(): ToolCallbacks {
    return {
        pushToolResult: () => { /* no-op */ },
        handleError: () => Promise.resolve(),
        log: () => { /* no-op */ },
    };
}

const DIFF_BATCH: BatchEditPreview = {
    entries: [
        { path: 'Notes/A.md', before: 'a1', after: 'a2' },
        { path: 'Notes/B.md', before: 'b1', after: 'b2' },
        { path: 'Notes/C.md', before: '', after: 'c1', isNew: true },
    ],
    summary: 'Restore 3 file(s) from checkpoint abc12345',
};

const SCOPE_BATCH: BatchEditPreview = {
    entries: [
        { path: 'Notes/A.md', before: '', after: '' },
        { path: 'Notes/B.md', before: '', after: '' },
    ],
    summary: 'fix_backlinks: 2 note(s) will be modified',
    scopeOnly: true,
};

interface BatchStubTool {
    name: string;
    isWriteOperation: boolean;
    execute: ReturnType<typeof vi.fn>;
    getDefinition: () => { name: string; description: string; input_schema: { type: 'object' } };
    previewBatch?: ReturnType<typeof vi.fn>;
    previewEdit?: ReturnType<typeof vi.fn>;
}

function makeBatchTool(
    name: string,
    batch: BatchEditPreview | null,
    single?: EditPreview | null,
): BatchStubTool {
    const tool: BatchStubTool = {
        name,
        isWriteOperation: true,
        execute: vi.fn((_input: Record<string, unknown>, _ctx: ToolExecutionContext) => Promise.resolve()),
        getDefinition: () => ({ name, description: 'stub', input_schema: { type: 'object' } }),
        previewBatch: vi.fn(() => Promise.resolve(batch)),
    };
    if (single !== undefined) {
        tool.previewEdit = vi.fn(() => Promise.resolve(single));
    }
    return tool;
}

function makeFakePlugin(tool: BatchStubTool) {
    const toolRegistry = {
        getTool: (name: string) => (name === tool.name ? tool : undefined),
        getAllTools: () => [tool],
    };
    const plugin = {
        app: {
            vault: {
                adapter: {
                    exists: () => Promise.resolve(false),
                    read: () => Promise.resolve(''),
                    write: () => Promise.resolve(),
                    mkdir: () => Promise.resolve(),
                    remove: () => Promise.resolve(),
                    list: () => Promise.resolve({ files: [], folders: [] }),
                    stat: () => Promise.resolve(null),
                },
            },
        },
        settings: {
            enableCheckpoints: false,
            agentFolderPath: '.vault-operator',
            autoApproval: {
                enabled: false,
                read: true, noteEdits: false, vaultChanges: false,
                web: false, mcp: false, subtasks: false, skills: false,
                pluginApiRead: true, pluginApiWrite: false, recipes: false, sandbox: false,
            },
        },
        ignoreService: {
            isIgnored: () => false,
            isProtected: () => false,
            getDenialReason: () => 'Denied',
        },
        operationLogger: { log: () => Promise.resolve() },
        checkpointService: null,
        trackChatLinkPath: () => { /* no-op */ },
    };
    return { plugin, toolRegistry };
}

async function buildPipeline(tool: BatchStubTool) {
    const { ToolExecutionPipeline } = await import('../ToolExecutionPipeline');
    const { plugin, toolRegistry } = makeFakePlugin(tool);
    return new (ToolExecutionPipeline as unknown as new (
        p: unknown, r: unknown, t: string, m: string,
    ) => InstanceType<typeof ToolExecutionPipeline>)(plugin, toolRegistry, 'task-batch', 'agent');
}

function call(name: string, input: Record<string, unknown> = {}): ToolUse {
    return { type: 'tool_use', id: `tu-${name}`, name: name as ToolUse['name'], input };
}

describe('FEAT-44-02b: the batch preview reaches the approval callback', () => {
    it('passes the batch as the fourth argument and no single preview', async () => {
        const tool = makeBatchTool('restore_checkpoint', DIFF_BATCH);
        const pipeline = await buildPipeline(tool);
        const onApprovalRequired = vi.fn(() => Promise.resolve({ decision: 'approved' as const }));

        await pipeline.executeTool(call('restore_checkpoint', { commitOid: 'abc' }), makeCallbacks(), { onApprovalRequired });

        expect(onApprovalRequired).toHaveBeenCalledTimes(1);
        const [name, , preview, batch] = onApprovalRequired.mock.calls[0] as unknown as [
            string, Record<string, unknown>, EditPreview | undefined, BatchEditPreview | undefined,
        ];
        expect(name).toBe('restore_checkpoint');
        expect(preview).toBeUndefined();
        expect(batch).toEqual(DIFF_BATCH);
    });

    it('a batch takes precedence over previewEdit (no double preview work)', async () => {
        const tool = makeBatchTool('restore_checkpoint', DIFF_BATCH, { path: 'x.md', before: '', after: 'x' });
        const pipeline = await buildPipeline(tool);
        const onApprovalRequired = vi.fn(() => Promise.resolve({ decision: 'approved' as const }));

        await pipeline.executeTool(call('restore_checkpoint', { commitOid: 'abc' }), makeCallbacks(), { onApprovalRequired });

        expect(tool.previewEdit).not.toHaveBeenCalled();
    });

    it('falls back to previewEdit when previewBatch returns null', async () => {
        const single: EditPreview = { path: 'Notes/A.md', before: 'a', after: 'b' };
        const tool = makeBatchTool('restore_checkpoint', null, single);
        const pipeline = await buildPipeline(tool);
        const onApprovalRequired = vi.fn(() => Promise.resolve({ decision: 'approved' as const }));

        await pipeline.executeTool(call('restore_checkpoint', { commitOid: 'abc', path: 'Notes/A.md' }), makeCallbacks(), { onApprovalRequired });

        const [, , preview, batch] = onApprovalRequired.mock.calls[0] as unknown as [
            string, Record<string, unknown>, EditPreview | undefined, BatchEditPreview | undefined,
        ];
        expect(batch).toBeUndefined();
        expect(preview).toEqual(single);
    });

    it('treats an EMPTY batch as no batch (plain card, still an approval)', async () => {
        const tool = makeBatchTool('vault_health_check', { entries: [], summary: 'nothing to do' });
        const pipeline = await buildPipeline(tool);
        const onApprovalRequired = vi.fn(() => Promise.resolve({ decision: 'approved' as const }));

        await pipeline.executeTool(call('vault_health_check', { action: 'cleanup' }), makeCallbacks(), { onApprovalRequired });

        expect(onApprovalRequired).toHaveBeenCalledTimes(1);
        const [, , , batch] = onApprovalRequired.mock.calls[0] as unknown as [
            string, Record<string, unknown>, EditPreview | undefined, BatchEditPreview | undefined,
        ];
        expect(batch).toBeUndefined();
    });

    it('rejecting the batch denies the tool call and nothing executes', async () => {
        const tool = makeBatchTool('restore_checkpoint', DIFF_BATCH);
        const pipeline = await buildPipeline(tool);
        const onApprovalRequired = vi.fn(() => Promise.resolve({ decision: 'rejected' as const }));

        const result = await pipeline.executeTool(call('restore_checkpoint', { commitOid: 'abc' }), makeCallbacks(), { onApprovalRequired });

        expect(result.is_error).toBe(true);
        expect(tool.execute).not.toHaveBeenCalled();
    });
});

describe('FEAT-44-02b: the approved subset reaches the tool', () => {
    it('threads approvedPaths into context.approvedBatchPaths', async () => {
        const tool = makeBatchTool('restore_checkpoint', DIFF_BATCH);
        const pipeline = await buildPipeline(tool);
        const onApprovalRequired = vi.fn(() => Promise.resolve({
            decision: 'approved' as const,
            approvedPaths: ['Notes/A.md', 'Notes/C.md'],
        }));

        await pipeline.executeTool(call('restore_checkpoint', { commitOid: 'abc' }), makeCallbacks(), { onApprovalRequired });

        expect(tool.execute).toHaveBeenCalledTimes(1);
        const ctx = tool.execute.mock.calls[0][1] as ToolExecutionContext;
        expect(ctx.approvedBatchPaths).toBeInstanceOf(Set);
        expect([...(ctx.approvedBatchPaths ?? [])].sort()).toEqual(['Notes/A.md', 'Notes/C.md']);
    });

    it('a full approval leaves approvedBatchPaths unset (full planned scope)', async () => {
        const tool = makeBatchTool('restore_checkpoint', DIFF_BATCH);
        const pipeline = await buildPipeline(tool);
        const onApprovalRequired = vi.fn(() => Promise.resolve({ decision: 'approved' as const }));

        await pipeline.executeTool(call('restore_checkpoint', { commitOid: 'abc' }), makeCallbacks(), { onApprovalRequired });

        const ctx = tool.execute.mock.calls[0][1] as ToolExecutionContext;
        expect(ctx.approvedBatchPaths).toBeUndefined();
    });

    it('sanitises approvedPaths against the batch entries (no foreign paths)', async () => {
        const tool = makeBatchTool('restore_checkpoint', DIFF_BATCH);
        const pipeline = await buildPipeline(tool);
        const onApprovalRequired = vi.fn(() => Promise.resolve({
            decision: 'approved' as const,
            approvedPaths: ['Notes/A.md', 'Evil/Other.md'],
        }));

        await pipeline.executeTool(call('restore_checkpoint', { commitOid: 'abc' }), makeCallbacks(), { onApprovalRequired });

        const ctx = tool.execute.mock.calls[0][1] as ToolExecutionContext;
        expect([...(ctx.approvedBatchPaths ?? [])]).toEqual(['Notes/A.md']);
    });

    it('ignores approvedPaths when NO batch was shown (a card cannot invent a subset)', async () => {
        const tool = makeBatchTool('vault_health_check', null);
        const pipeline = await buildPipeline(tool);
        const onApprovalRequired = vi.fn(() => Promise.resolve({
            decision: 'approved' as const,
            approvedPaths: ['Notes/A.md'],
        }));

        await pipeline.executeTool(call('vault_health_check', { action: 'cleanup' }), makeCallbacks(), { onApprovalRequired });

        const ctx = tool.execute.mock.calls[0][1] as ToolExecutionContext;
        expect(ctx.approvedBatchPaths).toBeUndefined();
    });

    it('drops finalContent from a batch approval (the batch gate is read-only)', async () => {
        // A user-edited finalContent from a batch gate would have the Pipeline
        // safeNoteWrite a single file and skip execute() -- silently dropping
        // the rest of the batch. The gate never offers editing; if a stray
        // finalContent arrives anyway, the Pipeline must not act on it.
        const tool = makeBatchTool('restore_checkpoint', DIFF_BATCH);
        const pipeline = await buildPipeline(tool);
        const onApprovalRequired = vi.fn(() => Promise.resolve({
            decision: 'approved' as const,
            finalContent: 'user typed something',
        }));

        const result = await pipeline.executeTool(call('restore_checkpoint', { commitOid: 'abc' }), makeCallbacks(), { onApprovalRequired });

        expect(result.is_error).toBeFalsy();
        expect(tool.execute).toHaveBeenCalledTimes(1);
    });
});

describe('FIX-44-44 coupling: batch approvals and the post-task review', () => {
    it('a diff batch approval counts as diff-reviewed (no unreviewed-write signal)', async () => {
        const tool = makeBatchTool('restore_checkpoint', DIFF_BATCH);
        const pipeline = await buildPipeline(tool);
        const onUnreviewedWrite = vi.fn();
        const onApprovalRequired = vi.fn(() => Promise.resolve({ decision: 'approved' as const }));

        await pipeline.executeTool(call('restore_checkpoint', { commitOid: 'abc' }), makeCallbacks(), {
            onApprovalRequired, onUnreviewedWrite,
        });

        expect(onUnreviewedWrite).not.toHaveBeenCalled();
    });

    it('a scope-only batch approval is NOT diff-reviewed (signal fires)', async () => {
        const tool = makeBatchTool('vault_health_check', SCOPE_BATCH);
        const pipeline = await buildPipeline(tool);
        const onUnreviewedWrite = vi.fn();
        const onApprovalRequired = vi.fn(() => Promise.resolve({ decision: 'approved' as const }));

        await pipeline.executeTool(call('vault_health_check', { action: 'fix_backlinks' }), makeCallbacks(), {
            onApprovalRequired, onUnreviewedWrite,
        });

        expect(onUnreviewedWrite).toHaveBeenCalledWith('vault_health_check');
    });
});

describe('FEAT-44-02b: scope grants still work from a batch gate', () => {
    it('rememberForRun on a batch approval covers the next call of the same effect', async () => {
        // vault-change effect; second tool of the same class must run without a card.
        const tool = makeBatchTool('vault_health_check', SCOPE_BATCH);
        const pipeline = await buildPipeline(tool);
        const onApprovalRequired = vi.fn(() => Promise.resolve({
            decision: 'approved' as const,
            rememberForRun: true,
        }));

        await pipeline.executeTool(call('vault_health_check', { action: 'fix_backlinks' }), makeCallbacks(), { onApprovalRequired });
        await pipeline.executeTool(call('vault_health_check', { action: 'cleanup' }), makeCallbacks(), { onApprovalRequired });

        expect(onApprovalRequired).toHaveBeenCalledTimes(1);
        expect(tool.execute).toHaveBeenCalledTimes(2);
    });
});

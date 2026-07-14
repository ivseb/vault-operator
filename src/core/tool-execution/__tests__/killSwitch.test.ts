/**
 * FEAT-44-07: the kill switch, in two parts.
 *
 * (b) "Always ask (paranoid mode)": a persisted plain setting that, while on,
 *     forces checkApproval to ask for EVERY effect except read/ui, regardless
 *     of config, presets, and run-/session-scope grants. Checked FIRST, so no
 *     later branch can auto-approve around it. It also refuses to record new
 *     scope grants (the card hides the buttons; the pipeline guards anyway).
 *
 * (a) "Reset to default-deny": applies the restrictive preset, clears the
 *     session set, and revokes run grants. The run sets live per task inside
 *     the pipelines where the settings tab cannot reach, so revocation works
 *     via an in-memory epoch counter on the plugin: each pipeline clears its
 *     (shared) run set lazily when it sees the counter moved.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ToolUse, ToolCallbacks } from '../../tools/types';
import type { ApprovalGrantKey } from '../../tools/toolEffects';

function makeCallbacks(): ToolCallbacks {
    return {
        pushToolResult: () => { /* no-op */ },
        handleError: () => Promise.resolve(),
        log: () => { /* no-op */ },
    };
}

function makeTool(name: string, isWriteOperation = true) {
    return {
        name,
        isWriteOperation,
        execute: vi.fn(async () => 'ok'),
        getDefinition: () => ({ name, description: 'stub', input_schema: { type: 'object' as const } }),
    };
}

function makeFakePlugin(opts: { paranoid?: boolean; approval?: Record<string, boolean> } = {}) {
    return {
        app: { vault: { adapter: {
            exists: () => Promise.resolve(false), read: () => Promise.resolve(''),
            write: () => Promise.resolve(), mkdir: () => Promise.resolve(),
            list: () => Promise.resolve({ files: [], folders: [] }), stat: () => Promise.resolve(null),
        } } },
        settings: {
            enableCheckpoints: false,
            agentFolderPath: '.vault-operator',
            paranoidMode: opts.paranoid === true,
            autoApproval: {
                enabled: false, noteEdits: false, vaultChanges: false,
                web: false, mcp: false, subtasks: false, skills: false,
                pluginApiRead: true, pluginApiWrite: false, recipes: false, sandbox: false,
                ...(opts.approval ?? {}),
            },
        },
        sessionApprovedGrants: new Set<ApprovalGrantKey>(),
        approvalRevocationEpoch: 0,
        ignoreService: { isIgnored: () => false, isProtected: () => false, getDenialReason: () => 'Denied' },
        operationLogger: { log: () => Promise.resolve() },
        checkpointService: null,
        trackChatLinkPath: () => { /* no-op */ },
    };
}

async function buildPipeline(plugin: unknown, tools: ReturnType<typeof makeTool>[], taskId = 'task-1') {
    const { ToolExecutionPipeline } = await import('../ToolExecutionPipeline');
    const map = new Map(tools.map((t) => [t.name, t]));
    const registry = { getTool: (n: string) => map.get(n), getAllTools: () => [...map.values()] };
    return new (ToolExecutionPipeline as unknown as new (
        p: unknown, r: unknown, t: string, m: string,
    ) => InstanceType<typeof ToolExecutionPipeline>)(plugin, registry, taskId, 'agent');
}

const call = (name: string, input: Record<string, unknown> = {}): ToolUse =>
    ({ type: 'tool_use', id: `tu-${name}`, name: name as ToolUse['name'], input });

describe('FEAT-44-07 (b): paranoid mode forces asking', () => {
    it('write_file asks despite master + noteEdits being on', async () => {
        const plugin = makeFakePlugin({ paranoid: true, approval: { enabled: true, noteEdits: true } });
        const write = makeTool('write_file');
        const pipeline = await buildPipeline(plugin, [write]);

        const onApprovalRequired = vi.fn(async () => ({ decision: 'approved' as const }));
        await pipeline.executeTool(call('write_file', { path: 'a.md', content: 'x' }), makeCallbacks(), { onApprovalRequired });

        expect(onApprovalRequired).toHaveBeenCalledTimes(1);
        expect(write.execute).toHaveBeenCalledTimes(1);
    });

    it('web_fetch asks despite an existing run grant AND session grant', async () => {
        const plugin = makeFakePlugin({ paranoid: true });
        plugin.sessionApprovedGrants.add('web');
        const fetch = makeTool('web_fetch', false);
        const pipeline = await buildPipeline(plugin, [fetch]);
        pipeline.getRunApprovedEffects().keys.add('web');

        const onApprovalRequired = vi.fn(async () => ({ decision: 'approved' as const }));
        await pipeline.executeTool(call('web_fetch', { url: 'https://example.com' }), makeCallbacks(), { onApprovalRequired });

        expect(onApprovalRequired).toHaveBeenCalledTimes(1);
    });

    it('reads and ui tools still run automatically', async () => {
        const plugin = makeFakePlugin({ paranoid: true });
        const read = makeTool('read_file', false);
        const done = makeTool('attempt_completion', false);
        const pipeline = await buildPipeline(plugin, [read, done]);

        const onApprovalRequired = vi.fn(async () => ({ decision: 'approved' as const }));
        await pipeline.executeTool(call('read_file', { path: 'a.md' }), makeCallbacks(), { onApprovalRequired });
        await pipeline.executeTool(call('attempt_completion', { result: 'done' }), makeCallbacks(), { onApprovalRequired });

        expect(onApprovalRequired).not.toHaveBeenCalled();
        expect(read.execute).toHaveBeenCalledTimes(1);
        expect(done.execute).toHaveBeenCalledTimes(1);
    });

    it('does not record new run or session grants while active', async () => {
        const plugin = makeFakePlugin({ paranoid: true });
        const write = makeTool('write_file');
        const pipeline = await buildPipeline(plugin, [write]);

        // Defense in depth: even if a grant flag arrives (the card hides the
        // buttons), paranoid mode must not bank it for later.
        const onApprovalRequired = vi.fn(async () => ({
            decision: 'approved' as const, rememberForRun: true, rememberForSession: true,
        }));
        await pipeline.executeTool(call('write_file', { path: 'a.md', content: 'x' }), makeCallbacks(), { onApprovalRequired });

        expect(pipeline.getRunApprovedEffects().keys.size).toBe(0);
        expect(plugin.sessionApprovedGrants.size).toBe(0);
    });
});

describe('FEAT-44-07 (a): revocation epoch clears run grants', () => {
    it('a bumped epoch revokes an existing run grant on the next check', async () => {
        const plugin = makeFakePlugin();
        const write = makeTool('write_file');
        const pipeline = await buildPipeline(plugin, [write]);

        const onApprovalRequired = vi.fn(async () => ({ decision: 'approved' as const, rememberForRun: true }));
        await pipeline.executeTool(call('write_file', { path: 'a.md', content: 'x' }), makeCallbacks(), { onApprovalRequired });
        // Covered by the run grant:
        await pipeline.executeTool(call('write_file', { path: 'a.md', content: 'y' }), makeCallbacks(), { onApprovalRequired });
        expect(onApprovalRequired).toHaveBeenCalledTimes(1);

        // Kill switch pressed in the settings tab:
        plugin.approvalRevocationEpoch += 1;

        await pipeline.executeTool(call('write_file', { path: 'a.md', content: 'z' }), makeCallbacks(), { onApprovalRequired });
        expect(onApprovalRequired).toHaveBeenCalledTimes(2);
    });

    it('a subtask pipeline built AFTER the reset does not inherit stale run grants', async () => {
        // The scenario that motivated RunGrantStore = {keys, epoch}: a
        // per-pipeline seen-epoch would be stamped fresh in the CHILD's
        // constructor, so a store adopted from the parent afterwards would
        // smuggle the pre-reset grants past the revocation. The epoch must
        // travel WITH the store.
        const plugin = makeFakePlugin();
        const write = makeTool('write_file');
        const parent = await buildPipeline(plugin, [write], 'task-parent');

        const onApprovalRequired = vi.fn(async () => ({ decision: 'approved' as const, rememberForRun: true }));
        await parent.executeTool(call('write_file', { path: 'a.md', content: 'x' }), makeCallbacks(), { onApprovalRequired });
        expect(parent.getRunApprovedEffects().keys.size).toBe(1);

        // Kill switch pressed, THEN the subtask is spawned:
        plugin.approvalRevocationEpoch += 1;
        const child = await buildPipeline(plugin, [write], 'task-child');
        child.setRunApprovedEffects(parent.getRunApprovedEffects());

        await child.executeTool(call('write_file', { path: 'b.md', content: 'y' }), makeCallbacks(), { onApprovalRequired });
        expect(onApprovalRequired).toHaveBeenCalledTimes(2);
    });
});

describe('FEAT-44-07 (a): resetToDefaultDeny helper', () => {
    it('applies the restrictive preset, clears session grants, bumps the epoch', async () => {
        const { resetToDefaultDeny } = await import('../../tools/autoApprovalGrant');
        const { PRESETS } = await import('../../tools/agent/UpdateSettingsTool');

        const plugin = makeFakePlugin({ approval: {
            enabled: true, noteEdits: true, vaultChanges: true, web: true, mcp: true,
            subtasks: true, skills: true, pluginApiRead: true, pluginApiWrite: true,
            recipes: true, sandbox: true,
        } });
        plugin.sessionApprovedGrants.add('note-edit');
        plugin.sessionApprovedGrants.add('web');

        resetToDefaultDeny(plugin, PRESETS.restrictive);

        expect(plugin.settings.autoApproval).toMatchObject(PRESETS.restrictive);
        expect(plugin.settings.autoApproval.enabled).toBe(false);
        expect(plugin.sessionApprovedGrants.size).toBe(0);
        expect(plugin.approvalRevocationEpoch).toBe(1);
    });
});

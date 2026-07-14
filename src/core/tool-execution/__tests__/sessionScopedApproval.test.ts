/**
 * FEAT-44-02a (session scope): "yes, and stop asking me for this kind of change
 * until the plugin reloads".
 *
 * The scope ladder is: once < this run < this session < always. The session set
 * lives in memory on the PLUGIN instance (never persisted), so it outlives a
 * single task and is visible to every pipeline (parent, subtasks, the next task)
 * without explicit sharing, but dies with the plugin reload.
 *
 * The invariants carried over from the run scope apply unchanged:
 * - resolved grant keys (a plugin-api READ grant never covers WRITE calls),
 * - config/self-modify can never be covered (Selbst-Eskalations-Sperre),
 * - high-blast-radius tools (restore_checkpoint, extract_zip) always re-ask.
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

/**
 * One fake PLUGIN shared by several pipelines: the session set hangs off the
 * plugin instance, exactly like in production.
 */
function makeFakePlugin() {
    return {
        app: { vault: { adapter: {
            exists: () => Promise.resolve(false), read: () => Promise.resolve(''),
            write: () => Promise.resolve(), mkdir: () => Promise.resolve(),
            list: () => Promise.resolve({ files: [], folders: [] }), stat: () => Promise.resolve(null),
        } } },
        settings: {
            enableCheckpoints: false,
            agentFolderPath: '.vault-operator',
            autoApproval: {
                enabled: false, noteEdits: false, vaultChanges: false,
                web: false, mcp: false, subtasks: false, skills: false,
                pluginApiRead: true, pluginApiWrite: false, recipes: false, sandbox: false,
            },
            pluginApi: { safeMethodOverrides: { 'someplugin:getData': true } },
        },
        sessionApprovedGrants: new Set<ApprovalGrantKey>(),
        ignoreService: { isIgnored: () => false, isProtected: () => false, getDenialReason: () => 'Denied' },
        operationLogger: { log: () => Promise.resolve() },
        checkpointService: null,
        trackChatLinkPath: () => { /* no-op */ },
    };
}

async function buildPipeline(plugin: unknown, tools: ReturnType<typeof makeTool>[], taskId: string) {
    const { ToolExecutionPipeline } = await import('../ToolExecutionPipeline');
    const map = new Map(tools.map((t) => [t.name, t]));
    const registry = { getTool: (n: string) => map.get(n), getAllTools: () => [...map.values()] };
    return new (ToolExecutionPipeline as unknown as new (
        p: unknown, r: unknown, t: string, m: string,
    ) => InstanceType<typeof ToolExecutionPipeline>)(plugin, registry, taskId, 'agent');
}

const call = (name: string, input: Record<string, unknown> = {}): ToolUse =>
    ({ type: 'tool_use', id: `tu-${name}`, name: name as ToolUse['name'], input });

const grantSession = () => vi.fn(async () => ({
    decision: 'approved' as const, rememberForSession: true,
}));

describe('FEAT-44-02a: approving for the session', () => {
    it('a session grant from task A suppresses the card in task B (new pipeline, same plugin)', async () => {
        const plugin = makeFakePlugin();
        const write = makeTool('write_file');
        const taskA = await buildPipeline(plugin, [write], 'task-a');
        const taskB = await buildPipeline(plugin, [write], 'task-b');

        const onApprovalRequired = grantSession();

        await taskA.executeTool(call('write_file', { path: 'a.md', content: 'x' }), makeCallbacks(), { onApprovalRequired });
        // A DIFFERENT task: the run scope would ask again, the session scope must not.
        await taskB.executeTool(call('write_file', { path: 'b.md', content: 'y' }), makeCallbacks(), { onApprovalRequired });

        expect(onApprovalRequired).toHaveBeenCalledTimes(1);
        expect(write.execute).toHaveBeenCalledTimes(2);
    });

    it('a plain Apply and a run grant do NOT populate the session set', async () => {
        const plugin = makeFakePlugin();
        const write = makeTool('write_file');
        const pipeline = await buildPipeline(plugin, [write], 'task-1');

        const plain = vi.fn(async () => ({ decision: 'approved' as const }));
        await pipeline.executeTool(call('write_file', { path: 'a.md', content: 'x' }), makeCallbacks(), { onApprovalRequired: plain });
        expect(plugin.sessionApprovedGrants.size).toBe(0);

        const run = vi.fn(async () => ({ decision: 'approved' as const, rememberForRun: true }));
        await pipeline.executeTool(call('write_file', { path: 'a.md', content: 'y' }), makeCallbacks(), { onApprovalRequired: run });
        expect(plugin.sessionApprovedGrants.size).toBe(0);
    });

    it('still asks for a DIFFERENT kind of change', async () => {
        const plugin = makeFakePlugin();
        const write = makeTool('write_file');
        const del = makeTool('delete_file');
        const pipeline = await buildPipeline(plugin, [write, del], 'task-1');

        const onApprovalRequired = grantSession();
        await pipeline.executeTool(call('write_file', { path: 'a.md', content: 'x' }), makeCallbacks(), { onApprovalRequired });
        await pipeline.executeTool(call('delete_file', { path: 'b.md' }), makeCallbacks(), { onApprovalRequired });

        // note-edit was granted for the session; vault-change was not.
        expect(onApprovalRequired).toHaveBeenCalledTimes(2);
    });

    it('a plugin-api READ session grant does not cover WRITE calls (FIX-44-39 granularity)', async () => {
        const plugin = makeFakePlugin();
        const api = makeTool('call_plugin_api', false);
        const pipeline = await buildPipeline(plugin, [api], 'task-1');

        const onApprovalRequired = grantSession();
        await pipeline.executeTool(call('call_plugin_api', { plugin_id: 'someplugin', method: 'getData' }), makeCallbacks(), { onApprovalRequired });
        // Second read: covered.
        await pipeline.executeTool(call('call_plugin_api', { plugin_id: 'someplugin', method: 'getData' }), makeCallbacks(), { onApprovalRequired });
        expect(onApprovalRequired).toHaveBeenCalledTimes(1);
        // Write: must ask.
        await pipeline.executeTool(call('call_plugin_api', { plugin_id: 'someplugin', method: 'setData' }), makeCallbacks(), { onApprovalRequired });
        expect(onApprovalRequired).toHaveBeenCalledTimes(2);
    });

    it('cannot buy off config or self-modify, and the session set stays clean of them', async () => {
        const plugin = makeFakePlugin();
        const settings = makeTool('update_settings', false);
        const soul = makeTool('update_soul', false);
        const pipeline = await buildPipeline(plugin, [settings, soul], 'task-1');

        const onApprovalRequired = grantSession();
        await pipeline.executeTool(call('update_settings', { action: 'set', path: 'debugMode', value: true }), makeCallbacks(), { onApprovalRequired });
        await pipeline.executeTool(call('update_settings', { action: 'set', path: 'debugMode', value: false }), makeCallbacks(), { onApprovalRequired });
        await pipeline.executeTool(call('update_soul', { fact: 'a' }), makeCallbacks(), { onApprovalRequired });
        await pipeline.executeTool(call('update_soul', { fact: 'b' }), makeCallbacks(), { onApprovalRequired });

        expect(onApprovalRequired).toHaveBeenCalledTimes(4);
        expect(plugin.sessionApprovedGrants.size).toBe(0);
    });

    it('restore_checkpoint and extract_zip re-ask despite a session grant for vault-change', async () => {
        const plugin = makeFakePlugin();
        const del = makeTool('delete_file');
        const restore = makeTool('restore_checkpoint');
        const zip = makeTool('extract_zip');
        const pipeline = await buildPipeline(plugin, [del, restore, zip], 'task-1');

        const onApprovalRequired = grantSession();
        await pipeline.executeTool(call('delete_file', { path: 'a.md' }), makeCallbacks(), { onApprovalRequired });
        await pipeline.executeTool(call('delete_file', { path: 'b.md' }), makeCallbacks(), { onApprovalRequired });
        await pipeline.executeTool(call('restore_checkpoint', {}), makeCallbacks(), { onApprovalRequired });
        await pipeline.executeTool(call('extract_zip', {}), makeCallbacks(), { onApprovalRequired });

        // delete #1 grants; delete #2 covered; restore + zip exempt.
        expect(onApprovalRequired).toHaveBeenCalledTimes(3);
    });

    it('degrades gracefully when the plugin has no session set (legacy stubs): asks every time', async () => {
        const plugin = makeFakePlugin() as Omit<ReturnType<typeof makeFakePlugin>, 'sessionApprovedGrants'> & { sessionApprovedGrants?: Set<ApprovalGrantKey> };
        delete plugin.sessionApprovedGrants;
        const write = makeTool('write_file');
        const pipeline = await buildPipeline(plugin, [write], 'task-1');

        const onApprovalRequired = grantSession();
        await pipeline.executeTool(call('write_file', { path: 'a.md', content: 'x' }), makeCallbacks(), { onApprovalRequired });
        await pipeline.executeTool(call('write_file', { path: 'a.md', content: 'y' }), makeCallbacks(), { onApprovalRequired });
        expect(onApprovalRequired).toHaveBeenCalledTimes(2);
    });
});

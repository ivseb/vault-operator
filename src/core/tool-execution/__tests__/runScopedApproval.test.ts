/**
 * FEAT-44-02 (run scope): "yes, and stop asking me for this kind of change for the
 * rest of this run".
 *
 * The user asked for ONE approval per run instead of one per tool call. A single
 * up-front diff for the whole run is impossible: the agent only decides its second
 * tool call after seeing the result of the first (edit_file's old_str depends on
 * the frontmatter that update_frontmatter just wrote), so there is nothing to
 * preview yet. What IS possible is to remember the answer -- the user sees the
 * first real diff, says yes once, and the run continues on that consent.
 *
 * The line that must not move: this can never buy a blanket permission for
 * `config` or `self-modify`. Those are alwaysAsk, and an agent that could talk its
 * way into "don't ask again" for its own settings would have re-opened exactly the
 * self-escalation hole ADR-153 closed.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ToolUse, ToolCallbacks } from '../../tools/types';

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

async function buildPipeline(tools: ReturnType<typeof makeTool>[]) {
    const { ToolExecutionPipeline } = await import('../ToolExecutionPipeline');
    const map = new Map(tools.map((t) => [t.name, t]));
    const plugin = {
        app: { vault: { adapter: {
            exists: () => Promise.resolve(false), read: () => Promise.resolve(''),
            write: () => Promise.resolve(), mkdir: () => Promise.resolve(),
            list: () => Promise.resolve({ files: [], folders: [] }), stat: () => Promise.resolve(null),
        } } },
        settings: {
            enableCheckpoints: false,
            agentFolderPath: '.vault-operator',
            autoApproval: {
                enabled: false, read: true, noteEdits: false, vaultChanges: false,
                web: false, mcp: false, subtasks: false, skills: false,
                pluginApiRead: true, pluginApiWrite: false, recipes: false, sandbox: false,
            },
            // FIX-44-39: 'someplugin:getData' is user-marked safe (a READ);
            // any other method resolves to WRITE (dynamic default).
            pluginApi: { safeMethodOverrides: { 'someplugin:getData': true } },
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

describe('FEAT-44-02: approving for the run', () => {
    it('stops asking for the same kind of change after the user said "not again this run"', async () => {
        const write = makeTool('write_file');
        const edit = makeTool('edit_file');
        const pipeline = await buildPipeline([write, edit]);

        const onApprovalRequired = vi.fn(async () => ({
            decision: 'approved' as const,
            rememberForRun: true,
        }));

        await pipeline.executeTool(call('write_file', { path: 'a.md', content: 'x' }), makeCallbacks(), { onApprovalRequired });
        // Same effect class (note-edit), same run: no second question.
        await pipeline.executeTool(call('edit_file', { path: 'a.md', old_str: 'x', new_str: 'y' }), makeCallbacks(), { onApprovalRequired });

        expect(onApprovalRequired).toHaveBeenCalledTimes(1);
        expect(edit.execute).toHaveBeenCalledTimes(1);
    });

    it('still asks for a DIFFERENT kind of change -- consent is per effect, not a blank cheque', async () => {
        const write = makeTool('write_file');
        const del = makeTool('delete_file');
        const pipeline = await buildPipeline([write, del]);

        const onApprovalRequired = vi.fn(async () => ({
            decision: 'approved' as const, rememberForRun: true,
        }));

        await pipeline.executeTool(call('write_file', { path: 'a.md', content: 'x' }), makeCallbacks(), { onApprovalRequired });
        await pipeline.executeTool(call('delete_file', { path: 'b.md' }), makeCallbacks(), { onApprovalRequired });

        // note-edit was pre-approved; vault-change was not.
        expect(onApprovalRequired).toHaveBeenCalledTimes(2);
    });

    it('a plain Apply does NOT pre-approve the rest of the run', async () => {
        const write = makeTool('write_file');
        const edit = makeTool('edit_file');
        const pipeline = await buildPipeline([write, edit]);

        const onApprovalRequired = vi.fn(async () => ({ decision: 'approved' as const }));

        await pipeline.executeTool(call('write_file', { path: 'a.md', content: 'x' }), makeCallbacks(), { onApprovalRequired });
        await pipeline.executeTool(call('edit_file', { path: 'a.md', old_str: 'x', new_str: 'y' }), makeCallbacks(), { onApprovalRequired });

        expect(onApprovalRequired).toHaveBeenCalledTimes(2);
    });

    it('cannot buy off config -- the agent must never pre-approve its own settings', async () => {
        const settings = makeTool('update_settings', false);
        const pipeline = await buildPipeline([settings]);

        const onApprovalRequired = vi.fn(async () => ({
            decision: 'approved' as const, rememberForRun: true,
        }));

        await pipeline.executeTool(call('update_settings', { action: 'set', path: 'autoApproval.enabled', value: true }), makeCallbacks(), { onApprovalRequired });
        await pipeline.executeTool(call('update_settings', { action: 'apply_preset', preset: 'permissive' }), makeCallbacks(), { onApprovalRequired });

        // alwaysAsk wins over any remembered consent.
        expect(onApprovalRequired).toHaveBeenCalledTimes(2);
    });

    it('cannot buy off self-modify either', async () => {
        const soul = makeTool('update_soul', false);
        const pipeline = await buildPipeline([soul]);

        const onApprovalRequired = vi.fn(async () => ({
            decision: 'approved' as const, rememberForRun: true,
        }));

        await pipeline.executeTool(call('update_soul', { fact: 'a' }), makeCallbacks(), { onApprovalRequired });
        await pipeline.executeTool(call('update_soul', { fact: 'b' }), makeCallbacks(), { onApprovalRequired });

        expect(onApprovalRequired).toHaveBeenCalledTimes(2);
    });

    it('FEAT-44-02: a run-grant for vault-change still re-asks for restore_checkpoint', async () => {
        const del = makeTool('delete_file');
        const restore = makeTool('restore_checkpoint');
        const pipeline = await buildPipeline([del, restore]);

        const onApprovalRequired = vi.fn(async () => ({ decision: 'approved' as const, rememberForRun: true }));

        // Grant vault-change for the run via a delete...
        await pipeline.executeTool(call('delete_file', { path: 'a.md' }), makeCallbacks(), { onApprovalRequired });
        // ...a second delete is now auto (no new prompt)...
        await pipeline.executeTool(call('delete_file', { path: 'b.md' }), makeCallbacks(), { onApprovalRequired });
        // ...but a mass rollback is exempt and asks again.
        await pipeline.executeTool(call('restore_checkpoint', {}), makeCallbacks(), { onApprovalRequired });

        expect(onApprovalRequired).toHaveBeenCalledTimes(2); // delete #1 + restore_checkpoint
    });

    it('FIX-44-39: a run grant from a plugin-api READ card does not cover WRITE calls', async () => {
        const api = makeTool('call_plugin_api', false);
        const pipeline = await buildPipeline([api]);

        const onApprovalRequired = vi.fn(async () => ({
            decision: 'approved' as const, rememberForRun: true,
        }));

        // READ card (safeMethodOverrides marks getData as safe), granted for the run...
        await pipeline.executeTool(call('call_plugin_api', { plugin_id: 'someplugin', method: 'getData' }), makeCallbacks(), { onApprovalRequired });
        // ...a second READ is covered by the grant...
        await pipeline.executeTool(call('call_plugin_api', { plugin_id: 'someplugin', method: 'getData' }), makeCallbacks(), { onApprovalRequired });
        expect(onApprovalRequired).toHaveBeenCalledTimes(1);

        // ...but a WRITE call of the same effect class must ask again.
        await pipeline.executeTool(call('call_plugin_api', { plugin_id: 'someplugin', method: 'setData' }), makeCallbacks(), { onApprovalRequired });
        expect(onApprovalRequired).toHaveBeenCalledTimes(2);
    });

    it('FIX-44-39: a run grant from a plugin-api WRITE card does not cover READ calls', async () => {
        const api = makeTool('call_plugin_api', false);
        const pipeline = await buildPipeline([api]);

        const onApprovalRequired = vi.fn(async () => ({
            decision: 'approved' as const, rememberForRun: true,
        }));

        await pipeline.executeTool(call('call_plugin_api', { plugin_id: 'someplugin', method: 'setData' }), makeCallbacks(), { onApprovalRequired });
        // A READ was never granted: the grant key is 'plugin-api:write', not the class.
        await pipeline.executeTool(call('call_plugin_api', { plugin_id: 'someplugin', method: 'getData' }), makeCallbacks(), { onApprovalRequired });
        expect(onApprovalRequired).toHaveBeenCalledTimes(2);
    });

    it('FIX-44-39 (S1): config/self-modify approvals never enter the grant set at all', async () => {
        // The invariant used to hold only because the LOOKUP checks alwaysAsk
        // first; the set itself still collected 'config' and is shared with
        // subtasks by reference. The insert must be guarded too.
        const settings = makeTool('update_settings', false);
        const pipeline = await buildPipeline([settings]);

        const onApprovalRequired = vi.fn(async () => ({
            decision: 'approved' as const, rememberForRun: true,
        }));

        await pipeline.executeTool(call('update_settings', { action: 'set', path: 'debugMode', value: true }), makeCallbacks(), { onApprovalRequired });
        expect(pipeline.getRunApprovedEffects().size).toBe(0);
    });

    it('FEAT-44-02: a subtask inherits the parent run-scope via a shared set', async () => {
        const write = makeTool('write_file');
        const parent = await buildPipeline([write]);
        const child = await buildPipeline([write]);

        // Parent shares its set with the child (as spawnSubtask does).
        child.setRunApprovedEffects(parent.getRunApprovedEffects());

        const onApprovalRequired = vi.fn(async () => ({ decision: 'approved' as const, rememberForRun: true }));

        // Parent grants note-edit for the run...
        await parent.executeTool(call('write_file', { path: 'a.md', content: 'x' }), makeCallbacks(), { onApprovalRequired });
        // ...and the child, sharing the set, does not ask again.
        await child.executeTool(call('write_file', { path: 'b.md', content: 'y' }), makeCallbacks(), { onApprovalRequired });

        expect(onApprovalRequired).toHaveBeenCalledTimes(1);
    });
});

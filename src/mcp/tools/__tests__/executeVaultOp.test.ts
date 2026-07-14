/**
 * AUDIT-013 C-1 regression tests (proper fix).
 *
 * The handler now routes through ToolExecutionPipeline. We test the
 * MCP-boundary contract:
 *   - AGENT_INTERNAL_TOOLS denied at handler before pipeline runs
 *   - Unknown operation denied with helpful list
 *   - Real registered read tool reaches the pipeline (tested via the
 *     plugin-internal pipeline behaviour: the tool's pushToolResult must
 *     be observed)
 *   - Real write tool reaches the pipeline and fails-closed because no
 *     approval callback is wired
 */

import { describe, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';
import { handleExecuteVaultOp } from '../executeVaultOp';
import type ObsidianAgentPlugin from '../../../main';
import type { ToolDefinition, ToolExecutionContext } from '../../../core/tools/types';

// FIX-44-37: execute is a typed Mock PROPERTY (not a method signature), so
// `expect(tool.execute)` does not trip @typescript-eslint/unbound-method and
// the callback params are not `any`.
type FakeExecute = Mock<(input: Record<string, unknown>, context: ToolExecutionContext) => Promise<void>>;

interface FakeTool {
    name: string;
    isWriteOperation: boolean;
    getDefinition(): ToolDefinition;
    execute: FakeExecute;
}

function makeReadTool(name: string, response = 'OK'): FakeTool {
    return {
        name,
        isWriteOperation: false,
        getDefinition: () => ({
            // ToolDefinition.name is the strict ToolName union; cast is fine in tests.
            name: name as ToolDefinition['name'],
            description: 'fake read',
            input_schema: { type: 'object', properties: {}, required: [] },
        }),
        execute: vi.fn(async (_input: Record<string, unknown>, ctx: ToolExecutionContext) => {
            ctx.callbacks.pushToolResult(response);
        }),
    };
}

function makeWriteTool(name: string): FakeTool {
    return {
        name,
        isWriteOperation: true,
        getDefinition: () => ({
            name: name as ToolDefinition['name'],
            description: 'fake write',
            input_schema: { type: 'object', properties: {}, required: [] },
        }),
        execute: vi.fn(async (_input: Record<string, unknown>, ctx: ToolExecutionContext) => {
            ctx.callbacks.pushToolResult('should not run');
        }),
    };
}

interface PluginStub {
    toolRegistry: {
        getTool: (name: string) => FakeTool | undefined;
        getAllTools: () => FakeTool[];
    };
    settings: Record<string, unknown>;
    app: { vault: { adapter: Record<string, unknown> } };
    operationLogger?: undefined;
    ignoreService?: undefined;
}

function makePlugin(tools: FakeTool[], mcpAllowWriteTools = false): PluginStub {
    const map = new Map(tools.map((t) => [t.name, t]));
    return {
        toolRegistry: {
            getTool: (n: string) => map.get(n),
            getAllTools: () => [...map.values()],
        },
        settings: {
            // Pipeline reads settings.autoApproval and settings.enableCheckpoints.
            autoApproval: { enabled: true, read: true, noteEdits: false, vaultChanges: false, mcp: false, sandbox: false, web: false, subtasks: false, skills: false, recipes: false, pluginApiRead: false, pluginApiWrite: false },
            enableCheckpoints: false,
            mcpAllowWriteTools,
        },
        app: { vault: { adapter: {} } },
    };
}

/** FIX-44-37: single typed boundary cast instead of scattered unsafe casts. */
function asPlugin(stub: PluginStub): ObsidianAgentPlugin {
    return stub as unknown as ObsidianAgentPlugin;
}

describe('handleExecuteVaultOp -- pipeline-routed (AUDIT-013 C-1 proper)', () => {
    it.each([
        // switch_mode was renamed to switch_agent in the Modes -> Agents
        // rename (commit 58bfa393). switch_mode no longer exists as a tool
        // and falls through to "Unknown operation" instead.
        'switch_agent',
        'new_task',
        'update_todo_list',
        'update_settings',
        // manage_skill removed in FEAT-29-05 (skill-creator builtin took
        // over). The tool no longer exists, so it falls through the
        // "agent-internal" filter into "Unknown operation".
        'enable_plugin',
        'call_plugin_api',
    ])('rejects agent-internal tool %s before pipeline', async (op) => {
        const plugin = makePlugin([]);
        const result = await handleExecuteVaultOp(asPlugin(plugin), { operation: op });
        expect(result.isError).toBe(true);
        const text = (result.content[0] as { text: string }).text;
        expect(text).toContain('agent-internal');
    });

    it('returns error when operation is missing', async () => {
        const plugin = makePlugin([]);
        const result = await handleExecuteVaultOp(asPlugin(plugin), {});
        expect(result.isError).toBe(true);
    });

    it('returns "Unknown operation" with list of available tools (excluding internal)', async () => {
        const plugin = makePlugin([makeReadTool('list_files')]);
        const result = await handleExecuteVaultOp(asPlugin(plugin), { operation: 'totally_unknown' });
        expect(result.isError).toBe(true);
        const text = (result.content[0] as { text: string }).text;
        expect(text).toContain('Unknown operation');
        expect(text).toContain('list_files');
        expect(text).not.toContain('switch_agent');
    });

    it('routes a registered read tool through the pipeline and returns its output', async () => {
        const tool = makeReadTool('list_files', 'three files found');
        const plugin = makePlugin([tool]);
        const result = await handleExecuteVaultOp(asPlugin(plugin), { operation: 'list_files' });
        expect(result.isError).toBe(false);
        const text = (result.content[0] as { text: string }).text;
        expect(text).toContain('three files found');
        expect(tool.execute).toHaveBeenCalled();
    });

    // ── FIX-44-46: headless MCP approval policy ─────────────────────────────
    // The pipeline used to run with NO approval callback, so the EPIC-44
    // effect reclassification flipped get_daily_note(create=true) and
    // mark_for_memory into an unconditional "Operation denied by user" --
    // even when the user had enabled "Allow write tools over MCP", the same
    // toggle FIX-44-26 honours for save_to_memory. The headless policy makes
    // both MCP gates decide from that one standing consent.

    it('FIX-44-46: allows get_daily_note create=true when "Allow write tools over MCP" is on', async () => {
        // Effects resolve by NAME from the central TOOL_EFFECTS registry:
        // get_daily_note with create=true is note-edit.
        const tool = makeReadTool('get_daily_note', 'daily note created');
        const plugin = makePlugin([tool], true);
        const result = await handleExecuteVaultOp(asPlugin(plugin), { operation: 'get_daily_note', params: { create: true } });
        expect(result.isError).toBe(false);
        const text = (result.content[0] as { text: string }).text;
        expect(text).toContain('daily note created');
    });

    it('FIX-44-46: denies get_daily_note create=true with a clean error naming the setting when the toggle is off', async () => {
        const tool = makeReadTool('get_daily_note', 'daily note created');
        const plugin = makePlugin([tool], false);
        const result = await handleExecuteVaultOp(asPlugin(plugin), { operation: 'get_daily_note', params: { create: true } });
        expect(result.isError).toBe(true);
        expect(tool.execute).not.toHaveBeenCalled();
        const text = (result.content[0] as { text: string }).text;
        expect(text).toContain('Allow write tools over MCP');
        expect(text).toContain('Settings > Vault Operator > Customize > Connectors');
        expect(text).not.toContain('denied by user');
    });

    it('FIX-44-46: get_daily_note WITHOUT create stays a read and runs regardless of the toggle', async () => {
        const tool = makeReadTool('get_daily_note', 'daily note content');
        const plugin = makePlugin([tool], false);
        const result = await handleExecuteVaultOp(asPlugin(plugin), { operation: 'get_daily_note', params: {} });
        expect(result.isError).toBe(false);
        const text = (result.content[0] as { text: string }).text;
        expect(text).toContain('daily note content');
    });

    it.each([true, false])(
        'FIX-44-46: mark_for_memory (self-modify) is always denied with a policy message (toggle=%s)',
        async (toggle) => {
            const tool = makeReadTool('mark_for_memory', 'should never run');
            const plugin = makePlugin([tool], toggle);
            const result = await handleExecuteVaultOp(asPlugin(plugin), { operation: 'mark_for_memory', params: {} });
            expect(result.isError).toBe(true);
            expect(tool.execute).not.toHaveBeenCalled();
            const text = (result.content[0] as { text: string }).text;
            // The message names the policy, not a user decision that never happened.
            expect(text).toContain('self-modify');
            expect(text).not.toContain('denied by user');
        },
    );

    it('blocks a write tool via pipeline fail-closed approval', async () => {
        const tool = makeWriteTool('write_file');
        const plugin = makePlugin([tool]);
        const result = await handleExecuteVaultOp(asPlugin(plugin), { operation: 'write_file', params: { path: 'a.md', content: 'x' } });
        expect(result.isError).toBe(true);
        // The execute body must NOT have been called -- approval rejected first.
        expect(tool.execute).not.toHaveBeenCalled();
        const text = (result.content[0] as { text: string }).text;
        // The pipeline returns "Operation denied by user" for fail-closed rejection.
        expect(text).toMatch(/denied/i);
    });
});

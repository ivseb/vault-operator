/**
 * FEAT-44-01 / ADR-153: effect-based approval gate.
 *
 * Regression tests for the five confirmed bypasses. Before the fix these tools
 * never reached `checkApproval`, because the gate entry
 * (`tool.isWriteOperation || group in {mcp, subtask, sandbox}`) did not let them
 * through -- they declare `isWriteOperation = false` even though they mutate
 * configuration, persona or the vault.
 *
 * The stub tools here deliberately declare `isWriteOperation = false`, exactly
 * like the real ones, so the test reproduces the actual bypass.
 *
 * Invariants:
 *  - config (update_settings, configure_model, manage_mcp_server) ALWAYS asks.
 *  - self-modify (update_soul, manage_source, mark_for_memory) ALWAYS asks.
 *  - read/ui run automatically even while the master toggle is off (the default).
 *  - An unknown tool asks (fail-closed). There is no harmless fallback.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ToolUse, ToolCallbacks } from '../../tools/types';

// ---------------------------------------------------------------------------
// Stubs (harness mirrors audit034-fixes.test.ts)
// ---------------------------------------------------------------------------

function makeCallbacks(): ToolCallbacks {
    return {
        pushToolResult: () => { /* no-op */ },
        handleError: () => Promise.resolve(),
        log: () => { /* no-op */ },
    };
}

interface StubTool {
    name: string;
    isWriteOperation: boolean;
    execute: ReturnType<typeof vi.fn>;
    getDefinition: () => {
        name: string;
        description: string;
        input_schema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] };
    };
}

function makeTool(name: string, isWriteOperation = false): StubTool {
    return {
        name,
        isWriteOperation,
        execute: vi.fn(async () => 'ok'),
        getDefinition: () => ({ name, description: 'stub', input_schema: { type: 'object' } }),
    };
}

type ApprovalOverrides = Partial<Record<string, boolean>>;

function makeFakePlugin(tools: StubTool[], approval: ApprovalOverrides = {}) {
    const toolMap = new Map<string, StubTool>(tools.map((t) => [t.name, t]));
    const toolRegistry = {
        getTool: (name: string) => toolMap.get(name),
        getAllTools: () => [...toolMap.values()],
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
                // DEFAULT_SETTINGS: master off, every write category off.
                enabled: false,
                read: true, noteEdits: false, vaultChanges: false,
                web: false, mcp: false, subtasks: false, skills: false,
                pluginApiRead: true, pluginApiWrite: false, recipes: false, sandbox: false,
                ...approval,
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

async function buildPipeline(tools: StubTool[], approval: ApprovalOverrides = {}) {
    const { ToolExecutionPipeline } = await import('../ToolExecutionPipeline');
    const { plugin, toolRegistry } = makeFakePlugin(tools, approval);
    const pipeline = new (ToolExecutionPipeline as unknown as new (
        p: unknown, r: unknown, t: string, m: string,
    ) => InstanceType<typeof ToolExecutionPipeline>)(
        plugin, toolRegistry, `task-${tools.map((t) => t.name).join('-')}`, 'agent',
    );
    return pipeline;
}

function call(name: string, input: Record<string, unknown> = {}): ToolUse {
    // Cast: the tests deliberately drive unknown tool names through the Pipeline
    // (the fail-closed case); those are not part of the ToolName union.
    return { type: 'tool_use', id: `tu-${name}`, name: name as ToolUse['name'], input };
}

/** Run a tool call with an approval callback wired up. */
async function run(
    toolName: string,
    opts: {
        isWriteOperation?: boolean;
        input?: Record<string, unknown>;
        approval?: ApprovalOverrides;
        decision?: 'approved' | 'rejected';
    } = {},
) {
    const tool = makeTool(toolName, opts.isWriteOperation ?? false);
    const pipeline = await buildPipeline([tool], opts.approval);
    const onApprovalRequired = vi.fn(async () => ({ decision: opts.decision ?? 'approved' as const }));
    const result = await pipeline.executeTool(call(toolName, opts.input), makeCallbacks(), {
        onApprovalRequired,
    });
    return { tool, onApprovalRequired, result };
}

// ---------------------------------------------------------------------------
// 1. The five confirmed bypasses
// ---------------------------------------------------------------------------

describe('FEAT-44-01: tools with isWriteOperation=false reach the approval gate', () => {
    // All five declare isWriteOperation = false and therefore slipped past
    // checkApproval under EVERY setting.
    const bypasses: Array<[string, Record<string, unknown>]> = [
        ['update_settings', { action: 'set', path: 'autoApproval.enabled', value: true }],
        ['update_soul', { fact: 'The user prefers terse answers', category: 'communication' }],
        ['manage_mcp_server', { action: 'add', name: 'evil', url: 'https://evil.example/sse', type: 'sse' }],
        ['mark_for_memory', { reason: 'important' }],
        ['get_daily_note', { create: true }],
    ];

    it.each(bypasses)('%s asks for confirmation under default settings', async (name, input) => {
        const { onApprovalRequired } = await run(name, { input });
        expect(onApprovalRequired).toHaveBeenCalledTimes(1);
    });

    it.each(bypasses)('%s does NOT execute when the user denies', async (name, input) => {
        const { tool, result } = await run(name, { input, decision: 'rejected' });
        expect(tool.execute).not.toHaveBeenCalled();
        expect(result.is_error).toBe(true);
    });

    it('get_daily_note WITHOUT create stays a read and does not ask', async () => {
        const { onApprovalRequired, tool } = await run('get_daily_note', { input: { offset: 0 } });
        expect(onApprovalRequired).not.toHaveBeenCalled();
        expect(tool.execute).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// 2. Self-escalation
// ---------------------------------------------------------------------------

describe('FEAT-44-01: the agent cannot escalate its own approval config', () => {
    it('update_settings apply_preset=permissive asks, and does not execute on deny', async () => {
        const { tool, onApprovalRequired, result } = await run('update_settings', {
            input: { action: 'apply_preset', preset: 'permissive' },
            decision: 'rejected',
        });
        expect(onApprovalRequired).toHaveBeenCalledTimes(1);
        expect(tool.execute).not.toHaveBeenCalled();
        expect(result.is_error).toBe(true);
    });

    it('update_settings asks EVEN with auto-approval fully turned up', async () => {
        // alwaysAsk: config is not auto-approvable, whatever the settings say.
        const { onApprovalRequired } = await run('update_settings', {
            input: { action: 'set', path: 'enableCheckpoints', value: false },
            approval: {
                enabled: true, read: true, noteEdits: true, vaultChanges: true,
                web: true, mcp: true, subtasks: true, skills: true,
                pluginApiRead: true, pluginApiWrite: true, recipes: true, sandbox: true,
            },
        });
        expect(onApprovalRequired).toHaveBeenCalledTimes(1);
    });

    it('update_settings is denied fail-closed when no callback is wired', async () => {
        const tool = makeTool('update_settings', false);
        const pipeline = await buildPipeline([tool]);
        const result = await pipeline.executeTool(
            call('update_settings', { action: 'apply_preset', preset: 'permissive' }),
            makeCallbacks(),
            // no onApprovalRequired
        );
        expect(result.is_error).toBe(true);
        expect(tool.execute).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// 3. alwaysAsk invariant for self-modify
// ---------------------------------------------------------------------------

describe('FEAT-44-01: self-modify is never auto-approvable (M-7)', () => {
    it.each(['update_soul', 'manage_source', 'mark_for_memory'])(
        '%s asks even with auto-approval fully turned up',
        async (name) => {
            const { onApprovalRequired } = await run(name, {
                // manage_source declares isWriteOperation=true, the others false.
                isWriteOperation: name === 'manage_source',
                approval: {
                    enabled: true, read: true, noteEdits: true, vaultChanges: true,
                    web: true, mcp: true, subtasks: true, skills: true,
                    pluginApiRead: true, pluginApiWrite: true, recipes: true, sandbox: true,
                },
            });
            expect(onApprovalRequired).toHaveBeenCalledTimes(1);
        },
    );
});

// ---------------------------------------------------------------------------
// 4. Read regression: the fix must not gate reads
// ---------------------------------------------------------------------------

describe('FEAT-44-01: reads run automatically even with the master toggle OFF', () => {
    // The trap: once the gate entry is removed, reads would otherwise fall under
    // `cfg.enabled && cfg.read`. The master is OFF by default, so every read_file
    // would raise a card and make the plugin unusable.
    it.each(['read_file', 'list_files', 'search_files', 'semantic_search', 'find_notes_by_type'])(
        '%s shows no card and executes',
        async (name) => {
            const { onApprovalRequired, tool } = await run(name, {
                approval: { enabled: false, read: false },
            });
            expect(onApprovalRequired).not.toHaveBeenCalled();
            expect(tool.execute).toHaveBeenCalledTimes(1);
        },
    );

    it.each(['attempt_completion', 'update_todo_list', 'ask_followup_question', 'find_tool'])(
        'ui tool %s shows no card',
        async (name) => {
            const { onApprovalRequired, tool } = await run(name, { approval: { enabled: false } });
            expect(onApprovalRequired).not.toHaveBeenCalled();
            expect(tool.execute).toHaveBeenCalledTimes(1);
        },
    );
});

// ---------------------------------------------------------------------------
// 5. Unknown tool: fail-closed
// ---------------------------------------------------------------------------

describe('FEAT-44-01: unknown and dynamic tools ask (fail-closed)', () => {
    it('a tool with no effect entry asks instead of falling back to a harmless class', async () => {
        const { onApprovalRequired } = await run('brand_new_unclassified_tool', {});
        expect(onApprovalRequired).toHaveBeenCalledTimes(1);
    });

    it('a skill code tool (custom_*) asks despite declaring isWriteOperation=false', async () => {
        // The skill's self-declaration is ignored: custom_* runs sandboxed code
        // and is classified as 'sandbox'.
        const { onApprovalRequired } = await run('custom_harmless_looking', {
            isWriteOperation: false,
        });
        expect(onApprovalRequired).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// 6. Effect policy matrix
// ---------------------------------------------------------------------------

describe('FEAT-44-01: effect policy matrix', () => {
    const gated: Array<[string, string, boolean]> = [
        // [tool, settings-key, isWriteOperation]
        ['write_file', 'noteEdits', true],
        ['delete_file', 'vaultChanges', true],
        ['web_fetch', 'web', false],
        ['use_mcp_tool', 'mcp', true],
        ['new_task', 'subtasks', false],
        ['invoke_skill', 'skills', true],
        ['evaluate_expression', 'sandbox', false],
        ['execute_recipe', 'recipes', true],
    ];

    it.each(gated)('%s asks under defaults (master off)', async (name, _key, isWrite) => {
        const { onApprovalRequired } = await run(name, { isWriteOperation: isWrite });
        expect(onApprovalRequired).toHaveBeenCalledTimes(1);
    });

    it.each(gated)('%s runs automatically when master + %s are on', async (name, key, isWrite) => {
        const { onApprovalRequired, tool } = await run(name, {
            isWriteOperation: isWrite,
            approval: { enabled: true, [key]: true },
        });
        expect(onApprovalRequired).not.toHaveBeenCalled();
        expect(tool.execute).toHaveBeenCalledTimes(1);
    });

    it('web_fetch asks with master ON but web OFF (the toggle finally bites)', async () => {
        const { onApprovalRequired } = await run('web_fetch', {
            approval: { enabled: true, web: false },
        });
        expect(onApprovalRequired).toHaveBeenCalledTimes(1);
    });

    it('run_skill_script is classified as sandbox, not skill', async () => {
        // Its effect is sandboxed code execution with the full SandboxBridge.
        // The weaker skills toggle must not auto-approve it.
        const { onApprovalRequired } = await run('run_skill_script', {
            isWriteOperation: true,
            approval: { enabled: true, skills: true, sandbox: false },
        });
        expect(onApprovalRequired).toHaveBeenCalledTimes(1);
    });

    it('invoke_mcp_server is classified as mcp, not skill', async () => {
        // Its effect is an MCP tool call. The skills toggle must not override
        // the mcp toggle.
        const { onApprovalRequired } = await run('invoke_mcp_server', {
            isWriteOperation: true,
            approval: { enabled: true, skills: true, mcp: false },
        });
        expect(onApprovalRequired).toHaveBeenCalledTimes(1);
    });
});

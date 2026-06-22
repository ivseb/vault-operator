/**
 * AUDIT-034 M-9 / M-10 / M-11 regression tests for ToolExecutionPipeline.
 *
 * M-9: mode-gate is enforced at the execution layer (not only in the schema)
 *      for model / mcp / undefined sources, and is bypassed for fastpath /
 *      planner sources.
 * M-10: validatePaths inspects multi-path tool inputs (move_file source +
 *       destination, extract_zip zip_path + target_folder, generate_canvas
 *       source + output_path, plan_presentation source, restore_checkpoint
 *       path) instead of only the generic `path` key.
 * M-11: configure_model always requires user approval (no auto-approve
 *       bypass even when group is 'agent').
 */

import { describe, it, expect, vi } from 'vitest';
import type { ToolUse, ToolCallbacks } from '../../tools/types';

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

function makeCallbacks(): { callbacks: ToolCallbacks; pushed: string[]; logs: string[] } {
    const pushed: string[] = [];
    const logs: string[] = [];
    return {
        pushed,
        logs,
        callbacks: {
            pushToolResult: (c) => {
                if (typeof c === 'string') pushed.push(c);
                else for (const b of c) if (b.type === 'text') pushed.push(b.text);
            },
            handleError: () => Promise.resolve(),
            log: (m) => { logs.push(m); },
        },
    };
}

interface StubTool {
    name: string;
    isWriteOperation: boolean;
    execute: ReturnType<typeof vi.fn>;
    getDefinition: () => { name: string; description: string; input_schema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] } };
}

function makeTool(name: string, isWriteOperation = false): StubTool {
    return {
        name,
        isWriteOperation,
        execute: vi.fn(async () => { /* no-op */ }),
        getDefinition: () => ({
            name,
            description: 'stub',
            input_schema: { type: 'object' },
        }),
    };
}

function makeIgnoreService(ignored: Set<string>, protectedSet: Set<string>) {
    return {
        isIgnored: (p: string) => ignored.has(p),
        isProtected: (p: string) => protectedSet.has(p),
        getDenialReason: (p: string) =>
            protectedSet.has(p) ? `Protected: ${p}` : ignored.has(p) ? `Ignored: ${p}` : 'Denied',
    };
}

interface FakePluginOpts {
    tools: StubTool[];
    ignored?: Set<string>;
    protectedSet?: Set<string>;
}

function makeFakePlugin(opts: FakePluginOpts): {
    plugin: unknown;
    toolRegistry: unknown;
} {
    const toolMap = new Map<string, StubTool>(opts.tools.map((t) => [t.name, t]));
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
            autoApproval: {
                enabled: false,
                read: false, noteEdits: false, vaultChanges: false,
                web: false, mcp: false, subtasks: false, skills: false,
                pluginApiRead: false, pluginApiWrite: false, recipes: false, sandbox: false,
            },
            agentFolderPath: '.vault-operator',
        },
        ignoreService: makeIgnoreService(
            opts.ignored ?? new Set(),
            opts.protectedSet ?? new Set(),
        ),
        operationLogger: { log: () => Promise.resolve() },
        checkpointService: null,
        trackChatLinkPath: () => { /* no-op */ },
    };
    return { plugin, toolRegistry };
}

async function buildPipeline(opts: FakePluginOpts, mode = 'agent') {
    // Dynamic import so the `obsidian` alias is resolved by vitest.
    const { ToolExecutionPipeline } = await import('../ToolExecutionPipeline');
    const { plugin, toolRegistry } = makeFakePlugin(opts);
    const pipeline = new (ToolExecutionPipeline as unknown as new (
        p: unknown, r: unknown, t: string, m: string,
    ) => InstanceType<typeof ToolExecutionPipeline>)(plugin, toolRegistry, `task-${Math.random()}`, mode);
    return { pipeline, plugin };
}

// ---------------------------------------------------------------------------
// M-10: multi-path IgnoreService validation
// ---------------------------------------------------------------------------

describe('AUDIT-034 M-10: multi-path IgnoreService validation', () => {
    it('denies move_file when source is ignored', async () => {
        const moveTool = makeTool('move_file', true);
        const { pipeline } = await buildPipeline({
            tools: [moveTool],
            ignored: new Set(['Private/x.md']),
        });
        const { callbacks } = makeCallbacks();
        const call: ToolUse = {
            type: 'tool_use',
            id: 'tu-1',
            name: 'move_file',
            input: { source: 'Private/x.md', destination: 'Public/x.md' },
        };
        const result = await pipeline.executeTool(call, callbacks);
        expect(result.is_error).toBe(true);
        expect(String(result.content)).toContain('Ignored: Private/x.md');
        expect(moveTool.execute).not.toHaveBeenCalled();
    });

    it('denies move_file when destination is protected', async () => {
        const moveTool = makeTool('move_file', true);
        const { pipeline } = await buildPipeline({
            tools: [moveTool],
            protectedSet: new Set(['Public/x.md']),
        });
        const { callbacks } = makeCallbacks();
        const call: ToolUse = {
            type: 'tool_use',
            id: 'tu-2',
            name: 'move_file',
            input: { source: 'Other/x.md', destination: 'Public/x.md' },
        };
        const result = await pipeline.executeTool(call, callbacks);
        expect(result.is_error).toBe(true);
        expect(String(result.content)).toContain('Protected: Public/x.md');
        expect(moveTool.execute).not.toHaveBeenCalled();
    });

    it('denies extract_zip when target_folder is protected', async () => {
        const tool = makeTool('extract_zip', true);
        const { pipeline } = await buildPipeline({
            tools: [tool],
            protectedSet: new Set(['Locked/dest']),
        });
        const { callbacks } = makeCallbacks();
        const call: ToolUse = {
            type: 'tool_use',
            id: 'tu-3',
            name: 'extract_zip',
            input: { zip_path: 'In/archive.zip', target_folder: 'Locked/dest' },
        };
        const result = await pipeline.executeTool(call, callbacks);
        expect(result.is_error).toBe(true);
        expect(String(result.content)).toContain('Protected: Locked/dest');
    });

    it('denies generate_canvas when source note is ignored', async () => {
        const tool = makeTool('generate_canvas', true);
        const { pipeline } = await buildPipeline({
            tools: [tool],
            ignored: new Set(['Private/seed.md']),
        });
        const { callbacks } = makeCallbacks();
        const call: ToolUse = {
            type: 'tool_use',
            id: 'tu-4',
            name: 'generate_canvas',
            input: {
                source: 'Private/seed.md',
                output_path: 'Canvases/out.canvas',
                mode: 'folder',
            },
        };
        const result = await pipeline.executeTool(call, callbacks);
        expect(result.is_error).toBe(true);
        expect(String(result.content)).toContain('Ignored: Private/seed.md');
    });
});

// ---------------------------------------------------------------------------
// M-11: configure_model approval gate
// ---------------------------------------------------------------------------

describe('AUDIT-034 M-11: configure_model requires user approval', () => {
    it('denies configure_model fail-closed when no approval callback is wired', async () => {
        const tool = makeTool('configure_model', true);
        const { pipeline } = await buildPipeline({ tools: [tool] });
        const { callbacks } = makeCallbacks();
        const call: ToolUse = {
            type: 'tool_use',
            id: 'cm-1',
            name: 'configure_model',
            input: { action: 'select', model_key: 'foo' },
        };
        const result = await pipeline.executeTool(call, callbacks);
        expect(result.is_error).toBe(true);
        expect(String(result.content)).toContain('denied');
        expect(tool.execute).not.toHaveBeenCalled();
    });

    it('calls onApprovalRequired for configure_model even when an approval callback exists', async () => {
        const tool = makeTool('configure_model', true);
        const { pipeline } = await buildPipeline({ tools: [tool] });
        const onApprovalRequired = vi.fn(async () => ({ decision: 'approved' as const }));
        const { callbacks } = makeCallbacks();
        const call: ToolUse = {
            type: 'tool_use',
            id: 'cm-2',
            name: 'configure_model',
            input: { action: 'add', provider: 'openai' },
        };
        await pipeline.executeTool(call, callbacks, { onApprovalRequired });
        expect(onApprovalRequired).toHaveBeenCalledTimes(1);
        expect(onApprovalRequired).toHaveBeenCalledWith('configure_model', call.input);
        expect(tool.execute).toHaveBeenCalledTimes(1);
    });

    it('rejects configure_model when user denies approval', async () => {
        const tool = makeTool('configure_model', true);
        const { pipeline } = await buildPipeline({ tools: [tool] });
        const onApprovalRequired = vi.fn(async () => ({ decision: 'rejected' as const }));
        const { callbacks } = makeCallbacks();
        const call: ToolUse = {
            type: 'tool_use',
            id: 'cm-3',
            name: 'configure_model',
            input: { action: 'add', provider: 'openai' },
        };
        const result = await pipeline.executeTool(call, callbacks, { onApprovalRequired });
        expect(result.is_error).toBe(true);
        expect(tool.execute).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// M-9: mode-gate enforcement at the execution layer
// ---------------------------------------------------------------------------

function makeModeService(modeSlug: string, allowedTools: string[]) {
    const mode = { slug: modeSlug, name: modeSlug, toolGroups: [] as never[] };
    return {
        getMode: (slug: string) => (slug === modeSlug ? mode : undefined),
        getActiveMode: () => mode,
        modeHasTool: (m: { slug: string }, tool: string) => m.slug === modeSlug && allowedTools.includes(tool),
    };
}

describe('AUDIT-034 M-9: mode-gate enforced at execution layer', () => {
    it('rejects model-source dispatch of a tool not in the active mode toolGroups', async () => {
        const writeTool = makeTool('write_file', true);
        const { pipeline } = await buildPipeline({ tools: [writeTool] }, 'read-only-agent');
        // Read-only mode does not include write_file.
        (pipeline as unknown as { setModeService: (m: unknown) => void }).setModeService(
            makeModeService('read-only-agent', ['read_file']),
        );
        const { callbacks } = makeCallbacks();
        const call: ToolUse = {
            type: 'tool_use',
            id: 'mg-1',
            name: 'write_file',
            input: { path: 'a.md', content: 'x' },
        };
        const result = await pipeline.executeTool(call, callbacks, undefined, { source: 'model' });
        expect(result.is_error).toBe(true);
        expect(String(result.content)).toContain('not available in mode');
        expect(writeTool.execute).not.toHaveBeenCalled();
    });

    it('rejects undefined-source dispatch the same way (legacy callers default to model)', async () => {
        const writeTool = makeTool('write_file', true);
        const { pipeline } = await buildPipeline({ tools: [writeTool] }, 'read-only-agent');
        (pipeline as unknown as { setModeService: (m: unknown) => void }).setModeService(
            makeModeService('read-only-agent', ['read_file']),
        );
        const { callbacks } = makeCallbacks();
        const call: ToolUse = {
            type: 'tool_use',
            id: 'mg-2',
            name: 'write_file',
            input: { path: 'a.md', content: 'x' },
        };
        // No opts argument at all.
        const result = await pipeline.executeTool(call, callbacks);
        expect(result.is_error).toBe(true);
        expect(writeTool.execute).not.toHaveBeenCalled();
    });

    it('bypasses the mode-gate for fastpath dispatches (recipes are user-authored)', async () => {
        const writeTool = makeTool('write_file', true);
        const { pipeline } = await buildPipeline({ tools: [writeTool] }, 'read-only-agent');
        (pipeline as unknown as { setModeService: (m: unknown) => void }).setModeService(
            makeModeService('read-only-agent', ['read_file']),
        );
        const onApprovalRequired = vi.fn(async () => ({ decision: 'approved' as const }));
        const { callbacks } = makeCallbacks();
        const call: ToolUse = {
            type: 'tool_use',
            id: 'mg-3',
            name: 'write_file',
            input: { path: 'a.md', content: 'x' },
        };
        const result = await pipeline.executeTool(
            call, callbacks,
            { onApprovalRequired },
            { source: 'fastpath' },
        );
        expect(result.is_error).toBe(false);
        expect(writeTool.execute).toHaveBeenCalledTimes(1);
    });

    it('bypasses the mode-gate for planner dispatches', async () => {
        const writeTool = makeTool('write_file', true);
        const { pipeline } = await buildPipeline({ tools: [writeTool] }, 'read-only-agent');
        (pipeline as unknown as { setModeService: (m: unknown) => void }).setModeService(
            makeModeService('read-only-agent', ['read_file']),
        );
        const onApprovalRequired = vi.fn(async () => ({ decision: 'approved' as const }));
        const { callbacks } = makeCallbacks();
        const call: ToolUse = {
            type: 'tool_use',
            id: 'mg-4',
            name: 'write_file',
            input: { path: 'a.md', content: 'x' },
        };
        const result = await pipeline.executeTool(
            call, callbacks,
            { onApprovalRequired },
            { source: 'planner' },
        );
        expect(result.is_error).toBe(false);
        expect(writeTool.execute).toHaveBeenCalledTimes(1);
    });

    it('allows the call when the tool IS in the active mode toolGroups', async () => {
        const readTool = makeTool('read_file', false);
        const { pipeline } = await buildPipeline({ tools: [readTool] }, 'read-only-agent');
        (pipeline as unknown as { setModeService: (m: unknown) => void }).setModeService(
            makeModeService('read-only-agent', ['read_file']),
        );
        const { callbacks } = makeCallbacks();
        const call: ToolUse = {
            type: 'tool_use',
            id: 'mg-5',
            name: 'read_file',
            input: { path: 'a.md' },
        };
        const result = await pipeline.executeTool(call, callbacks);
        expect(result.is_error).toBe(false);
        expect(readTool.execute).toHaveBeenCalledTimes(1);
    });

    it('falls back to registry-only behavior when no ModeService is bound', async () => {
        const writeTool = makeTool('write_file', true);
        const { pipeline } = await buildPipeline({ tools: [writeTool] }, 'read-only-agent');
        // Intentionally do NOT call setModeService.
        const onApprovalRequired = vi.fn(async () => ({ decision: 'approved' as const }));
        const { callbacks } = makeCallbacks();
        const call: ToolUse = {
            type: 'tool_use',
            id: 'mg-6',
            name: 'write_file',
            input: { path: 'a.md', content: 'x' },
        };
        const result = await pipeline.executeTool(call, callbacks, { onApprovalRequired });
        expect(result.is_error).toBe(false);
        expect(writeTool.execute).toHaveBeenCalledTimes(1);
    });
});

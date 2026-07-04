import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentTask, type AgentTaskCallbacks, type AgentTaskRunConfig } from '../AgentTask';
import { BUILT_IN_MODES } from '../modes/builtinModes';
import type { ApiHandler, ApiStreamChunk, MessageParam, ContentBlock } from '../../api/types';
import type { ToolRegistry } from '../tools/ToolRegistry';

/**
 * EPIC-41 facade↔engine↔interceptor INTEGRATION test.
 *
 * The port-level unit tests (AgentLoopEngine.*.test.ts, *Interceptor.test.ts)
 * each exercise one seam with fake ports. Nothing drives the real
 * AgentTask.run() through the real AgentLoopEngine and the real interceptor
 * wiring. This test closes that gap: it streams a genuine tool_use turn
 * followed by a text turn and asserts the cross-module contract the unit
 * tests split apart -- the assistant tool_use is executed via the pipeline,
 * its tool_result is pushed to history by the engine, the UI callback fires,
 * the Stigmergy turn opens before the loop and is graded in the finally, and
 * the run completes cleanly.
 *
 * The two genuinely external boundaries are mocked: the ToolExecutionPipeline
 * (touches the vault filesystem) and the StigmergyAdapter (talks to a
 * daemon). Everything between them -- engine, LoopState, interceptors,
 * system-prompt assembly, history handoff -- is the real code.
 */

const { executeToolMock, beginTurnMock, registerMock, fakeTurn } = vi.hoisted(() => {
    const calls: string[] = [];
    const acceptAmounts: number[] = [];
    return {
        executeToolMock: vi.fn(),
        beginTurnMock: vi.fn(),
        registerMock: vi.fn(async () => undefined),
        fakeTurn: {
            calls,
            acceptAmounts,
            turn: {
                enabled: false,
                taskId: 'itest',
                decisionMode: 'none',
                orderTools: <T,>(tools: readonly T[]) => [...tools],
                pathGuidance: () => ({ text: '', path: [] as string[] }),
                emitInvoked: async () => undefined,
                emitReturned: async () => undefined,
                end: async () => { calls.push('end'); },
                accept: async (amount: number) => { calls.push('accept'); acceptAmounts.push(amount); },
                abandon: async () => { calls.push('abandon'); },
            },
        },
    };
});

vi.mock('../tool-execution/ToolExecutionPipeline', () => ({
    ToolExecutionPipeline: class {
        executeTool = executeToolMock;
        setSubagentAllowedTools = vi.fn();
        setStigmergyTurn = vi.fn();
        getExternalizer = () => undefined;
        cleanupExternalized = vi.fn(async () => undefined);
        getPlugin = () => ({});
    },
}));

vi.mock('../stigmergy/StigmergyAdapter', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../stigmergy/StigmergyAdapter')>();
    return {
        ...actual,
        beginStigmergyTurn: beginTurnMock,
        registerCapabilitiesIfChanged: registerMock,
    };
});

/** Async-generator ApiHandler that plays a scripted list of turns. */
function scriptedApi(turns: ApiStreamChunk[][]): ApiHandler {
    let turn = 0;
    return {
        getModel: () => ({ id: 'claude-sonnet-5', info: { contextWindow: 200_000 } }),
        providerType: 'anthropic',
        createMessage: vi.fn(function (): AsyncIterable<ApiStreamChunk> {
            const chunks = turns[turn] ?? [{ type: 'text', text: 'done' }];
            turn++;
            return (async function* () {
                for (const c of chunks) yield c;
            })();
        }),
    } as unknown as ApiHandler;
}

function makePlugin() {
    return {
        settings: { autoTaskRouter: { enabled: false }, leanSystemPrompt: false, advancedApi: {} },
        app: { vault: { configDir: '.test-config', adapter: {} }, plugins: { enabledPlugins: new Set<string>() } },
        getHelperModel: () => null,
        recipeMatchingService: undefined,
    };
}

function makeToolRegistry(plugin: ReturnType<typeof makePlugin>): ToolRegistry {
    return {
        plugin,
        getToolDefinitions: () => [
            { name: 'read_file', description: 'read', input_schema: { type: 'object', properties: {} } },
        ],
    } as unknown as ToolRegistry;
}

function makeCallbacks(): AgentTaskCallbacks & { [k: string]: ReturnType<typeof vi.fn> } {
    return {
        onIterationStart: vi.fn(),
        onText: vi.fn(),
        onThinking: vi.fn(),
        onToolStart: vi.fn(),
        onToolResult: vi.fn(),
        onToolProgress: vi.fn(),
        onUsage: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onAttemptCompletion: vi.fn(),
    };
}

function baseConfig(overrides: Partial<AgentTaskRunConfig> = {}): AgentTaskRunConfig {
    return {
        userMessage: 'read a.md and summarize it',
        taskId: 'itest',
        initialMode: BUILT_IN_MODES[0], // pass a real ModeConfig -> no modeService needed
        history: [],
        ...overrides,
    };
}

beforeEach(() => {
    executeToolMock.mockReset();
    beginTurnMock.mockReset();
    registerMock.mockClear();
    fakeTurn.calls.length = 0;
    fakeTurn.acceptAmounts.length = 0;
    beginTurnMock.mockImplementation(async () => fakeTurn.turn);
});

describe('AgentTask.run integration (engine + interceptors, real wiring)', () => {
    it('executes a streamed tool_use, pushes its tool_result, and completes on the next text turn', async () => {
        executeToolMock.mockResolvedValue({ content: 'file contents of a.md' });
        const api = scriptedApi([
            // turn 1: model calls read_file
            [
                { type: 'tool_use', id: 'tu-1', name: 'read_file', input: { path: 'a.md' } },
                { type: 'usage', inputTokens: 100, outputTokens: 20 },
            ],
            // turn 2: model answers, no tools -> loop exits
            [{ type: 'text', text: 'The file says hello.' }],
        ]);
        const callbacks = makeCallbacks();
        const plugin = makePlugin();
        const history: MessageParam[] = [];
        const task = new AgentTask(api, makeToolRegistry(plugin), callbacks);

        await task.run(baseConfig({ history }));

        // 1. The tool actually ran through the pipeline.
        expect(executeToolMock).toHaveBeenCalledTimes(1);
        expect(executeToolMock.mock.calls[0][0]).toMatchObject({ name: 'read_file', input: { path: 'a.md' } });
        // 2. UI callbacks fired for the executed tool.
        expect(callbacks.onToolStart).toHaveBeenCalledWith('read_file', { path: 'a.md' });
        expect(callbacks.onToolResult).toHaveBeenCalledWith('read_file', 'file contents of a.md', false);
        // 3. The engine pushed the tool_result user message after the assistant turn.
        const toolResultMsg = history.find(
            (m) => m.role === 'user' && Array.isArray(m.content)
                && (m.content).some((b) => b.type === 'tool_result'),
        );
        expect(toolResultMsg).toBeDefined();
        const block = (toolResultMsg!.content as ContentBlock[]).find((b) => b.type === 'tool_result');
        expect(block).toMatchObject({ tool_use_id: 'tu-1', content: 'file contents of a.md' });
        // 4. Final answer streamed and the run completed.
        expect(callbacks.onText).toHaveBeenCalledWith('The file says hello.');
        expect(callbacks.onComplete).toHaveBeenCalledTimes(1);
        expect(callbacks.onError).not.toHaveBeenCalled();
    });

    it('opens the Stigmergy turn before the loop and grades it in the finally on a clean exit', async () => {
        executeToolMock.mockResolvedValue({ content: 'ok' });
        const api = scriptedApi([
            [{ type: 'tool_use', id: 'tu-1', name: 'read_file', input: {} }, { type: 'usage', inputTokens: 50, outputTokens: 10 }],
            [{ type: 'text', text: 'answer' }],
        ]);
        const plugin = makePlugin();
        const task = new AgentTask(api, makeToolRegistry(plugin), makeCallbacks());

        await task.run(baseConfig());

        // onRunStart consulted the daemon once, before any turn graded it.
        expect(beginTurnMock).toHaveBeenCalledTimes(1);
        expect(registerMock).toHaveBeenCalledTimes(1);
        // onRunEnd in the finally: end() precedes exactly one resolution; a
        // clean natural exit (streamed text, no errors, under the cap) grades
        // to accept with the input+output token total.
        expect(fakeTurn.calls).toEqual(['end', 'accept']);
        expect(fakeTurn.acceptAmounts).toEqual([60]);
    });

    it('surfaces a stream tool_error to the UI and still exits cleanly', async () => {
        const api = scriptedApi([
            // turn 1: truncated tool call (tool_error), no executable tool
            [{ type: 'tool_error', id: 'te-1', name: 'write_file', error: 'truncated JSON' }],
            // turn 2: recovery text
            [{ type: 'text', text: 'let me retry differently' }],
        ]);
        const callbacks = makeCallbacks();
        const plugin = makePlugin();
        const history: MessageParam[] = [];
        const task = new AgentTask(api, makeToolRegistry(plugin), callbacks);

        await task.run(baseConfig({ history }));

        // The pipeline is never asked to execute a malformed tool.
        expect(executeToolMock).not.toHaveBeenCalled();
        // The stream-side error is surfaced to the UI (consumeStream port).
        expect(callbacks.onToolResult).toHaveBeenCalledWith('write_file', 'truncated JSON', true);
        // The error block is paired into history so the model can correct.
        const errBlock = history
            .flatMap((m) => (Array.isArray(m.content) ? (m.content) : []))
            .find((b) => b.type === 'tool_result' && (b as { tool_use_id?: string }).tool_use_id === 'te-1');
        expect(errBlock).toMatchObject({ is_error: true, content: 'truncated JSON' });
        expect(callbacks.onComplete).toHaveBeenCalledTimes(1);
    });
});

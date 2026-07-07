import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentTask, type AgentTaskCallbacks, type AgentTaskRunConfig } from '../AgentTask';
import { BUILT_IN_MODES } from '../modes/builtinModes';
import type { ApiHandler, ApiStreamChunk, MessageParam } from '../../api/types';
import type { ToolRegistry } from '../tools/ToolRegistry';
import { initLoopStateForRun, createInitialLoopState } from '../agent/LoopState';

/**
 * FIX-41-03-01 regression: attempt_completion's result was rendered only
 * when NO text was streamed during the entire task (task-global
 * hasStreamedText gate, AgentTask.ts:1710). A model that streams a few
 * narration sentences and puts the full answer into the result param had
 * its answer silently discarded (2026-07-07 incident: 325 chars narration
 * streamed, the whole deliverable in attempt_completion.result, user saw
 * no response).
 *
 * Contract pinned here:
 *  - result carrying MORE substance than everything streamed -> rendered
 *  - short summary result after a fully streamed answer -> NOT rendered
 *  - no streamed text at all -> rendered (pre-existing fallback)
 *  - resuming a snapshot taken after the completion push must not
 *    insta-complete the resumed run (completionResult reset).
 */

const { executeToolMock, beginTurnMock, registerMock, fakeTurn } = vi.hoisted(() => {
    const calls: string[] = [];
    return {
        executeToolMock: vi.fn(),
        beginTurnMock: vi.fn(),
        registerMock: vi.fn(async () => undefined),
        fakeTurn: {
            calls,
            turn: {
                enabled: false,
                taskId: 'ctest',
                decisionMode: 'none',
                orderTools: <T,>(tools: readonly T[]) => [...tools],
                pathGuidance: () => ({ text: '', path: [] as string[] }),
                emitInvoked: async () => undefined,
                emitReturned: async () => undefined,
                end: async () => { calls.push('end'); },
                accept: async () => { calls.push('accept'); },
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
            { name: 'attempt_completion', description: 'complete', input_schema: { type: 'object', properties: {} } },
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
        userMessage: 'analyse the meeting transcript',
        taskId: 'ctest',
        initialMode: BUILT_IN_MODES[0],
        history: [],
        ...overrides,
    };
}

/** Wire the pipeline mock so attempt_completion behaves like the real tool:
 *  signalCompletion(result) then a normal tool_result. */
function wireAttemptCompletion() {
    executeToolMock.mockImplementation(async (toolCall: { name: string; input: { result?: string } }, _cb: unknown, ctx: { signalCompletion?: (r: string) => void }) => {
        if (toolCall.name === 'attempt_completion') {
            ctx.signalCompletion?.(toolCall.input.result ?? '');
            return { content: `<completion_result>${toolCall.input.result ?? ''}</completion_result>` };
        }
        return { content: 'ok' };
    });
}

beforeEach(() => {
    executeToolMock.mockReset();
    beginTurnMock.mockReset();
    registerMock.mockClear();
    fakeTurn.calls.length = 0;
    beginTurnMock.mockImplementation(async () => fakeTurn.turn);
    wireAttemptCompletion();
});

const LONG_RESULT = 'Analyse des Kickoff-Transkripts gegen die Roadmap-Items erstellt und in die Zieldatei geschrieben. '
    + 'Struktur: pro Meilenstein jedes Roadmap-Item mit dem im Meeting Besprochenen, plus Zusatzpunkte und eine Frist-Tabelle.';

describe('attempt_completion result rendering (FIX-41-03-01)', () => {
    it('renders the result when it carries more substance than the streamed narration', async () => {
        const api = scriptedApi([[
            { type: 'text', text: 'Der Vergleich ist fertig und in die aktive Datei geschrieben.' },
            { type: 'tool_use', id: 'tu-1', name: 'attempt_completion', input: { result: LONG_RESULT } },
            { type: 'usage', inputTokens: 100, outputTokens: 50 },
        ]]);
        const callbacks = makeCallbacks();
        const task = new AgentTask(api, makeToolRegistry(makePlugin()), callbacks);

        await task.run(baseConfig());

        expect(callbacks.onAttemptCompletion).toHaveBeenCalledTimes(1);
        expect(callbacks.onText).toHaveBeenCalledWith(LONG_RESULT);
        expect(callbacks.onComplete).toHaveBeenCalledTimes(1);
    });

    it('does NOT re-render a short summary result after a fully streamed answer', async () => {
        const streamedAnswer = 'x'.repeat(1200); // full answer streamed as text
        const summary = 'Done: wrote the analysis to the target file.';
        const api = scriptedApi([[
            { type: 'text', text: streamedAnswer },
            { type: 'tool_use', id: 'tu-1', name: 'attempt_completion', input: { result: summary } },
            { type: 'usage', inputTokens: 100, outputTokens: 50 },
        ]]);
        const callbacks = makeCallbacks();
        const task = new AgentTask(api, makeToolRegistry(makePlugin()), callbacks);

        await task.run(baseConfig());

        expect(callbacks.onText).not.toHaveBeenCalledWith(summary);
        expect(callbacks.onComplete).toHaveBeenCalledTimes(1);
    });

    it('keeps the no-stream fallback: result renders when no text was streamed at all', async () => {
        const api = scriptedApi([[
            { type: 'tool_use', id: 'tu-1', name: 'attempt_completion', input: { result: LONG_RESULT } },
            { type: 'usage', inputTokens: 100, outputTokens: 50 },
        ]]);
        const callbacks = makeCallbacks();
        const task = new AgentTask(api, makeToolRegistry(makePlugin()), callbacks);

        await task.run(baseConfig());

        expect(callbacks.onText).toHaveBeenCalledWith(LONG_RESULT);
        expect(callbacks.onComplete).toHaveBeenCalledTimes(1);
    });
});

describe('initLoopStateForRun resume resets (FIX-41-03-01 follow-on)', () => {
    it('resets completion state so a snapshot taken after the completion push cannot insta-complete the resumed run', () => {
        const snapshot = createInitialLoopState();
        snapshot.completionResult = 'old result';
        snapshot.attemptCompletionFired = true;
        snapshot.hasStreamedText = true;
        snapshot.streamedTextChars = 999;

        const resumed = initLoopStateForRun(snapshot);

        expect(resumed.completionResult).toBeNull();
        expect(resumed.attemptCompletionFired).toBe(false);
        expect(resumed.hasStreamedText).toBe(false);
        expect(resumed.streamedTextChars).toBe(0);
    });
});

import { describe, it, expect, vi } from 'vitest';
import { AgentLoopEngine } from '../AgentLoopEngine';
import { createInitialLoopState } from '../LoopState';
import type { ApiStreamChunk } from '../../../api/types';

/**
 * IMP-41-02-01b / ADR-145: the engine owns the stream-consume phase of the
 * loop and is testable without any Obsidian mock. Chunks are classified
 * into text / thinking segments / tool uses / tool errors / usage, with
 * the same side-effect order the inline loop had (UI ports fire per chunk,
 * state counters update on tool_error and usage).
 */

function stream(chunks: ApiStreamChunk[]): AsyncIterable<ApiStreamChunk> {
    return (async function* () {
        for (const c of chunks) yield c;
    })();
}

function makePorts() {
    return {
        onText: vi.fn(),
        onThinking: vi.fn(),
        onToolStart: vi.fn(),
        onToolResult: vi.fn(),
        onUsage: vi.fn(),
    };
}

describe('AgentLoopEngine.consumeStream', () => {
    it('collects a text-only turn', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        const ports = makePorts();
        const result = await engine.consumeStream(stream([
            { type: 'text', text: 'hello ' },
            { type: 'text', text: 'world' },
            { type: 'usage', inputTokens: 10, outputTokens: 5 },
        ]), state, ports);

        expect(result.textParts.join('')).toBe('hello world');
        expect(result.toolUses).toEqual([]);
        expect(state.hasStreamedText).toBe(true);
        expect(ports.onText).toHaveBeenCalledTimes(2);
        expect(ports.onUsage).toHaveBeenCalledWith(10, 5, 0, 0);
    });

    it('collects tool uses and fires onToolStart per tool', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        const ports = makePorts();
        const result = await engine.consumeStream(stream([
            { type: 'tool_use', id: 't1', name: 'read_file', input: { path: 'a.md' } },
            { type: 'tool_use', id: 't2', name: 'search_files', input: { query: 'x' } },
        ]), state, ports);

        expect(result.toolUses.map((t) => t.name)).toEqual(['read_file', 'search_files']);
        expect(ports.onToolStart).toHaveBeenCalledTimes(2);
        expect(state.hasStreamedText).toBe(false);
    });

    it('records tool errors as mistakes and surfaces them to the UI', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        const ports = makePorts();
        const result = await engine.consumeStream(stream([
            { type: 'tool_error', id: 'e1', name: 'write_file', error: 'truncated input' },
        ]), state, ports);

        expect(result.toolErrors.get('e1')).toBe('truncated input');
        expect(result.toolUses).toHaveLength(1); // placeholder tool_use for pairing
        expect(state.consecutiveMistakes).toBe(1);
        expect(state.totalToolErrors).toBe(1);
        expect(ports.onToolResult).toHaveBeenCalledWith('write_file', 'truncated input', true);
    });

    it('accumulates usage into the state totals', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        const ports = makePorts();
        await engine.consumeStream(stream([
            { type: 'usage', inputTokens: 100, outputTokens: 20, cacheReadTokens: 500, cacheCreationTokens: 50 },
        ]), state, ports);

        expect(state.totalInputTokens).toBe(100);
        expect(state.totalOutputTokens).toBe(20);
        expect(state.totalCacheReadTokens).toBe(500);
        expect(state.totalCacheCreationTokens).toBe(50);
    });

    it('collects signed thinking segments via the collector', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        const ports = makePorts();
        const result = await engine.consumeStream(stream([
            { type: 'thinking', text: 'reasoning', requiresPassback: true },
            { type: 'thinking_signature', signature: 'sig-1' },
            { type: 'text', text: 'answer' },
        ]), state, ports);

        const blocks = result.thinking.finalize(50_000);
        expect(blocks).toEqual([{ type: 'thinking', text: 'reasoning', signature: 'sig-1' }]);
        expect(ports.onThinking).toHaveBeenCalledWith('reasoning');
    });

    it('propagates a mid-stream throw (loop-level policy handles it)', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        const ports = makePorts();
        const failing = (async function* (): AsyncIterable<ApiStreamChunk> {
            yield { type: 'text', text: 'partial' };
            throw Object.assign(new Error('boom'), { status: 500 });
        })();
        await expect(engine.consumeStream(failing, state, ports)).rejects.toThrow('boom');
        expect(state.hasStreamedText).toBe(true); // partial text was seen
    });
});

describe('AgentLoopEngine.runIterationPreamble (stage 2)', () => {
    function preamblePorts(overrides: Partial<{ aborted: boolean; steering: string[] }> = {}) {
        return {
            isAborted: () => overrides.aborted ?? false,
            maxIterations: 10,
            consumeSteeringMessages: overrides.steering !== undefined
                ? vi.fn(() => overrides.steering as string[])
                : undefined,
        };
    }
    const MODE = { name: 'Agent', slug: 'agent', roleDefinition: 'role' };

    it('returns abort when the signal already fired', () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        const outcome = engine.runIterationPreamble(state, [], MODE, preamblePorts({ aborted: true }), []);
        expect(outcome).toBe('abort');
    });

    it('counts telemetry iterations and proceeds', () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        const outcome = engine.runIterationPreamble(state, [], MODE, preamblePorts(), []);
        expect(outcome).toBe('proceed');
        expect(state.telemetryIterations).toBe(1);
    });

    it('injects the soft-limit nudge at 60 percent of max iterations', () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        state.iteration = 6; // floor(10 * 0.6)
        const history: import('../../../api/types').MessageParam[] = [];
        engine.runIterationPreamble(state, history, MODE, preamblePorts(), []);
        expect(history).toHaveLength(1);
        expect(String(history[0].content)).toContain('Wrap up now');
        // Not on other iterations
        const h2: import('../../../api/types').MessageParam[] = [];
        state.iteration = 5;
        engine.runIterationPreamble(state, h2, MODE, preamblePorts(), []);
        expect(h2).toHaveLength(0);
    });

    it('drains steering messages into history and invalidates the cache', () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        const history: import('../../../api/types').MessageParam[] = [];
        engine.runIterationPreamble(state, history, MODE, preamblePorts({ steering: ['fix the title', 'use OKF'] }), []);
        expect(history.map((m) => m.content)).toEqual(['fix the title', 'use OKF']);
        expect(state.cacheInvalidated).toBe(true);
    });

    it('fires interceptors in registration order after the abort check', () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        const order: string[] = [];
        const a = { name: 'a', onIterationStart: () => order.push('a') };
        const b = { name: 'b', onIterationStart: () => order.push('b') };
        engine.runIterationPreamble(state, [], MODE, preamblePorts(), [a, b]);
        expect(order).toEqual(['a', 'b']);
        // aborted -> interceptors never fire
        order.length = 0;
        engine.runIterationPreamble(state, [], MODE, preamblePorts({ aborted: true }), [a, b]);
        expect(order).toEqual([]);
    });

    it('applies transformRequestHistory interceptors in order', () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        const t1 = {
            name: 't1',
            transformRequestHistory: (h: import('../../../api/types').MessageParam[]) =>
                [...h, { role: 'user' as const, content: 'one' }],
        };
        const t2 = {
            name: 't2',
            transformRequestHistory: (h: import('../../../api/types').MessageParam[]) =>
                [...h, { role: 'user' as const, content: 'two' }],
        };
        const out = engine.transformRequestHistory([{ role: 'user', content: 'base' }], { state, history: [], activeMode: MODE }, [t1, t2]);
        expect(out.map((m) => m.content)).toEqual(['base', 'one', 'two']);
    });
});

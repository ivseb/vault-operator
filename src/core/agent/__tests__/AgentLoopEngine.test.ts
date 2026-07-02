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

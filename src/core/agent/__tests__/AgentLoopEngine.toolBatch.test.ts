/**
 * IMP-41-02-01b stage 3a: the engine owns tool-batch execution. These
 * tests pin the four order-sensitive contracts the inline loop had:
 * sidebar FIFO result ordering, abort boundaries between sequential
 * tools, the two exact circuit-breaker messages, and the inflight
 * snapshot phase quirk. Fake ports only -- no Obsidian, no pipeline.
 */

import { describe, it, expect, vi } from 'vitest';
import { AgentLoopEngine, type ToolBatchPorts, type ToolUseBlock, type ToolExecResult } from '../AgentLoopEngine';
import { createInitialLoopState } from '../LoopState';
import type { ContentBlock, MessageParam } from '../../../api/types';

function toolUse(id: string, name: string, input: Record<string, unknown> = {}): ToolUseBlock {
    return { type: 'tool_use', id, name, input };
}

type ToolResultBlock = Extract<ContentBlock, { type: 'tool_result' }>;

function resultBlocks(history: MessageParam[]): ToolResultBlock[] {
    expect(history).toHaveLength(1);
    const content = history[0].content;
    expect(Array.isArray(content)).toBe(true);
    return (content as ContentBlock[]).filter(
        (b): b is ToolResultBlock => b.type === 'tool_result',
    );
}

function makePorts(overrides: Partial<ToolBatchPorts> = {}): ToolBatchPorts {
    return {
        isAborted: () => false,
        executeTool: vi.fn(async (): Promise<ToolExecResult> => ({ content: 'ok' })),
        onToolResult: vi.fn(),
        escalateToMain: vi.fn(),
        qualityGateFor: () => undefined,
        consecutiveMistakeLimit: 3,
        parallelSafe: new Set(['read_file', 'search_files']),
        ...overrides,
    };
}

describe('AgentLoopEngine.executeToolBatch', () => {
    it('pushes stream tool_error blocks before executed results, verbatim and flagged', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        const history: MessageParam[] = [];
        const ports = makePorts();

        await engine.executeToolBatch(
            [toolUse('t1', 'write_file')],
            new Map([['e1', 'truncated JSON input']]),
            state, history, ports,
        );

        const blocks = resultBlocks(history);
        expect(blocks).toHaveLength(2);
        expect(blocks[0]).toMatchObject({ tool_use_id: 'e1', content: 'truncated JSON input', is_error: true });
        expect(blocks[1]).toMatchObject({ tool_use_id: 't1', content: 'ok' });
    });

    it('processes parallel-prefix results in original order even when promises resolve out of order', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        const history: MessageParam[] = [];
        const resolvers: Array<(r: ToolExecResult) => void> = [];
        const executeTool = vi.fn((tu: ToolUseBlock) => new Promise<ToolExecResult>((resolve) => {
            resolvers.push((r) => resolve({ ...r, content: `${tu.id}-done` }));
        }));
        const ports = makePorts({ executeTool });

        const run = engine.executeToolBatch(
            [toolUse('t1', 'read_file'), toolUse('t2', 'search_files')],
            new Map(), state, history, ports,
        );
        // Resolve in REVERSE order -- t2 finishes before t1.
        resolvers[1]({ content: '' });
        resolvers[0]({ content: '' });
        await run;

        // FIFO contract with the sidebar: UI callbacks and blocks in model order.
        const uiCalls = (ports.onToolResult as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
        expect(uiCalls).toEqual(['t1-done', 't2-done']);
        expect(resultBlocks(history).map((b) => b.tool_use_id)).toEqual(['t1', 't2']);
    });

    it('stops the sequential tail at an abort boundary but still pushes collected results', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        const history: MessageParam[] = [];
        let aborted = false;
        const executeTool = vi.fn(async (): Promise<ToolExecResult> => {
            aborted = true; // abort arrives while the first tool runs
            return { content: 'first' };
        });
        const ports = makePorts({
            executeTool,
            isAborted: () => aborted,
            parallelSafe: new Set<string>(),
        });

        await engine.executeToolBatch(
            [toolUse('t1', 'write_file'), toolUse('t2', 'write_file'), toolUse('t3', 'write_file')],
            new Map(), state, history, ports,
        );

        expect(executeTool).toHaveBeenCalledTimes(1);
        expect(resultBlocks(history).map((b) => b.tool_use_id)).toEqual(['t1']);
    });

    it('breaks the sequential tail after the tool that set completionResult', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        const history: MessageParam[] = [];
        const executeTool = vi.fn(async (tu: ToolUseBlock): Promise<ToolExecResult> => {
            if (tu.id === 't1') state.completionResult = 'done';
            return { content: 'x' };
        });
        const ports = makePorts({ executeTool, parallelSafe: new Set<string>() });

        await engine.executeToolBatch(
            [toolUse('t1', 'attempt_completion'), toolUse('t2', 'write_file')],
            new Map(), state, history, ports,
        );

        expect(executeTool).toHaveBeenCalledTimes(1);
        expect(resultBlocks(history).map((b) => b.tool_use_id)).toEqual(['t1']);
    });

    it('counts mistakes, resets on success, escalates at 2 and throws the exact breaker message at the limit', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        const history: MessageParam[] = [];
        const outcomes: Record<string, ToolExecResult> = {
            t1: { content: '<error>a</error>', is_error: true },
            t2: { content: 'fine' },
            t3: { content: '<error>b</error>', is_error: true },
            t4: { content: '<error>c</error>', is_error: true },
        };
        const executeTool = vi.fn(async (tu: ToolUseBlock) => outcomes[tu.id]);
        const ports = makePorts({ executeTool, parallelSafe: new Set<string>(), consecutiveMistakeLimit: 2 });

        await expect(engine.executeToolBatch(
            [toolUse('t1', 'a'), toolUse('t2', 'b'), toolUse('t3', 'c'), toolUse('t4', 'd')],
            new Map(), state, history, ports,
        )).rejects.toThrow(
            'Agent stopped after 2 consecutive errors. '
            + 'Check the tool results above or raise the limit in Settings → Advanced.',
        );

        // t1 error (1), t2 success (reset), t3 error (1), t4 error (2) -> escalate + throw.
        expect(state.consecutiveMistakes).toBe(2);
        expect(state.totalToolErrors).toBe(3);
        expect(ports.escalateToMain).toHaveBeenCalledTimes(1);
        // The throw happens before the history push -- run()'s error policy owns the turn.
        expect(history).toHaveLength(0);
    });

    it('throws the exact malformed-tool-call breaker message on an error-only turn, after pushing the blocks', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        state.consecutiveMistakes = 2; // pre-bumped by consumeStream per tool_error
        const history: MessageParam[] = [];
        const ports = makePorts({ consecutiveMistakeLimit: 2 });

        await expect(engine.executeToolBatch(
            [], new Map([['e1', 'cut off']]), state, history, ports,
        )).rejects.toThrow(
            'Agent stopped after 2 consecutive errors -- the last was a malformed or truncated tool call. '
            + "The model's tool call kept getting cut off before it finished. "
            + 'Fix: have the model split a large write into write_file (header + first section) then append_to_file for the rest, '
            + 'reduce the attached input, or raise Max output tokens in Settings -> Models.',
        );

        // Unlike the per-tool breaker, the malformed breaker fires AFTER the push.
        expect(resultBlocks(history).map((b) => b.tool_use_id)).toEqual(['e1']);
    });

    it('appends the quality gate only on success, for string and multimodal content', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        const history: MessageParam[] = [];
        const outcomes: Record<string, ToolExecResult> = {
            t1: { content: 'written' },
            t2: { content: [{ type: 'text', text: 'block' }] },
            t3: { content: 'failed', is_error: true },
        };
        const executeTool = vi.fn(async (tu: ToolUseBlock) => outcomes[tu.id]);
        const ports = makePorts({
            executeTool,
            parallelSafe: new Set<string>(),
            qualityGateFor: (name) => (name === 'write_file' ? 'CHECK: verify the write' : undefined),
        });

        await engine.executeToolBatch(
            [toolUse('t1', 'write_file'), toolUse('t2', 'write_file'), toolUse('t3', 'write_file')],
            new Map(), state, history, ports,
        );

        const blocks = resultBlocks(history);
        expect(blocks[0].content).toBe('written\n\nCHECK: verify the write');
        expect(blocks[1].content).toEqual([
            { type: 'text', text: 'block' },
            { type: 'text', text: '\n\nCHECK: verify the write' },
        ]);
        expect(blocks[2].content).toBe('failed'); // no gate on error
    });

    it('fires the inflight snapshot after the push and sets the phase only when the port exists', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        state.phase = 'streaming';
        const history: MessageParam[] = [];
        let historyLenAtSnapshot = -1;
        const ports = makePorts({
            saveInflightSnapshot: () => { historyLenAtSnapshot = history.length; },
        });

        await engine.executeToolBatch([toolUse('t1', 'read_file')], new Map(), state, history, ports);

        expect(historyLenAtSnapshot).toBe(1);
        expect(state.phase).toBe('executing-tools');

        // Without the port the phase is left untouched (no store wired).
        const state2 = createInitialLoopState();
        state2.phase = 'streaming';
        const history2: MessageParam[] = [];
        await engine.executeToolBatch([toolUse('t1', 'read_file')], new Map(), state2, history2, makePorts());
        expect(state2.phase).toBe('streaming');
    });

    it('does not escalate below two consecutive mistakes', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        const history: MessageParam[] = [];
        const executeTool = vi.fn(async (): Promise<ToolExecResult> => ({ content: '<error>x</error>', is_error: true }));
        const ports = makePorts({ executeTool, parallelSafe: new Set<string>() });

        await engine.executeToolBatch([toolUse('t1', 'a')], new Map(), state, history, ports);

        expect(state.consecutiveMistakes).toBe(1);
        expect(ports.escalateToMain).not.toHaveBeenCalled();
    });
});

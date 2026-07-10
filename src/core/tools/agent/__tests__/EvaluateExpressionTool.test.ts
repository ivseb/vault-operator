import { describe, it, expect, vi } from 'vitest';
import { EvaluateExpressionTool } from '../EvaluateExpressionTool';
import type ObsidianAgentPlugin from '../../../../main';
import type { ISandboxExecutor } from '../../../sandbox/ISandboxExecutor';
import type { EsbuildWasmManager } from '../../../sandbox/EsbuildWasmManager';
import type { ToolExecutionContext } from '../../types';

/**
 * FIX-05-02-05: the sandbox return value is pushed 1:1 into the message
 * history. Without a cap, `return ctx.vault.read(path)`-style expressions
 * pump arbitrarily large payloads into the context until the 50k message
 * truncation destroys the agent's own earlier tool results. The tool caps
 * the formatted output and appends a marker steering the model to
 * read_file (chunked reads) or ctx.vault.write (large computed data).
 */

function makeTool(result: unknown): {
    tool: EvaluateExpressionTool;
    results: string[];
    context: ToolExecutionContext;
} {
    const plugin = {} as unknown as ObsidianAgentPlugin;
    const sandboxExecutor = {
        execute: vi.fn(async () => result),
    } as unknown as ISandboxExecutor;
    const esbuildManager = {
        transform: vi.fn(async (src: string) => src),
        build: vi.fn(async (src: string) => src),
    } as unknown as EsbuildWasmManager;
    const tool = new EvaluateExpressionTool(plugin, sandboxExecutor, esbuildManager);
    const results: string[] = [];
    const context = {
        callbacks: {
            pushToolResult: (r: string) => { results.push(r); },
            log: vi.fn(),
        },
    } as unknown as ToolExecutionContext;
    return { tool, results, context };
}

describe('EvaluateExpressionTool result cap (FIX-05-02-05)', () => {
    it('passes small results through unchanged', async () => {
        const { tool, results, context } = makeTool({ set: 5, missed: [] });
        await tool.execute({ expression: 'return 1' }, context);
        expect(results).toHaveLength(1);
        expect(results[0]).toContain('"set": 5');
        expect(results[0]).not.toContain('[Truncated');
    });

    it('truncates oversized string results and appends the steering marker', async () => {
        const big = 'x'.repeat(100_000);
        const { tool, results, context } = makeTool(big);
        await tool.execute({ expression: 'return 1' }, context);
        expect(results).toHaveLength(1);
        expect(results[0].length).toBeLessThan(20_000);
        expect(results[0]).toContain('[Truncated: result was 100000 chars');
        expect(results[0]).toContain('read_file');
        expect(results[0]).toContain('ctx.vault.write');
    });

    it('truncates oversized JSON results too', async () => {
        const big = { chunks: Array.from({ length: 2_000 }, (_, i) => `chunk-${i}-${'y'.repeat(40)}`) };
        const { tool, results, context } = makeTool(big);
        await tool.execute({ expression: 'return 1' }, context);
        expect(results).toHaveLength(1);
        expect(results[0].length).toBeLessThan(20_000);
        expect(results[0]).toContain('[Truncated: result was');
    });

    it('keeps results just under the cap untouched', async () => {
        const nearCap = 'z'.repeat(15_999);
        const { tool, results, context } = makeTool(nearCap);
        await tool.execute({ expression: 'return 1' }, context);
        expect(results).toHaveLength(1);
        expect(results[0]).not.toContain('[Truncated');
        expect(results[0]).toContain(nearCap);
    });
});

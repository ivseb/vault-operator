/**
 * FIX-44-45: DynamicTool (the custom_* skill tools) must bind the governance
 * taskId for its sandbox execution.
 *
 * Adversarial review 2026-07-14 (CONFIRMED, P1). DynamicTool.execute called
 * sandboxExecutor.execute WITHOUT a governance taskId, so
 * SandboxBridge.snapshotBeforeWrite no-oped and sandbox vault writes from
 * custom skill tools were unrecoverable via restore_checkpoint -- the exact
 * loss class FIX-44-04 closed for evaluate_expression / run_skill_script.
 *
 * After FIX-44-43 the binding is per execution: the tool passes
 * { governanceTaskId: context.taskId } to execute(), the executor maps the
 * execution id to the task, and every bridge write of that run snapshots
 * under it.
 */

import { describe, it, expect, vi } from 'vitest';
import { DynamicToolFactory } from '../DynamicToolFactory';
import type { DynamicToolDefinition } from '../types';
import type { ToolExecutionContext } from '../../types';
import type { ISandboxExecutor, SandboxExecutionOptions } from '../../../sandbox/ISandboxExecutor';
import type ObsidianAgentPlugin from '../../../../main';

function makeTool() {
    const calls: Array<{
        compiledJs: string;
        input: Record<string, unknown>;
        options?: SandboxExecutionOptions;
    }> = [];
    const executor: ISandboxExecutor = {
        ensureReady: async () => { /* no-op */ },
        execute: async (compiledJs, input, options) => {
            calls.push({ compiledJs, input, options });
            return 'ok';
        },
        destroy: () => { /* no-op */ },
    };
    const definition: DynamicToolDefinition = {
        name: 'custom_test_tool',
        description: 'test tool',
        input_schema: { type: 'object', properties: {} },
        isWriteOperation: true,
    };
    const plugin = { app: {} } as unknown as ObsidianAgentPlugin;
    const tool = DynamicToolFactory.create(definition, 'compiled-js', executor, plugin);
    return { tool, calls };
}

function makeContext(taskId: string): ToolExecutionContext {
    return {
        taskId,
        callbacks: {
            pushToolResult: vi.fn(),
            log: vi.fn(),
        },
    } as unknown as ToolExecutionContext;
}

describe('DynamicTool governance binding (FIX-44-45)', () => {
    it('passes the governance taskId of the executing task to the sandbox', async () => {
        const { tool, calls } = makeTool();

        await tool.execute({ some: 'input' }, makeContext('task-7'));

        expect(calls).toHaveLength(1);
        expect(calls[0].compiledJs).toBe('compiled-js');
        expect(calls[0].options?.governanceTaskId).toBe('task-7');
    });

    it('each invocation binds its own task (no stale reuse)', async () => {
        const { tool, calls } = makeTool();

        await tool.execute({}, makeContext('task-A'));
        await tool.execute({}, makeContext('task-B'));

        expect(calls[0].options?.governanceTaskId).toBe('task-A');
        expect(calls[1].options?.governanceTaskId).toBe('task-B');
    });
});

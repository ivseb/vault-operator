import { describe, it, expect, beforeEach } from 'vitest';
import { NewTaskTool } from '../NewTaskTool';
import type ObsidianAgentPlugin from '../../../../main';
import type { ToolExecutionContext } from '../../types';

/**
 * Tests for NewTaskTool focusing on the FEAT-24-04 / ADR-113 changes:
 * per-call token budget + profile path. Validation-only tests live in
 * newTaskValidation.test.ts.
 */

interface CapturedResult { content: string }

function makePlugin(subtaskTokenBudget = 8000, providerConfigs: unknown[] = []): ObsidianAgentPlugin {
    return {
        settings: {
            advancedApi: { subtaskTokenBudget },
            activeMcpServers: [],
            providerConfigs,
        },
    } as unknown as ObsidianAgentPlugin;
}

function makeContext(opts: { mode?: string; spawnResult?: string; spawnSpy?: (m: string, msg: string, p?: string, ov?: unknown) => void } = {}): { ctx: ToolExecutionContext; results: CapturedResult[]; logs: string[] } {
    const results: CapturedResult[] = [];
    const logs: string[] = [];
    const ctx = {
        mode: opts.mode ?? 'agent',
        callbacks: {
            pushToolResult: (content: string) => { results.push({ content }); },
            log: (msg: string) => { logs.push(msg); },
            handleError: async () => { /* noop */ },
        },
        spawnSubtask: async (mode: string, message: string, profileName?: string, overrides?: unknown) => {
            opts.spawnSpy?.(mode, message, profileName, overrides);
            return opts.spawnResult ?? 'subtask result';
        },
    } as unknown as ToolExecutionContext;
    return { ctx, results, logs };
}

const PROVIDER_WITH_OPUS = {
    id: 'anthropic-main',
    type: 'anthropic',
    enabled: true,
    apiKey: 'sk-x',
    baseUrl: 'https://api.anthropic.com',
    discoveredModels: [{ id: 'claude-opus-4-6', displayName: 'Opus 4.6' }],
};

describe('NewTaskTool token budget (FEAT-24-04 / ADR-113)', () => {
    let plugin: ObsidianAgentPlugin;
    beforeEach(() => { plugin = makePlugin(8000); });

    it('rejects a message that exceeds the per-call token budget', async () => {
        const tool = new NewTaskTool(plugin);
        const { ctx, results } = makeContext();
        // 8000 * 4 = 32000 chars is exactly the budget; one more char tips over.
        const longMessage = 'X'.repeat(32_001);
        await tool.execute({
            mode: 'agent',
            message: longMessage,
            profile: 'research',
        }, ctx);
        expect(results).toHaveLength(1);
        const out = results[0].content;
        expect(out).toMatch(/exceeds the per-call token budget/);
        expect(out).toContain('8000');
        expect(out).toMatch(/Shorten the message/);
        expect(out).toContain('subtaskTokenBudget');
    });

    it('lets a message at the budget edge through', async () => {
        const tool = new NewTaskTool(plugin);
        let spawned = false;
        const { ctx, results } = makeContext({ spawnSpy: () => { spawned = true; } });
        const message = 'X'.repeat(32_000); // exactly budget
        await tool.execute({
            mode: 'agent',
            message,
            profile: 'research',
        }, ctx);
        expect(spawned).toBe(true);
        expect(results[0].content).toContain('Sub-agent completed');
    });

    it('honours a smaller user-configured budget', async () => {
        const tightPlugin = makePlugin(100); // 400 chars
        const tool = new NewTaskTool(tightPlugin);
        const { ctx, results } = makeContext();
        await tool.execute({
            mode: 'agent',
            message: 'X'.repeat(500),
            profile: 'research',
        }, ctx);
        expect(results[0].content).toContain('exceeds the per-call token budget');
        expect(results[0].content).toContain('100');
    });
});

describe('NewTaskTool profile vs Tier-4 path (FEAT-24-04 / ADR-113)', () => {
    let plugin: ObsidianAgentPlugin;
    beforeEach(() => { plugin = makePlugin(); });

    it('passes profile=research to spawnSubtask and reports profile in completion header', async () => {
        const tool = new NewTaskTool(plugin);
        const calls: Array<{ mode: string; message: string; profile?: string }> = [];
        const { ctx, results } = makeContext({
            spawnSpy: (mode, message, profile) => { calls.push({ mode, message, profile }); },
            spawnResult: 'compact research summary',
        });
        await tool.execute({
            mode: 'agent',
            message: 'find all meeting notes from Q3',
            profile: 'research',
        }, ctx);
        expect(calls).toHaveLength(1);
        expect(calls[0].profile).toBe('research');
        expect(results[0].content).toMatch(/profile: research/);
        expect(results[0].content).toContain('compact research summary');
    });

    it('still works on the Tier-4 path (no profile, with justification)', async () => {
        const tool = new NewTaskTool(plugin);
        const calls: Array<{ profile?: string }> = [];
        const { ctx, results } = makeContext({
            spawnSpy: (_m, _msg, profile) => { calls.push({ profile }); },
        });
        await tool.execute({
            mode: 'agent',
            message: 'do a parallel comparison',
            justification_category: 'PARALLEL',
            justification_reason: 'comparing 5 independent meeting notes for synthesis across teams',
        }, ctx);
        expect(calls[0].profile).toBeUndefined();
        expect(results[0].content).toMatch(/mode: agent/);
    });

    it('returns a clear error on unknown profile name', async () => {
        const tool = new NewTaskTool(plugin);
        const { ctx, results } = makeContext();
        await tool.execute({
            mode: 'agent',
            message: 'do something',
            profile: 'planner',
        }, ctx);
        expect(results[0].content).toContain('Unknown subagent profile');
        expect(results[0].content).toContain('research');
    });

    it('refuses to spawn when not in Agent mode', async () => {
        const tool = new NewTaskTool(plugin);
        const { ctx, results } = makeContext({ mode: 'ask' });
        await tool.execute({
            mode: 'agent',
            message: 'do a thing',
            profile: 'research',
        }, ctx);
        expect(results[0].content).toMatch(/only available in Agent mode/);
    });
});

describe('NewTaskTool model_key (Issue #54.4.1)', () => {
    it('forwards a valid model_key to spawnSubtask as overrides.modelKey', async () => {
        const tool = new NewTaskTool(makePlugin(8000, [PROVIDER_WITH_OPUS]));
        const captured: unknown[] = [];
        const { ctx } = makeContext({ spawnSpy: (_m, _msg, _p, ov) => { captured.push(ov); } });
        await tool.execute({
            mode: 'agent',
            message: 'find every Q3 note and summarise',
            profile: 'research',
            model_key: 'claude-opus-4-6|anthropic',
        }, ctx);
        expect(captured[0]).toEqual({ modelKey: 'claude-opus-4-6|anthropic' });
    });

    it('rejects an unknown model_key and does not spawn', async () => {
        const tool = new NewTaskTool(makePlugin(8000, [PROVIDER_WITH_OPUS]));
        let spawned = false;
        const { ctx, results } = makeContext({ spawnSpy: () => { spawned = true; } });
        await tool.execute({
            mode: 'agent',
            message: 'find every Q3 note and summarise',
            profile: 'research',
            model_key: 'ghost|anthropic',
        }, ctx);
        expect(spawned).toBe(false);
        expect(results[0].content).toContain('claude-opus-4-6|anthropic');
        expect(results[0].content).toMatch(/not a configured model/i);
    });

    it('spawns without overrides.modelKey when no model_key is given', async () => {
        const tool = new NewTaskTool(makePlugin(8000, [PROVIDER_WITH_OPUS]));
        const captured: Array<{ modelKey?: string } | undefined> = [];
        const { ctx } = makeContext({ spawnSpy: (_m, _msg, _p, ov) => { captured.push(ov as { modelKey?: string } | undefined); } });
        await tool.execute({
            mode: 'agent',
            message: 'find every Q3 note and summarise',
            profile: 'research',
        }, ctx);
        expect(captured[0]?.modelKey).toBeUndefined();
    });
});

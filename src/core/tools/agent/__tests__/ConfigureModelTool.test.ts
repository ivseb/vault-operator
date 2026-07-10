import { describe, it, expect } from 'vitest';
import { ConfigureModelTool } from '../ConfigureModelTool';
import type ObsidianAgentPlugin from '../../../../main';
import type { ToolExecutionContext } from '../../types';
import type { CustomModel, ProviderConfig } from '../../../../types/settings';

/**
 * Issue #54.4b: configure_model must read the EPIC-26 provider store
 * (providerConfigs[]) so the agent can enumerate models even after the
 * migration emptied the legacy activeModels[]. Adds a `list` action and
 * re-points select/test lookups at providerConfigs.
 */

function makeProvider(): ProviderConfig {
    return {
        id: 'anthropic-main',
        type: 'anthropic',
        enabled: true,
        apiKey: 'sk-test',
        baseUrl: 'https://api.anthropic.com',
        discoveredModels: [
            { id: 'claude-opus-4-6', displayName: 'Opus 4.6' },
            { id: 'claude-haiku-4-5', displayName: 'Haiku 4.5' },
        ],
        lastRefreshAt: 0,
    } as unknown as ProviderConfig;
}

function makePlugin(providerConfigs: ProviderConfig[], activeModels: CustomModel[] = []): ObsidianAgentPlugin {
    return {
        settings: { providerConfigs, activeModels, activeModelKey: '' },
        saveSettings: async () => { /* noop */ },
    } as unknown as ObsidianAgentPlugin;
}

function makeCtx(): { ctx: ToolExecutionContext; results: string[] } {
    const results: string[] = [];
    const ctx = {
        mode: 'agent',
        callbacks: {
            pushToolResult: (content: string) => { results.push(content); },
            log: () => { /* noop */ },
            handleError: async () => { /* noop */ },
        },
    } as unknown as ToolExecutionContext;
    return { ctx, results };
}

describe('ConfigureModelTool list action (Issue #54.4b)', () => {
    it('enumerates provider-config models even when activeModels is empty', async () => {
        const tool = new ConfigureModelTool(makePlugin([makeProvider()], []));
        const { ctx, results } = makeCtx();
        await tool.execute({ action: 'list' }, ctx);
        expect(results).toHaveLength(1);
        expect(results[0]).toContain('claude-opus-4-6|anthropic');
        expect(results[0]).toContain('Opus 4.6');
        expect(results[0]).toContain('claude-haiku-4-5|anthropic');
    });

    it('gives a helpful hint when no provider models are configured', async () => {
        const tool = new ConfigureModelTool(makePlugin([], []));
        const { ctx, results } = makeCtx();
        await tool.execute({ action: 'list' }, ctx);
        expect(results[0]).toMatch(/no models configured/i);
    });
});

describe('ConfigureModelTool select against providerConfigs (Issue #54.4b)', () => {
    it('finds a model in providerConfigs even with an empty activeModels[]', async () => {
        const plugin = makePlugin([makeProvider()], []);
        const tool = new ConfigureModelTool(plugin);
        const { ctx, results } = makeCtx();
        await tool.execute({ action: 'select', model_key: 'claude-opus-4-6|anthropic' }, ctx);
        expect(results[0]).toContain('<success>');
        expect(plugin.settings.activeModelKey).toBe('claude-opus-4-6|anthropic');
    });

    it('lists available provider models when the key is unknown', async () => {
        const tool = new ConfigureModelTool(makePlugin([makeProvider()], []));
        const { ctx, results } = makeCtx();
        await tool.execute({ action: 'select', model_key: 'ghost|anthropic' }, ctx);
        expect(results[0]).toContain('<error>');
        expect(results[0]).toContain('claude-opus-4-6|anthropic');
        expect(results[0]).not.toContain('none configured');
    });
});

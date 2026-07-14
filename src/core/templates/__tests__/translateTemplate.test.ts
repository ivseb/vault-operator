/**
 * FEAT-29-14 / review finding B1 (2026-07-14): the template translator must
 * resolve its model from the canonical providerConfigs[] store. The first-run
 * wizard writes only providerConfigs[] (FIX-26-99-03); a consumer reading the
 * legacy activeModels[] alone is model-blind after a wizard install and
 * silently falls back to the untranslated EN source.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '../../../types/settings';
import type ObsidianAgentPlugin from '../../../main';

const buildApiHandlerForModelMock = vi.fn();

vi.mock('../../../api/index', () => ({
    buildApiHandlerForModel: (model: unknown) => buildApiHandlerForModelMock(model) as unknown,
}));

import { makeTemplateTranslator } from '../translateTemplate';

const SOURCE = '---\ntags:\n---\nBody\n';

function providerConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
    return {
        id: 'anthropic-main',
        type: 'anthropic',
        displayName: 'Anthropic',
        enabled: true,
        apiKey: 'sk-live',
        discoveredModels: [{ id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' }],
        lastRefreshAt: 0,
        tierMapping: { mid: 'claude-sonnet-4-6' },
        tierOverrides: {},
        ...overrides,
    };
}

function pluginWith(settings: Record<string, unknown>): ObsidianAgentPlugin {
    return { settings } as unknown as ObsidianAgentPlugin;
}

describe('makeTemplateTranslator model resolution (review finding B1)', () => {
    beforeEach(() => {
        buildApiHandlerForModelMock.mockReset();
        buildApiHandlerForModelMock.mockReturnValue({
            classifyText: async () => 'translated',
        });
    });

    it('resolves the model from providerConfigs[] after a wizard-only install', async () => {
        const plugin = pluginWith({
            activeModels: [],
            activeModelKey: null,
            providerConfigs: [providerConfig()],
            activeProviderId: 'anthropic-main',
        });
        const translate = makeTemplateTranslator(plugin);

        const out = await translate('de', 'note.md', SOURCE);

        expect(out).toBe('translated\n');
        expect(buildApiHandlerForModelMock).toHaveBeenCalledTimes(1);
        const model = buildApiHandlerForModelMock.mock.calls[0][0] as { name: string; apiKey?: string };
        expect(model.name).toBe('claude-sonnet-4-6');
        expect(model.apiKey).toBe('sk-live');
    });

    it('falls back to the legacy activeModels[] store for not-yet-migrated setups', async () => {
        const plugin = pluginWith({
            activeModels: [{ name: 'legacy-model', provider: 'anthropic', apiKey: 'sk-legacy', enabled: true }],
            activeModelKey: null,
            providerConfigs: [],
            activeProviderId: null,
        });
        const translate = makeTemplateTranslator(plugin);

        const out = await translate('de', 'note.md', SOURCE);

        expect(out).toBe('translated\n');
        const model = buildApiHandlerForModelMock.mock.calls[0][0] as { name: string };
        expect(model.name).toBe('legacy-model');
    });

    it('returns the source unchanged when neither store has a model', async () => {
        const plugin = pluginWith({
            activeModels: [],
            activeModelKey: null,
            providerConfigs: [],
            activeProviderId: null,
        });
        const translate = makeTemplateTranslator(plugin);

        const out = await translate('de', 'note.md', SOURCE);

        expect(out).toBe(SOURCE);
        expect(buildApiHandlerForModelMock).not.toHaveBeenCalled();
    });
});

/**
 * IMP-54-05b (issue #54): pure view logic for the ProviderDetailModal
 * "Reasoning effort" opt-in section.
 *
 * The section is only meaningful for provider types on the OpenAI-compatible
 * wire path, and only offers models the STATIC registry resolves to [] --
 * models that already have native levels (gpt-5 on openai, Claude on
 * openrouter) must not show the control.
 */

import { describe, it, expect } from 'vitest';
import type { ProviderConfig } from '../../../types/settings';
import { buildEffortOptInView } from '../effortOptIn';

function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
    return {
        id: 'custom-main',
        type: 'custom',
        enabled: true,
        discoveredModels: [{ id: 'GLM-5.2' }, { id: 'DeepSeek-R1' }],
        lastRefreshAt: 0,
        tierMapping: {},
        tierOverrides: {},
        ...overrides,
    };
}

describe('buildEffortOptInView', () => {
    it('returns null for provider types outside the OpenAI-compatible wire path', () => {
        for (const type of ['anthropic', 'bedrock', 'github-copilot', 'chatgpt-oauth'] as const) {
            expect(buildEffortOptInView(makeProvider({ type })), type).toBeNull();
        }
    });

    it('offers all statically effort-incapable models of a custom provider as candidates', () => {
        const view = buildEffortOptInView(makeProvider());
        expect(view).not.toBeNull();
        expect(view!.optedIn).toEqual([]);
        expect(view!.available).toEqual(['GLM-5.2', 'DeepSeek-R1']);
    });

    it('splits opted-in models out of the candidate list', () => {
        const view = buildEffortOptInView(makeProvider({ effortOptIn: { 'GLM-5.2': true } }));
        expect(view!.optedIn).toEqual(['GLM-5.2']);
        expect(view!.available).toEqual(['DeepSeek-R1']);
    });

    it('never offers models the static registry already resolves (gpt-5 on openai)', () => {
        const view = buildEffortOptInView(makeProvider({
            type: 'openai',
            discoveredModels: [{ id: 'gpt-5' }, { id: 'GLM-5.2' }],
        }));
        expect(view!.available).toEqual(['GLM-5.2']);
    });

    it('includes manual tier-override ids that discovery does not know (FIX-55-01)', () => {
        const view = buildEffortOptInView(makeProvider({
            discoveredModels: [],
            tierOverrides: { flagship: 'GLM-5.2' },
        }));
        expect(view!.available).toEqual(['GLM-5.2']);
    });

    it('keeps a stale opted-in id listed so the user can remove it', () => {
        const view = buildEffortOptInView(makeProvider({
            discoveredModels: [],
            effortOptIn: { 'gone-model': true },
        }));
        expect(view!.optedIn).toEqual(['gone-model']);
        expect(view!.available).toEqual([]);
    });

    it('ignores explicit false entries in the map', () => {
        const view = buildEffortOptInView(makeProvider({ effortOptIn: { 'GLM-5.2': false } }));
        expect(view!.optedIn).toEqual([]);
        expect(view!.available).toEqual(['GLM-5.2', 'DeepSeek-R1']);
    });
});

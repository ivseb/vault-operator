/**
 * FIX-55-01 (issue #55): manually entered model ids (tierOverrides) must be
 * visible and pinnable in the chat model picker.
 *
 * The manual tier input in ProviderDetailModal writes provider.tierOverrides,
 * but the picker built its rows exclusively from provider.discoveredModels,
 * so a typed id (e.g. gpt-5.6 on ChatGPT OAuth) was saved but never appeared
 * and could not be pinned. Even a pinned manual id would have been dropped at
 * send time because resolveOverrideModel only searched discoveredModels.
 */
import { describe, expect, it } from 'vitest';
import type { ProviderConfig } from '../../../types/settings';
import {
    buildChatModelPickerRows,
    resolveOverrideModel,
    resolveStickyChatModel,
} from '../chatModelDropdown';

function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
    return {
        id: 'chatgpt-oauth-main',
        type: 'chatgpt-oauth',
        enabled: true,
        discoveredModels: [
            { id: 'gpt-5.5', displayName: 'GPT-5.5', autoTier: 'flagship' },
            { id: 'gpt-5.4-mini', displayName: 'GPT-5.4 mini', autoTier: 'fast' },
        ],
        lastRefreshAt: 0,
        tierMapping: { flagship: 'gpt-5.5', fast: 'gpt-5.4-mini' },
        tierOverrides: {},
        ...overrides,
    };
}

describe('buildChatModelPickerRows (FIX-55-01)', () => {
    it('returns discovered models as non-manual rows', () => {
        const rows = buildChatModelPickerRows(makeProvider());
        expect(rows.map((r) => r.model.id)).toEqual(['gpt-5.5', 'gpt-5.4-mini']);
        expect(rows.every((r) => !r.manual)).toBe(true);
    });

    it('appends a tierOverride id that discovery does not know, exactly once', () => {
        const rows = buildChatModelPickerRows(makeProvider({
            tierOverrides: { flagship: 'gpt-5.6' },
        }));
        const manualRows = rows.filter((r) => r.manual);
        expect(manualRows.map((r) => r.model.id)).toEqual(['gpt-5.6']);
        expect(rows.filter((r) => r.model.id === 'gpt-5.6')).toHaveLength(1);
    });

    it('dedupes the same manual id set on multiple tiers', () => {
        const rows = buildChatModelPickerRows(makeProvider({
            tierOverrides: { flagship: 'gpt-5.6', mid: 'gpt-5.6' },
        }));
        expect(rows.filter((r) => r.model.id === 'gpt-5.6')).toHaveLength(1);
    });

    it('dedupes once discovery later includes the same id (discovered row wins)', () => {
        const rows = buildChatModelPickerRows(makeProvider({
            discoveredModels: [
                { id: 'gpt-5.6', displayName: 'GPT-5.6', autoTier: 'flagship' },
                { id: 'gpt-5.5', displayName: 'GPT-5.5', autoTier: 'mid' },
            ],
            tierOverrides: { flagship: 'gpt-5.6' },
        }));
        const matches = rows.filter((r) => r.model.id === 'gpt-5.6');
        expect(matches).toHaveLength(1);
        expect(matches[0].manual).toBe(false);
        expect(matches[0].model.displayName).toBe('GPT-5.6');
    });

    it('ignores empty and whitespace-only override values', () => {
        const rows = buildChatModelPickerRows(makeProvider({
            tierOverrides: { flagship: '  ', mid: '' },
        }));
        expect(rows).toHaveLength(2);
    });

    it('handles a provider without discoveredModels', () => {
        const rows = buildChatModelPickerRows(makeProvider({
            discoveredModels: [],
            tierMapping: {},
            tierOverrides: { flagship: 'gpt-5.6' },
        }));
        expect(rows.map((r) => r.model.id)).toEqual(['gpt-5.6']);
        expect(rows[0].manual).toBe(true);
    });
});

describe('resolveOverrideModel with manual tierOverride ids (FIX-55-01)', () => {
    it('resolves a manual override id so the pin takes effect at send time', () => {
        const provider = makeProvider({ tierOverrides: { flagship: 'gpt-5.6' } });
        const m = resolveOverrideModel(provider, 'gpt-5.6');
        expect(m).not.toBeNull();
        expect(m?.id).toBe('gpt-5.6');
    });

    it('still prefers the discovered entry when the id is discovered', () => {
        const provider = makeProvider({ tierOverrides: { flagship: 'gpt-5.5' } });
        const m = resolveOverrideModel(provider, 'gpt-5.5');
        expect(m?.displayName).toBe('GPT-5.5');
    });

    it('still returns null for ids that are neither discovered nor overridden', () => {
        const provider = makeProvider({ tierOverrides: { flagship: 'gpt-5.6' } });
        expect(resolveOverrideModel(provider, 'gpt-9000')).toBeNull();
    });

    it('keeps a sticky pin on a manual id across restarts (issue #54.3 path)', () => {
        const provider = makeProvider({ tierOverrides: { flagship: 'gpt-5.6' } });
        const sticky = resolveStickyChatModel(
            provider,
            { 'chatgpt-oauth-main': 'gpt-5.6' },
            'chatgpt-oauth-main',
            true,
        );
        expect(sticky).toBe('gpt-5.6');
    });
});

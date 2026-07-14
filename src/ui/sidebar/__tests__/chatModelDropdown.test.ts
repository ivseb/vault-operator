import { describe, it, expect } from 'vitest';
import type { ProviderConfig } from '../../../types/settings';
import {
    buildChatModelDropdownOptions,
    resolveEffortLevelsForPin,
    resolveOverrideModel,
    resolveStickyChatModel,
} from '../chatModelDropdown';

function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
    return {
        id: 'anthropic-main',
        type: 'anthropic',
        enabled: true,
        discoveredModels: [
            { id: 'claude-opus-4-6', displayName: 'Opus 4.6', autoTier: 'flagship' },
            { id: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', autoTier: 'mid' },
            { id: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', autoTier: 'fast' },
        ],
        lastRefreshAt: 0,
        tierMapping: {
            fast: 'claude-haiku-4-5-20251001',
            mid: 'claude-sonnet-4-6',
            flagship: 'claude-opus-4-6',
        },
        tierOverrides: {},
        ...overrides,
    };
}

describe('buildChatModelDropdownOptions (EPIC-26 / FEAT-26-05)', () => {
    it('returns only the Auto option when no provider is active', () => {
        const opts = buildChatModelDropdownOptions({
            provider: null,
            autoLabel: 'Auto',
            advisorDisabledLabel: 'advisor disabled',
        });
        expect(opts).toHaveLength(1);
        expect(opts[0]).toMatchObject({ id: 'auto', kind: 'auto', advisorDisabled: true });
        expect(opts[0].label).toContain('advisor disabled');
    });

    it('returns Auto + provider models when configured', () => {
        const opts = buildChatModelDropdownOptions({
            provider: makeProvider(),
            autoLabel: 'Auto',
            advisorDisabledLabel: 'advisor disabled',
        });
        expect(opts).toHaveLength(4);
        expect(opts[0]).toMatchObject({ id: 'auto', kind: 'auto', advisorDisabled: false });
        expect(opts[0].label).toBe('Auto');
        const overrideIds = opts.slice(1).map((o) => o.id);
        expect(overrideIds).toEqual(['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);
    });

    it('marks Auto as advisor-disabled when the flagship slot is empty', () => {
        const provider = makeProvider({
            tierMapping: { fast: 'claude-haiku-4-5-20251001', mid: 'claude-sonnet-4-6' },
            tierOverrides: {},
        });
        const opts = buildChatModelDropdownOptions({
            provider,
            autoLabel: 'Auto',
            advisorDisabledLabel: 'advisor disabled',
        });
        const autoOpt = opts[0];
        expect(autoOpt.kind).toBe('auto');
        if (autoOpt.kind === 'auto') {
            expect(autoOpt.advisorDisabled).toBe(true);
        }
        expect(autoOpt.label).toContain('advisor disabled');
    });

    it('honors tierOverrides.flagship for the advisor-disabled check', () => {
        const provider = makeProvider({
            tierMapping: { fast: 'claude-haiku-4-5-20251001', mid: 'claude-sonnet-4-6' },
            tierOverrides: { flagship: 'claude-opus-4-6' },
        });
        const opts = buildChatModelDropdownOptions({
            provider,
            autoLabel: 'Auto',
            advisorDisabledLabel: 'advisor disabled',
        });
        const autoOpt = opts[0];
        if (autoOpt.kind === 'auto') {
            expect(autoOpt.advisorDisabled).toBe(false);
        }
    });

    it('uses displayName when available, falls back to model id', () => {
        const provider = makeProvider({
            discoveredModels: [
                { id: 'claude-opus-4-6', displayName: 'Opus 4.6', autoTier: 'flagship' },
                { id: 'mystery-model' }, // no displayName
            ],
        });
        const opts = buildChatModelDropdownOptions({
            provider,
            autoLabel: 'Auto',
            advisorDisabledLabel: 'advisor disabled',
        });
        const overrideLabels = opts.slice(1).map((o) => o.label);
        expect(overrideLabels).toEqual(['Opus 4.6', 'mystery-model']);
    });
});

describe('resolveOverrideModel (EPIC-26 / FEAT-26-05)', () => {
    it('returns null for auto', () => {
        expect(resolveOverrideModel(makeProvider(), 'auto')).toBeNull();
    });

    it('returns null when override id is null', () => {
        expect(resolveOverrideModel(makeProvider(), null)).toBeNull();
    });

    it('returns null when provider is null', () => {
        expect(resolveOverrideModel(null, 'claude-opus-4-6')).toBeNull();
    });

    it('returns the matching discovered model entry', () => {
        const m = resolveOverrideModel(makeProvider(), 'claude-sonnet-4-6');
        expect(m?.displayName).toBe('Sonnet 4.6');
    });

    it('returns null for unknown id', () => {
        expect(resolveOverrideModel(makeProvider(), 'ghost')).toBeNull();
    });
});

describe('resolveStickyChatModel (Issue #54.3)', () => {
    const map = { 'anthropic-main': 'claude-sonnet-4-6' };

    it('returns the saved model id when it still exists on the provider', () => {
        expect(resolveStickyChatModel(makeProvider(), map, 'anthropic-main', true)).toBe('claude-sonnet-4-6');
    });

    it('returns null when persistence is disabled', () => {
        expect(resolveStickyChatModel(makeProvider(), map, 'anthropic-main', false)).toBeNull();
    });

    it('returns null when the saved model was deprovisioned', () => {
        const provider = makeProvider({
            discoveredModels: [{ id: 'claude-opus-4-6', displayName: 'Opus 4.6', autoTier: 'flagship' }],
        });
        expect(resolveStickyChatModel(provider, map, 'anthropic-main', true)).toBeNull();
    });

    it('returns null when no provider is active', () => {
        expect(resolveStickyChatModel(null, map, 'anthropic-main', true)).toBeNull();
    });

    it('returns null when there is no entry for the active provider', () => {
        expect(resolveStickyChatModel(makeProvider(), map, 'other-provider', true)).toBeNull();
        expect(resolveStickyChatModel(makeProvider(), map, null, true)).toBeNull();
        expect(resolveStickyChatModel(makeProvider(), undefined, 'anthropic-main', true)).toBeNull();
    });
});

describe('resolveEffortLevelsForPin (IMP-54-05b)', () => {
    it('returns [] when nothing is pinned (Auto mode never shows the slider)', () => {
        expect(resolveEffortLevelsForPin(makeProvider(), null)).toEqual([]);
    });

    it('resolves the static family levels for a pinned known model', () => {
        expect(resolveEffortLevelsForPin(makeProvider(), 'claude-opus-4-6')).toEqual([]);
        const provider = makeProvider({
            discoveredModels: [{ id: 'claude-opus-4-8', displayName: 'Opus 4.8', autoTier: 'flagship' }],
        });
        expect(resolveEffortLevelsForPin(provider, 'claude-opus-4-8'))
            .toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    });

    it('grants the OpenAI level set for an opted-in model on a custom provider', () => {
        const provider = makeProvider({
            type: 'custom',
            discoveredModels: [{ id: 'GLM-5.2' }],
            tierMapping: {},
            effortOptIn: { 'GLM-5.2': true },
        });
        expect(resolveEffortLevelsForPin(provider, 'GLM-5.2'))
            .toEqual(['minimal', 'low', 'medium', 'high']);
    });

    it('grants the OpenAI level set for an opted-in MANUAL tier-override id (FIX-55-01 rows)', () => {
        const provider = makeProvider({
            type: 'custom',
            discoveredModels: [],
            tierMapping: {},
            tierOverrides: { flagship: 'GLM-5.2' },
            effortOptIn: { 'GLM-5.2': true },
        });
        expect(resolveEffortLevelsForPin(provider, 'GLM-5.2'))
            .toEqual(['minimal', 'low', 'medium', 'high']);
    });

    it('returns [] for a pinned custom model without opt-in (unchanged behavior)', () => {
        const provider = makeProvider({
            type: 'custom',
            discoveredModels: [{ id: 'GLM-5.2' }],
            tierMapping: {},
        });
        expect(resolveEffortLevelsForPin(provider, 'GLM-5.2')).toEqual([]);
    });

    it('returns [] for an unknown pin id (deprovisioned model)', () => {
        expect(resolveEffortLevelsForPin(makeProvider(), 'ghost-model')).toEqual([]);
    });
});

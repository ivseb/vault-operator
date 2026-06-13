/**
 * Per-conversation reasoning-effort override logic.
 *
 * These tests pin the pure decision that maps a conversation effort-override
 * state onto the effective effort level the built model should carry. The
 * default 'auto' sends no effort field, so existing conversations stay
 * byte-identical to before.
 */
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_EFFORT_OVERRIDE,
    effortControlVisibility,
    effortIndexForOverride,
    effortStopForIndex,
    effortStops,
    isExplicitEffortOverride,
    resolveEffectiveEffort,
    resolveEffectiveModelForEffort,
    thinkingSwitchIsOn,
} from '../effortOverride';

describe('resolveEffectiveEffort', () => {
    it('auto resolves to undefined (no override, no field sent)', () => {
        expect(resolveEffectiveEffort('auto')).toBe(undefined);
    });

    it('resolves every native level verbatim (minimal..max)', () => {
        expect(resolveEffectiveEffort('minimal')).toBe('minimal');
        expect(resolveEffectiveEffort('low')).toBe('low');
        expect(resolveEffectiveEffort('medium')).toBe('medium');
        expect(resolveEffectiveEffort('high')).toBe('high');
        expect(resolveEffectiveEffort('xhigh')).toBe('xhigh');
        expect(resolveEffectiveEffort('max')).toBe('max');
    });
});

describe('isExplicitEffortOverride', () => {
    it('is false for auto (no change, no field)', () => {
        expect(isExplicitEffortOverride('auto')).toBe(false);
    });

    it('is true for every native level', () => {
        expect(isExplicitEffortOverride('minimal')).toBe(true);
        expect(isExplicitEffortOverride('low')).toBe(true);
        expect(isExplicitEffortOverride('medium')).toBe(true);
        expect(isExplicitEffortOverride('high')).toBe(true);
        expect(isExplicitEffortOverride('xhigh')).toBe(true);
        expect(isExplicitEffortOverride('max')).toBe(true);
    });
});

describe('DEFAULT_EFFORT_OVERRIDE', () => {
    it('defaults to auto so existing behavior is preserved', () => {
        expect(DEFAULT_EFFORT_OVERRIDE).toBe('auto');
        expect(isExplicitEffortOverride(DEFAULT_EFFORT_OVERRIDE)).toBe(false);
        expect(resolveEffectiveEffort(DEFAULT_EFFORT_OVERRIDE)).toBe(undefined);
    });
});

describe('effortControlVisibility', () => {
    it('shows the control only when thinking is on and the model is effort-capable', () => {
        expect(effortControlVisibility(true, true)).toBe('control');
    });

    it('renders nothing when thinking is off (effort is hidden, no coherence collapse needed)', () => {
        expect(effortControlVisibility(false, true)).toBe('none');
        expect(effortControlVisibility(false, false)).toBe('none');
    });

    it('renders nothing when thinking is on but the model cannot send effort', () => {
        expect(effortControlVisibility(true, false)).toBe('none');
    });
});

describe('thinkingSwitchIsOn', () => {
    it('reads the default follow as On (byte-identical default still shows On)', () => {
        expect(thinkingSwitchIsOn('follow')).toBe(true);
    });

    it('reads explicit on as On', () => {
        expect(thinkingSwitchIsOn('on')).toBe(true);
    });

    it('reads only explicit off as Off', () => {
        expect(thinkingSwitchIsOn('off')).toBe(false);
    });
});

describe('effortStops', () => {
    it('prepends auto to the model-native levels', () => {
        expect(effortStops(['low', 'medium', 'high', 'xhigh', 'max'])).toEqual([
            'auto',
            'low',
            'medium',
            'high',
            'xhigh',
            'max',
        ]);
        expect(effortStops(['minimal', 'low', 'medium', 'high'])).toEqual([
            'auto',
            'minimal',
            'low',
            'medium',
            'high',
        ]);
    });

    it('is just auto when the model has no native levels', () => {
        expect(effortStops([])).toEqual(['auto']);
    });
});

describe('effortIndexForOverride <-> effortStopForIndex round trip', () => {
    const claudeStops = effortStops(['low', 'medium', 'high', 'xhigh', 'max']);

    it('maps each stop to its index and back', () => {
        for (let i = 0; i < claudeStops.length; i++) {
            expect(effortIndexForOverride(claudeStops, claudeStops[i])).toBe(i);
            expect(effortStopForIndex(claudeStops, i)).toBe(claudeStops[i]);
        }
    });

    it('auto sits at index 0', () => {
        expect(effortIndexForOverride(claudeStops, 'auto')).toBe(0);
        expect(effortStopForIndex(claudeStops, 0)).toBe('auto');
    });

    it('an override not in the stops clamps to auto (index 0)', () => {
        const gptStops = effortStops(['minimal', 'low', 'medium', 'high']);
        // xhigh is a Claude level; it is not a GPT stop, so it clamps to auto.
        expect(effortIndexForOverride(gptStops, 'xhigh')).toBe(0);
    });

    it('an out-of-range index clamps into the stops', () => {
        expect(effortStopForIndex(claudeStops, -3)).toBe('auto');
        expect(effortStopForIndex(claudeStops, 99)).toBe('max');
        expect(effortStopForIndex(claudeStops, Number.NaN)).toBe('auto');
    });
});

describe('resolveEffectiveModelForEffort', () => {
    it('uses the pinned model when one is pinned (router off, pin wins)', () => {
        expect(
            resolveEffectiveModelForEffort(
                { modelId: 'claude-opus-4-8', providerType: 'anthropic' },
                { modelId: 'gpt-5', providerType: 'openai' },
            ),
        ).toEqual({ modelId: 'claude-opus-4-8', providerType: 'anthropic' });
    });

    it('falls back to the default-active model when nothing is pinned', () => {
        expect(
            resolveEffectiveModelForEffort(
                null,
                { modelId: 'gpt-5', providerType: 'openai' },
            ),
        ).toEqual({ modelId: 'gpt-5', providerType: 'openai' });
    });

    it('returns null when neither a pinned nor a default model resolves', () => {
        expect(resolveEffectiveModelForEffort(null, null)).toBe(null);
    });
});

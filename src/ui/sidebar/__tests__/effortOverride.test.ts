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
    isExplicitEffortOverride,
    resolveConversationOverrides,
    resolveEffectiveEffort,
} from '../effortOverride';

describe('resolveEffectiveEffort', () => {
    it('auto resolves to undefined (no override, no field sent)', () => {
        expect(resolveEffectiveEffort('auto')).toBe(undefined);
    });

    it('low / medium / high resolve to their level', () => {
        expect(resolveEffectiveEffort('low')).toBe('low');
        expect(resolveEffectiveEffort('medium')).toBe('medium');
        expect(resolveEffectiveEffort('high')).toBe('high');
    });
});

describe('isExplicitEffortOverride', () => {
    it('is false for auto (no change, no field)', () => {
        expect(isExplicitEffortOverride('auto')).toBe(false);
    });

    it('is true for low, medium and high', () => {
        expect(isExplicitEffortOverride('low')).toBe(true);
        expect(isExplicitEffortOverride('medium')).toBe(true);
        expect(isExplicitEffortOverride('high')).toBe(true);
    });
});

describe('DEFAULT_EFFORT_OVERRIDE', () => {
    it('defaults to auto so existing behavior is preserved', () => {
        expect(DEFAULT_EFFORT_OVERRIDE).toBe('auto');
        expect(isExplicitEffortOverride(DEFAULT_EFFORT_OVERRIDE)).toBe(false);
        expect(resolveEffectiveEffort(DEFAULT_EFFORT_OVERRIDE)).toBe(undefined);
    });
});

describe('resolveConversationOverrides (within-pin coherence)', () => {
    it('passes the thinking override through untouched when effort is auto', () => {
        expect(resolveConversationOverrides('on', 'auto')).toEqual({
            effort: undefined,
            thinking: 'on',
            effortIsExplicit: false,
        });
        expect(resolveConversationOverrides('off', 'auto')).toEqual({
            effort: undefined,
            thinking: 'off',
            effortIsExplicit: false,
        });
        expect(resolveConversationOverrides('follow', 'auto')).toEqual({
            effort: undefined,
            thinking: 'follow',
            effortIsExplicit: false,
        });
    });

    it('forces thinking to follow when effort is explicit (effort wins)', () => {
        // Thinking=Off + Effort=High is contradictory on Claude, so effort wins
        // and the explicit thinking override is suppressed.
        expect(resolveConversationOverrides('off', 'high')).toEqual({
            effort: 'high',
            thinking: 'follow',
            effortIsExplicit: true,
        });
        expect(resolveConversationOverrides('on', 'low')).toEqual({
            effort: 'low',
            thinking: 'follow',
            effortIsExplicit: true,
        });
        expect(resolveConversationOverrides('follow', 'medium')).toEqual({
            effort: 'medium',
            thinking: 'follow',
            effortIsExplicit: true,
        });
    });
});

import { effortControlVisibility } from '../effortOverride';

describe('effortControlVisibility', () => {
    it('shows the control only when a model is pinned and effort is supported', () => {
        expect(effortControlVisibility(true, true)).toBe('control');
    });

    it('shows the hint in auto mode (no model pinned)', () => {
        expect(effortControlVisibility(false, true)).toBe('hint');
        expect(effortControlVisibility(false, false)).toBe('hint');
    });

    it('renders nothing when a model is pinned but cannot send effort', () => {
        expect(effortControlVisibility(true, false)).toBe('none');
    });
});

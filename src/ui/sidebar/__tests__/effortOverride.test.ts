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

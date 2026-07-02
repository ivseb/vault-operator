import { describe, it, expect } from 'vitest';
import { computeCost, formatEur, getModelPrice } from '../ModelPricing';

describe('ModelPricing', () => {
    it('matches exact model id case-insensitively', () => {
        const price = getModelPrice('claude-sonnet-4-6');
        expect(price.inputPerMillionUsd).toBe(3);
        expect(price.outputPerMillionUsd).toBe(15);
    });

    it('falls back to longest substring match', () => {
        const price = getModelPrice('claude-sonnet-4-6-20251101');
        expect(price.inputPerMillionUsd).toBe(3);
    });

    it('returns Haiku pricing for haiku models', () => {
        const price = getModelPrice('claude-haiku-4-5-20251001');
        expect(price.inputPerMillionUsd).toBe(1);
        expect(price.outputPerMillionUsd).toBe(5);
    });

    it('falls back gracefully for unknown models', () => {
        const price = getModelPrice('some-future-model');
        expect(price.inputPerMillionUsd).toBeGreaterThan(0);
    });

    it('computes total cost with cache rates', () => {
        const cost = computeCost('claude-sonnet-4-6', 100_000, 10_000, 50_000, 0);
        // input: 100k * 3$/M = $0.30
        // output: 10k * 15$/M = $0.15
        // cache read: 50k * 0.3$/M = $0.015
        // total USD: 0.465, EUR: ~0.432
        expect(cost.totalUsd).toBeCloseTo(0.465, 2);
        expect(cost.totalEur).toBeCloseTo(0.432, 2);
    });

    // v2.10.0: formatEur uses Intl.NumberFormat('de-DE', currency: EUR)
    // with min 2 / max 4 fraction digits. The Euro sign is separated from
    // the amount by a non-breaking space (U+00A0), per German locale.
    it('formats sub-cent amounts with up to 4 digits', () => {
        // 0,005 rendered with min 2, max 4 -> "0,005"
        expect(formatEur(0.005)).toBe('0,005 €');
    });

    it('formats cent amounts with locale comma', () => {
        // 0,042 rendered with min 2, max 4 -> "0,042"
        expect(formatEur(0.042)).toBe('0,042 €');
    });

    it('formats euros above one with up to 4 digits', () => {
        // 1,234 rendered with min 2, max 4 -> "1,234"
        expect(formatEur(1.234)).toBe('1,234 €');
    });

    it('formats zero as 0,00 EUR', () => {
        expect(formatEur(0)).toBe('0,00 €');
    });

    it('formats common amounts correctly', () => {
        expect(formatEur(0.02)).toBe('0,02 €');
        expect(formatEur(0.84)).toBe('0,84 €');
    });

    // FIX-24-05-01: pricing table refresh, verified against official rate
    // cards on 2026-07-02. Opus-tier dropped to 5/25 with Opus 4.5; the
    // old 15/75 rates only apply to Opus 4.0/4.1.
    describe('FIX-24-05-01 pricing refresh', () => {
        it('prices the current Opus generation at 5/25 with matching cache rates', () => {
            for (const id of ['claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-opus-4-5']) {
                const price = getModelPrice(id);
                expect(price.inputPerMillionUsd, id).toBe(5);
                expect(price.outputPerMillionUsd, id).toBe(25);
                expect(price.cacheReadPerMillionUsd, id).toBeCloseTo(0.5, 5);
                expect(price.cacheWritePerMillionUsd, id).toBeCloseTo(6.25, 5);
            }
        });

        it('keeps legacy Opus 4.0/4.1 at 15/75', () => {
            expect(getModelPrice('claude-opus-4-1').inputPerMillionUsd).toBe(15);
            expect(getModelPrice('claude-opus-4-20250514').inputPerMillionUsd).toBe(15);
        });

        it('prices Fable 5 at 10/50 instead of the Sonnet fallback', () => {
            const price = getModelPrice('claude-fable-5');
            expect(price.inputPerMillionUsd).toBe(10);
            expect(price.outputPerMillionUsd).toBe(50);
        });

        it('prices Sonnet 5 at 3/15 via its own entry', () => {
            const price = getModelPrice('claude-sonnet-5');
            expect(price.inputPerMillionUsd).toBe(3);
            expect(price.outputPerMillionUsd).toBe(15);
            expect(price.cacheReadPerMillionUsd).toBeCloseTo(0.3, 5);
        });

        it('prices o3 at 2/8 (post June-2025 cut) and o3-mini on its own entry', () => {
            expect(getModelPrice('o3').inputPerMillionUsd).toBe(2);
            expect(getModelPrice('o3').outputPerMillionUsd).toBe(8);
            expect(getModelPrice('o3-mini').inputPerMillionUsd).toBeCloseTo(1.1, 5);
            expect(getModelPrice('o3-mini').outputPerMillionUsd).toBeCloseTo(4.4, 5);
        });

        it('prices gpt-5 at 1.25/10 and gpt-5-mini/nano on their own entries', () => {
            expect(getModelPrice('gpt-5').inputPerMillionUsd).toBeCloseTo(1.25, 5);
            expect(getModelPrice('gpt-5').outputPerMillionUsd).toBe(10);
            expect(getModelPrice('gpt-5-mini').inputPerMillionUsd).toBeCloseTo(0.25, 5);
            expect(getModelPrice('gpt-5-nano').inputPerMillionUsd).toBeCloseTo(0.05, 5);
        });

        it('prices gemini-2.5-flash at 0.30/2.50', () => {
            const price = getModelPrice('gemini-2.5-flash');
            expect(price.inputPerMillionUsd).toBeCloseTo(0.3, 5);
            expect(price.outputPerMillionUsd).toBeCloseTo(2.5, 5);
        });

        it('gives every OpenAI/Google entry a cache-read rate below the input rate', () => {
            for (const id of ['gpt-5', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini', 'gemini-2.5-pro', 'gemini-2.5-flash']) {
                const price = getModelPrice(id);
                expect(price.cacheReadPerMillionUsd, id).toBeDefined();
                expect(price.cacheReadPerMillionUsd!, id).toBeLessThan(price.inputPerMillionUsd);
            }
        });
    });
});

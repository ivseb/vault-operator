import { describe, it, expect } from 'vitest';
import { TokenEstimator } from '../TokenEstimator';

/**
 * IMP-41-01-04 / ADR-148: per-task calibrated chars-per-token factor.
 *
 * The static char/4 heuristic under-estimates code/CJK by 10-20 percent,
 * which delays condensing into the emergency-4xx path. The estimator
 * calibrates from the REAL prompt token counts each usage chunk reports:
 * first observation jumps straight to the observed rate (SC-1: <5 percent
 * error from the second turn on), later observations smooth with EMA.
 */

describe('TokenEstimator', () => {
    it('defaults to the legacy char/4 parity', () => {
        const est = new TokenEstimator();
        expect(est.tokensForChars(400)).toBe(100);
        expect(est.getCharsPerToken()).toBe(4.0);
    });

    it('adopts the observed rate fully on the first calibration (SC-1)', () => {
        const est = new TokenEstimator();
        // True rate: 3.2 chars/token (code-heavy content)
        est.recordUsage(32_000, 10_000);
        expect(est.getCharsPerToken()).toBeCloseTo(3.2, 5);
        // Next estimate is within 5 percent of ground truth
        const estimate = est.tokensForChars(32_000);
        expect(Math.abs(estimate - 10_000) / 10_000).toBeLessThan(0.05);
    });

    it('smooths subsequent observations instead of jumping', () => {
        const est = new TokenEstimator();
        est.recordUsage(40_000, 10_000); // 4.0
        est.recordUsage(20_000, 10_000); // observed 2.0 -> EMA, not full jump
        const factor = est.getCharsPerToken();
        expect(factor).toBeLessThan(4.0);
        expect(factor).toBeGreaterThan(2.0);
    });

    it('clamps the factor to [2.0, 6.0] on degenerate observations', () => {
        const low = new TokenEstimator();
        low.recordUsage(100, 1_000_000);
        expect(low.getCharsPerToken()).toBe(2.0);

        const high = new TokenEstimator();
        high.recordUsage(1_000_000, 10);
        expect(high.getCharsPerToken()).toBe(6.0);
    });

    it('ignores zero and negative observations', () => {
        const est = new TokenEstimator();
        est.recordUsage(0, 100);
        est.recordUsage(100, 0);
        est.recordUsage(-5, -2);
        expect(est.getCharsPerToken()).toBe(4.0);
    });

    it('can be seeded directly (count_tokens API result)', () => {
        const est = new TokenEstimator();
        est.seed(60_000, 20_000); // 3.0 chars/token
        expect(est.getCharsPerToken()).toBeCloseTo(3.0, 5);
    });

    it('sums message chars for calibration input', () => {
        const chars = TokenEstimator.sumChars([
            { role: 'user', content: 'hello' }, // 5
            {
                role: 'assistant',
                content: [
                    { type: 'text', text: 'world' }, // 5
                    { type: 'tool_use', id: '1', name: 't', input: { a: 'bb' } }, // JSON chars
                ],
            },
        ]);
        expect(chars).toBeGreaterThanOrEqual(10);
    });
});

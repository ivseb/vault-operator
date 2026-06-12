/**
 * Retrieval wave 1, item 4: weighted RRF fusion with cosine sanity blend.
 *
 * Contract under test (fuseHybridArms):
 *  - weighted: false reproduces the previous direct rrf() call exactly
 *    (same ids, same scores, same contributions, same order). The settings
 *    flag weightedFusionEnabled=false must be byte-identical to the old
 *    code path.
 *  - weighted: true multiplies the tag arm contribution by 0.6 so tag-only
 *    hits stop displacing real keyword/dense hits.
 *  - weighted: true blends dense cosine into the final ordering score:
 *    paths WITH a dense cosine get 0.7 * normalizedRrf + 0.3 * cosine,
 *    paths WITHOUT a dense cosine keep their plain normalizedRrf
 *    (no blend, no penalty).
 */

import { describe, it, expect } from 'vitest';
import { rrf } from '../../memory/rrf';
import {
    fuseHybridArms,
    TAG_ARM_WEIGHT,
    RRF_BLEND_SHARE,
    COSINE_BLEND_SHARE,
} from '../weightedFusion';

describe('fuseHybridArms / legacy path (weighted: false)', () => {
    it('returns the exact plain rrf() result (ids, scores, contributions, order)', () => {
        const semantic = ['Notes/A.md', 'Notes/B.md'];
        const keyword = ['Notes/B.md', 'Notes/C.md'];
        const tag = ['Notes/D.md'];

        const legacy = rrf([
            { name: 'semantic', items: semantic },
            { name: 'keyword', items: keyword },
            { name: 'tag', items: tag },
        ]);
        const fused = fuseHybridArms({ semantic, keyword, tag }, { weighted: false });

        expect(fused).toEqual(legacy);
    });

    it('ignores the cosine map entirely when weighted is false', () => {
        const semantic = ['Notes/A.md'];
        const keyword = ['Notes/B.md'];
        const tag: string[] = [];

        const legacy = rrf([
            { name: 'semantic', items: semantic },
            { name: 'keyword', items: keyword },
            { name: 'tag', items: tag },
        ]);
        const fused = fuseHybridArms(
            { semantic, keyword, tag },
            { weighted: false, cosineByPath: new Map([['Notes/A.md', 0.99]]) },
        );

        expect(fused).toEqual(legacy);
    });
});

describe('fuseHybridArms / weighted path (weighted: true)', () => {
    it('downweights the tag arm: keyword rank 2 outranks a tag-only rank 1 hit', () => {
        // Old behavior: tag rank 1 (1/61) beat keyword rank 2 (1/62).
        // Weighted: tag rank 1 contributes 0.6/61 < 1/62, so the real
        // keyword body match wins.
        const fused = fuseHybridArms(
            {
                semantic: ['Notes/Dense.md'],
                keyword: ['Notes/Dense.md', 'Notes/Contested.md'],
                tag: ['Notes/TagOnly.md'],
            },
            { weighted: true },
        );

        const rank = (id: string) => fused.findIndex((f) => f.id === id);
        expect(rank('Notes/Contested.md')).toBeGreaterThan(-1);
        expect(rank('Notes/TagOnly.md')).toBeGreaterThan(-1);
        expect(rank('Notes/Contested.md')).toBeLessThan(rank('Notes/TagOnly.md'));
    });

    it('keeps tag recall: tag-only hits still appear in the fused list', () => {
        const fused = fuseHybridArms(
            { semantic: ['Notes/A.md'], keyword: [], tag: ['Notes/TagOnly.md'] },
            { weighted: true },
        );
        expect(fused.some((f) => f.id === 'Notes/TagOnly.md')).toBe(true);
    });

    it('blends cosine for dense-scored paths with the 0.7/0.3 split', () => {
        // Dense.md: semantic rank 1 + keyword rank 1 -> raw 2/61 (max).
        // Keyword.md: keyword rank 2 -> raw 1/62, no cosine.
        const cosine = 0.9;
        const fused = fuseHybridArms(
            {
                semantic: ['Notes/Dense.md'],
                keyword: ['Notes/Dense.md', 'Notes/Keyword.md'],
                tag: [],
            },
            { weighted: true, cosineByPath: new Map([['Notes/Dense.md', cosine]]) },
        );

        const dense = fused.find((f) => f.id === 'Notes/Dense.md');
        const kw = fused.find((f) => f.id === 'Notes/Keyword.md');
        const rawDense = 1 / 61 + 1 / 61;
        const rawKw = 1 / 62;

        // Dense has the max raw score -> normalizedRrf 1.0, then blended.
        expect(dense?.score).toBeCloseTo(RRF_BLEND_SHARE * 1.0 + COSINE_BLEND_SHARE * cosine, 10);
        // Keyword-only path keeps its plain normalized RRF: no blend, no penalty.
        expect(kw?.score).toBeCloseTo(rawKw / rawDense, 10);
    });

    it('does not penalize paths without a dense cosine (asymmetric blend)', () => {
        // A (dense, cosine 0.5) and B (keyword-only) both sit at rank 1 of
        // their arm, so both normalize to 1.0. A is blended down to
        // 0.7 + 0.3 * 0.5 = 0.85 while B keeps 1.0. If B were blended with
        // an implicit cosine of 0 it would drop to 0.7 instead.
        const fused = fuseHybridArms(
            { semantic: ['Notes/A.md'], keyword: ['Notes/B.md'], tag: [] },
            { weighted: true, cosineByPath: new Map([['Notes/A.md', 0.5]]) },
        );

        const a = fused.find((f) => f.id === 'Notes/A.md');
        const b = fused.find((f) => f.id === 'Notes/B.md');
        expect(b?.score).toBeCloseTo(1.0, 10);
        expect(a?.score).toBeCloseTo(0.85, 10);
        expect(fused[0]?.id).toBe('Notes/B.md');
    });

    it('preserves per-signal contributions for method classification', () => {
        const fused = fuseHybridArms(
            {
                semantic: ['Notes/A.md'],
                keyword: ['Notes/A.md'],
                tag: ['Notes/A.md'],
            },
            { weighted: true },
        );
        const a = fused.find((f) => f.id === 'Notes/A.md');
        expect(a?.contributions['semantic']).toBeGreaterThan(0);
        expect(a?.contributions['keyword']).toBeGreaterThan(0);
        expect(a?.contributions['tag']).toBeGreaterThan(0);
        // Tag contribution carries the 0.6 weight.
        expect(a?.contributions['tag']).toBeCloseTo(TAG_ARM_WEIGHT / 61, 10);
    });

    it('returns an empty list for empty arms', () => {
        const fused = fuseHybridArms({ semantic: [], keyword: [], tag: [] }, { weighted: true });
        expect(fused).toEqual([]);
    });
});

describe('weighted fusion constants', () => {
    it('uses the agreed weights (tag 0.6, blend 0.7/0.3)', () => {
        expect(TAG_ARM_WEIGHT).toBe(0.6);
        expect(RRF_BLEND_SHARE).toBe(0.7);
        expect(COSINE_BLEND_SHARE).toBe(0.3);
    });
});

/**
 * Weighted RRF fusion for the hybrid semantic_search pipeline
 * (retrieval wave 1, item 4).
 *
 * Plain RRF lets the tag arm vote with full weight, so a tag-only hit at
 * tag rank 1 (1/61) displaces a real body keyword match at keyword rank 2
 * (1/62). This helper fixes two things behind the weightedFusionEnabled
 * settings flag:
 *
 *  1. The tag arm contribution is multiplied by TAG_ARM_WEIGHT (0.6),
 *     keeping tag recall while removing its power to outvote real matches.
 *  2. A cosine sanity blend: the fused RRF score is normalized to [0, 1]
 *     and, for paths the dense arm actually scored, blended with the dense
 *     cosine similarity (0.7 * normalizedRrf + 0.3 * cosine).
 *
 * With the flag disabled the function reproduces the previous direct
 * rrf() call exactly, so flag off is byte-identical to the old code path.
 *
 * Pure function: no DB, no obsidian, no globals (same engine-public
 * contract as rrf.ts, ADR-080).
 */

import { rrf } from '../memory/rrf';
import type { RrfResult } from '../memory/rrf';

/** RRF weight of the tag arm in weighted mode. */
export const TAG_ARM_WEIGHT = 0.6;
/** Share of the normalized RRF score in the cosine sanity blend. */
export const RRF_BLEND_SHARE = 0.7;
/** Share of the dense cosine similarity in the cosine sanity blend. */
export const COSINE_BLEND_SHARE = 0.3;

export interface HybridFusionArms {
    /** Dense (embedding) arm paths, best first. */
    semantic: readonly string[];
    /** Keyword (TF-IDF) arm paths, best first. */
    keyword: readonly string[];
    /** Tag-match arm paths, best first. */
    tag: readonly string[];
}

export interface HybridFusionOptions {
    /** false reproduces the legacy unweighted rrf() call exactly. */
    weighted: boolean;
    /**
     * Best dense cosine similarity per path. Only consulted in weighted
     * mode; paths missing from the map keep their plain normalized RRF.
     */
    cosineByPath?: ReadonlyMap<string, number>;
}

/**
 * Fuse the three hybrid search arms into one ordered list.
 * Returns RrfResult entries (id, score, contributions) sorted by score
 * descending; contributions stay raw RRF values for method classification.
 */
export function fuseHybridArms(arms: HybridFusionArms, options: HybridFusionOptions): RrfResult[] {
    if (!options.weighted) {
        // Legacy path: must stay byte-identical to the previous direct
        // rrf() call in SemanticSearchTool (flag-off contract).
        return rrf([
            { name: 'semantic', items: arms.semantic },
            { name: 'keyword', items: arms.keyword },
            { name: 'tag', items: arms.tag },
        ]);
    }

    const fused = rrf([
        { name: 'semantic', items: arms.semantic },
        { name: 'keyword', items: arms.keyword },
        { name: 'tag', items: arms.tag, weight: TAG_ARM_WEIGHT },
    ]);
    if (fused.length === 0) return fused;

    // rrf() returns the list sorted descending, so index 0 holds the max.
    const maxScore = fused[0].score;
    if (maxScore <= 0) return fused;

    const cosineByPath = options.cosineByPath;
    for (const entry of fused) {
        const normalizedRrf = entry.score / maxScore;
        const cosine = cosineByPath?.get(entry.id);
        // Asymmetric blend by design: only paths the dense arm actually
        // scored get the cosine blend. Paths without a dense cosine keep
        // their plain normalized RRF (no blend, no penalty); blending an
        // implicit cosine of 0 would punish keyword/tag-only hits for a
        // signal that was never computed for them.
        entry.score = typeof cosine === 'number'
            ? RRF_BLEND_SHARE * normalizedRrf + COSINE_BLEND_SHARE * cosine
            : normalizedRrf;
    }
    return fused.sort((a, b) => b.score - a.score);
}

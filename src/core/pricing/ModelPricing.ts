/**
 * ModelPricing -- USD/EUR cost calculation per model (ADR-090, Lever 5 + 10)
 *
 * Pricing is per-million tokens. Numbers are best-effort published rates,
 * may drift over time -- update when models change. Falls back to Sonnet
 * pricing for unknown models so we always show *something*.
 *
 * USD->EUR uses a static rate (configurable). The point is order-of-magnitude
 * cost awareness for the user, not financial accuracy.
 */

export interface ModelPrice {
    /** USD per 1M input tokens (uncached) */
    inputPerMillionUsd: number;
    /** USD per 1M output tokens */
    outputPerMillionUsd: number;
    /** USD per 1M tokens read from prompt cache (typically 10% of input) */
    cacheReadPerMillionUsd?: number;
    /** USD per 1M tokens written to prompt cache (typically 125% of input) */
    cacheWritePerMillionUsd?: number;
}

export interface CostBreakdown {
    inputCost: number;
    outputCost: number;
    cacheReadCost: number;
    cacheWriteCost: number;
    totalUsd: number;
    totalEur: number;
}

const USD_TO_EUR = 0.93;

/**
 * Manual pricing-table maintenance marker. Bump this string when you have
 * just verified the PRICING table below against the live Anthropic /
 * OpenAI / Google rate cards. ISO date.
 *
 * Why this is manual rather than scraped: the three vendors publish prices
 * on HTML pages with no stable machine-readable contract. A reminder is
 * pragmatic; a scraper would break with every redesign.
 */
export const PRICING_LAST_UPDATED = '2026-05-14';
const PRICING_STALE_DAYS = 90;

/**
 * Return a maintenance warning string when the pricing table has not been
 * touched for more than PRICING_STALE_DAYS, otherwise null. Called once
 * from plugin onload so the warning shows up exactly once per session.
 */
export function getPricingAgeWarning(today: Date = new Date()): string | null {
    const last = new Date(PRICING_LAST_UPDATED);
    const days = Math.floor((today.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
    if (days <= PRICING_STALE_DAYS) return null;
    return `[ModelPricing] Pricing table is ${days} days old (last updated ${PRICING_LAST_UPDATED}). ` +
        'Verify Anthropic / OpenAI / Google rate cards and bump PRICING_LAST_UPDATED.';
}

/**
 * Pricing table. Keys are matched by:
 *   1. Exact model id (case-insensitive)
 *   2. Substring fallback (e.g. "claude-sonnet" matches any sonnet variant)
 * If nothing matches, FALLBACK is used so the UI never shows blank.
 */
const PRICING: Record<string, ModelPrice> = {
    // Anthropic Claude
    'claude-opus-4-7': { inputPerMillionUsd: 15, outputPerMillionUsd: 75, cacheReadPerMillionUsd: 1.5, cacheWritePerMillionUsd: 18.75 },
    'claude-opus-4-6': { inputPerMillionUsd: 15, outputPerMillionUsd: 75, cacheReadPerMillionUsd: 1.5, cacheWritePerMillionUsd: 18.75 },
    'claude-opus-4': { inputPerMillionUsd: 15, outputPerMillionUsd: 75, cacheReadPerMillionUsd: 1.5, cacheWritePerMillionUsd: 18.75 },
    'claude-sonnet-4-6': { inputPerMillionUsd: 3, outputPerMillionUsd: 15, cacheReadPerMillionUsd: 0.3, cacheWritePerMillionUsd: 3.75 },
    'claude-sonnet-4-5': { inputPerMillionUsd: 3, outputPerMillionUsd: 15, cacheReadPerMillionUsd: 0.3, cacheWritePerMillionUsd: 3.75 },
    'claude-sonnet-4': { inputPerMillionUsd: 3, outputPerMillionUsd: 15, cacheReadPerMillionUsd: 0.3, cacheWritePerMillionUsd: 3.75 },
    'claude-haiku-4-5': { inputPerMillionUsd: 1, outputPerMillionUsd: 5, cacheReadPerMillionUsd: 0.1, cacheWritePerMillionUsd: 1.25 },

    // OpenAI
    'gpt-5': { inputPerMillionUsd: 5, outputPerMillionUsd: 20 },
    'gpt-4.1': { inputPerMillionUsd: 2, outputPerMillionUsd: 8 },
    'gpt-4o': { inputPerMillionUsd: 2.5, outputPerMillionUsd: 10 },
    'gpt-4o-mini': { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
    'o3': { inputPerMillionUsd: 60, outputPerMillionUsd: 240 },
    'o4-mini': { inputPerMillionUsd: 1.1, outputPerMillionUsd: 4.4 },

    // Google
    'gemini-2.5-pro': { inputPerMillionUsd: 1.25, outputPerMillionUsd: 10 },
    'gemini-2.5-flash': { inputPerMillionUsd: 0.075, outputPerMillionUsd: 0.3 },

    // Meta (free tiers approximated)
    'llama-3': { inputPerMillionUsd: 0.2, outputPerMillionUsd: 0.6 },
};

/** Used when nothing matches -- midrange Sonnet pricing so UI never blanks. */
const FALLBACK: ModelPrice = { inputPerMillionUsd: 3, outputPerMillionUsd: 15, cacheReadPerMillionUsd: 0.3, cacheWritePerMillionUsd: 3.75 };

/** Look up pricing for a model id. Falls back gracefully. */
export function getModelPrice(modelId: string | undefined | null): ModelPrice {
    if (!modelId) return FALLBACK;
    const lower = modelId.toLowerCase();

    // Exact match first
    if (PRICING[lower]) return PRICING[lower];

    // Substring fallback (longest key first so claude-sonnet-4-6 wins over claude-sonnet-4)
    const sortedKeys = Object.keys(PRICING).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
        if (lower.includes(key)) return PRICING[key];
    }
    return FALLBACK;
}

/**
 * Compute cost for a usage report.
 * cacheReadTokens are billed at the cache-read rate (much cheaper).
 * cacheCreationTokens are billed at the cache-write rate (slightly more than input).
 * Regular inputTokens already exclude cache hits in most providers' usage reports.
 */
export function computeCost(
    modelId: string | undefined | null,
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens: number = 0,
    cacheCreationTokens: number = 0,
): CostBreakdown {
    const price = getModelPrice(modelId);

    const inputCost = (inputTokens / 1_000_000) * price.inputPerMillionUsd;
    const outputCost = (outputTokens / 1_000_000) * price.outputPerMillionUsd;
    const cacheReadCost = (cacheReadTokens / 1_000_000) * (price.cacheReadPerMillionUsd ?? price.inputPerMillionUsd);
    const cacheWriteCost = (cacheCreationTokens / 1_000_000) * (price.cacheWritePerMillionUsd ?? price.inputPerMillionUsd);

    const totalUsd = inputCost + outputCost + cacheReadCost + cacheWriteCost;
    const totalEur = totalUsd * USD_TO_EUR;

    return { inputCost, outputCost, cacheReadCost, cacheWriteCost, totalUsd, totalEur };
}

/**
 * Format an EUR amount for compact display in the UI footer using the
 * locale-aware German currency format. Uses up to 4 fraction digits so
 * sub-cent values stay legible (a Haiku query is often 0,0005 EUR).
 *
 *   0.0005 -> "0,0005 €"
 *   0.02   -> "0,02 €"
 *   1.23   -> "1,23 €"
 *
 * (Plan v2.10.0 user request: replace mixed ¢/€ format with a single
 * locale-correct currency representation.)
 */
const EUR_FORMATTER = new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
});

export function formatEur(eur: number): string {
    return EUR_FORMATTER.format(eur);
}

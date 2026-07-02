/**
 * PriceCatalogService -- live model prices from OpenRouter (IMP-24-05-02)
 *
 * The static PRICING table in ModelPricing.ts drifts (FIX-24-05-01 found
 * it up to 30x off) and its staleness warning reaches nobody. OpenRouter's
 * public /v1/models endpoint carries current vendor rates for all common
 * models -- including the ones served via Bedrock -- with cache-read/write
 * rates where the vendor bills them. We fetch it at most once per 24h,
 * persist the snapshot, and feed it into ModelPricing as the preferred
 * price source. Offline or pre-first-fetch behavior is unchanged (static
 * table, then FALLBACK).
 *
 * The prices are a best-guess approximation by design: OpenRouter passes
 * vendor rates through, but regional platform pricing (e.g. Bedrock EU)
 * can deviate in edge cases.
 */

import { requestUrl } from 'obsidian';
import { setLivePriceCatalog, type ModelPrice } from './ModelPricing';
import type { FileAdapter } from '../storage/types';

/** Persisted snapshot path, relative to the GlobalFS data root. */
export const PRICE_CATALOG_FILE = 'price-catalog.json';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Normalize an OpenRouter id to the static-table key style: strip the
 * vendor prefix, lowercase, version dots to dashes ("anthropic/claude-
 * haiku-4.5" -> "claude-haiku-4-5", which also substring-matches Bedrock
 * ids). Colon variants (":free", ":extended") carry different pricing
 * tiers and are skipped.
 */
export function normalizeCatalogKey(id: string): string | null {
    if (id.includes(':')) return null;
    const bare = id.includes('/') ? id.slice(id.indexOf('/') + 1) : id;
    if (!bare) return null;
    return bare.toLowerCase().replace(/(\d)\.(\d)/g, '$1-$2');
}

/**
 * Parse the OpenRouter /v1/models wire format (per-token USD strings)
 * into a per-1M-token catalog. Entries without prompt+completion pricing
 * are skipped; cache rates are only set when the vendor bills them.
 */
export function parseOpenRouterCatalog(json: unknown): Record<string, ModelPrice> {
    const catalog: Record<string, ModelPrice> = {};
    const data = (json as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) return catalog;
    const perMillion = (v: unknown): number | undefined => {
        if (typeof v !== 'string' && typeof v !== 'number') return undefined;
        const n = typeof v === 'string' ? parseFloat(v) : v;
        return Number.isFinite(n) ? n * 1_000_000 : undefined;
    };
    for (const entry of data) {
        const e = entry as { id?: unknown; pricing?: Record<string, unknown> };
        if (typeof e.id !== 'string' || !e.pricing) continue;
        const key = normalizeCatalogKey(e.id);
        if (!key) continue;
        const input = perMillion(e.pricing.prompt);
        const output = perMillion(e.pricing.completion);
        if (input === undefined || output === undefined) continue;
        const price: ModelPrice = { inputPerMillionUsd: input, outputPerMillionUsd: output };
        const cacheRead = perMillion(e.pricing.input_cache_read);
        const cacheWrite = perMillion(e.pricing.input_cache_write);
        if (cacheRead !== undefined) price.cacheReadPerMillionUsd = cacheRead;
        if (cacheWrite !== undefined) price.cacheWritePerMillionUsd = cacheWrite;
        catalog[key] = price;
    }
    return catalog;
}

interface PersistedCatalog {
    fetchedAt: number;
    catalog: Record<string, ModelPrice>;
}

async function fetchOpenRouterModels(): Promise<unknown> {
    const res = await requestUrl({ url: OPENROUTER_MODELS_URL, method: 'GET', throw: false });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    return res.json;
}

export class PriceCatalogService {
    private fetchedAt = 0;

    constructor(
        private fs: FileAdapter,
        private fetchJson: () => Promise<unknown> = fetchOpenRouterModels,
    ) {}

    /** Apply a previously persisted snapshot -- no network involved. */
    async load(): Promise<void> {
        try {
            if (!(await this.fs.exists(PRICE_CATALOG_FILE))) return;
            const raw = await this.fs.read(PRICE_CATALOG_FILE);
            const parsed = JSON.parse(raw) as PersistedCatalog;
            if (typeof parsed?.fetchedAt !== 'number' || !parsed.catalog || Object.keys(parsed.catalog).length === 0) return;
            this.fetchedAt = parsed.fetchedAt;
            setLivePriceCatalog(parsed.catalog);
        } catch (e) {
            console.warn('[PriceCatalog] load failed (non-fatal):', e);
        }
    }

    /**
     * Fetch a fresh catalog when the current one is older than 24h.
     * Best-effort: failures leave the current pricing (persisted snapshot
     * or static table) untouched.
     */
    async refreshIfStale(): Promise<void> {
        if (Date.now() - this.fetchedAt < TTL_MS) return;
        try {
            const json = await this.fetchJson();
            const catalog = parseOpenRouterCatalog(json);
            // Defensive: never replace a working catalog with an empty one.
            if (Object.keys(catalog).length === 0) return;
            this.fetchedAt = Date.now();
            setLivePriceCatalog(catalog);
            await this.fs.write(PRICE_CATALOG_FILE, JSON.stringify({ fetchedAt: this.fetchedAt, catalog } satisfies PersistedCatalog));
        } catch (e) {
            console.warn('[PriceCatalog] refresh failed (non-fatal):', e);
        }
    }
}

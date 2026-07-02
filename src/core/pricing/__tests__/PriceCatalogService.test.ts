/**
 * IMP-24-05-02 regression tests
 *
 * Live price catalog from OpenRouter /v1/models as best-guess pricing
 * source for ALL models (user decision 2026-07-02, follow-up to
 * FIX-24-05-01: the manual table drifts to uselessness). The static
 * PRICING table stays as offline fallback.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    normalizeCatalogKey,
    parseOpenRouterCatalog,
    sanitizeCatalog,
    PriceCatalogService,
    PRICE_CATALOG_FILE,
} from '../PriceCatalogService';
import { getModelPrice, setLivePriceCatalog } from '../ModelPricing';
import type { FileAdapter } from '../../storage/types';

afterEach(() => setLivePriceCatalog(null));

// ---------------------------------------------------------------------------
// Key normalization: OpenRouter ids -> static-table style keys that also
// substring-match Bedrock ids.
// ---------------------------------------------------------------------------
describe('normalizeCatalogKey (IMP-24-05-02)', () => {
    it('strips the vendor prefix and turns version dots into dashes', () => {
        expect(normalizeCatalogKey('anthropic/claude-opus-4.8')).toBe('claude-opus-4-8');
        expect(normalizeCatalogKey('anthropic/claude-haiku-4.5')).toBe('claude-haiku-4-5');
        expect(normalizeCatalogKey('openai/gpt-5')).toBe('gpt-5');
        expect(normalizeCatalogKey('google/gemini-2.5-flash')).toBe('gemini-2-5-flash');
    });

    it('skips variant ids with a colon suffix', () => {
        expect(normalizeCatalogKey('meta-llama/llama-3-70b:free')).toBeNull();
        expect(normalizeCatalogKey('anthropic/claude-sonnet-4.5:extended')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Wire parsing: per-token strings -> USD per 1M, cache rates when present.
// ---------------------------------------------------------------------------
describe('parseOpenRouterCatalog (IMP-24-05-02)', () => {
    const wire = {
        data: [
            {
                id: 'anthropic/claude-opus-4.8',
                pricing: { prompt: '0.000005', completion: '0.000025', input_cache_read: '0.0000005', input_cache_write: '0.00000625' },
            },
            {
                id: 'openai/gpt-5',
                pricing: { prompt: '0.00000125', completion: '0.00001', input_cache_read: '0.000000125' },
            },
            { id: 'meta-llama/llama-3-70b:free', pricing: { prompt: '0', completion: '0' } },
            { id: 'vendor/broken-entry', pricing: {} },
        ],
    };

    it('converts per-token prices to USD per 1M with cache rates', () => {
        const catalog = parseOpenRouterCatalog(wire);
        expect(catalog['claude-opus-4-8']).toEqual({
            inputPerMillionUsd: 5,
            outputPerMillionUsd: 25,
            cacheReadPerMillionUsd: 0.5,
            cacheWritePerMillionUsd: 6.25,
        });
    });

    it('omits absent cache rates instead of inventing them', () => {
        const catalog = parseOpenRouterCatalog(wire);
        expect(catalog['gpt-5'].cacheReadPerMillionUsd).toBeCloseTo(0.125, 6);
        expect(catalog['gpt-5'].cacheWritePerMillionUsd).toBeUndefined();
    });

    it('skips colon variants and entries without prompt/completion pricing', () => {
        const catalog = parseOpenRouterCatalog(wire);
        expect(Object.keys(catalog).sort()).toEqual(['claude-opus-4-8', 'gpt-5']);
    });
});

// ---------------------------------------------------------------------------
// Resolution order in getModelPrice: live catalog wins, static stays as
// fallback, unknown models keep the FALLBACK behavior.
// ---------------------------------------------------------------------------
describe('getModelPrice with live catalog (IMP-24-05-02)', () => {
    it('prefers the live price over the static table (Sonnet 5 intro pricing)', () => {
        setLivePriceCatalog({
            'claude-sonnet-5': { inputPerMillionUsd: 2, outputPerMillionUsd: 10, cacheReadPerMillionUsd: 0.2, cacheWritePerMillionUsd: 2.5 },
        });
        const price = getModelPrice('claude-sonnet-5');
        expect(price.inputPerMillionUsd).toBe(2);
        expect(price.outputPerMillionUsd).toBe(10);
    });

    it('matches Bedrock ids against normalized live keys via substring', () => {
        setLivePriceCatalog({
            'claude-haiku-4-5': { inputPerMillionUsd: 1, outputPerMillionUsd: 5, cacheReadPerMillionUsd: 0.1, cacheWritePerMillionUsd: 1.25 },
        });
        const price = getModelPrice('eu.anthropic.claude-haiku-4-5-20251001-v1:0');
        expect(price.outputPerMillionUsd).toBe(5);
    });

    it('normalizes dotted incoming ids before matching the live catalog', () => {
        setLivePriceCatalog({
            'claude-opus-4-8': { inputPerMillionUsd: 5, outputPerMillionUsd: 25 },
        });
        expect(getModelPrice('anthropic/claude-opus-4.8').outputPerMillionUsd).toBe(25);
    });

    it('falls back to the static table for models missing from the catalog', () => {
        setLivePriceCatalog({
            'claude-sonnet-5': { inputPerMillionUsd: 2, outputPerMillionUsd: 10 },
        });
        // o3 is not in the live catalog above -> static entry (2/8) applies.
        expect(getModelPrice('o3').outputPerMillionUsd).toBe(8);
    });

    it('behaves exactly as before when no catalog is set', () => {
        setLivePriceCatalog(null);
        expect(getModelPrice('claude-sonnet-5').inputPerMillionUsd).toBe(3);
        expect(getModelPrice('some-future-model').inputPerMillionUsd).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// Service: persistence + 24h TTL, non-blocking usage pattern.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// AUDIT-2026-07-02 L-1 / I-1 / I-2: trust-boundary hardening of the parser.
// ---------------------------------------------------------------------------
describe('parseOpenRouterCatalog hardening (AUDIT L-1/I-1/I-2)', () => {
    it('rejects non-positive prices (negative or zero input/output)', () => {
        const cat = parseOpenRouterCatalog({ data: [
            { id: 'evil/negative', pricing: { prompt: '-0.0001', completion: '0.00001' } },
            { id: 'evil/zero-out', pricing: { prompt: '0.00001', completion: '0' } },
            { id: 'anthropic/claude-opus-4.8', pricing: { prompt: '0.000005', completion: '0.000025' } },
        ] });
        expect(Object.keys(cat)).toEqual(['claude-opus-4-8']);
    });

    it('drops implausibly large per-token prices (> $10k / 1M)', () => {
        const cat = parseOpenRouterCatalog({ data: [
            { id: 'evil/absurd', pricing: { prompt: '1', completion: '1' } }, // 1e6 per 1M
            { id: 'anthropic/claude-opus-4.8', pricing: { prompt: '0.000005', completion: '0.000025' } },
        ] });
        expect(cat['evil/absurd']).toBeUndefined();
        expect(cat['claude-opus-4-8']).toBeDefined();
    });

    it('ignores negative cache rates instead of storing them', () => {
        const cat = parseOpenRouterCatalog({ data: [
            { id: 'x/y', pricing: { prompt: '0.000005', completion: '0.000025', input_cache_read: '-0.0000005' } },
        ] });
        expect(cat['y'].cacheReadPerMillionUsd).toBeUndefined();
    });

    it('skips __proto__/constructor/prototype model ids (defense in depth)', () => {
        const before = Object.keys(Object.prototype).length;
        const cat = parseOpenRouterCatalog({ data: [
            { id: '__proto__', pricing: { prompt: '0.000005', completion: '0.000025' } },
            { id: 'a/constructor', pricing: { prompt: '0.000005', completion: '0.000025' } },
            { id: 'a/prototype', pricing: { prompt: '0.000005', completion: '0.000025' } },
            { id: 'anthropic/claude-opus-4.8', pricing: { prompt: '0.000005', completion: '0.000025' } },
        ] });
        expect(Object.keys(cat)).toEqual(['claude-opus-4-8']);
        // global prototype untouched, and catalog has no inherited price leak
        expect(Object.keys(Object.prototype).length).toBe(before);
        expect(Object.getPrototypeOf(cat)).toBe(Object.prototype);
    });

    it('sanitizeCatalog drops non-positive/absurd entries and unsafe keys', () => {
        const clean = sanitizeCatalog({
            '__proto__': { inputPerMillionUsd: 5, outputPerMillionUsd: 25 },
            'neg': { inputPerMillionUsd: -1, outputPerMillionUsd: 5 },
            'absurd': { inputPerMillionUsd: 99999, outputPerMillionUsd: 5 },
            'ok': { inputPerMillionUsd: 5, outputPerMillionUsd: 25, cacheReadPerMillionUsd: -1 },
        });
        expect(Object.keys(clean)).toEqual(['ok']);
        expect(clean['ok'].cacheReadPerMillionUsd).toBeUndefined();
    });

    it('caps the number of parsed entries', () => {
        const data = Array.from({ length: 50_000 }, (_, i) => ({
            id: `v/m-${i}`, pricing: { prompt: '0.000001', completion: '0.000001' },
        }));
        const cat = parseOpenRouterCatalog({ data });
        expect(Object.keys(cat).length).toBeLessThanOrEqual(10_000);
    });
});

describe('PriceCatalogService (IMP-24-05-02)', () => {
    function makeFakeFs(): { fs: FileAdapter; files: Map<string, string> } {
        const files = new Map<string, string>();
        const fs = {
            exists: async (p: string) => files.has(p),
            read: async (p: string) => {
                const v = files.get(p);
                if (v === undefined) throw new Error('not found');
                return v;
            },
            write: async (p: string, content: string) => { files.set(p, content); },
            mkdir: async () => {},
        } as unknown as FileAdapter;
        return { fs, files };
    }

    const wire = {
        data: [{ id: 'anthropic/claude-opus-4.8', pricing: { prompt: '0.000005', completion: '0.000025' } }],
    };

    it('fetches, persists, and applies the catalog when nothing is cached', async () => {
        const { fs, files } = makeFakeFs();
        const fetchJson = vi.fn(async () => wire);
        const service = new PriceCatalogService(fs, fetchJson);
        await service.refreshIfStale();
        expect(fetchJson).toHaveBeenCalledTimes(1);
        expect(files.has(PRICE_CATALOG_FILE)).toBe(true);
        expect(getModelPrice('claude-opus-4-8-something').outputPerMillionUsd).toBe(25);
    });

    it('does NOT refetch while the persisted catalog is fresh', async () => {
        const { fs } = makeFakeFs();
        const fetchJson = vi.fn(async () => wire);
        const service = new PriceCatalogService(fs, fetchJson);
        await service.refreshIfStale();
        await service.refreshIfStale();
        expect(fetchJson).toHaveBeenCalledTimes(1);
    });

    it('refetches once the persisted catalog is older than the TTL', async () => {
        const { fs, files } = makeFakeFs();
        const fetchJson = vi.fn(async () => wire);
        const service = new PriceCatalogService(fs, fetchJson);
        await service.refreshIfStale();
        // Age the persisted snapshot beyond 24h.
        const stored = JSON.parse(files.get(PRICE_CATALOG_FILE) ?? '{}') as { fetchedAt: number };
        stored.fetchedAt = Date.now() - 25 * 60 * 60 * 1000;
        files.set(PRICE_CATALOG_FILE, JSON.stringify(stored));
        const service2 = new PriceCatalogService(fs, fetchJson);
        await service2.load();
        await service2.refreshIfStale();
        expect(fetchJson).toHaveBeenCalledTimes(2);
    });

    it('load() applies a persisted catalog without any network call', async () => {
        const { fs, files } = makeFakeFs();
        files.set(PRICE_CATALOG_FILE, JSON.stringify({
            fetchedAt: Date.now(),
            catalog: { 'claude-opus-4-8': { inputPerMillionUsd: 5, outputPerMillionUsd: 25 } },
        }));
        const fetchJson = vi.fn(async () => wire);
        const service = new PriceCatalogService(fs, fetchJson);
        await service.load();
        expect(fetchJson).not.toHaveBeenCalled();
        expect(getModelPrice('claude-opus-4-8').outputPerMillionUsd).toBe(25);
    });

    it('re-validates a tampered persisted catalog on load (AUDIT L-1)', async () => {
        const { fs, files } = makeFakeFs();
        files.set(PRICE_CATALOG_FILE, JSON.stringify({
            fetchedAt: Date.now(),
            catalog: {
                'evil-model': { inputPerMillionUsd: -5, outputPerMillionUsd: 25 },
                'claude-opus-4-8': { inputPerMillionUsd: 5, outputPerMillionUsd: 25 },
            },
        }));
        const service = new PriceCatalogService(fs, vi.fn(async () => ({ data: [] })));
        await service.load();
        // Negative-priced entry dropped, valid one applied.
        expect(getModelPrice('evil-model').inputPerMillionUsd).not.toBe(-5);
        expect(getModelPrice('claude-opus-4-8').outputPerMillionUsd).toBe(25);
    });

    it('survives a failing fetch without touching the current pricing', async () => {
        const { fs } = makeFakeFs();
        const fetchJson = vi.fn(async () => { throw new Error('offline'); });
        const service = new PriceCatalogService(fs, fetchJson);
        await service.refreshIfStale();
        // Static behavior intact.
        expect(getModelPrice('claude-sonnet-5').inputPerMillionUsd).toBe(3);
    });
});

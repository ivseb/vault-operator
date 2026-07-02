/**
 * FIX-26-02-01 regression test
 *
 * OpenRouter's /v1/models quotes pricing as USD PER TOKEN (strings like
 * "0.00001" = 10 USD per 1M). fetchProviderModels stored the values
 * unconverted, while the tier classifier (and the field docs on
 * DiscoveredModel) expect USD per 1M tokens. Every real per-token value
 * (0 to ~0.001) therefore fell below every threshold and
 * classifyByPricing returned 'fast' for everything, flagships included.
 *
 * The fix converts at parse time so the persisted fields match their
 * documented unit and the classifier comment ("callers multiply by
 * 1_000_000") is finally true.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { classifyModelTier } from '../../../core/routing/ModelTierClassifier';

const requestUrlMock = vi.fn();

vi.mock('obsidian', async (importOriginal) => {
    const actual = await importOriginal<typeof import('obsidian')>();
    return {
        ...actual,
        requestUrl: (opts: unknown) => requestUrlMock(opts),
    };
});

// fetchProviderModels races requestUrl against a window.setTimeout timeout.
(globalThis as { window?: unknown }).window = globalThis;

describe('OpenRouter pricing unit conversion (FIX-26-02-01)', () => {
    beforeEach(() => {
        requestUrlMock.mockReset();
        vi.spyOn(console, 'debug').mockImplementation(() => {});
    });

    it('converts per-token prices to USD per 1M tokens', async () => {
        requestUrlMock.mockResolvedValue({
            status: 200,
            json: {
                data: [
                    {
                        id: 'anthropic/claude-sonnet-5',
                        name: 'Claude Sonnet 5',
                        // OpenRouter wire format: USD per token, as strings.
                        pricing: { prompt: '0.000003', completion: '0.00001' },
                        supported_parameters: ['tools'],
                        context_length: 1_000_000,
                    },
                    {
                        id: 'some/unpriced-model',
                        name: 'Unpriced',
                        pricing: {},
                        supported_parameters: ['tools'],
                    },
                ],
            },
        });
        const { fetchProviderModels } = await import('../testModelConnection');
        const models = await fetchProviderModels('openrouter', 'sk-or-test');

        const sonnet = models.find((m) => m.id === 'anthropic/claude-sonnet-5');
        expect(sonnet?.pricingPromptUsd).toBeCloseTo(3, 6);
        expect(sonnet?.pricingCompletionUsd).toBeCloseTo(10, 6);

        const unpriced = models.find((m) => m.id === 'some/unpriced-model');
        expect(unpriced?.pricingPromptUsd).toBeUndefined();
        expect(unpriced?.pricingCompletionUsd).toBeUndefined();
    });

    it('end to end: a converted flagship price no longer classifies as fast', async () => {
        requestUrlMock.mockResolvedValue({
            status: 200,
            json: {
                data: [
                    {
                        id: 'vendor/unknown-frontier-model',
                        name: 'Unknown Frontier',
                        // 75 USD per 1M completion, quoted per token.
                        pricing: { prompt: '0.000015', completion: '0.000075' },
                        supported_parameters: ['tools'],
                    },
                ],
            },
        });
        const { fetchProviderModels } = await import('../testModelConnection');
        const [model] = await fetchProviderModels('openrouter', 'sk-or-test');

        const result = classifyModelTier(model.id, {
            pricing: {
                promptUsd: model.pricingPromptUsd,
                completionUsd: model.pricingCompletionUsd,
            },
        });
        expect(result?.tier).toBe('flagship');
        expect(result?.source).toBe('pricing');
    });
});

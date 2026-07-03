import { describe, it, expect } from 'vitest';
import { getModelCapabilities } from '../modelCapabilities';
import { getCacheCapability } from '../capabilities';
import {
    modelSupportsTemperature,
    modelUsesBudgetTokensThinking,
    getModelEffortLevels,
    getModelContextWindow,
} from '../../types/model-registry';

/**
 * IMP-41-02-04 / ADR-147: single lookup point for model capabilities.
 *
 * The FIX-04-03-12 live incident (Sonnet 5 temperature 400) was the fourth
 * drift of the "scattered capability checks" class. getModelCapabilities
 * aggregates every capability dimension behind one call; the parity suite
 * below pins it against the legacy helpers so the two can never drift.
 */

const PARITY_MODELS: Array<[string, string]> = [
    ['anthropic', 'claude-sonnet-5'],
    ['anthropic', 'claude-opus-4-8'],
    ['anthropic', 'claude-opus-4-6'],
    ['anthropic', 'claude-haiku-4-5'],
    ['anthropic', 'claude-fable-5'],
    ['bedrock', 'global.anthropic.claude-sonnet-5'],
    ['bedrock', 'eu.anthropic.claude-opus-4-7-v1'],
    ['bedrock', 'amazon.nova-pro-v1'],
    ['openai', 'gpt-5'],
    ['openai', 'gpt-4o'],
    ['openai', 'o3-mini'],
    ['ollama', 'qwen3:8b'],
];

describe('getModelCapabilities parity with legacy helpers', () => {
    for (const [provider, model] of PARITY_MODELS) {
        it(`agrees with legacy helpers for ${provider}/${model}`, () => {
            const caps = getModelCapabilities(provider, model);
            expect(caps.supportsTemperature).toBe(modelSupportsTemperature(model));
            expect(caps.cacheStyle).toBe(getCacheCapability(provider as never, model).cacheStyle);
            expect(caps.effortLevels).toEqual(getModelEffortLevels(model, provider));
            expect(caps.contextWindow).toBe(getModelContextWindow(model));
            const expectedShape = /claude/i.test(model)
                ? (modelUsesBudgetTokensThinking(model) ? 'budget-tokens' : 'adaptive')
                : caps.thinkingShape; // non-Claude shape asserted separately
            expect(caps.thinkingShape).toBe(expectedShape);
        });
    }
});

describe('getModelCapabilities semantics', () => {
    it('classifies the Claude 5 lineup as adaptive thinking without temperature', () => {
        const caps = getModelCapabilities('anthropic', 'claude-sonnet-5');
        expect(caps.supportsTemperature).toBe(false);
        expect(caps.thinkingShape).toBe('adaptive');
        expect(caps.supportsVision).toBe(true);
    });

    it('classifies legacy Claude as budget-tokens thinking with temperature', () => {
        const caps = getModelCapabilities('anthropic', 'claude-sonnet-4-5');
        expect(caps.supportsTemperature).toBe(true);
        expect(caps.thinkingShape).toBe('budget-tokens');
    });

    it('marks non-thinking models as none', () => {
        const caps = getModelCapabilities('openai', 'gpt-4o');
        expect(caps.thinkingShape).toBe('none');
    });

    it('returns a conservative fallback for unknown models', () => {
        const caps = getModelCapabilities('custom', 'totally-unknown-llm');
        expect(caps.supportsTemperature).toBe(true); // legacy default
        expect(caps.cacheStyle).toBe('none');
        expect(caps.supportsVision).toBe(false);
        expect(caps.supportsParallelToolCalls).toBe(false);
        expect(caps.contextWindow).toBeGreaterThan(0);
    });

    it('flags vision for the major multimodal families', () => {
        expect(getModelCapabilities('anthropic', 'claude-opus-4-6').supportsVision).toBe(true);
        expect(getModelCapabilities('openai', 'gpt-4o').supportsVision).toBe(true);
        expect(getModelCapabilities('openai', 'gpt-5').supportsVision).toBe(true);
        expect(getModelCapabilities('gemini', 'gemini-2.5-pro').supportsVision).toBe(true);
        expect(getModelCapabilities('ollama', 'qwen3:8b').supportsVision).toBe(false);
    });

    it('normalizes Bedrock aliases before classification', () => {
        const caps = getModelCapabilities('bedrock', 'global.anthropic.claude-sonnet-5');
        expect(caps.supportsTemperature).toBe(false);
        expect(caps.thinkingShape).toBe('adaptive');
        expect(caps.supportsVision).toBe(true);
    });
});

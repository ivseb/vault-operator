/**
 * IMP-54-05b (issue #54): per-model reasoning-effort opt-in for custom /
 * OpenAI-compatible providers.
 *
 * The static registry only knows the Claude lineup and the gpt-5/o-series;
 * a custom endpoint serving GLM-5.2 (or DeepSeek-R1, Qwen reasoning models)
 * always resolved []. resolveEffortLevels is the single choke point both the
 * picker gate and the openai.ts request-body validation call: opt-in first,
 * then the static families. Opted-in models get the OpenAI-style level set.
 */

import { describe, it, expect } from 'vitest';
import {
    getModelEffortLevels,
    resolveEffortLevels,
    providerSupportsEffortOptIn,
    isEffortOptedIn,
} from '../model-registry';

describe('providerSupportsEffortOptIn', () => {
    it('accepts every provider type routed through the OpenAI-compatible wire path', () => {
        for (const type of ['openai', 'azure', 'custom', 'gemini', 'ollama', 'lmstudio', 'openrouter']) {
            expect(providerSupportsEffortOptIn(type), type).toBe(true);
        }
    });

    it('rejects provider types with their own non-chat-completions wire paths', () => {
        for (const type of ['anthropic', 'bedrock', 'github-copilot', 'chatgpt-oauth', 'kilo-gateway']) {
            expect(providerSupportsEffortOptIn(type), type).toBe(false);
        }
    });
});

describe('isEffortOptedIn', () => {
    it('reads an explicit true from the provider map', () => {
        expect(isEffortOptedIn({ 'GLM-5.2': true }, 'GLM-5.2')).toBe(true);
    });

    it('treats missing map, missing id and explicit false as not opted in', () => {
        expect(isEffortOptedIn(undefined, 'GLM-5.2')).toBe(false);
        expect(isEffortOptedIn({}, 'GLM-5.2')).toBe(false);
        expect(isEffortOptedIn({ 'GLM-5.2': false }, 'GLM-5.2')).toBe(false);
        expect(isEffortOptedIn({ 'other-model': true }, 'GLM-5.2')).toBe(false);
    });
});

describe('resolveEffortLevels', () => {
    it('resolves the OpenAI level set for an opted-in unknown model on a custom provider', () => {
        expect(resolveEffortLevels('GLM-5.2', 'custom', true))
            .toEqual(['minimal', 'low', 'medium', 'high']);
    });

    it('resolves the OpenAI level set for an opted-in unknown model on an openai-type custom endpoint', () => {
        expect(resolveEffortLevels('GLM-5.2', 'openai', true))
            .toEqual(['minimal', 'low', 'medium', 'high']);
    });

    it('without opt-in falls back to the static registry (unknown id stays [])', () => {
        expect(resolveEffortLevels('GLM-5.2', 'custom')).toEqual([]);
        expect(resolveEffortLevels('GLM-5.2', 'custom', false)).toEqual([]);
        expect(resolveEffortLevels('GLM-5.2', 'openai', undefined)).toEqual([]);
    });

    it('matches the static registry verbatim for the known families (no opt-in needed)', () => {
        for (const [model, type] of [
            ['claude-opus-4-8', 'anthropic'],
            ['gpt-5', 'openai'],
            ['o3', 'github-copilot'],
            ['anthropic/claude-opus-4-8', 'openrouter'],
            ['gemini-2.5-pro', 'gemini'],
        ] as const) {
            expect(resolveEffortLevels(model, type), `${model}|${type}`)
                .toEqual(getModelEffortLevels(model, type));
        }
    });

    it('ignores an opt-in on provider types outside the OpenAI-compatible wire path (config drift stays inert)', () => {
        expect(resolveEffortLevels('some-model', 'bedrock', true)).toEqual([]);
        expect(resolveEffortLevels('some-model', 'anthropic', true)).toEqual([]);
        expect(resolveEffortLevels('some-model', 'chatgpt-oauth', true)).toEqual([]);
    });

    it('opt-in wins over the static family (documented resolution order)', () => {
        expect(resolveEffortLevels('gpt-5', 'openai', true))
            .toEqual(['minimal', 'low', 'medium', 'high']);
    });

    it('returns a fresh array (callers must not be able to mutate the constant)', () => {
        const a = resolveEffortLevels('GLM-5.2', 'custom', true);
        a.push('max');
        expect(resolveEffortLevels('GLM-5.2', 'custom', true))
            .toEqual(['minimal', 'low', 'medium', 'high']);
    });
});

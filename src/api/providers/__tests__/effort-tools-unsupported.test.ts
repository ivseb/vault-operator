/**
 * FIX-54-10: gpt-5.6 platform generation rejects function tools combined
 * with reasoning_effort on /v1/chat/completions:
 *
 *   "400 Function tools with reasoning_effort are not supported for
 *    gpt-5.6-sol in /v1/chat/completions. To use function tools, use
 *    /v1/responses or set reasoning_effort to 'none'."
 *
 * ADR-148 layer-3 pattern (classify -> corrective one-shot retry -> learn),
 * mirroring the output-cap machinery:
 *   1. classifyProviderError -> 'effort-tools-unsupported'
 *   2. decideLoopErrorAction -> one corrective-retry
 *   3. LearnedCapsStore persists a per-model effortWithToolsUnsupported flag
 *   4. OpenAiProvider consults the flag: tools present -> reasoning_effort
 *      forced to the explicit 'none' the provider names as the escape
 *      (omitting the field is NOT equivalent: reasoning models default to a
 *      non-none effort server-side).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { classifyProviderError } from '../../retry';
import { decideLoopErrorAction } from '../../../core/agent/loopErrorPolicy';
import { LearnedCapsStore, LEARNED_CAPS_FILE } from '../../../core/agent/LearnedCapsStore';
import { isEffortWithToolsUnsupported, setLearnedModelFlags } from '../../../types/model-registry';
import { OpenAiProvider } from '../openai';
import type { LLMProvider } from '../../../types/settings';
import type { ApiStreamChunk } from '../../types';
import type { ToolDefinition } from '../../../core/tools/types';

const LIVE_ERROR_MESSAGE =
    "400 Function tools with reasoning_effort are not supported for gpt-5.6-sol in /v1/chat/completions. "
    + "To use function tools, use /v1/responses or set reasoning_effort to 'none'.";

function apiError(overrides: Record<string, unknown>): Error {
    const err = new Error((overrides.message as string) ?? 'API error');
    Object.assign(err, overrides);
    return err;
}

function memFs() {
    const files = new Map<string, string>();
    return {
        files,
        exists: (p: string) => Promise.resolve(files.has(p)),
        read: (p: string) => {
            const c = files.get(p);
            return c === undefined ? Promise.reject(new Error('missing')) : Promise.resolve(c);
        },
        write: (p: string, c: string) => { files.set(p, c); return Promise.resolve(); },
    };
}

const TEST_TOOLS: ToolDefinition[] = [{
    name: 'read_file',
    description: 'Read a file',
    input_schema: { type: 'object', properties: {} },
}];

type Captured = Record<string, unknown>;

function makeAsyncIterable<T>(chunks: T[]): AsyncIterable<T> {
    // eslint-disable-next-line @typescript-eslint/require-await -- generator wraps a sync source
    return (async function* () {
        for (const chunk of chunks) yield chunk;
    })();
}

async function drain(stream: AsyncIterable<ApiStreamChunk>): Promise<ApiStreamChunk[]> {
    const out: ApiStreamChunk[] = [];
    for await (const c of stream) out.push(c);
    return out;
}

function makeOpenAi(config: Partial<LLMProvider>): {
    provider: OpenAiProvider;
    lastRequest: () => Captured | null;
} {
    const full: LLMProvider = {
        id: 'test',
        name: 'Test',
        type: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-5.6-sol',
        ...config,
    } as LLMProvider;
    const provider = new OpenAiProvider(full);

    let captured: Captured | null = null;
    const stream = makeAsyncIterable([
        { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] },
    ]);
    (provider as unknown as { client: { chat: { completions: { create: unknown } } } }).client = {
        chat: {
            completions: {
                create: (body: Captured) => {
                    captured = body;
                    return Promise.resolve(stream);
                },
            },
        },
    };

    return { provider, lastRequest: () => captured };
}

const BASE_STATE = {
    retriesUsed: 0,
    maxRetries: 3,
    emergencyRetried: false,
    outputCapRetried: false,
    effortToolsRetried: false,
    historyLength: 10,
    rateLimitBaseWaitMs: 30_000,
};

beforeEach(() => setLearnedModelFlags({}));

// ===========================================================================
// 1. Classification
// ===========================================================================

describe('effort-tools-unsupported classification (FIX-54-10)', () => {
    it('classifies the live gpt-5.6-sol 400 as effort-tools-unsupported', () => {
        const err = apiError({ status: 400, message: LIVE_ERROR_MESSAGE });
        expect(classifyProviderError(err)).toBe('effort-tools-unsupported');
    });

    it('matches plausible wording variants (structural match, provider-agnostic)', () => {
        for (const message of [
            "Function tools with reasoning_effort are not supported for gpt-5.6-terra in /v1/chat/completions.",
            'reasoning_effort is not supported when function tools are present',
            "Tools cannot be used with reasoning.effort on this model. Set reasoning_effort to 'none'.",
            'The reasoning effort parameter is incompatible with tool calling for this model',
        ]) {
            expect(classifyProviderError(apiError({ status: 400, message }))).toBe('effort-tools-unsupported');
        }
    });

    it('falls back to the message when no structured status is present', () => {
        const err = apiError({ message: LIVE_ERROR_MESSAGE });
        expect(classifyProviderError(err)).toBe('effort-tools-unsupported');
    });

    it('does NOT classify an effort-only 400 without tools context', () => {
        const err = apiError({ status: 400, message: "reasoning_effort 'xhigh' is not a valid value" });
        expect(classifyProviderError(err)).toBe('client');
    });

    it('does NOT classify a tools-only 400 without an effort field', () => {
        const err = apiError({ status: 400, message: 'tools are not supported for this model' });
        expect(classifyProviderError(err)).toBe('client');
    });

    it('keeps output-cap classification intact (no shadowing)', () => {
        const err = apiError({ status: 400, message: 'max_tokens: 32000 > 8192, which is the maximum' });
        expect(classifyProviderError(err)).toBe('output-cap');
    });

    // Review finding (2026-07-14): the vLLM/LM-Studio shape rejects the
    // reasoning_effort PARAMETER entirely; its "Supported parameters are:
    // ..., tools, ..." enumeration must not count as a tools-combination
    // rejection, because retrying with 'none' still sends the unsupported
    // field and cannot succeed.
    it('does NOT classify an effort-parameter-unsupported 400 whose supported-list mentions tools', () => {
        const err = apiError({
            status: 400,
            message: 'Unsupported parameter: reasoning_effort. Supported parameters are: temperature, top_p, tools, tool_choice, stream',
        });
        expect(classifyProviderError(err)).toBe('client');
    });

    it('does NOT classify when tools are only mentioned inside a supported-parameters enumeration', () => {
        const err = apiError({
            status: 400,
            message: "reasoning_effort is not supported by this endpoint. Supported parameters include: messages, tools, stream",
        });
        expect(classifyProviderError(err)).toBe('client');
    });

    it('still classifies the combination rejection when tools appear before a supported-list', () => {
        const err = apiError({
            status: 400,
            message: "Function tools with reasoning_effort are not supported for gpt-5.6-terra in /v1/chat/completions. Supported parameters are: messages, stream",
        });
        expect(classifyProviderError(err)).toBe('effort-tools-unsupported');
    });
});

// ===========================================================================
// 2. Loop policy: one corrective retry
// ===========================================================================

describe('loop policy for effort-tools-unsupported (FIX-54-10)', () => {
    it('grants ONE corrective retry', () => {
        const err = apiError({ status: 400, message: LIVE_ERROR_MESSAGE });
        expect(decideLoopErrorAction(err, BASE_STATE)).toMatchObject({
            action: 'corrective-retry',
            cls: 'effort-tools-unsupported',
        });
    });

    it('fails hard when the corrective retry was already used (no loop)', () => {
        const err = apiError({ status: 400, message: LIVE_ERROR_MESSAGE });
        const result = decideLoopErrorAction(err, { ...BASE_STATE, effortToolsRetried: true });
        expect(result.action).toBe('fail');
    });

    it('does not consume the output-cap retry budget', () => {
        const err = apiError({ status: 400, message: LIVE_ERROR_MESSAGE });
        const result = decideLoopErrorAction(err, { ...BASE_STATE, outputCapRetried: true });
        expect(result).toMatchObject({ action: 'corrective-retry', cls: 'effort-tools-unsupported' });
    });
});

// ===========================================================================
// 3. Learn: persisted per-model flag
// ===========================================================================

describe('LearnedCapsStore effortWithToolsUnsupported flag (FIX-54-10)', () => {
    it('learns the flag, persists it, and injects it into the registry', async () => {
        const fs = memFs();
        const store = new LearnedCapsStore(fs);
        await store.load();
        expect(isEffortWithToolsUnsupported('gpt-5.6-sol')).toBe(false);

        await store.learnEffortWithToolsUnsupported('gpt-5.6-sol');

        expect(isEffortWithToolsUnsupported('gpt-5.6-sol')).toBe(true);
        expect(fs.files.has(LEARNED_CAPS_FILE)).toBe(true);
        const parsed = JSON.parse(fs.files.get(LEARNED_CAPS_FILE)!) as {
            flags?: Record<string, { effortWithToolsUnsupported?: boolean }>;
        };
        expect(parsed.flags?.['gpt-5.6-sol']?.effortWithToolsUnsupported).toBe(true);
    });

    it('reloads persisted flags on boot and re-injects them (future sessions never pay the 400)', async () => {
        const fs = memFs();
        const first = new LearnedCapsStore(fs);
        await first.load();
        await first.learnEffortWithToolsUnsupported('gpt-5.6-sol');
        setLearnedModelFlags({}); // simulate fresh process

        const second = new LearnedCapsStore(fs);
        await second.load();
        expect(isEffortWithToolsUnsupported('gpt-5.6-sol')).toBe(true);
    });

    it('keeps caps and flags side by side in one file', async () => {
        const fs = memFs();
        const store = new LearnedCapsStore(fs);
        await store.load();
        await store.learnCap('gpt-5.6-sol', 12_000);
        await store.learnEffortWithToolsUnsupported('gpt-5.6-sol');
        const parsed = JSON.parse(fs.files.get(LEARNED_CAPS_FILE)!) as {
            caps: Record<string, number>;
            flags?: Record<string, { effortWithToolsUnsupported?: boolean }>;
        };
        expect(parsed.caps['gpt-5.6-sol']).toBe(12_000);
        expect(parsed.flags?.['gpt-5.6-sol']?.effortWithToolsUnsupported).toBe(true);
    });

    it('rejects tampered flag entries on load (proto keys, non-true values)', async () => {
        const fs = memFs();
        fs.files.set(LEARNED_CAPS_FILE, JSON.stringify({
            caps: {},
            flags: {
                '__proto__': { effortWithToolsUnsupported: true },
                'model-a': { effortWithToolsUnsupported: 'yes' },
                'model-b': { effortWithToolsUnsupported: true },
            },
        }));
        const store = new LearnedCapsStore(fs);
        await store.load();
        expect(isEffortWithToolsUnsupported('model-a')).toBe(false);
        expect(isEffortWithToolsUnsupported('model-b')).toBe(true);
        expect(({} as Record<string, unknown>).effortWithToolsUnsupported).toBeUndefined();
    });
});

// ===========================================================================
// 4. Request builder: flag + tools -> explicit reasoning_effort 'none'
// ===========================================================================

describe('OpenAiProvider suppresses effort with tools when flagged (FIX-54-10)', () => {
    it('forces reasoning_effort to the explicit "none" when the flag is set AND tools are present', async () => {
        setLearnedModelFlags({ 'gpt-5.6-sol': { effortWithToolsUnsupported: true } });
        const { provider, lastRequest } = makeOpenAi({ reasoningEffort: 'medium' });
        await drain(provider.createMessage('sys', [{ role: 'user', content: 'hi' }], TEST_TOOLS));
        expect(lastRequest()?.reasoning_effort).toBe('none');
    });

    it('keeps the user effort when the flag is set but NO tools are present', async () => {
        setLearnedModelFlags({ 'gpt-5.6-sol': { effortWithToolsUnsupported: true } });
        const { provider, lastRequest } = makeOpenAi({ reasoningEffort: 'medium' });
        await drain(provider.createMessage('sys', [{ role: 'user', content: 'hi' }], []));
        expect(lastRequest()?.reasoning_effort).toBe('medium');
    });

    it('keeps the user effort for an unflagged model (regression)', async () => {
        const { provider, lastRequest } = makeOpenAi({ model: 'gpt-5', reasoningEffort: 'medium' });
        await drain(provider.createMessage('sys', [{ role: 'user', content: 'hi' }], TEST_TOOLS));
        expect(lastRequest()?.reasoning_effort).toBe('medium');
    });

    // Live evidence 2026-07-14 (second field report): when NO user effort is
    // configured we used to send no field at all, but the SERVER then applies
    // its own non-none default effort for reasoning models and 400s with the
    // exact same combination error. The escape the provider names requires an
    // EXPLICIT 'none', so a flagged model with tools must always carry it,
    // user-chosen effort or not.
    it('sends the explicit "none" when the flag is set and NO user effort is configured', async () => {
        setLearnedModelFlags({ 'gpt-5.6-sol': { effortWithToolsUnsupported: true } });
        const { provider, lastRequest } = makeOpenAi({});
        await drain(provider.createMessage('sys', [{ role: 'user', content: 'hi' }], TEST_TOOLS));
        expect(lastRequest()?.reasoning_effort).toBe('none');
    });

    it('sends NO effort field for an unflagged model without user effort (byte-identical regression)', async () => {
        const { provider, lastRequest } = makeOpenAi({ model: 'gpt-5' });
        await drain(provider.createMessage('sys', [{ role: 'user', content: 'hi' }], TEST_TOOLS));
        expect('reasoning_effort' in lastRequest()!).toBe(false);
    });

    it('sends NO effort field on a flagged model when no tools are present and no effort chosen', async () => {
        setLearnedModelFlags({ 'gpt-5.6-sol': { effortWithToolsUnsupported: true } });
        const { provider, lastRequest } = makeOpenAi({});
        await drain(provider.createMessage('sys', [{ role: 'user', content: 'hi' }], []));
        expect('reasoning_effort' in lastRequest()!).toBe(false);
    });
});

// ===========================================================================
// 5. End-to-end chain: classified 400 -> corrective retry -> learn ->
//    subsequent request builds with 'none' when tools present
// ===========================================================================

describe('end-to-end: 400 -> corrective retry -> learn -> rebuilt with none (FIX-54-10)', () => {
    it('walks the full chain', async () => {
        // The failed call: platform 400 from gpt-5.6-sol.
        const err = apiError({ status: 400, message: LIVE_ERROR_MESSAGE });

        // 1. classify
        expect(classifyProviderError(err)).toBe('effort-tools-unsupported');

        // 2. policy grants a corrective retry
        const action = decideLoopErrorAction(err, BASE_STATE);
        expect(action).toMatchObject({ action: 'corrective-retry', cls: 'effort-tools-unsupported' });

        // 3. learn (what AgentTask does on corrective-retry for this class)
        const store = new LearnedCapsStore(memFs());
        await store.load();
        await store.learnEffortWithToolsUnsupported('gpt-5.6-sol');

        // 4. the retried request now builds with reasoning_effort 'none'
        const { provider, lastRequest } = makeOpenAi({ reasoningEffort: 'high' });
        await drain(provider.createMessage('sys', [{ role: 'user', content: 'hi' }], TEST_TOOLS));
        expect(lastRequest()?.reasoning_effort).toBe('none');
        expect(lastRequest()?.tools).toBeDefined();
    });
});

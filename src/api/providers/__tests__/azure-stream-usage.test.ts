/**
 * FIX-04-03-11 regression test
 *
 * openai.ts gated stream_options.include_usage on type === 'openai' or
 * 'openrouter'. Azure supports include_usage on the api-version the
 * provider pins (2024-10-21) but never received the flag, so streamed
 * Azure responses carried no usage chunk and the cost footer stayed
 * empty (AgentTask skips onUsage entirely at 0 tokens).
 *
 * local/self-hosted types (custom / ollama / lmstudio) intentionally
 * stay excluded: some strict OpenAI-compat servers reject unknown
 * stream_options fields.
 */

import { describe, it, expect } from 'vitest';
import { OpenAiProvider } from '../openai';
import type { LLMProvider } from '../../../types/settings';
import type { ApiStreamChunk } from '../../types';

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

function makeProvider(config: Partial<LLMProvider>): {
    provider: OpenAiProvider;
    lastRequest: () => Captured | null;
} {
    const full: LLMProvider = {
        id: 'test',
        name: 'Test',
        type: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-5',
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

describe('OpenAiProvider stream_options.include_usage (FIX-04-03-11)', () => {
    it('requests usage for azure streams', async () => {
        const { provider, lastRequest } = makeProvider({
            type: 'azure',
            baseUrl: 'https://example.openai.azure.com',
        });
        await drain(provider.createMessage('sys', [{ role: 'user', content: 'hi' }], []));
        expect(lastRequest()?.stream_options).toEqual({ include_usage: true });
    });

    it('keeps requesting usage for openai and openrouter', async () => {
        for (const type of ['openai', 'openrouter'] as const) {
            const { provider, lastRequest } = makeProvider({ type });
            await drain(provider.createMessage('sys', [{ role: 'user', content: 'hi' }], []));
            expect(lastRequest()?.stream_options, type).toEqual({ include_usage: true });
        }
    });

    it('does not send stream_options to local backends', async () => {
        for (const type of ['custom', 'ollama', 'lmstudio'] as const) {
            const { provider, lastRequest } = makeProvider({
                type,
                baseUrl: 'http://localhost:8000/v1',
            });
            await drain(provider.createMessage('sys', [{ role: 'user', content: 'hi' }], []));
            expect(lastRequest()?.stream_options, type).toBeUndefined();
        }
    });
});

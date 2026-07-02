/**
 * FIX-21-02-01 regression test
 *
 * The Responses API reports cached prompt tokens in
 * usage.input_tokens_details.cached_tokens, and input_tokens INCLUDES
 * them. chatgpt-oauth.ts only read input/output_tokens, so the whole
 * prompt was priced at the full input rate and the footer never showed
 * a cache-hit rate. Convention IMP-18-01-02 (report non-cached part as
 * inputTokens, cached part separately) applies to this provider too.
 */

import { describe, it, expect } from 'vitest';
import { ChatGptOAuthProvider } from '../chatgpt-oauth';
import type { LLMProvider } from '../../../types/settings';
import type { ApiStreamChunk } from '../../types';

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

function sseBytes(events: Array<{ event: string; data: unknown }>): Buffer[] {
    return events.map(({ event, data }) =>
        Buffer.from(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`, 'utf-8'),
    );
}

function makeProvider(usage: Record<string, unknown>): ChatGptOAuthProvider {
    const full: LLMProvider = {
        id: 'test',
        name: 'Test',
        type: 'chatgpt-oauth',
        model: 'gpt-5',
    } as LLMProvider;
    const provider = new ChatGptOAuthProvider(full);
    (provider as unknown as { streamRequest: unknown }).streamRequest = () =>
        Promise.resolve({
            status: 200,
            headers: {},
            stream: makeAsyncIterable<Buffer>(sseBytes([
                {
                    event: 'response.completed',
                    data: { type: 'response.completed', response: { usage } },
                },
            ])),
        });
    return provider;
}

describe('ChatGptOAuthProvider cached tokens (FIX-21-02-01)', () => {
    it('subtracts cached_tokens from input and reports them as cacheReadTokens', async () => {
        const provider = makeProvider({
            input_tokens: 1000,
            output_tokens: 100,
            input_tokens_details: { cached_tokens: 800 },
        });
        const chunks = await drain(provider.createMessage('sys', [{ role: 'user', content: 'hi' }], []));
        const usage = chunks.find((c) => c.type === 'usage');
        expect(usage).toBeDefined();
        expect(usage).toMatchObject({
            inputTokens: 200,
            outputTokens: 100,
            cacheReadTokens: 800,
        });
    });

    it('reports plain usage unchanged when no cached_tokens are present', async () => {
        const provider = makeProvider({
            input_tokens: 1000,
            output_tokens: 100,
        });
        const chunks = await drain(provider.createMessage('sys', [{ role: 'user', content: 'hi' }], []));
        const usage = chunks.find((c) => c.type === 'usage');
        expect(usage).toMatchObject({ inputTokens: 1000, outputTokens: 100 });
        expect((usage as { cacheReadTokens?: number }).cacheReadTokens ?? 0).toBe(0);
    });
});

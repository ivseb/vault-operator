/**
 * FIX-04-03-07 regression test
 *
 * DeepSeek deepseek-reasoner via OpenAI-compatible provider returns
 * `reasoning_content` + `content`. When the assistant message contains
 * `tool_calls`, the original `reasoning_content` MUST be echoed back on the
 * follow-up request, otherwise DeepSeek returns 400 ("The `reasoning_content`
 * in the thinking mode must be passed back to the API").
 *
 * Other OpenAI-compatible backends (openai, azure, gemini, openrouter) do not
 * expect or know `reasoning_content`. To avoid regressions we gate the passback
 * via an explicit allow-list and only echo `reasoning_content` for the LAST
 * assistant message that has tool_use blocks (DeepSeek's multi-round
 * convention: "do not include reasoning_content of previous rounds").
 *
 * See FIX-04-03-07-deepseek-reasoning-passback.md for the full root cause.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OpenAiProvider } from '../openai';
import type { LLMProvider } from '../../../types/settings';
import type { ApiStreamChunk, MessageParam } from '../../types';

type CapturedRequest = {
    messages: Array<Record<string, unknown>>;
    [k: string]: unknown;
};

function makeStream<T>(chunks: T[]): AsyncIterable<T> {
    // eslint-disable-next-line @typescript-eslint/require-await -- generator wraps a sync source
    return (async function* () {
        for (const chunk of chunks) yield chunk;
    })();
}

function makeProvider(type: LLMProvider['type'], model = 'deepseek-reasoner'): {
    provider: OpenAiProvider;
    lastRequest: () => CapturedRequest | null;
    setStream: (chunks: unknown[]) => void;
} {
    const config: LLMProvider = {
        id: 'test',
        name: 'Test',
        type,
        apiKey: 'sk-test',
        baseUrl: 'https://api.deepseek.com',
        model,
    } as LLMProvider;
    const provider = new OpenAiProvider(config);

    let captured: CapturedRequest | null = null;
    let nextStream: AsyncIterable<unknown> = makeStream([{
        choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }],
    }]);

    (provider as unknown as { client: { chat: { completions: { create: unknown } } } }).client = {
        chat: {
            completions: {
                create: (body: CapturedRequest) => {
                    captured = body;
                    return Promise.resolve(nextStream);
                },
            },
        },
    };

    return {
        provider,
        lastRequest: () => captured,
        setStream: (chunks: unknown[]) => { nextStream = makeStream(chunks); },
    };
}

async function drain(stream: AsyncIterable<ApiStreamChunk>): Promise<ApiStreamChunk[]> {
    const out: ApiStreamChunk[] = [];
    for await (const c of stream) out.push(c);
    return out;
}

describe('OpenAiProvider — reasoning_content passback (FIX-04-03-07)', () => {

    describe('streaming capture', () => {
        it('flags `reasoning_content` deltas with requiresPassback: true', async () => {
            const { provider, setStream } = makeProvider('custom');
            setStream([
                { choices: [{ delta: { reasoning_content: 'I need to ' }, finish_reason: null }] },
                { choices: [{ delta: { reasoning_content: 'search the vault.' }, finish_reason: null }] },
                { choices: [{ delta: { content: 'Searching now.' }, finish_reason: 'stop' }] },
            ]);
            const chunks = await drain(provider.createMessage('', [], []));
            const thinking = chunks.filter((c): c is Extract<ApiStreamChunk, { type: 'thinking' }> => c.type === 'thinking');
            expect(thinking.length).toBe(2);
            expect(thinking[0].requiresPassback).toBe(true);
            expect(thinking[1].requiresPassback).toBe(true);
        });
    });

    describe('wire format — allow-list', () => {
        const thinkingHistory: MessageParam[] = [
            { role: 'user', content: 'do something' },
            {
                role: 'assistant',
                content: [
                    { type: 'thinking', text: 'analyzing the request' },
                    { type: 'tool_use', id: 'tu1', name: 'list_files', input: { path: '.' } },
                ],
            },
            {
                role: 'user',
                content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'file1\nfile2' }],
            },
        ];

        it('echoes reasoning_content for config.type=custom', async () => {
            const { provider, lastRequest } = makeProvider('custom');
            await drain(provider.createMessage('sys', thinkingHistory, []));
            const req = lastRequest();
            expect(req).not.toBeNull();
            const assistantMsg = req!.messages.find((m) => m.role === 'assistant');
            expect(assistantMsg).toBeDefined();
            expect(assistantMsg!.reasoning_content).toBe('analyzing the request');
        });

        it('echoes reasoning_content for config.type=ollama', async () => {
            const { provider, lastRequest } = makeProvider('ollama');
            await drain(provider.createMessage('sys', thinkingHistory, []));
            const assistantMsg = lastRequest()!.messages.find((m) => m.role === 'assistant');
            expect(assistantMsg!.reasoning_content).toBe('analyzing the request');
        });

        it('echoes reasoning_content for config.type=lmstudio', async () => {
            const { provider, lastRequest } = makeProvider('lmstudio');
            await drain(provider.createMessage('sys', thinkingHistory, []));
            const assistantMsg = lastRequest()!.messages.find((m) => m.role === 'assistant');
            expect(assistantMsg!.reasoning_content).toBe('analyzing the request');
        });

        it('does NOT echo reasoning_content for config.type=openai', async () => {
            const { provider, lastRequest } = makeProvider('openai', 'gpt-4o');
            await drain(provider.createMessage('sys', thinkingHistory, []));
            const assistantMsg = lastRequest()!.messages.find((m) => m.role === 'assistant');
            expect(assistantMsg!.reasoning_content).toBeUndefined();
        });

        it('does NOT echo reasoning_content for config.type=azure', async () => {
            const { provider, lastRequest } = makeProvider('azure', 'gpt-4o');
            await drain(provider.createMessage('sys', thinkingHistory, []));
            const assistantMsg = lastRequest()!.messages.find((m) => m.role === 'assistant');
            expect(assistantMsg!.reasoning_content).toBeUndefined();
        });

        it('does NOT echo reasoning_content for config.type=openrouter', async () => {
            const { provider, lastRequest } = makeProvider('openrouter', 'deepseek/deepseek-r1');
            await drain(provider.createMessage('sys', thinkingHistory, []));
            const assistantMsg = lastRequest()!.messages.find((m) => m.role === 'assistant');
            expect(assistantMsg!.reasoning_content).toBeUndefined();
        });

        it('does NOT echo reasoning_content for config.type=gemini', async () => {
            const { provider, lastRequest } = makeProvider('gemini', 'gemini-2.0-flash');
            await drain(provider.createMessage('sys', thinkingHistory, []));
            const assistantMsg = lastRequest()!.messages.find((m) => m.role === 'assistant');
            expect(assistantMsg!.reasoning_content).toBeUndefined();
        });
    });

    describe('wire format — last-assistant-only', () => {
        it('does NOT echo reasoning_content for an OLDER assistant message (only the last)', async () => {
            const { provider, lastRequest } = makeProvider('custom');
            const history: MessageParam[] = [
                { role: 'user', content: 'first turn' },
                {
                    role: 'assistant',
                    content: [
                        { type: 'thinking', text: 'older reasoning' },
                        { type: 'tool_use', id: 'tu0', name: 'list_files', input: {} },
                    ],
                },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu0', content: 'old result' }] },
                { role: 'user', content: 'second turn' },
                {
                    role: 'assistant',
                    content: [
                        { type: 'thinking', text: 'latest reasoning' },
                        { type: 'tool_use', id: 'tu1', name: 'read_file', input: { path: 'x.md' } },
                    ],
                },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'file body' }] },
            ];
            await drain(provider.createMessage('sys', history, []));
            const assistants = lastRequest()!.messages.filter((m) => m.role === 'assistant');
            expect(assistants).toHaveLength(2);
            // Older assistant has NO reasoning_content; only the last one does.
            expect(assistants[0].reasoning_content).toBeUndefined();
            expect(assistants[1].reasoning_content).toBe('latest reasoning');
        });

        it('does NOT echo reasoning_content when last assistant has no tool_use', async () => {
            const { provider, lastRequest } = makeProvider('custom');
            const history: MessageParam[] = [
                { role: 'user', content: 'hi' },
                {
                    role: 'assistant',
                    content: [
                        { type: 'thinking', text: 'thinking about greeting' },
                        { type: 'text', text: 'Hello.' },
                    ],
                },
                { role: 'user', content: 'thanks' },
            ];
            await drain(provider.createMessage('sys', history, []));
            const assistantMsg = lastRequest()!.messages.find((m) => m.role === 'assistant');
            // No tool_use anywhere → no reasoning_content needed.
            expect(assistantMsg!.reasoning_content).toBeUndefined();
        });

        it('concatenates multiple thinking blocks on the last assistant message', async () => {
            const { provider, lastRequest } = makeProvider('custom');
            const history: MessageParam[] = [
                { role: 'user', content: 'do it' },
                {
                    role: 'assistant',
                    content: [
                        { type: 'thinking', text: 'part one. ' },
                        { type: 'thinking', text: 'part two.' },
                        { type: 'tool_use', id: 'tu1', name: 'list_files', input: {} },
                    ],
                },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'r' }] },
            ];
            await drain(provider.createMessage('sys', history, []));
            const assistantMsg = lastRequest()!.messages.find((m) => m.role === 'assistant');
            expect(assistantMsg!.reasoning_content).toBe('part one. part two.');
        });
    });

    describe('wire format — guards', () => {
        it('does NOT set reasoning_content when the thinking text is empty', async () => {
            const { provider, lastRequest } = makeProvider('custom');
            const history: MessageParam[] = [
                { role: 'user', content: 'go' },
                {
                    role: 'assistant',
                    content: [
                        { type: 'thinking', text: '' },
                        { type: 'tool_use', id: 'tu1', name: 'list_files', input: {} },
                    ],
                },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'r' }] },
            ];
            await drain(provider.createMessage('sys', history, []));
            const assistantMsg = lastRequest()!.messages.find((m) => m.role === 'assistant');
            expect(assistantMsg!.reasoning_content).toBeUndefined();
        });

        it('truncates reasoning_content longer than 50,000 chars and appends a marker', async () => {
            const { provider, lastRequest } = makeProvider('custom');
            const huge = 'x'.repeat(60_000);
            const history: MessageParam[] = [
                { role: 'user', content: 'go' },
                {
                    role: 'assistant',
                    content: [
                        { type: 'thinking', text: huge },
                        { type: 'tool_use', id: 'tu1', name: 'list_files', input: {} },
                    ],
                },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'r' }] },
            ];
            await drain(provider.createMessage('sys', history, []));
            const assistantMsg = lastRequest()!.messages.find((m) => m.role === 'assistant');
            const rc = assistantMsg!.reasoning_content as string;
            expect(rc.length).toBeLessThanOrEqual(50_000 + 64); // 50k + trailer
            expect(rc.endsWith('[reasoning truncated]')).toBe(true);
        });

        it('does NOT include thinking blocks in the visible content field', async () => {
            const { provider, lastRequest } = makeProvider('custom');
            const history: MessageParam[] = [
                { role: 'user', content: 'go' },
                {
                    role: 'assistant',
                    content: [
                        { type: 'thinking', text: 'secret reasoning' },
                        { type: 'text', text: 'visible answer' },
                        { type: 'tool_use', id: 'tu1', name: 'list_files', input: {} },
                    ],
                },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'r' }] },
            ];
            await drain(provider.createMessage('sys', history, []));
            const assistantMsg = lastRequest()!.messages.find((m) => m.role === 'assistant');
            // visible content stays text-only; reasoning lives in its own slot.
            expect(assistantMsg!.content).toBe('visible answer');
            expect(assistantMsg!.reasoning_content).toBe('secret reasoning');
        });
    });
});

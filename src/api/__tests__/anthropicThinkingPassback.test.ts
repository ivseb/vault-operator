import { describe, it, expect, vi } from 'vitest';
import { AnthropicProvider } from '../providers/anthropic';
import type { LLMProvider } from '../../types/settings';
import type { ApiStreamChunk, MessageParam } from '../types';

/**
 * IMP-41-01-05: Anthropic signed-thinking round trip.
 *
 * Stream side: thinking_delta chunks carry requiresPassback so AgentTask
 * persists them; signature_delta accumulates and is emitted as a
 * thinking_signature chunk at content_block_stop.
 * Wire side: with thinking enabled, signed thinking blocks on the last
 * assistant message are sent back as { type: 'thinking', thinking, signature };
 * unsigned blocks never reach the wire.
 */

function makeProvider(overrides: Partial<LLMProvider> = {}): AnthropicProvider {
    return new AnthropicProvider({
        id: 'test', name: 'Test', type: 'anthropic',
        apiKey: 'sk-test', model: 'claude-sonnet-4-5',
        thinkingEnabled: true,
        ...overrides,
    } as LLMProvider);
}

function mockStream(provider: AnthropicProvider, events: unknown[]): ReturnType<typeof vi.fn> {
    const streamMock = vi.fn(() => (async function* () {
        for (const e of events) yield e;
    })());
    (provider as unknown as { client: { messages: { stream: unknown } } })
        .client.messages.stream = streamMock;
    return streamMock;
}

async function collect(provider: AnthropicProvider, messages: MessageParam[]): Promise<ApiStreamChunk[]> {
    const chunks: ApiStreamChunk[] = [];
    for await (const c of provider.createMessage('system', messages, [])) chunks.push(c);
    return chunks;
}

const THINKING_EVENTS = [
    { type: 'message_start', message: { usage: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'let me think' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-part-1' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: '-part-2' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'answer' } },
    { type: 'message_delta', usage: { output_tokens: 5 }, delta: { stop_reason: 'end_turn' } },
];

describe('AnthropicProvider thinking stream (IMP-41-01-05)', () => {
    it('marks thinking deltas requiresPassback and emits the sealed signature', async () => {
        const provider = makeProvider();
        mockStream(provider, THINKING_EVENTS);
        const chunks = await collect(provider, [{ role: 'user', content: 'hi' }]);

        const thinking = chunks.filter((c) => c.type === 'thinking');
        expect(thinking).toHaveLength(1);
        expect(thinking[0]).toMatchObject({ text: 'let me think', requiresPassback: true });

        const signatures = chunks.filter((c) => c.type === 'thinking_signature');
        expect(signatures).toHaveLength(1);
        expect(signatures[0]).toMatchObject({ signature: 'sig-part-1-part-2' });
    });

    it('emits no signature chunk for thinking blocks without signature_delta', async () => {
        const provider = makeProvider();
        mockStream(provider, [
            { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'unsigned' } },
            { type: 'content_block_stop', index: 0 },
        ]);
        const chunks = await collect(provider, [{ role: 'user', content: 'hi' }]);
        expect(chunks.filter((c) => c.type === 'thinking_signature')).toHaveLength(0);
    });
});

describe('AnthropicProvider thinking wire passback (IMP-41-01-05)', () => {
    const SIGNED_HISTORY: MessageParam[] = [
        { role: 'user', content: 'do something' },
        {
            role: 'assistant',
            content: [
                { type: 'thinking', text: 'signed cot', signature: 'sig-1' },
                { type: 'tool_use', id: 't1', name: 'read_file', input: {} },
            ],
        },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file body' }] },
    ];

    it('sends the signed thinking block of the last assistant turn', async () => {
        const provider = makeProvider();
        const streamMock = mockStream(provider, []);
        await collect(provider, SIGNED_HISTORY);

        const request = streamMock.mock.calls[0][0] as { messages: Array<{ content: unknown }> };
        const assistantContent = request.messages[1].content as Array<Record<string, unknown>>;
        expect(assistantContent[0]).toEqual({ type: 'thinking', thinking: 'signed cot', signature: 'sig-1' });
    });

    it('never sends unsigned thinking blocks', async () => {
        const provider = makeProvider();
        const streamMock = mockStream(provider, []);
        await collect(provider, [
            { role: 'user', content: 'x' },
            { role: 'assistant', content: [{ type: 'thinking', text: 'unsigned' }, { type: 'text', text: 'a' }] },
            { role: 'user', content: 'y' },
        ]);
        const request = streamMock.mock.calls[0][0] as { messages: Array<{ content: unknown }> };
        const types = (request.messages[1].content as Array<{ type: string }>).map((b) => b.type);
        expect(types).toEqual(['text']);
    });

    it('strips ALL thinking blocks when thinking is disabled', async () => {
        const provider = makeProvider({ thinkingEnabled: false });
        const streamMock = mockStream(provider, []);
        await collect(provider, SIGNED_HISTORY);
        const request = streamMock.mock.calls[0][0] as { messages: Array<{ content: unknown }> };
        const types = (request.messages[1].content as Array<{ type: string }>).map((b) => b.type);
        expect(types).toEqual(['tool_use']);
    });
});

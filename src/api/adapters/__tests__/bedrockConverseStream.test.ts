import { describe, it, expect, vi } from 'vitest';
import { parseBedrockConverseStream } from '../bedrockConverse';
import type { ApiStreamChunk } from '../../types';

/**
 * IMP-41-03-03: the Bedrock Converse stream parser turns AWS SDK
 * ConverseStreamOutput events into the provider-neutral ApiStreamChunk
 * sequence. The golden-file suite only pins prepare-request payloads, so
 * the parse path (text, thinking, tool accumulation across deltas, the
 * end-of-stream tool-parse failures, and usage/cache emission) was
 * unverified until now. Events are plain objects matching the SDK shape.
 */

vi.mock('../../logCacheStat', () => ({ logCacheStat: vi.fn() }));

// The SDK event union is structural; the parser only reads the fields
// asserted below, so a permissive local type keeps the fixtures readable.
type Event = Record<string, unknown>;

function stream(events: Event[]): AsyncIterable<never> {
    return (async function* () {
        for (const e of events) yield e as never;
    })();
}

async function collect(events: Event[], model = 'anthropic.claude-sonnet-4'): Promise<ApiStreamChunk[]> {
    const out: ApiStreamChunk[] = [];
    for await (const c of parseBedrockConverseStream(stream(events), { model, cachingEnabled: true })) {
        out.push(c);
    }
    return out;
}

describe('parseBedrockConverseStream', () => {
    it('emits text deltas verbatim and reasoning deltas as thinking', async () => {
        const chunks = await collect([
            { contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { text: 'let me think' } } } },
            { contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'Hello ' } } },
            { contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'world' } } },
        ]);

        expect(chunks).toEqual([
            { type: 'thinking', text: 'let me think' },
            { type: 'text', text: 'Hello ' },
            { type: 'text', text: 'world' },
        ]);
    });

    it('accumulates a tool call across start + input deltas and emits it on block stop', async () => {
        const chunks = await collect([
            { contentBlockStart: { contentBlockIndex: 1, start: { toolUse: { toolUseId: 't-1', name: 'read_file' } } } },
            { contentBlockDelta: { contentBlockIndex: 1, delta: { toolUse: { input: '{"path":' } } } },
            { contentBlockDelta: { contentBlockIndex: 1, delta: { toolUse: { input: '"a.md"}' } } } },
            { contentBlockStop: { contentBlockIndex: 1 } },
        ]);

        expect(chunks).toEqual([
            { type: 'tool_use', id: 't-1', name: 'read_file', input: { path: 'a.md' } },
        ]);
    });

    it('emits an empty-input tool_use when no input deltas arrive', async () => {
        const chunks = await collect([
            { contentBlockStart: { contentBlockIndex: 0, start: { toolUse: { toolUseId: 't-2', name: 'list_files' } } } },
            { contentBlockStop: { contentBlockIndex: 0 } },
        ]);

        expect(chunks).toEqual([
            { type: 'tool_use', id: 't-2', name: 'list_files', input: {} },
        ]);
    });

    it('surfaces a tool_error when the accumulated tool JSON is invalid', async () => {
        const chunks = await collect([
            { contentBlockStart: { contentBlockIndex: 0, start: { toolUse: { toolUseId: 't-3', name: 'write_file' } } } },
            { contentBlockDelta: { contentBlockIndex: 0, delta: { toolUse: { input: '{"path": "a.md", "conte' } } } },
            { contentBlockStop: { contentBlockIndex: 0 } },
        ]);

        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toMatchObject({ type: 'tool_error', id: 't-3', name: 'write_file' });
    });

    it('reports an unterminated tool call (stream ended mid-tool) as a truncation error, max_tokens aware', async () => {
        const chunks = await collect([
            { contentBlockStart: { contentBlockIndex: 0, start: { toolUse: { toolUseId: 't-4', name: 'write_file' } } } },
            { contentBlockDelta: { contentBlockIndex: 0, delta: { toolUse: { input: '{"path"' } } } },
            // no contentBlockStop -> the tool never completes
            { messageStop: { stopReason: 'max_tokens' } },
        ]);

        expect(chunks).toHaveLength(1);
        const err = chunks[0] as Extract<ApiStreamChunk, { type: 'tool_error' }>;
        expect(err.type).toBe('tool_error');
        expect(err.id).toBe('t-4');
        // truncatedToolInputError mentions the output-token cap for max_tokens stops.
        expect(err.error.toLowerCase()).toContain('token');
    });

    it('emits a usage chunk with cache figures when metadata carries tokens', async () => {
        const chunks = await collect([
            { contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'hi' } } },
            { metadata: { usage: { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 80, cacheWriteInputTokens: 10 } } },
        ]);

        expect(chunks).toEqual([
            { type: 'text', text: 'hi' },
            { type: 'usage', inputTokens: 100, outputTokens: 20, cacheReadTokens: 80, cacheCreationTokens: 10 },
        ]);
    });

    it('omits cache fields (undefined) when there is no cache activity, and no usage chunk at zero tokens', async () => {
        const withUsage = await collect([
            { metadata: { usage: { inputTokens: 5, outputTokens: 3 } } },
        ]);
        expect(withUsage).toEqual([
            { type: 'usage', inputTokens: 5, outputTokens: 3, cacheReadTokens: undefined, cacheCreationTokens: undefined },
        ]);

        const noTokens = await collect([
            { contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'x' } } },
        ]);
        expect(noTokens).toEqual([{ type: 'text', text: 'x' }]);
    });
});

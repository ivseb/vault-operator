/**
 * FIX-04-03-07 regression test
 *
 * Anthropic and Bedrock convertMessages throw on unknown ContentBlock types.
 * Once ThinkingBlocks live in the internal ContentBlock union (so DeepSeek can
 * round-trip its reasoning), a cross-provider switch (DeepSeek conversation
 * loaded under an Anthropic config) would crash without a pre-filter.
 *
 * `stripThinkingBlocks` drops thinking blocks defensively. Anthropic's signed
 * extended-thinking round-trip needs separate handling (out of scope for this
 * fix).
 */

import { describe, it, expect } from 'vitest';
import { stripThinkingBlocks } from '../stripThinkingBlocks';
import type { MessageParam } from '../../../api/types';

describe('stripThinkingBlocks (FIX-04-03-07)', () => {
    it('removes thinking blocks from assistant message content arrays', () => {
        const messages: MessageParam[] = [
            { role: 'user', content: 'do something' },
            {
                role: 'assistant',
                content: [
                    { type: 'thinking', text: 'inner monologue' },
                    { type: 'text', text: 'visible answer' },
                    { type: 'tool_use', id: 'tu1', name: 'list_files', input: {} },
                ],
            },
        ];
        const out = stripThinkingBlocks(messages);
        const assistantContent = out[1].content;
        if (!Array.isArray(assistantContent)) throw new Error('expected array');
        expect(assistantContent.some((b) => b.type === 'thinking')).toBe(false);
        expect(assistantContent.some((b) => b.type === 'text')).toBe(true);
        expect(assistantContent.some((b) => b.type === 'tool_use')).toBe(true);
    });

    it('leaves messages without thinking blocks untouched', () => {
        const messages: MessageParam[] = [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'hello' },
            {
                role: 'user',
                content: [{ type: 'tool_result', tool_use_id: 'x', content: 'r' }],
            },
        ];
        const out = stripThinkingBlocks(messages);
        expect(out).toEqual(messages);
    });

    it('passes string content through unchanged', () => {
        const messages: MessageParam[] = [
            { role: 'user', content: 'plain string' },
        ];
        const out = stripThinkingBlocks(messages);
        expect(out[0].content).toBe('plain string');
    });

    it('does not mutate the input array', () => {
        const messages: MessageParam[] = [
            {
                role: 'assistant',
                content: [
                    { type: 'thinking', text: 'x' },
                    { type: 'text', text: 'y' },
                ],
            },
        ];
        const original = JSON.stringify(messages);
        stripThinkingBlocks(messages);
        expect(JSON.stringify(messages)).toBe(original);
    });

    it('keeps message role and order intact', () => {
        const messages: MessageParam[] = [
            { role: 'user', content: 'a' },
            { role: 'assistant', content: [{ type: 'thinking', text: 't' }, { type: 'text', text: 'b' }] },
            { role: 'user', content: 'c' },
        ];
        const out = stripThinkingBlocks(messages);
        expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
        expect(out[2].content).toBe('c');
    });

    it('preserves messages that become empty (all-thinking) — caller decides what to do', () => {
        // Intentionally non-destructive: if filtering an assistant content array
        // empties it, we leave an empty array. The downstream provider's API
        // call may reject it; defensive cleanup belongs elsewhere
        // (sanitizeHistoryForApi handles real orphan cases).
        const messages: MessageParam[] = [
            {
                role: 'assistant',
                content: [{ type: 'thinking', text: 'only reasoning, no visible output' }],
            },
        ];
        const out = stripThinkingBlocks(messages);
        const content = out[0].content;
        expect(Array.isArray(content)).toBe(true);
        expect((content as unknown[]).length).toBe(0);
    });
});

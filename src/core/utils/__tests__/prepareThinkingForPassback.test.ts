import { describe, it, expect } from 'vitest';
import { prepareThinkingForPassback, stripThinkingBlocks } from '../stripThinkingBlocks';
import type { MessageParam } from '../../../api/types';

/**
 * IMP-41-01-05: passback preparation for Anthropic signed thinking.
 *
 * Rules:
 *  - unsigned thinking blocks are stripped everywhere (cross-provider or
 *    OpenAI-reasoner remnants would 400 on Anthropic)
 *  - SIGNED thinking and redacted_thinking survive ONLY on the last
 *    assistant message (the API requires them there for tool_use loops;
 *    older turns may drop them to save tokens)
 */

const SIGNED = { type: 'thinking' as const, text: 'signed cot', signature: 'sig-1' };
const UNSIGNED = { type: 'thinking' as const, text: 'plain cot' };
const REDACTED = { type: 'redacted_thinking' as const, data: 'opaque-bytes' };
const TEXT = { type: 'text' as const, text: 'visible answer' };
const TOOL_USE = { type: 'tool_use' as const, id: 't1', name: 'read_file', input: {} };

describe('prepareThinkingForPassback', () => {
    it('keeps signed thinking on the last assistant message', () => {
        const messages: MessageParam[] = [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: [SIGNED, TEXT, TOOL_USE] },
        ];
        const out = prepareThinkingForPassback(messages);
        const last = out[1];
        expect(Array.isArray(last.content) && last.content[0]).toMatchObject({
            type: 'thinking', text: 'signed cot', signature: 'sig-1',
        });
    });

    it('strips signed thinking from earlier assistant turns', () => {
        const messages: MessageParam[] = [
            { role: 'assistant', content: [SIGNED, TEXT] },
            { role: 'user', content: 'continue' },
            { role: 'assistant', content: [{ ...SIGNED, signature: 'sig-2' }, TEXT] },
        ];
        const out = prepareThinkingForPassback(messages);
        expect((out[0].content as unknown[]).some((b) => (b as { type: string }).type === 'thinking')).toBe(false);
        expect((out[2].content as unknown[])[0]).toMatchObject({ signature: 'sig-2' });
    });

    it('strips unsigned thinking everywhere, even on the last assistant turn', () => {
        const messages: MessageParam[] = [
            { role: 'assistant', content: [UNSIGNED, TEXT] },
        ];
        const out = prepareThinkingForPassback(messages);
        expect((out[0].content as unknown[]).map((b) => (b as { type: string }).type)).toEqual(['text']);
    });

    it('keeps redacted_thinking on the last assistant message only', () => {
        const messages: MessageParam[] = [
            { role: 'assistant', content: [REDACTED, TEXT] },
            { role: 'user', content: 'next' },
            { role: 'assistant', content: [REDACTED, TOOL_USE] },
        ];
        const out = prepareThinkingForPassback(messages);
        expect((out[0].content as unknown[]).map((b) => (b as { type: string }).type)).toEqual(['text']);
        expect((out[2].content as unknown[]).map((b) => (b as { type: string }).type))
            .toEqual(['redacted_thinking', 'tool_use']);
    });

    it('does not mutate the input', () => {
        const messages: MessageParam[] = [
            { role: 'assistant', content: [SIGNED, TEXT] },
        ];
        const snapshot = JSON.stringify(messages);
        prepareThinkingForPassback(messages);
        expect(JSON.stringify(messages)).toBe(snapshot);
    });
});

describe('stripThinkingBlocks (redacted extension)', () => {
    it('now also strips redacted_thinking for foreign providers', () => {
        const messages: MessageParam[] = [
            { role: 'assistant', content: [SIGNED, REDACTED, TEXT] },
        ];
        const out = stripThinkingBlocks(messages);
        expect((out[0].content as unknown[]).map((b) => (b as { type: string }).type)).toEqual(['text']);
    });
});

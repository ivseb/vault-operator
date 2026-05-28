/**
 * stripThinkingBlocks - defensive cross-provider safety filter (FIX-04-03-07)
 *
 * Once `{ type: 'thinking' }` is a first-class ContentBlock (so DeepSeek can
 * round-trip its `reasoning_content` via the OpenAI-compatible provider), a
 * cross-provider switch (DeepSeek conversation loaded under an Anthropic or
 * Bedrock config) would hit `throw new Error('Unknown content block type')`
 * in their strict convertMessages. This helper drops thinking blocks before
 * the strict map runs.
 *
 * Anthropic's signed extended-thinking round-trip is out of scope for this
 * fix - it needs a separate `thinking_signed` block schema and provider
 * support. Until then, plain thinking blocks must not reach Anthropic's API
 * (it would reject them).
 *
 * Returns a NEW array. Input is not mutated.
 */

import type { ContentBlock, MessageParam } from '../../api/types';

export function stripThinkingBlocks(messages: readonly MessageParam[]): MessageParam[] {
    const out: MessageParam[] = [];
    for (const msg of messages) {
        if (typeof msg.content === 'string') {
            out.push(msg);
            continue;
        }
        const filtered: ContentBlock[] = msg.content.filter((b) => b.type !== 'thinking');
        out.push({ ...msg, content: filtered });
    }
    return out;
}

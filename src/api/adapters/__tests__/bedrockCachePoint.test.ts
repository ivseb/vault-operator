/**
 * IMP-01-04-03 (Lever B): Bedrock places TWO history cachePoints -- a rolling
 * one on the last user message and a stable one ~6 user-messages back -- so a
 * long agentic conversation stays a cache READ across turns instead of a full
 * cacheCreate every turn (which the single rolling cachePoint plus the
 * front-anchored todo string used to force).
 */

import { describe, it, expect } from 'vitest';
import { prepareBedrockConverseInput } from '../bedrockConverse';
import type { LLMProvider } from '../../../types/settings';
import type { MessageParam } from '../../types';
import type { ToolDefinition } from '../../../core/tools/types';

const CONFIG = {
    id: 'g', name: 'G', type: 'bedrock',
    model: 'global.anthropic.claude-sonnet-5',
    promptCachingEnabled: true,
    maxTokens: 4096,
} as unknown as LLMProvider;

const TOOLS: ToolDefinition[] = [
    { name: 'read_file', description: 'read', input_schema: { type: 'object', properties: {} } },
];

/** Count cachePoint blocks across all message content arrays. */
function countMessageCachePoints(input: { messages?: Array<{ content?: unknown }> }): number {
    let n = 0;
    for (const m of input.messages ?? []) {
        if (Array.isArray(m.content)) {
            for (const b of m.content) {
                if (b && typeof b === 'object' && 'cachePoint' in b) n++;
            }
        }
    }
    return n;
}

describe('Bedrock history cachePoints (Lever B)', () => {
    it('places a rolling + a stable backoff cachePoint on a long conversation', () => {
        const history: MessageParam[] = [{ role: 'user', content: 'task' }];
        for (let i = 0; i < 8; i++) {
            history.push({ role: 'assistant', content: [{ type: 'tool_use', id: `t${i}`, name: 'read', input: {} }] });
            history.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: `result ${i}` }] });
        }

        const input = prepareBedrockConverseInput(CONFIG, 'SYSTEM', history, TOOLS);
        expect(countMessageCachePoints(input)).toBe(2);
    });

    it('places a single cachePoint when the history is shorter than the backoff', () => {
        const history: MessageParam[] = [
            { role: 'user', content: 'task' },
            { role: 'assistant', content: [{ type: 'tool_use', id: 't0', name: 'read', input: {} }] },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't0', content: 'r' }] },
        ];
        const input = prepareBedrockConverseInput(CONFIG, 'SYSTEM', history, TOOLS);
        // Only the last user message gets one; there is no user message 6 back.
        expect(countMessageCachePoints(input)).toBe(1);
    });
});

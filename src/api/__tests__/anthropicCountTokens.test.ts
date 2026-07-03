import { describe, it, expect, vi } from 'vitest';
import { AnthropicProvider } from '../providers/anthropic';
import type { LLMProvider } from '../../types/settings';

/**
 * IMP-41-01-04 / T5 (ADR-148): opportunistic count_tokens seed.
 *
 * Before the FIRST request of a task the estimator has no calibration and the
 * prompt is at its most uncertain. AnthropicProvider exposes countTokens so
 * AgentTask can seed the chars-per-token factor. Errors are swallowed: the
 * seed is an optimisation, never a blocker.
 */

const CONFIG: LLMProvider = {
    id: 'test-anthropic',
    name: 'Test',
    type: 'anthropic',
    apiKey: 'sk-test',
    model: 'claude-sonnet-5',
} as LLMProvider;

import type { ToolDefinition } from '../../core/tools/types';

const MESSAGES = [{ role: 'user' as const, content: 'hello world' }];
const TOOLS: ToolDefinition[] = [{
    name: 'read_file',
    description: 'Read a file',
    input_schema: { type: 'object' as const, properties: {} },
} as ToolDefinition];

describe('AnthropicProvider.countTokens', () => {
    it('returns the SDK-reported input token count', async () => {
        const provider = new AnthropicProvider(CONFIG);
        const countMock = vi.fn().mockResolvedValue({ input_tokens: 4321 });
        (provider as unknown as { client: { messages: { countTokens: unknown } } })
            .client.messages.countTokens = countMock;

        const result = await provider.countTokens('system prompt', MESSAGES, TOOLS);
        expect(result).toBe(4321);
        expect(countMock).toHaveBeenCalledTimes(1);
        const arg = countMock.mock.calls[0][0];
        expect(arg.model).toBe('claude-sonnet-5');
        expect(Array.isArray(arg.messages)).toBe(true);
        expect(Array.isArray(arg.tools)).toBe(true);
    });

    it('returns undefined when the SDK call fails (silent fallback)', async () => {
        const provider = new AnthropicProvider(CONFIG);
        (provider as unknown as { client: { messages: { countTokens: unknown } } })
            .client.messages.countTokens = vi.fn().mockRejectedValue(new Error('404'));

        await expect(provider.countTokens('system', MESSAGES, TOOLS)).resolves.toBeUndefined();
    });

    it('returns undefined when the bundled SDK lacks countTokens', async () => {
        const provider = new AnthropicProvider(CONFIG);
        (provider as unknown as { client: { messages: { countTokens?: unknown } } })
            .client.messages.countTokens = undefined;

        await expect(provider.countTokens('system', MESSAGES, TOOLS)).resolves.toBeUndefined();
    });
});

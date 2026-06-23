/**
 * FIX-23-09-01 -- handleToolCall must NOT auto-inject buildPrompts() output
 * into MCP tool responses. The system-context prompt is only reachable via
 * the standard MCP prompts/list + prompts/get channel that the user
 * explicitly selects in the client UI.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the systemContext module: if anything calls buildPrompts() through
// the tool-call path, we will see it (and the test will fail).
vi.mock('../../prompts/systemContext', () => ({
    buildPrompts: vi.fn(async () => [{
        role: 'user' as const,
        content: { type: 'text' as const, text: 'SHOULD_NOT_APPEAR_IN_TOOL_RESULT' },
    }]),
}));

// Mock the get_context handler so we don't need a real plugin.
vi.mock('../getContext', () => ({
    handleGetContext: vi.fn(async () => ({
        content: [{ type: 'text' as const, text: 'TOOL_BODY' }],
        isError: false,
    })),
}));

import { handleToolCall } from '../index';
import { buildPrompts } from '../../prompts/systemContext';
import type ObsidianAgentPlugin from '../../../main';

function makePlugin(): ObsidianAgentPlugin {
    return {
        operationLogger: undefined,
        conversationStore: undefined,
        mcpRateLimiter: undefined,
        settings: { mcpServerToken: '' },
        app: { vault: { getMarkdownFiles: () => [] } },
    } as unknown as ObsidianAgentPlugin;
}

describe('handleToolCall: no auto-inject of systemContext (FIX-23-09-01)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns the tool body unmodified on the first tool call of a session', async () => {
        const res = await handleToolCall(makePlugin(), 'get_context', {});
        const text = res.content.map(c => c.text).join('\n');
        expect(text).toBe('TOOL_BODY');
        expect(text).not.toMatch(/SHOULD_NOT_APPEAR_IN_TOOL_RESULT/);
    });

    it('never calls buildPrompts from the tool-call dispatcher', async () => {
        await handleToolCall(makePlugin(), 'get_context', {});
        await handleToolCall(makePlugin(), 'get_context', {});
        expect(buildPrompts).not.toHaveBeenCalled();
    });
});

describe('handleToolCall: rate-limit caller-key ignores source_interface (AUDIT-034 L-9)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uses only the mcpServerToken as the caller key, not args.source_interface', async () => {
        const consume = vi.fn(() => ({ allowed: true, remainingInWindow: 9, limitInWindow: 10 }));
        const plugin = {
            operationLogger: undefined,
            conversationStore: undefined,
            mcpRateLimiter: { consume, check: vi.fn(), record: vi.fn(), size: () => 0, cleanup: vi.fn() },
            settings: { mcpServerToken: 'token-abc' },
            app: { vault: { getMarkdownFiles: () => [] } },
        } as unknown as ObsidianAgentPlugin;

        await handleToolCall(plugin, 'get_context', { source_interface: 'claude-desktop' });
        await handleToolCall(plugin, 'get_context', { source_interface: 'cline' });
        await handleToolCall(plugin, 'get_context', { source_interface: 'attacker-supplied-string' });

        expect(consume).toHaveBeenCalledTimes(3);
        // All three calls must bucket under the same caller key, regardless
        // of the client-supplied source_interface. This is the L-9 fix: an
        // attacker can no longer multiply expensive-class buckets by varying
        // source_interface.
        for (const call of consume.mock.calls as unknown as unknown[][]) {
            expect(call[0]).toBe('token-abc');
        }
    });

    it('falls back to "unauthenticated" when no server token is configured', async () => {
        const consume = vi.fn(() => ({ allowed: true, remainingInWindow: 9, limitInWindow: 10 }));
        const plugin = {
            operationLogger: undefined,
            conversationStore: undefined,
            mcpRateLimiter: { consume, check: vi.fn(), record: vi.fn(), size: () => 0, cleanup: vi.fn() },
            settings: { mcpServerToken: undefined },
            app: { vault: { getMarkdownFiles: () => [] } },
        } as unknown as ObsidianAgentPlugin;

        await handleToolCall(plugin, 'get_context', { source_interface: 'whatever' });

        expect(consume).toHaveBeenCalledWith('unauthenticated', expect.any(String));
    });
});

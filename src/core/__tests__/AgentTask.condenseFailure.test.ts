import { describe, it, expect, vi } from 'vitest';
import { AgentTask } from '../AgentTask';
import type { AgentTaskCallbacks } from '../AgentTask';
import type { ApiHandler, MessageParam } from '../../api/types';
import type { ToolRegistry } from '../tools/ToolRegistry';

/**
 * FIX-COMPACT-02: condenseHistory must signal failure loudly.
 *
 * The previous empty catch silently swallowed helper-api errors
 * (rate-limit, 5xx, transient network). The next iteration triggered
 * the same condense path with the same over-threshold history, looping
 * indefinitely without any user-facing signal. The emergency-condensing
 * path also set emergencyRetried=true even when the inner condense
 * silently failed, so an actual context overflow turned into a hard
 * user-facing API error.
 *
 * Contract:
 *   - condenseHistory returns false when the helper-api call throws.
 *   - The new onContextCondenseFailed callback fires with the Error.
 *   - History stays unchanged (the splice never runs).
 */

const SYSTEM_PROMPT = 'You are a helpful assistant.';

function makeHistory(): MessageParam[] {
    // Each message must be big enough that the 10k-token smart-tail
    // caps after a couple of messages, leaving toSummarize with >= 3
    // entries (otherwise condenseHistory skips early with "too small").
    const bigText = 'x '.repeat(15_000); // ~30k chars per message ~ 7.5k tokens
    const msgs: MessageParam[] = [];
    msgs.push({ role: 'user', content: 'Original task: refactor the auth module.' });
    for (let i = 0; i < 8; i++) {
        msgs.push({ role: 'assistant', content: `assistant turn ${i}: ${bigText}` });
        msgs.push({ role: 'user', content: `user reply ${i}: ${bigText}` });
    }
    return msgs;
}

function makeThrowingApi(error: Error): ApiHandler {
    return {
        getModel: vi.fn(() => ({ id: 'mock-model', info: { contextWindow: 200_000 } })),
        // eslint-disable-next-line require-yield -- generator must throw before yielding
        createMessage: vi.fn(async function* () {
            throw error;
        }),
    } as unknown as ApiHandler;
}

function makeToolRegistry(): ToolRegistry {
    return {
        plugin: {
            getHelperModel: () => null,
            settings: { advancedApi: {} },
        },
    } as unknown as ToolRegistry;
}

describe('AgentTask.condenseHistory failure handling (FIX-COMPACT-02)', () => {
    it('fires onContextCondenseFailed and returns false when the helper API throws', async () => {
        const apiError = new Error('rate_limit_exceeded');
        const api = makeThrowingApi(apiError);
        const toolRegistry = makeToolRegistry();
        const onContextCondenseFailed = vi.fn();
        const onContextCondensed = vi.fn();
        const callbacks: AgentTaskCallbacks = {
            onText: vi.fn(),
            onToolStart: vi.fn(),
            onToolResult: vi.fn(),
            onComplete: vi.fn(),
            onError: vi.fn(),
            onContextCondensed,
            onContextCondenseFailed,
        };

        const task = new AgentTask(api, toolRegistry, callbacks);
        const history = makeHistory();
        const snapshot = JSON.stringify(history);

        // condenseHistory is private; bracket access for the focused test.
        const ok = await (task as unknown as {
            condenseHistory: (h: MessageParam[], sp: string) => Promise<boolean>;
        }).condenseHistory(history, SYSTEM_PROMPT);

        expect(ok).toBe(false);
        expect(onContextCondenseFailed).toHaveBeenCalledTimes(1);
        expect(onContextCondenseFailed.mock.calls[0][0]).toBeInstanceOf(Error);
        expect((onContextCondenseFailed.mock.calls[0][0] as Error).message).toContain('rate_limit_exceeded');
        // History must not have been spliced when the condense call failed
        expect(JSON.stringify(history)).toBe(snapshot);
        // The success callback must NOT have fired
        expect(onContextCondensed).not.toHaveBeenCalled();
    });

    it('returns true on success', async () => {
        const api: ApiHandler = {
            getModel: vi.fn(() => ({ id: 'mock-model', info: { contextWindow: 200_000 } })),
            createMessage: vi.fn(async function* () {
                yield { type: 'text' as const, text: 'compact summary text' };
            }),
        } as unknown as ApiHandler;
        const toolRegistry = makeToolRegistry();
        const onContextCondensed = vi.fn();
        const onContextCondenseFailed = vi.fn();
        const callbacks: AgentTaskCallbacks = {
            onText: vi.fn(),
            onToolStart: vi.fn(),
            onToolResult: vi.fn(),
            onComplete: vi.fn(),
            onError: vi.fn(),
            onContextCondensed,
            onContextCondenseFailed,
        };

        const task = new AgentTask(api, toolRegistry, callbacks);
        const history = makeHistory();
        const ok = await (task as unknown as {
            condenseHistory: (h: MessageParam[], sp: string) => Promise<boolean>;
        }).condenseHistory(history, SYSTEM_PROMPT);

        expect(ok).toBe(true);
        expect(onContextCondensed).toHaveBeenCalledTimes(1);
        expect(onContextCondenseFailed).not.toHaveBeenCalled();
    });
});

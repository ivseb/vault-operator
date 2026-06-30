import { describe, it, expect, vi } from 'vitest';
import { AgentTask, type AgentTaskCallbacks } from '../AgentTask';
import type { ApiHandler, MessageParam } from '../../api/types';
import type { ToolRegistry } from '../tools/ToolRegistry';

/**
 * FIX-COMPACT-06: condenseHistory accepts a maxTailTokens override so
 * the retry loop can halve the tail each pass instead of repeating the
 * same call. Without adaptation a stuck history can trigger the same
 * 10k-tail summary three times and still sit over threshold.
 */

function makeHistory(): MessageParam[] {
    // Each message ~3000 chars ~ 750 tokens so tail size varies meaningfully
    // with maxTailTokens (10k -> ~13 msgs, 2.5k -> ~3 msgs).
    const text = 'x '.repeat(1500);
    const msgs: MessageParam[] = [];
    msgs.push({ role: 'user', content: 'Original task' });
    for (let i = 0; i < 8; i++) {
        msgs.push({ role: 'assistant', content: `assistant ${i}: ${text}` });
        msgs.push({ role: 'user', content: `user ${i}: ${text}` });
    }
    return msgs;
}

function makeApi(): ApiHandler {
    return {
        getModel: vi.fn(() => ({ id: 'mock', info: { contextWindow: 200_000 } })),
        createMessage: vi.fn(async function* () {
            yield { type: 'text' as const, text: 'summary text' };
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

function makeCallbacks(): AgentTaskCallbacks {
    return {
        onText: vi.fn(),
        onToolStart: vi.fn(),
        onToolResult: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onContextCondensed: vi.fn(),
        onContextCondenseFailed: vi.fn(),
    };
}

describe('AgentTask.condenseHistory adaptive tail (FIX-COMPACT-06)', () => {
    it('shrinks the resulting history when maxTailTokens is smaller', async () => {
        const task1 = new AgentTask(makeApi(), makeToolRegistry(), makeCallbacks());
        const task2 = new AgentTask(makeApi(), makeToolRegistry(), makeCallbacks());
        const history1 = makeHistory();
        const history2 = makeHistory();

        type Condense = (
            h: MessageParam[], sp: string, abort?: AbortSignal, ledger?: string, maxTailTokens?: number,
        ) => Promise<boolean>;

        const ok1 = await (task1 as unknown as { condenseHistory: Condense }).condenseHistory(
            history1, 'sp', undefined, undefined, 10_000,
        );
        const ok2 = await (task2 as unknown as { condenseHistory: Condense }).condenseHistory(
            history2, 'sp', undefined, undefined, 2_500,
        );

        expect(ok1).toBe(true);
        expect(ok2).toBe(true);
        // history2 (smaller tail) must end up with strictly fewer messages.
        // Both keep first + summary + marker + tail; the tail is the variable part.
        expect(history2.length).toBeLessThan(history1.length);
        // Sanity: original task message survives at index 0 in both.
        expect(history1[0].content).toContain('Original task');
        expect(history2[0].content).toContain('Original task');
    });

    it('default tail size (no override) matches the historical 10k behaviour', async () => {
        const task = new AgentTask(makeApi(), makeToolRegistry(), makeCallbacks());
        const history = makeHistory();
        const ok = await (task as unknown as {
            condenseHistory: (h: MessageParam[], sp: string) => Promise<boolean>;
        }).condenseHistory(history, 'sp');
        expect(ok).toBe(true);
        // Sanity: structurally unchanged contract (first + summary + marker + tail)
        expect(history.length).toBeGreaterThanOrEqual(4);
        expect(history[0].content).toContain('Original task');
    });
});

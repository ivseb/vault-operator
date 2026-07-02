import { describe, it, expect, vi } from 'vitest';
import { AgentTask, shouldForwardSubtaskUsage, type AgentTaskCallbacks } from '../AgentTask';
import type { ApiHandler, MessageParam } from '../../api/types';
import type { ToolRegistry } from '../tools/ToolRegistry';

/**
 * FIX-24-05-03 + FIX-24-05-04: usage accounting fixes from the 2026-07
 * token-cost audit.
 *
 * FIX-24-05-03: the spawnSubtask onUsage callback both accumulated child
 * tokens into the parent totals AND forwarded them upward. At depth 2 the
 * grandchild tokens ended up twice in the root totals (once via the live
 * forward, once inside the child's final report). Only the root task may
 * forward (to the UI, which does not accumulate).
 *
 * FIX-24-05-04: condensing (and FastPath planner) streams consumed only
 * 'text' chunks, dropping the usage chunk entirely -- those tokens were
 * missing from footer and telemetry.
 */

function makeHistory(): MessageParam[] {
    const big = 'x '.repeat(15_000);
    const msgs: MessageParam[] = [{ role: 'user', content: 'Original task' }];
    for (let i = 0; i < 8; i++) {
        msgs.push({ role: 'assistant', content: `a${i}: ${big}` });
        msgs.push({ role: 'user', content: `u${i}: ${big}` });
    }
    return msgs;
}

function makeApiWithUsage(): ApiHandler {
    return {
        getModel: vi.fn(() => ({ id: 'mock-model', info: { contextWindow: 200_000 } })),
        createMessage: vi.fn(async function* () {
            yield { type: 'text' as const, text: 'summary' };
            yield {
                type: 'usage' as const,
                inputTokens: 12_345,
                outputTokens: 678,
                cacheReadTokens: 90,
                cacheCreationTokens: 12,
            };
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
    };
}

describe('shouldForwardSubtaskUsage (FIX-24-05-03)', () => {
    it('forwards at the root level only', () => {
        expect(shouldForwardSubtaskUsage(0)).toBe(true);
    });

    it('does not forward from intermediate levels (prevents double count)', () => {
        expect(shouldForwardSubtaskUsage(1)).toBe(false);
        expect(shouldForwardSubtaskUsage(2)).toBe(false);
    });
});

describe('condenseHistory usage accounting (FIX-24-05-04)', () => {
    it('accumulates the condensing usage chunk into auxUsage', async () => {
        const task = new AgentTask(makeApiWithUsage(), makeToolRegistry(), makeCallbacks());
        const ok = await (task as unknown as {
            condenseHistory: (h: MessageParam[], sp: string) => Promise<boolean>;
        }).condenseHistory(makeHistory(), 'sp');
        expect(ok).toBe(true);
        const aux = (task as unknown as {
            auxUsage: { input: number; output: number; cacheRead: number; cacheCreation: number };
        }).auxUsage;
        expect(aux.input).toBe(12_345);
        expect(aux.output).toBe(678);
        expect(aux.cacheRead).toBe(90);
        expect(aux.cacheCreation).toBe(12);
    });
});

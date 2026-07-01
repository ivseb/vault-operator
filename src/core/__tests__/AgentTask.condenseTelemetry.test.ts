import { describe, it, expect, vi } from 'vitest';
import { AgentTask, type AgentTaskCallbacks } from '../AgentTask';
import type { ApiHandler, MessageParam } from '../../api/types';
import type { ToolRegistry } from '../tools/ToolRegistry';

/**
 * FIX-COMPACT-07: emit a structured condense-telemetry event per pass.
 *
 * Previously only volatile console.debug + the UI callback ran, so there
 * was no datapoint set for tuning the threshold or spotting helper-api
 * quality regressions. The new callback fires for SUCCESS and FAILURE
 * so the sidebar (and offline analytics) can persist a JSONL row.
 *
 * Contract: every call to condenseHistory ends in exactly one telemetry
 * event (with `success` set), regardless of whether the splice ran or
 * the helper API threw.
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

function makeApi(yieldSummary: string | null, throwErr?: Error): ApiHandler {
    return {
        getModel: vi.fn(() => ({ id: 'mock-model', info: { contextWindow: 200_000 } })),
        createMessage: vi.fn(async function* () {
            if (throwErr) throw throwErr;
            if (yieldSummary !== null) {
                yield { type: 'text' as const, text: yieldSummary };
            }
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

describe('AgentTask condense telemetry (FIX-COMPACT-07)', () => {
    it('fires onCondenseTelemetry with success=true and savedTokens after a real condense', async () => {
        const onCondenseTelemetry = vi.fn();
        const callbacks: AgentTaskCallbacks = {
            onText: vi.fn(),
            onToolStart: vi.fn(),
            onToolResult: vi.fn(),
            onComplete: vi.fn(),
            onError: vi.fn(),
            onCondenseTelemetry,
        };
        const task = new AgentTask(makeApi('summary'), makeToolRegistry(), callbacks);
        const history = makeHistory();
        const ok = await (task as unknown as {
            condenseHistory: (h: MessageParam[], sp: string) => Promise<boolean>;
        }).condenseHistory(history, 'sp');
        expect(ok).toBe(true);
        expect(onCondenseTelemetry).toHaveBeenCalledTimes(1);
        const event = onCondenseTelemetry.mock.calls[0][0] as {
            success: boolean;
            prevTokens: number;
            newTokens: number;
            savedTokens: number;
            durationMs: number;
            helperModelUsed: boolean;
        };
        expect(event.success).toBe(true);
        expect(event.prevTokens).toBeGreaterThan(0);
        expect(event.newTokens).toBeGreaterThan(0);
        expect(event.newTokens).toBeLessThan(event.prevTokens);
        expect(event.savedTokens).toBe(event.prevTokens - event.newTokens);
        expect(event.durationMs).toBeGreaterThanOrEqual(0);
        // No helper model configured (plugin.getHelperModel returns null)
        expect(event.helperModelUsed).toBe(false);
    });

    it('fires onCondenseTelemetry with success=false and error when the helper API throws', async () => {
        const onCondenseTelemetry = vi.fn();
        const callbacks: AgentTaskCallbacks = {
            onText: vi.fn(),
            onToolStart: vi.fn(),
            onToolResult: vi.fn(),
            onComplete: vi.fn(),
            onError: vi.fn(),
            onCondenseTelemetry,
        };
        const task = new AgentTask(
            makeApi(null, new Error('rate_limit')),
            makeToolRegistry(),
            callbacks,
        );
        const history = makeHistory();
        const ok = await (task as unknown as {
            condenseHistory: (h: MessageParam[], sp: string) => Promise<boolean>;
        }).condenseHistory(history, 'sp');
        expect(ok).toBe(false);
        expect(onCondenseTelemetry).toHaveBeenCalledTimes(1);
        const event = onCondenseTelemetry.mock.calls[0][0] as {
            success: boolean;
            errorMessage?: string;
        };
        expect(event.success).toBe(false);
        expect(event.errorMessage).toContain('rate_limit');
    });

    it('does NOT fire telemetry for short histories (early return)', async () => {
        const onCondenseTelemetry = vi.fn();
        const callbacks: AgentTaskCallbacks = {
            onText: vi.fn(),
            onToolStart: vi.fn(),
            onToolResult: vi.fn(),
            onComplete: vi.fn(),
            onError: vi.fn(),
            onCondenseTelemetry,
        };
        const task = new AgentTask(makeApi('summary'), makeToolRegistry(), callbacks);
        // Below the 7-message threshold
        const tinyHistory: MessageParam[] = [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'hello' },
        ];
        const ok = await (task as unknown as {
            condenseHistory: (h: MessageParam[], sp: string) => Promise<boolean>;
        }).condenseHistory(tinyHistory, 'sp');
        expect(ok).toBe(false);
        // Telemetry only fires when the condense actually engaged
        expect(onCondenseTelemetry).not.toHaveBeenCalled();
    });
});

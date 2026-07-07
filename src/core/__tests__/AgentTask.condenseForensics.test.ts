/**
 * IMP-41-03-04 safe subset: the condense forensics MessageLog records a
 * generation BEFORE and AFTER every splice, so getCondenseTimeline()
 * exposes before/after pairs -- the diagnosis case ADR-149 targets
 * ("what did condensing eat?") without any live-history ownership.
 */

import { describe, it, expect, vi } from 'vitest';
import { AgentTask, type AgentTaskCallbacks } from '../AgentTask';
import type { ApiHandler, MessageParam } from '../../api/types';
import type { ToolRegistry } from '../tools/ToolRegistry';

function makeHistory(): MessageParam[] {
    const big = 'x '.repeat(15_000);
    const msgs: MessageParam[] = [{ role: 'user', content: 'Original task' }];
    for (let i = 0; i < 8; i++) {
        msgs.push({ role: 'assistant', content: `a${i}: ${big}` });
        msgs.push({ role: 'user', content: `u${i}: ${big}` });
    }
    return msgs;
}

function makeApi(yieldSummary: string): ApiHandler {
    return {
        getModel: vi.fn(() => ({ id: 'mock-model', info: { contextWindow: 200_000 } })),
        createMessage: vi.fn(async function* () {
            yield { type: 'text' as const, text: yieldSummary };
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

describe('AgentTask condense forensics (IMP-41-03-04 safe subset)', () => {
    it('records a pre/post generation pair per successful condense pass', async () => {
        const task = new AgentTask(makeApi('summary'), makeToolRegistry(), makeCallbacks());
        const history = makeHistory();
        const preCount = history.length;

        const ok = await (task as unknown as {
            condenseHistory: (h: MessageParam[], sp: string) => Promise<boolean>;
        }).condenseHistory(history, 'sp');

        expect(ok).toBe(true);
        const { generations } = task.getCondenseTimeline();
        expect(generations).toHaveLength(2);
        expect(generations[0].label).toMatch(/^pre-condense /);
        expect(generations[1].label).toMatch(/^post-condense /);
        // The pre snapshot holds the original volume, the post snapshot the
        // condensed rewrite (first msg + summary + continuation + tail).
        expect(generations[0].messages).toHaveLength(preCount);
        expect(generations[1].messages).toHaveLength(history.length);
        expect(generations[1].messages.length).toBeLessThan(preCount);
        // Labels carry the message counts for at-a-glance diffing.
        expect(generations[0].label).toContain(`(${preCount} msgs`);
        expect(generations[1].label).toContain(`(${history.length} msgs`);
    });

    it('records nothing when the condense pass fails (empty summary)', async () => {
        const task = new AgentTask(
            {
                getModel: vi.fn(() => ({ id: 'mock-model', info: { contextWindow: 200_000 } })),
                createMessage: vi.fn(async function* () {
                    yield { type: 'text' as const, text: '   ' };
                }),
            } as unknown as ApiHandler,
            makeToolRegistry(),
            makeCallbacks(),
        );
        const history = makeHistory();

        const ok = await (task as unknown as {
            condenseHistory: (h: MessageParam[], sp: string) => Promise<boolean>;
        }).condenseHistory(history, 'sp');

        expect(ok).toBe(false);
        expect(task.getCondenseTimeline().generations).toHaveLength(0);
    });
});

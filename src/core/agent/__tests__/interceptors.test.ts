import { describe, it, expect } from 'vitest';
import { TodoAnchorInterceptor } from '../interceptors/TodoAnchorInterceptor';
import { PowerSteeringInterceptor } from '../interceptors/PowerSteeringInterceptor';
import { AdvisorReminderInterceptor } from '../interceptors/AdvisorReminderInterceptor';
import { createInitialLoopState } from '../LoopState';
import type { MessageParam } from '../../../api/types';
import type { LoopInterceptorContext } from '../interceptors/types';

/**
 * IMP-41-02-01c / ADR-145: cross-cutting concerns as interceptors with
 * behaviour identical to the inline blocks they replace.
 */

const MODE = { name: 'Agent', slug: 'agent', roleDefinition: 'You are the agent.' };

function ctx(iteration: number, history: MessageParam[] = []): LoopInterceptorContext {
    const state = createInitialLoopState();
    state.iteration = iteration;
    return { state, history, activeMode: MODE };
}

describe('TodoAnchorInterceptor', () => {
    it('formats todo updates like the legacy callback wrapper', () => {
        const anchor = new TodoAnchorInterceptor();
        anchor.noteTodoUpdate([
            { text: 'read files', status: 'done' },
            { text: 'write summary', status: 'in_progress' },
            { text: 'verify', status: 'open' },
        ]);
        expect(anchor.getAnchorText()).toBe(
            '[Current Task Plan]\n- [x] read files\n- [~] write summary\n- [ ] verify',
        );
    });

    it('appends the anchor to the last plain user message without mutating the input', () => {
        const anchor = new TodoAnchorInterceptor();
        anchor.noteTodoUpdate([{ text: 'a', status: 'open' }]);
        const safeHistory: MessageParam[] = [
            { role: 'user', content: 'task' },
            { role: 'assistant', content: 'working' },
            { role: 'user', content: 'continue' },
        ];
        const snapshot = JSON.stringify(safeHistory);
        const out = anchor.transformRequestHistory(safeHistory, ctx(2));
        expect(JSON.stringify(safeHistory)).toBe(snapshot); // input untouched
        expect(out[2].content).toContain('continue\n\n[Current Task Plan]');
    });

    it('anchors on the last user message even when it is tool_result array content (recency zone, not the front string)', () => {
        // The agentic case: every user turn after the first is a tool_result
        // (array content); the only string user message is msg#0 at the FRONT.
        // Appending there (the old behaviour) changed the cache prefix every
        // turn -> full cacheCreate. The anchor must land on the LAST message.
        const anchor = new TodoAnchorInterceptor();
        anchor.noteTodoUpdate([{ text: 'a', status: 'open' }]);
        const safeHistory: MessageParam[] = [
            { role: 'user', content: 'task' },
            { role: 'assistant', content: [{ type: 'tool_use', id: '1', name: 'read', input: {} }] },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: '1', content: 'file contents' }] },
        ];
        const out = anchor.transformRequestHistory(safeHistory, ctx(2));

        // The front string message (the stable cache prefix) is untouched.
        expect(out[0].content).toBe('task');
        // The anchor rides on the LAST user message, as a text block.
        const last = out[2].content as Array<{ type: string; text?: string }>;
        expect(Array.isArray(last)).toBe(true);
        const texts = last.filter((b) => b.type === 'text').map((b) => b.text).join('');
        expect(texts).toContain('[Current Task Plan]');
    });

    it('does not anchor on iteration 0 or when no todos exist', () => {
        const anchor = new TodoAnchorInterceptor();
        const history: MessageParam[] = [{ role: 'user', content: 'task' }];
        expect(anchor.transformRequestHistory(history, ctx(2))).toBe(history); // no todos
        anchor.noteTodoUpdate([{ text: 'a', status: 'open' }]);
        expect(anchor.transformRequestHistory(history, ctx(0))).toBe(history); // iteration 0
    });

    it('clears the anchor when todos empty out', () => {
        const anchor = new TodoAnchorInterceptor();
        anchor.noteTodoUpdate([{ text: 'a', status: 'open' }]);
        anchor.noteTodoUpdate([]);
        expect(anchor.getAnchorText()).toBe('');
    });
});

describe('PowerSteeringInterceptor', () => {
    it('injects the reminder every Nth iteration', () => {
        const steering = new PowerSteeringInterceptor(3);
        const history: MessageParam[] = [];
        steering.onIterationStart(ctx(3, history));
        expect(history).toHaveLength(1);
        expect(String(history[0].content)).toContain('[Power Steering Reminder]');
        expect(String(history[0].content)).toContain('**Agent** mode');
    });

    it('skips iteration 0 and non-multiples', () => {
        const steering = new PowerSteeringInterceptor(3);
        for (const i of [0, 1, 2, 4, 5]) {
            const history: MessageParam[] = [];
            steering.onIterationStart(ctx(i, history));
            expect(history).toHaveLength(0);
        }
    });

    it('is disabled at frequency 0', () => {
        const steering = new PowerSteeringInterceptor(0);
        const history: MessageParam[] = [];
        steering.onIterationStart(ctx(6, history));
        expect(history).toHaveLength(0);
    });

    it('dedupes a back-to-back identical reminder (FIX-PERF-24)', () => {
        const steering = new PowerSteeringInterceptor(3);
        const history: MessageParam[] = [];
        steering.onIterationStart(ctx(3, history));
        steering.onIterationStart(ctx(3, history)); // same iteration replay
        expect(history).toHaveLength(1);
    });
});

describe('AdvisorReminderInterceptor', () => {
    /** ctx variant that carries an explicit mistake counter. */
    function mistakeCtx(consecutiveMistakes: number): LoopInterceptorContext {
        const state = createInitialLoopState();
        state.consecutiveMistakes = consecutiveMistakes;
        return { state, history: [], activeMode: MODE };
    }

    it('invalidates the cache on the off->on transition at the 2-mistake threshold', () => {
        const advisor = new AdvisorReminderInterceptor();
        const below = mistakeCtx(1);
        advisor.onIterationStart(below);
        expect(below.state.cacheInvalidated).toBe(false); // still off, no transition

        const crossed = mistakeCtx(2);
        advisor.onIterationStart(crossed);
        expect(crossed.state.cacheInvalidated).toBe(true); // off->on fires once
    });

    it('does not re-invalidate while the reminder stays active (no per-iteration churn)', () => {
        const advisor = new AdvisorReminderInterceptor();
        advisor.onIterationStart(mistakeCtx(2)); // off->on

        const stillActive = mistakeCtx(3);
        advisor.onIterationStart(stillActive);
        expect(stillActive.state.cacheInvalidated).toBe(false); // on->on, no re-render
    });

    it('invalidates again on the on->off transition when the mistake counter resets', () => {
        const advisor = new AdvisorReminderInterceptor();
        advisor.onIterationStart(mistakeCtx(2)); // off->on

        const recovered = mistakeCtx(0);
        advisor.onIterationStart(recovered);
        expect(recovered.state.cacheInvalidated).toBe(true); // on->off drops the hint
    });

    it('stays inert while consistently below the threshold', () => {
        const advisor = new AdvisorReminderInterceptor();
        for (const m of [0, 1, 0, 1]) {
            const c = mistakeCtx(m);
            advisor.onIterationStart(c);
            expect(c.state.cacheInvalidated).toBe(false);
        }
    });
});

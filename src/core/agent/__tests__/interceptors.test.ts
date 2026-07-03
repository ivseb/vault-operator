import { describe, it, expect } from 'vitest';
import { TodoAnchorInterceptor } from '../interceptors/TodoAnchorInterceptor';
import { PowerSteeringInterceptor } from '../interceptors/PowerSteeringInterceptor';
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

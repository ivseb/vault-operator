import { describe, it, expect } from 'vitest';
import { createInitialLoopState } from '../LoopState';

/**
 * IMP-41-02-01a / ADR-145: the loop state must be JSON-serializable —
 * that is the precondition for task resume (IMP-41-03-01) and the
 * engine extraction.
 */

describe('AgentLoopState', () => {
    it('round-trips through JSON without loss', () => {
        const state = createInitialLoopState({ fastPathFired: true });
        state.iteration = 7;
        state.consecutiveMistakes = 2;
        state.completionResult = 'done';
        state.pendingModeSwitch = 'architect';
        state.phase = 'executing-tools';

        const revived = JSON.parse(JSON.stringify(state)) as typeof state;
        expect(revived).toEqual(state);
    });

    it('starts with legacy-identical defaults', () => {
        const state = createInitialLoopState();
        expect(state.completionResult).toBeNull();
        expect(state.consecutiveMistakes).toBe(0);
        expect(state.stigmergyOutcome).toBe('abandon');
        expect(state.emergencyRetried).toBe(false);
        expect(state.fastPathFired).toBe(false);
        expect(state.totalInputTokens).toBe(0);
    });

    it('contains no non-serializable members', () => {
        const state = createInitialLoopState();
        for (const [key, value] of Object.entries(state)) {
            expect(
                ['string', 'number', 'boolean'].includes(typeof value) || value === null,
                `field ${key} must be a JSON primitive`,
            ).toBe(true);
        }
    });
});

import { describe, it, expect } from 'vitest';
import { createInitialLoopState, initLoopStateForRun } from '../LoopState';

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
        expect(state.turnOutcome).toBe('abandon');
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

describe('initLoopStateForRun (IMP-41-03-01 resume)', () => {
    it('starts fresh without a resume state', () => {
        const state = initLoopStateForRun();
        expect(state.iteration).toBe(0);
        expect(state.phase).toBe('preamble');
        expect(state.totalInputTokens).toBe(0);
    });

    it('resumes AFTER the snapshotted iteration with budgets intact', () => {
        const snapshot = createInitialLoopState();
        snapshot.iteration = 4;
        snapshot.phase = 'executing-tools';
        snapshot.consecutiveMistakes = 1;
        snapshot.advisorCallsUsed = 2;
        snapshot.totalInputTokens = 12_345;
        snapshot.rateLimitRetries = 1;

        const state = initLoopStateForRun(snapshot);
        // Snapshot is taken AFTER the tool-results push, so the iteration
        // completed -- resume continues with the NEXT one.
        expect(state.iteration).toBe(5);
        expect(state.phase).toBe('preamble');
        // Budgets and usage carry over (no double-billing, no budget reset).
        expect(state.consecutiveMistakes).toBe(1);
        expect(state.advisorCallsUsed).toBe(2);
        expect(state.totalInputTokens).toBe(12_345);
        expect(state.rateLimitRetries).toBe(1);
    });

    it('does not mutate the snapshot it resumes from', () => {
        const snapshot = createInitialLoopState();
        snapshot.iteration = 2;
        const frozen = JSON.stringify(snapshot);
        const state = initLoopStateForRun(snapshot);
        state.iteration = 99;
        expect(JSON.stringify(snapshot)).toBe(frozen);
    });

    it('clears transient completion flags on resume', () => {
        const snapshot = createInitialLoopState();
        snapshot.iteration = 3;
        snapshot.hasStreamedText = true;
        snapshot.hasRetriedEmpty = true;
        const state = initLoopStateForRun(snapshot);
        // Per-turn stream flags reset; a resumed run streams its own turns.
        expect(state.hasStreamedText).toBe(false);
        expect(state.hasRetriedEmpty).toBe(false);
    });
});

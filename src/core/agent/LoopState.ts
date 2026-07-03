/**
 * Explicit, serializable agent-loop state (IMP-41-02-01a, ADR-145).
 *
 * AgentTask.run() held its runtime state in ~20 closure variables scattered
 * across an 1800-line function — unserializable (blocks task resume,
 * IMP-41-03-01), untestable in isolation, and invisible when debugging a
 * stuck loop. This object replaces them 1:1. Field semantics and reset
 * points are IDENTICAL to the closure variables they replace; the engine
 * extraction (IMP-41-02-01b) then moves ownership into AgentLoopEngine.
 *
 * Everything here must stay JSON-serializable: no functions, no class
 * instances, no AbortSignal/Map/Set.
 */

export type LoopPhase =
    | 'preamble'
    | 'streaming'
    | 'executing-tools'
    | 'condensing'
    | 'completing'
    | 'done'
    | 'aborted'
    | 'failed';

export interface AgentLoopState {
    /** Coarse phase for diagnostics and (W3) resume. */
    phase: LoopPhase;
    /** Current iteration of the inner for-loop (0-based). */
    iteration: number;

    // --- exit / completion ---
    /** Set by attempt_completion; non-null ends the loop after the turn. */
    completionResult: string | null;
    attemptCompletionFired: boolean;
    /** True when a FastPath recipe pre-ran before the loop. */
    fastPathFired: boolean;
    /** Natural end without cap/error (Stigmergy outcome grading). */
    cleanNaturalExit: boolean;
    /** Substrate outcome, resolved at the return sites. */
    stigmergyOutcome: 'accept' | 'abandon';

    // --- guards / budgets ---
    consecutiveMistakes: number;
    totalToolErrors: number;
    /** Loop-level transient-error retries used (rate-limit/5xx/network). */
    rateLimitRetries: number;
    emergencyRetried: boolean;
    advisorCallsUsed: number;

    // --- stream / reply bookkeeping ---
    hasStreamedText: boolean;
    hasRetriedEmpty: boolean;

    // --- mode / prompt-cache ---
    pendingModeSwitch: string | null;
    cacheInvalidated: boolean;
    recentPluginSkillUsage: boolean;

    // --- telemetry / usage totals ---
    telemetryIterations: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    totalCacheCreationTokens: number;
}

export function createInitialLoopState(opts: { fastPathFired?: boolean } = {}): AgentLoopState {
    return {
        phase: 'preamble',
        iteration: 0,
        completionResult: null,
        attemptCompletionFired: false,
        fastPathFired: opts.fastPathFired ?? false,
        cleanNaturalExit: false,
        stigmergyOutcome: 'abandon',
        consecutiveMistakes: 0,
        totalToolErrors: 0,
        rateLimitRetries: 0,
        emergencyRetried: false,
        advisorCallsUsed: 0,
        hasStreamedText: false,
        hasRetriedEmpty: false,
        pendingModeSwitch: null,
        cacheInvalidated: false,
        recentPluginSkillUsage: false,
        telemetryIterations: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheCreationTokens: 0,
    };
}

/**
 * Loop interceptor contract (IMP-41-02-01c, ADR-145).
 *
 * Cross-cutting concerns hook into the loop through this interface instead
 * of growing inline in AgentTask.run(). Registration order = execution
 * order; interceptors read/write ONLY the serializable state and their own
 * constructor ports (never closure variables of run()).
 *
 * Migration status (stage-wise per ADR-145):
 *   - TodoAnchorInterceptor      migrated (removes the onTodoUpdate
 *                                callback mutation, IMP-41-02-01 SC)
 *   - PowerSteeringInterceptor   migrated
 *   - FastPath / Advisor / Stigmergy / RouterEscalation follow with engine
 *     extraction stages 2+3 (they need hooks that do not exist yet).
 */

import type { MessageParam } from '../../../api/types';
import type { AgentLoopState } from '../LoopState';

export interface LoopInterceptorContext {
    state: AgentLoopState;
    /** Live conversation history. Appending at iteration start is allowed. */
    history: MessageParam[];
    activeMode: { name: string; slug: string; roleDefinition: string };
}

export interface LoopInterceptor {
    readonly name: string;
    /** Runs at the top of every iteration, before prompt assembly. */
    onIterationStart?(ctx: LoopInterceptorContext): void;
    /**
     * Transform the sanitized per-request history (recency anchors etc.).
     * Must not mutate the input array; return it unchanged or a copy.
     */
    transformRequestHistory?(safeHistory: MessageParam[], ctx: LoopInterceptorContext): MessageParam[];
}

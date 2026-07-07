/**
 * Todo recency anchor as a loop interceptor (IMP-41-02-01c; ADR-061 for the
 * anchor semantics, FIX-PERF-22 for the safeHistory-only application).
 *
 * Replaces the in-run() monkey-patch of taskCallbacks.onTodoUpdate — the one
 * place the loop mutated the caller's callback object. AgentTask now feeds
 * todo updates in explicitly via noteTodoUpdate(); the caller's callbacks
 * are never touched.
 */

import type { MessageParam } from '../../../api/types';
import type { LoopInterceptor, LoopInterceptorContext } from './types';

interface TodoItem {
    text: string;
    /** Known values: 'open', 'in_progress', 'done'; free-form strings pass through. */
    status: string;
}

export class TodoAnchorInterceptor implements LoopInterceptor {
    readonly name = 'todo-anchor';
    private currentTodoText = '';

    /** Called by the tools' updateTodos path; formats the recency anchor. */
    noteTodoUpdate(items: TodoItem[]): void {
        if (items.length > 0) {
            this.currentTodoText = '[Current Task Plan]\n' + items.map((i) => {
                const marker = i.status === 'done' ? 'x' : i.status === 'in_progress' ? '~' : ' ';
                return `- [${marker}] ${i.text}`;
            }).join('\n');
        } else {
            this.currentTodoText = '';
        }
    }

    getAnchorText(): string {
        return this.currentTodoText;
    }

    /**
     * FIX-PERF-22: append the anchor to the LAST plain-text user message of
     * the sanitized request history only — the live history stays unmutated,
     * so a mid-stream throw never leaves the todo glued onto the transcript.
     * Skipped on iteration 0 (the fresh user message IS the focus).
     */
    transformRequestHistory(safeHistory: MessageParam[], ctx: LoopInterceptorContext): MessageParam[] {
        if (!this.currentTodoText || ctx.state.iteration === 0) return safeHistory;
        for (let h = safeHistory.length - 1; h >= 0; h--) {
            const m = safeHistory[h];
            if (m.role === 'user' && typeof m.content === 'string') {
                const copy = safeHistory.slice();
                copy[h] = { ...m, content: `${m.content}\n\n${this.currentTodoText}` };
                return copy;
            }
        }
        return safeHistory;
    }
}

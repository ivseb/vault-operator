/**
 * MemoryV2Telemetry -- jsonl logger for the v2 hot-path.
 *
 * Logs four event categories that operators / Sebastian want visibility on:
 *   - cache       prompt-cache hit ratio per turn (Anthropic cache_read_tokens)
 *   - retrieval   p50/p95 latency of ContextComposer + recall_memory
 *   - drift       topic-drift events emitted by ContextComposer
 *   - recall      recall_memory tool calls (query, result count)
 *
 * Output: append-only JSONL at `<plugin-data-dir>/logs/memory-v2/{YYYY-MM-DD}.jsonl`.
 * Reads via the existing `read_agent_logs` tool, so the agent can answer
 * "how often did my topic drift this week" without a separate dashboard.
 *
 * Constructor-Injection only -- no obsidian. The transport is a single
 * append callback so tests can inject in-memory and the host wires the
 * actual filesystem.
 *
 * FEATURE-0317 / PLAN-006 task 13.
 */

export type MemoryV2TelemetryKind = 'cache' | 'retrieval' | 'drift' | 'recall';

export interface MemoryV2TelemetryEvent {
    kind: MemoryV2TelemetryKind;
    /** ISO timestamp; defaulted by `record()` when omitted. */
    timestamp?: string;
    payload: Record<string, unknown>;
}

export type AppendLineFn = (relativePath: string, line: string) => Promise<void>;

export class MemoryV2Telemetry {
    constructor(private readonly appendLine: AppendLineFn) {}

    async record(event: MemoryV2TelemetryEvent): Promise<void> {
        const ts = event.timestamp ?? new Date().toISOString();
        const day = ts.slice(0, 10); // YYYY-MM-DD
        const path = `logs/memory-v2/${day}.jsonl`;
        const line = JSON.stringify({ kind: event.kind, ts, ...event.payload }) + '\n';
        try {
            await this.appendLine(path, line);
        } catch (e) {
            console.debug('[MemoryV2Telemetry] append failed (non-fatal):', e);
        }
    }

    /** Convenience helpers so callers stay terse. */
    async cache(payload: { cacheReadTokens: number; totalInputTokens: number; sessionId?: string }) {
        return this.record({ kind: 'cache', payload });
    }
    async retrieval(payload: { stage: string; durationMs: number; hits?: number; sessionId?: string }) {
        return this.record({ kind: 'retrieval', payload });
    }
    async drift(payload: { previousTopic: string; newTopic: string | null; score: number; sessionId?: string }) {
        return this.record({ kind: 'drift', payload });
    }
    async recall(payload: { query: string; topK: number; hits: number; multiHop: boolean }) {
        return this.record({ kind: 'recall', payload });
    }
}

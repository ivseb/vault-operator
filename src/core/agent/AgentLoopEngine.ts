/**
 * AgentLoopEngine (IMP-41-02-01b, ADR-145) — extraction stage 1.
 *
 * Owns the stream-consume phase of the agent loop: classifying provider
 * chunks into text, thinking segments, tool uses, tool errors and usage,
 * with the exact side-effect order the inline loop had. No Obsidian types;
 * UI feedback goes through the StreamPorts callbacks, durable state through
 * the serializable AgentLoopState.
 *
 * Extraction roadmap (ADR-145 "migration in steps, each step green"):
 *   stage 1 (this): stream consume            <- AgentTask delegates here
 *   stage 2: iteration preamble + exit checks  (with interceptor hooks)
 *   stage 3: tool batch execution + condense trigger
 * Each stage moves ownership without behaviour change; the full test suite
 * is the parity gate per stage.
 */

import type { ApiStreamChunk, ContentBlock } from '../../api/types';
import type { AgentLoopState } from './LoopState';
import { ThinkingSegmentCollector } from './thinkingSegments';

/** UI/host feedback ports for one streamed turn. */
export interface StreamPorts {
    onText(text: string): void;
    onThinking(text: string): void;
    onToolStart(name: string, input: Record<string, unknown>): void;
    /** Fired for tool_error chunks (isError=true), mirroring the legacy loop. */
    onToolResult(name: string, content: string, isError: boolean): void;
    /** Raw usage numbers of this turn (state totals are updated by the engine). */
    onUsage(inputTokens: number, outputTokens: number, cacheRead: number, cacheCreation: number): void;
}

/** Classified result of one streamed assistant turn. */
export interface StreamTurnResult {
    textParts: string[];
    thinking: ThinkingSegmentCollector;
    toolUses: Array<Extract<ContentBlock, { type: 'tool_use' }>>;
    /** tool_use id -> actionable provider error (truncated JSON etc.). */
    toolErrors: Map<string, string>;
}

export class AgentLoopEngine {
    /**
     * Consume one provider stream. Mutates `state` exactly like the inline
     * loop did: hasStreamedText on first text, mistake counters on
     * tool_error, usage totals on the usage chunk. Mid-stream throws
     * propagate to the caller (the loop-level error policy owns them).
     */
    async consumeStream(
        stream: AsyncIterable<ApiStreamChunk>,
        state: AgentLoopState,
        ports: StreamPorts,
    ): Promise<StreamTurnResult> {
        state.phase = 'streaming';
        const result: StreamTurnResult = {
            textParts: [],
            thinking: new ThinkingSegmentCollector(),
            toolUses: [],
            toolErrors: new Map(),
        };

        for await (const chunk of stream) {
            if (chunk.type === 'thinking') {
                ports.onThinking(chunk.text);
                if (chunk.requiresPassback) result.thinking.push(chunk.text);
            } else if (chunk.type === 'thinking_signature') {
                result.thinking.seal(chunk.signature);
            } else if (chunk.type === 'text') {
                state.hasStreamedText = true;
                result.textParts.push(chunk.text);
                ports.onText(chunk.text);
            } else if (chunk.type === 'tool_use') {
                result.toolUses.push({
                    type: 'tool_use',
                    id: chunk.id,
                    name: chunk.name,
                    input: chunk.input,
                });
                ports.onToolStart(chunk.name, chunk.input);
            } else if (chunk.type === 'tool_error') {
                // BUG-3 / BUG-032: unparseable or truncated tool JSON — record
                // in history, skip execution, and count it as a mistake so a
                // repeated broken write trips consecutiveMistakeLimit instead
                // of looping until the context overflows.
                result.toolErrors.set(chunk.id, chunk.error);
                result.toolUses.push({ type: 'tool_use', id: chunk.id, name: chunk.name, input: {} });
                ports.onToolStart(chunk.name, {});
                ports.onToolResult(chunk.name, chunk.error, true);
                state.consecutiveMistakes++;
                state.totalToolErrors++;
            } else if (chunk.type === 'usage') {
                state.totalInputTokens += chunk.inputTokens;
                state.totalOutputTokens += chunk.outputTokens;
                state.totalCacheReadTokens += chunk.cacheReadTokens ?? 0;
                state.totalCacheCreationTokens += chunk.cacheCreationTokens ?? 0;
                ports.onUsage(
                    chunk.inputTokens,
                    chunk.outputTokens,
                    chunk.cacheReadTokens ?? 0,
                    chunk.cacheCreationTokens ?? 0,
                );
            }
        }
        return result;
    }
}

/**
 * FastPathExecutor — ADR-061: Recipe-based Batch Execution
 *
 * When a learned recipe matches the user's intent, executes the tool
 * steps as a batch instead of iterating through the ReAct loop.
 * Reduces LLM iterations from 8 to 2-3 for known task patterns.
 *
 * Flow:
 *   1. Planner Call: LLM fills recipe steps with concrete parameters
 *   2. Batch Execution: Tools run via ToolExecutionPipeline (full governance)
 *   3. History Prep: Results injected into history for the normal loop
 *   4. Normal loop takes over for presentation/completion (1-2 iterations)
 *
 * Design principles (Manus Context Engineering):
 * - Tool list NEVER changes (no filtering, no tool_choice)
 * - History is append-only (batch results are appended)
 * - Externalization disabled during batch (Presenter needs full content)
 * - Fallback to normal loop on any error
 */

import type { ApiHandler, MessageParam } from '../api/types';
import type { ToolExecutionPipeline } from './tool-execution/ToolExecutionPipeline';
import type { ProceduralRecipe } from './mastery/types';
import type { ToolCallbacks, ToolName, ToolDefinition } from './tools/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlannedToolCall {
    tool: string;
    input: Record<string, unknown>;
}

export interface FastPathResult {
    /** Whether fast path executed successfully */
    success: boolean;
    /** History entries to prepend before the normal loop */
    historyEntries: MessageParam[];
    /** Number of tool calls executed */
    toolCallsExecuted: number;
}

// ---------------------------------------------------------------------------
// Planner Prompt
// ---------------------------------------------------------------------------

const PLANNER_INSTRUCTION = `You have a proven recipe for this task. Your job is to fill in the concrete parameters.

RECIPE STEPS:
{STEPS}

USER REQUEST:
{USER_MESSAGE}

Output ONLY a valid JSON array of tool calls. No markdown, no explanation.
Each element: {"tool": "tool_name", "input": {parameter_object}}

Rules:
- Use the exact tool names from the recipe steps
- Fill in realistic parameters based on the user's request
- For search tools: extract the topic/keywords from the user's message
- For read_file: use paths that the search will likely return (or leave for the loop)
- For write_file: generate a reasonable filename based on the topic
- Keep it simple — the normal loop will handle refinement after the batch
- If a step is conditional, include it only if it seems necessary

Example output:
[
  {"tool": "semantic_search", "input": {"query": "Kant philosophy ethics"}},
  {"tool": "write_file", "input": {"path": "Notes/Kant Summary.md", "content": "..."}}
]`;

// ---------------------------------------------------------------------------
// FastPathExecutor
// ---------------------------------------------------------------------------

export class FastPathExecutor {
    constructor(
        private api: ApiHandler,
        private pipeline: ToolExecutionPipeline,
    ) {}

    /**
     * Attempt fast path execution for a matched recipe.
     *
     * @param recipe - The matched recipe with tool steps
     * @param userMessage - The user's original message
     * @param systemPrompt - The cached system prompt (reused, not rebuilt)
     * @param callbacks - Tool execution callbacks (for UI updates)
     * @param abortSignal - Cancellation signal
     * @returns FastPathResult with history entries, or success=false on failure
     */
    async execute(
        recipe: ProceduralRecipe,
        userMessage: string,
        systemPrompt: string,
        callbacks: ToolCallbacks,
        abortSignal?: AbortSignal,
        tools?: ToolDefinition[],
    ): Promise<FastPathResult> {
        const failed: FastPathResult = { success: false, historyEntries: [], toolCallsExecuted: 0 };

        try {
            console.debug(`[FastPath] Starting for recipe: ${recipe.name} (${recipe.steps.length} steps)`);

            // 1. Planner Call: LLM fills recipe steps with concrete parameters
            const plannedCalls = await this.plannerCall(recipe, userMessage, systemPrompt, abortSignal, tools);
            if (!plannedCalls || plannedCalls.length === 0) {
                console.debug('[FastPath] Planner returned no tool calls, falling back to normal loop');
                return failed;
            }

            console.debug(`[FastPath] Planner generated ${plannedCalls.length} tool calls`);

            // 2. Disable externalization during batch (Presenter needs full content — ADR-061)
            const externalizer = this.pipeline.getExternalizer();
            externalizer?.disable();

            // 3. Batch Execution via Pipeline (full governance)
            const results: Array<{ tool: string; input: Record<string, unknown>; content: string; isError: boolean }> = [];
            let toolCallsExecuted = 0;

            // Separate read-safe and write tools for parallel execution
            const readCalls = plannedCalls.filter((c) => this.isReadSafe(c.tool));
            const writeCalls = plannedCalls.filter((c) => !this.isReadSafe(c.tool));

            // Execute read-safe tools in parallel
            if (readCalls.length > 0) {
                const readResults = await Promise.all(
                    readCalls.map(async (call) => {
                        const toolUseId = `fp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                        const result = await this.pipeline.executeTool(
                            { type: 'tool_use', id: toolUseId, name: call.tool as ToolName, input: call.input },
                            callbacks,
                        );
                        toolCallsExecuted++;
                        const content = typeof result.content === 'string'
                            ? result.content
                            : (result.content as Array<{ type: string; text?: string }>)
                                .filter((b) => b.type === 'text')
                                .map((b) => b.text ?? '')
                                .join('\n');
                        return { tool: call.tool, input: call.input, content, isError: result.is_error ?? false };
                    }),
                );
                results.push(...readResults);
            }

            // Execute write tools sequentially
            for (const call of writeCalls) {
                if (abortSignal?.aborted) break;
                const toolUseId = `fp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                const result = await this.pipeline.executeTool(
                    { type: 'tool_use', id: toolUseId, name: call.tool as ToolName, input: call.input },
                    callbacks,
                );
                toolCallsExecuted++;
                const content = typeof result.content === 'string'
                    ? result.content
                    : (result.content as Array<{ type: string; text?: string }>)
                        .filter((b) => b.type === 'text')
                        .map((b) => b.text ?? '')
                        .join('\n');
                results.push({ tool: call.tool, input: call.input, content, isError: result.is_error ?? false });
            }

            // 4. Re-enable externalization for the normal loop
            externalizer?.enable();

            // 5. Build history entries
            const historyEntries = this.buildHistory(results, recipe);

            console.debug(`[FastPath] Completed: ${toolCallsExecuted} tools executed, ${results.filter(r => r.isError).length} errors`);

            return {
                success: true,
                historyEntries,
                toolCallsExecuted,
            };
        } catch (e) {
            // Re-enable externalization on error
            this.pipeline.getExternalizer()?.enable();
            console.warn('[FastPath] Execution failed, falling back to normal loop:', e);
            return failed;
        }
    }

    /**
     * Planner Call: Ask the LLM to fill recipe steps with concrete parameters.
     */
    private async plannerCall(
        recipe: ProceduralRecipe,
        userMessage: string,
        systemPrompt: string,
        abortSignal?: AbortSignal,
        tools?: ToolDefinition[],
    ): Promise<PlannedToolCall[] | null> {
        const stepsText = recipe.steps
            .map((s, i) => `${i + 1}. ${s.tool} — ${s.note}${s.conditional ? ' [optional]' : ''}`)
            .join('\n');

        // Include input schemas for tools mentioned in the recipe so LLM knows the parameters
        const recipeToolNames = new Set(recipe.steps.map((s) => s.tool));
        let toolSchemaHint = '';
        if (tools && tools.length > 0) {
            const relevantTools = tools.filter((t) => recipeToolNames.has(t.name));
            if (relevantTools.length > 0) {
                toolSchemaHint = '\n\nTOOL PARAMETER SCHEMAS (use these exact parameter names):\n' +
                    relevantTools.map((t) => `${t.name}: ${JSON.stringify(t.input_schema?.properties ?? {})}`).join('\n');
            }
        }

        const plannerMessage = PLANNER_INSTRUCTION
            .replace('{STEPS}', stepsText)
            .replace('{USER_MESSAGE}', userMessage) + toolSchemaHint;

        try {
            let responseText = '';
            for await (const chunk of this.api.createMessage(
                systemPrompt,
                [{ role: 'user', content: plannerMessage }],
                [], // No tools for planner — we want pure JSON output
                abortSignal,
            )) {
                if (chunk.type === 'text') responseText += chunk.text;
            }

            // Strip markdown code fences
            let cleaned = responseText.trim();
            if (cleaned.startsWith('```')) {
                cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
            }

            // Parse and validate
            const parsed: unknown = JSON.parse(cleaned);
            if (!Array.isArray(parsed)) {
                console.warn('[FastPath] Planner response is not an array');
                return null;
            }

            const validCalls: PlannedToolCall[] = [];
            for (const item of parsed) {
                if (
                    typeof item === 'object' && item !== null &&
                    typeof (item as Record<string, unknown>).tool === 'string' &&
                    typeof (item as Record<string, unknown>).input === 'object'
                ) {
                    validCalls.push({
                        tool: String((item as Record<string, unknown>).tool),
                        input: (item as Record<string, unknown>).input as Record<string, unknown>,
                    });
                }
            }

            return validCalls.length > 0 ? validCalls : null;
        } catch (e) {
            console.warn('[FastPath] Planner call failed:', e);
            return null;
        }
    }

    /**
     * Build synthetic history entries from batch results.
     * These are appended to the conversation history so the normal loop
     * can see what was already done and present/complete the task.
     */
    private buildHistory(
        results: Array<{ tool: string; input: Record<string, unknown>; content: string; isError: boolean }>,
        recipe: ProceduralRecipe,
    ): MessageParam[] {
        const entries: MessageParam[] = [];

        // Synthetic assistant message: "I executed the recipe steps"
        const toolUseBlocks = results.map((r, i) => ({
            type: 'tool_use' as const,
            id: `fp-batch-${i}`,
            name: r.tool,
            input: r.input,
        }));

        entries.push({
            role: 'assistant',
            content: toolUseBlocks,
        });

        // Tool results
        const toolResultBlocks = results.map((r, i) => ({
            type: 'tool_result' as const,
            tool_use_id: `fp-batch-${i}`,
            content: r.content,
            is_error: r.isError,
        }));

        entries.push({
            role: 'user',
            content: toolResultBlocks,
        });

        return entries;
    }

    /** Check if a tool is safe for parallel execution. */
    private isReadSafe(toolName: string): boolean {
        const READ_SAFE = new Set([
            'read_file', 'read_document', 'list_files', 'search_files',
            'get_frontmatter', 'get_linked_notes', 'search_by_tag',
            'get_vault_stats', 'semantic_search', 'query_base',
            'web_search', 'web_fetch',
        ]);
        return READ_SAFE.has(toolName);
    }
}

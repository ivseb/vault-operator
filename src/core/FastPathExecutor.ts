/**
 * FastPathExecutor — ADR-061: Two-Stage Recipe-based Batch Execution
 *
 * When a learned recipe matches the user's intent, executes the tool
 * steps as a two-stage batch instead of iterating through the ReAct loop.
 *
 * Two-Stage Flow:
 *   Stage 1 (Search): Planner parametrizes search tools → parallel batch execution
 *   Stage 2 (Read):   Planner sees search results → parametrizes read tools → parallel batch
 *   Stage 3 (Loop):   Normal loop for write/present (1-2 iterations)
 *
 * This solves the single-planner problem: a one-shot planner cannot predict
 * file paths for read_file because it hasn't seen search results yet.
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

/** Tools allowed in Stage 1 (search/discovery). Hard allowlist — planner output is filtered. */
const STAGE1_ALLOWED = new Set([
    'semantic_search', 'search_files', 'search_by_tag', 'list_files',
    'get_vault_stats', 'web_search',
]);

/** Tools allowed in Stage 2 (read). Hard allowlist. */
const STAGE2_ALLOWED = new Set([
    'read_file', 'read_document', 'get_frontmatter', 'get_linked_notes',
]);

/** Tools safe for parallel execution (no side effects). */
const READ_SAFE = new Set([
    'read_file', 'read_document', 'list_files', 'search_files',
    'get_frontmatter', 'get_linked_notes', 'search_by_tag',
    'get_vault_stats', 'semantic_search', 'query_base',
    'web_search', 'web_fetch',
]);

export interface FastPathResult {
    success: boolean;
    historyEntries: MessageParam[];
    toolCallsExecuted: number;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const SEARCH_PLANNER = `You have a proven recipe for this task. Stage 1: parametrize the SEARCH steps only.

RECIPE STEPS:
{STEPS}

USER REQUEST:
{USER_MESSAGE}

Output ONLY search/discovery tool calls as a JSON array. No markdown.
Include ONLY: semantic_search, search_files, search_by_tag, list_files, web_search.
Do NOT include read_file, write_file, or other tools — those come in stage 2.

{TOOL_SCHEMAS}

Example: [{"tool": "semantic_search", "input": {"query": "Kant ethics philosophy"}}]`;

const READ_PLANNER = `Stage 2: Based on the search results below, parametrize the READ steps.

SEARCH RESULTS:
{SEARCH_RESULTS}

USER REQUEST:
{USER_MESSAGE}

Output ONLY read tool calls as a JSON array. No markdown.
Include ONLY: read_file, read_document.
Pick the most relevant files from the search results (max 5).
Do NOT include write_file or search tools — the loop handles writing.

{TOOL_SCHEMAS}

Example: [{"tool": "read_file", "input": {"path": "Notes/Kant Summary.md"}}]`;

// ---------------------------------------------------------------------------
// FastPathExecutor
// ---------------------------------------------------------------------------

export class FastPathExecutor {
    constructor(
        private api: ApiHandler,
        private pipeline: ToolExecutionPipeline,
    ) {}

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
            console.debug(`[FastPath] Starting two-stage for recipe: ${recipe.name} (${recipe.steps.length} steps)`);

            const externalizer = this.pipeline.getExternalizer();
            const allResults: Array<{ tool: string; input: Record<string, unknown>; content: string; isError: boolean }> = [];
            let toolCallsExecuted = 0;

            // ── Stage 1: Search (externalization ENABLED — search results are large
            //    and the Presenter doesn't need them, only the Read-Planner does) ────
            const searchCalls = await this.plannerCall(
                SEARCH_PLANNER, recipe, userMessage, systemPrompt, abortSignal, tools,
            );

            // Capture full search content for the Read-Planner BEFORE externalization
            // (the planner needs full results to pick the right files)
            let searchContentForPlanner = '';

            if (searchCalls && searchCalls.length > 0) {
                // S-2: Hard allowlist — reject any tools the planner shouldn't have generated
                const filteredSearch = searchCalls.filter((c) => STAGE1_ALLOWED.has(c.tool));
                if (filteredSearch.length !== searchCalls.length) {
                    console.warn(`[FastPath] Stage 1: filtered ${searchCalls.length - filteredSearch.length} disallowed tool(s)`);
                }
                console.debug(`[FastPath] Stage 1: ${filteredSearch.length} search calls`);
                const searchResults = await this.executeBatch(filteredSearch, callbacks, abortSignal);

                // Save full content for Read-Planner before it gets externalized in history
                searchContentForPlanner = searchResults
                    .filter((r) => !r.isError)
                    .map((r) => `[${r.tool}]\n${r.content}`)
                    .join('\n\n---\n\n');

                allResults.push(...searchResults);
                toolCallsExecuted += searchResults.length;

                // ── Stage 2: Read (externalization DISABLED — Presenter needs full
                //    file content to write a quality summary) ──────────────────────
                if (searchContentForPlanner.length > 0) {
                    externalizer?.disable();

                    const readCalls = await this.plannerCall(
                        READ_PLANNER, recipe, userMessage, systemPrompt, abortSignal, tools,
                        searchContentForPlanner,
                    );

                    if (readCalls && readCalls.length > 0) {
                        // S-2: Hard allowlist for Stage 2
                        const filteredRead = readCalls.filter((c) => STAGE2_ALLOWED.has(c.tool));
                        if (filteredRead.length !== readCalls.length) {
                            console.warn(`[FastPath] Stage 2: filtered ${readCalls.length - filteredRead.length} disallowed tool(s)`);
                        }
                        console.debug(`[FastPath] Stage 2: ${filteredRead.length} read calls`);
                        const readResults = await this.executeBatch(filteredRead, callbacks, abortSignal);
                        allResults.push(...readResults);
                        toolCallsExecuted += readResults.length;
                    }

                    externalizer?.enable();
                }
            }

            if (toolCallsExecuted === 0) {
                console.debug('[FastPath] No tools executed, falling back to normal loop');
                return failed;
            }

            // Build history entries
            const historyEntries = this.buildHistory(allResults);

            console.debug(`[FastPath] Completed: ${toolCallsExecuted} tools (${allResults.filter(r => r.isError).length} errors)`);

            return { success: true, historyEntries, toolCallsExecuted };
        } catch (e) {
            // Re-enable externalization on error (might have been disabled for Stage 2)
            this.pipeline.getExternalizer()?.enable();
            console.warn('[FastPath] Execution failed, falling back to normal loop:', e);
            return failed;
        }
    }

    // -----------------------------------------------------------------------
    // Planner Call
    // -----------------------------------------------------------------------

    private async plannerCall(
        template: string,
        recipe: ProceduralRecipe,
        userMessage: string,
        systemPrompt: string,
        abortSignal?: AbortSignal,
        tools?: ToolDefinition[],
        searchResults?: string,
    ): Promise<PlannedToolCall[] | null> {
        const stepsText = recipe.steps
            .map((s, i) => `${i + 1}. ${s.tool} — ${s.note}${s.conditional ? ' [optional]' : ''}`)
            .join('\n');

        // Include input schemas for recipe-relevant tools
        const recipeToolNames = new Set(recipe.steps.map((s) => s.tool));
        let toolSchemaHint = '';
        if (tools && tools.length > 0) {
            const relevant = tools.filter((t) => recipeToolNames.has(t.name));
            if (relevant.length > 0) {
                toolSchemaHint = 'TOOL PARAMETER SCHEMAS:\n' +
                    relevant.map((t) => `${t.name}: ${JSON.stringify(t.input_schema?.properties ?? {})}`).join('\n');
            }
        }

        let prompt = template
            .replace('{STEPS}', stepsText)
            .replace('{USER_MESSAGE}', userMessage)
            .replace('{TOOL_SCHEMAS}', toolSchemaHint);

        if (searchResults) {
            prompt = prompt.replace('{SEARCH_RESULTS}', searchResults);
        }

        try {
            let responseText = '';
            for await (const chunk of this.api.createMessage(
                systemPrompt,
                [{ role: 'user', content: prompt }],
                [], // No tools — want JSON output, not tool calls
                abortSignal,
            )) {
                if (chunk.type === 'text') responseText += chunk.text;
            }

            // Strip markdown code fences
            let cleaned = responseText.trim();
            if (cleaned.startsWith('```')) {
                cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
            }

            const parsed: unknown = JSON.parse(cleaned);
            if (!Array.isArray(parsed)) return null;

            const valid: PlannedToolCall[] = [];
            for (const item of parsed) {
                if (
                    typeof item === 'object' && item !== null &&
                    typeof (item as Record<string, unknown>).tool === 'string' &&
                    typeof (item as Record<string, unknown>).input === 'object'
                ) {
                    valid.push({
                        tool: String((item as Record<string, unknown>).tool),
                        input: (item as Record<string, unknown>).input as Record<string, unknown>,
                    });
                }
            }
            return valid.length > 0 ? valid : null;
        } catch (e) {
            console.warn('[FastPath] Planner call failed:', e);
            return null;
        }
    }

    // -----------------------------------------------------------------------
    // Batch Execution
    // -----------------------------------------------------------------------

    private async executeBatch(
        calls: PlannedToolCall[],
        callbacks: ToolCallbacks,
        abortSignal?: AbortSignal,
    ): Promise<Array<{ tool: string; input: Record<string, unknown>; content: string; isError: boolean }>> {
        const results: Array<{ tool: string; input: Record<string, unknown>; content: string; isError: boolean }> = [];

        // Read-safe tools in parallel, write tools sequential
        const readCalls = calls.filter((c) => this.isReadSafe(c.tool));
        const writeCalls = calls.filter((c) => !this.isReadSafe(c.tool));

        if (readCalls.length > 0) {
            const readResults = await Promise.all(
                readCalls.map(async (call) => {
                    const id = `fp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                    const result = await this.pipeline.executeTool(
                        { type: 'tool_use', id, name: call.tool as ToolName, input: call.input },
                        callbacks,
                    );
                    return {
                        tool: call.tool,
                        input: call.input,
                        content: this.extractText(result.content),
                        isError: result.is_error ?? false,
                    };
                }),
            );
            results.push(...readResults);
        }

        for (const call of writeCalls) {
            if (abortSignal?.aborted) break;
            const id = `fp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const result = await this.pipeline.executeTool(
                { type: 'tool_use', id, name: call.tool as ToolName, input: call.input },
                callbacks,
            );
            results.push({
                tool: call.tool,
                input: call.input,
                content: this.extractText(result.content),
                isError: result.is_error ?? false,
            });
        }

        return results;
    }

    // -----------------------------------------------------------------------
    // History Builder
    // -----------------------------------------------------------------------

    private buildHistory(
        results: Array<{ tool: string; input: Record<string, unknown>; content: string; isError: boolean }>,
    ): MessageParam[] {
        const entries: MessageParam[] = [];

        const toolUseBlocks = results.map((r, i) => ({
            type: 'tool_use' as const,
            id: `fp-batch-${i}`,
            name: r.tool,
            input: r.input,
        }));

        entries.push({ role: 'assistant', content: toolUseBlocks });

        const toolResultBlocks = results.map((r, i) => ({
            type: 'tool_result' as const,
            tool_use_id: `fp-batch-${i}`,
            content: r.content,
            is_error: r.isError,
        }));

        entries.push({ role: 'user', content: toolResultBlocks });

        return entries;
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private isReadSafe(toolName: string): boolean {
        return READ_SAFE.has(toolName);
    }

    private extractText(content: unknown): string {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            return (content as Array<{ type: string; text?: string }>)
                .filter((b) => b.type === 'text')
                .map((b) => b.text ?? '')
                .join('\n');
        }
        return String(content);
    }
}

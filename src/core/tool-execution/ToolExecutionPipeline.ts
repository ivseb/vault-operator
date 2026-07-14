/**
 * ToolExecutionPipeline - Central execution and governance layer
 *
 * ⭐ CRITICAL COMPONENT (ASR-02)
 *
 * ALL tool executions (internal and MCP) MUST flow through this pipeline.
 * Ensures:
 * - Ignore/protected path validation (IgnoreService)
 * - Auto-approval or user-approval for write operations
 * - Checkpoint creation before writes (Sprint 1.4)
 * - Persistent operation logging (OperationLogger)
 * - Error handling
 */

import type ObsidianAgentPlugin from '../../main';
import type { ToolRegistry } from '../tools/ToolRegistry';
import type {
    ToolUse,
    ToolResult,
    ToolCallbacks,
    ToolExecutionContext,
    ValidationResult,
} from '../tools/types';
import type { IgnoreService } from '../governance/IgnoreService';
import type { OperationLogger } from '../governance/OperationLogger';
import { ResultExternalizer } from './ResultExternalizer';
import { VaultDataFileAdapter } from '../storage/VaultDataFileAdapter';
import { getTmpRoot } from '../utils/agentFolder';
import { findAllowedMethod } from '../tools/agent/pluginApiAllowlist';
import { isPluginApiWriteCall as resolvePluginApiIsWrite } from '../tools/agent/pluginApiAdaptive';
import { EFFECT_POLICY, resolveToolEffect, DYNAMIC_TOOL_PREFIX, PROGRESSIVE_DISCLOSURE_META_TOOLS, type ToolEffect, type ApprovalGrantKey } from '../tools/toolEffects';
import { hasEditPreview, hasNonFileEffects, type EditPreview } from '../tools/editPreview';
import { safeNoteWrite } from '../utils/safeNoteWrite';
import { validateVaultRelativePath } from '../tools/vault/pathValidation';
import type { AutoApprovalConfig } from '../../types/settings';
import { scanUnreadSources } from '../quality-gates';
import { computeReadBudgetChars } from '../../types/model-registry';
import { validateToolInput } from './inputSchemaValidator';
import { stableStringify } from '../utils/stableStringify';
import type { ModeService } from '../modes/ModeService';

/** Source of a single-tool dispatch routed through the Pipeline. */
export type DispatchSource = 'model' | 'fastpath' | 'planner';

/**
 * FEAT-24-03 (ADR-63 amendment): hard ceiling on the characters of any single
 * tool result that reaches the conversation history. The externalizer is the
 * primary mechanism (large results -> tmp file + reference); this cap is the
 * floor for results the externalizer skips (read_file/read_document,
 * search_history, recall_memory, MCP tools) or where externalization failed.
 * Generous enough that normal results pass untouched. read_file/read_document
 * self-cap at a window-proportional budget (IMP-01-04-03), so their floor here
 * is raised via {@link readAwareOutputCap} to not re-truncate a legitimate
 * large read on a big-context model.
 */
export const HARD_TOOL_OUTPUT_CAP_CHARS = 60_000;

/**
 * Headroom over the raw read budget for the untrusted-content wrapper tag and
 * the truncation-hint line that ReadFileTool adds around the content.
 */
export const READ_OUTPUT_WRAPPER_HEADROOM_CHARS = 4_000;

/**
 * IMP-01-04-03: the per-tool output floor for read_file/read_document must
 * clear their window-proportional read budget, otherwise a 1M-context model's
 * one-call read (up to 400k chars) gets chopped back to 60k here and the model
 * has to re-read in chunks anyway. All other tools keep the flat 60k floor.
 */
export function readAwareOutputCap(toolName: string, windowTokens?: number): number {
    if (toolName !== 'read_file' && toolName !== 'read_document') {
        return HARD_TOOL_OUTPUT_CAP_CHARS;
    }
    return Math.max(
        HARD_TOOL_OUTPUT_CAP_CHARS,
        computeReadBudgetChars(windowTokens) + READ_OUTPUT_WRAPPER_HEADROOM_CHARS,
    );
}

/**
 * AUDIT-034 L-17 cross-module gate. Mirrors `TRUSTED_SKILL_SOURCES` in
 * `src/core/tools/agent/InvokeSkillTool.ts`. Duplicated here (instead of
 * imported) because InvokeSkillTool pulls heavy subtask-spawning + mode
 * registry deps that the Pipeline does not need; we keep the trust set
 * local and pin both sites with a comment so a future change has to update
 * both places. Sources NOT in this set are treated as imported content and
 * the autoApproval.skills flag is ignored for them -- the per-skill prompt
 * in InvokeSkillTool (sessionApprovedImportedSkills + askImportedSkillApproval)
 * remains the user-facing approval surface.
 *
 * Keep this set tight. Adding `agent`/`learned`/etc here would silently
 * widen the trust boundary for every `invoke_skill` auto-approval path.
 *
 * `pro` (monetized publisher skills) is trusted here to mirror
 * TRUSTED_SKILL_SOURCES in InvokeSkillTool.ts. SECURITY CONTRACT: sound
 * only while `source: pro` is written exclusively by a verified installer
 * (dev install today, hash-pinned download later). The download flow MUST
 * verify integrity before stamping `source: pro`.
 */
const PIPELINE_TRUSTED_SKILL_SOURCES: ReadonlySet<string> = new Set([
    'builtin',
    'bundled',
    'pro',
]);

/**
 * Cap an oversized tool-result string at {@link HARD_TOOL_OUTPUT_CAP_CHARS},
 * cutting on a line boundary when one is reasonably close, and append a notice
 * telling the agent how to fetch the rest. Returns the input unchanged when it
 * is within budget, is an error result, or is not a plain string (multimodal).
 */
export function capOversizedToolOutput(
    content: string | import('../../api/types').ToolResultContentBlock[],
    hadError: boolean,
    capChars: number = HARD_TOOL_OUTPUT_CAP_CHARS,
): { content: string | import('../../api/types').ToolResultContentBlock[]; capped: boolean; originalLength: number } {
    if (hadError || typeof content !== 'string' || content.length <= capChars) {
        return { content, capped: false, originalLength: typeof content === 'string' ? content.length : 0 };
    }
    const orig = content.length;
    const head = content.slice(0, capChars);
    const nl = head.lastIndexOf('\n');
    const kept = nl > capChars / 2 ? head.slice(0, nl) : head;
    return {
        content: kept +
            `\n\n[Output truncated: ${kept.length} of ${orig} chars shown. ` +
            `Narrow the request (a more specific query, a page/line range, fewer results) to see the rest — do not assume the omitted part is empty.]`,
        capped: true,
        originalLength: orig,
    };
}

/**
 * ADR-153: the approval classification now lives centrally in
 * `src/core/tools/toolEffects.ts` (TOOL_EFFECTS + EFFECT_POLICY).
 *
 * A hand-maintained name map (TOOL_GROUPS) used to sit here and, together with
 * the self-declared `isWriteOperation`, decided whether a tool was checked at
 * all. Both are gone as sources: `isWriteOperation` now only drives checkpoints
 * and cache invalidation, and the effect class comes from the registry. A tool
 * with no entry requires approval.
 */


/** Result of an approval check — may include user-edited content */
export interface ApprovalResult {
    decision: 'auto' | 'approved' | 'rejected';
    /**
     * FEAT-44-02 (run scope): "yes, and stop asking me for this kind of change for
     * the rest of this run".
     *
     * A single approval covering the WHOLE run up front is impossible: the agent
     * only decides its second tool call after seeing the result of the first, so
     * there is nothing to preview yet. What IS possible is to remember the answer.
     * The user sees the first real diff, says yes once, and the rest of the run
     * runs on that consent.
     *
     * Deliberately scoped to the run, not the session and not persisted: consent
     * given for one task does not carry into the next one.
     */
    rememberForRun?: boolean;
    /**
     * FEAT-44-02a (session scope): "yes, and stop asking for this kind of change
     * until the plugin reloads". One level above the run scope: the grant
     * outlives the task, is visible to every pipeline via the plugin instance,
     * and dies with the plugin reload. Never persisted. Same resolved-key
     * granularity and the same config/self-modify lock as the run scope.
     */
    rememberForSession?: boolean;
    /** User-edited final content (only for note-edit approvals via DiffReviewModal) */
    finalContent?: string;
    /**
     * FIX-44-13a: vault path of the previewed file, attached by askOrDeny when
     * the approval carries user-edited finalContent. Authoritative over
     * `toolCall.input.path`: tools address their target as `path`, `note_path`
     * or a normalized variant of it, but the preview always names the file
     * whose before/after the user actually saw and edited.
     */
    editedPath?: string;
    /**
     * IMP-41-01-02: optional rejection context surfaced to the model (e.g.
     * "Approval timed out after 10 minutes"). Without it the tool_result
     * carries the generic "denied by user" line.
     */
    reason?: string;
    /**
     * FIX-44-44: true when the user approved this call on its REAL diff (a
     * previewEdit preview reached the card). Set by the Pipeline in askOrDeny,
     * never by the UI. Auto approvals (settings, run scope) and name-only card
     * approvals leave it unset -- those writes land without a diff surface and
     * are reported via {@link ContextExtensions.onUnreviewedWrite} so the
     * post-task review can pick them up.
     */
    diffReviewed?: boolean;
}

/**
 * FEAT-44-02 / FEAT-44-07: run-scope grants plus the revocation epoch they were
 * made under. Shared BY REFERENCE between a parent task's pipeline and its
 * subtasks (see setRunApprovedEffects), so both the grants and their revocation
 * travel together: when the kill switch bumps the plugin's epoch, whichever
 * pipeline checks next clears the shared keys for every sharer.
 */
export interface RunGrantStore {
    epoch: number;
    keys: Set<import('../tools/toolEffects').ApprovalGrantKey>;
}

/**
 * Result of an in-chat asset-install prompt (Obsidian policy compliance:
 * network fetches must be triggered by an explicit user click, so tools
 * that need an optional asset call `onOptionalAssetRequired` which
 * renders an inline install-card and awaits the user's decision).
 */
export interface OptionalAssetInstallResult {
    /**
     * - `installed`: user clicked Install, download+SHA-check succeeded, the
     *   asset is now on disk. The calling tool should retry its asset load.
     * - `skipped`: user closed / declined the card. The calling tool should
     *   surface the normal "not installed" error to the model.
     * - `failed`: user clicked Install but the download or SHA-check failed.
     *   The error message is in `error`. Tool should surface it to the model.
     */
    decision: 'installed' | 'skipped' | 'failed';
    error?: string;
}

/** Extra context injected by AgentTask for agent-control tools */
export interface ContextExtensions {
    /** Abort signal for the currently running task */
    abortSignal?: AbortSignal;
    askQuestion?: (question: string, options?: string[], allowMultiple?: boolean) => Promise<string>;
    signalCompletion?: (result: string) => void;
    /**
     * Request user approval for a tool call.
     *
     * FEAT-44-10: `preview` carries the real before/after of a note edit when the
     * tool could compute it without writing. The UI then renders the approval as
     * a diff, and the user decides on what they can actually see. When it is
     * absent the caller shows the plain card -- never no approval.
     */
    onApprovalRequired?: (
        toolName: string,
        input: Record<string, unknown>,
        preview?: EditPreview,
    ) => Promise<ApprovalResult>;
    /**
     * Ask the user to install a missing optional asset (office bundle,
     * pdfjs bundle, reranker WASM, ...). Renders an in-chat install card
     * with description, size, SHA info and an Install button. The Promise
     * resolves once the user decides (installed, skipped, or failed).
     * Obsidian community policy: network fetches must be behind an
     * explicit user click; the card is that click.
     */
    onOptionalAssetRequired?: (
        spec: import('../assets/OptionalAssetManager').AssetSpec,
        toolName: string,
    ) => Promise<OptionalAssetInstallResult>;
    /** Publish the current todo list to the UI */
    updateTodos?: (items: import('../tools/agent/UpdateTodoListTool').TodoItem[]) => void;
    /** Switch the active mode (called by switch_mode tool) */
    switchMode?: (slug: string) => void;
    /** Spawn a child task (called by new_task / invoke_skill tools) */
    spawnSubtask?: (
        mode: string,
        message: string,
        profileName?: string,
        overrides?: import('../tools/types').SubtaskSpawnOverrides,
    ) => Promise<string>;
    /**
     * FEAT-29-10 Composability: shared stack-tracker for invoke_skill /
     * invoke_mcp_server. Owned by the top-level AgentTask, passed by
     * reference into every spawned subtask so cycle-detection and
     * depth-limit work across the whole composition chain.
     */
    compositionStack?: import('../skills/CompositionStackService').CompositionStackService;
    /**
     * EPIC-26 / FEAT-26-01 / ADR-120: try to acquire one of the per-task
     * advisor slots. Used by ConsultFlagshipTool to enforce the 3-call
     * budget before spawning the flagship subagent.
     */
    consumeAdvisorSlot?: () => { ok: boolean; used: number; limit: number };
    /** Notify UI about a new checkpoint after a write operation */
    onCheckpoint?: (checkpoint: import('../checkpoints/GitCheckpointService').CheckpointInfo) => void;
    /**
     * FIX-44-44: a write tool ran successfully WITHOUT the user having
     * individually approved it on its diff (auto-approved by settings, covered
     * by a run-scope grant, or approved on a name-only card because the tool
     * has no previewEdit). The sidebar counts these per task and opens the
     * post-task review exactly when at least one exists -- the review is the
     * only diff surface such a write will ever get.
     */
    onUnreviewedWrite?: (toolName: string) => void;
    /** Invalidate cached tool definitions (e.g. after webTools.enabled changes) */
    invalidateToolCache?: () => void;
    /** FEATURE-1600: activate a deferred tool for the rest of the session. */
    activateDeferredTool?: (toolName: string) => void;
    /** Active conversation ID for chat-linking frontmatter stamping (ADR-022) */
    conversationId?: string;
    /**
     * FIX-H (ADR-090 follow-up): set of file paths the current task has read.
     * The pipeline mutates this on each successful read_file/read_document call;
     * UpdateTodoListTool reads it to verify done items reference actually-read files.
     */
    readFiles?: Set<string>;
}

export class ToolExecutionPipeline {
    private plugin: ObsidianAgentPlugin;
    private toolRegistry: ToolRegistry;

    /**
     * FEAT-24-07 / ADR-115: read-only accessor for the parent plugin.
     * Used by FastPathExecutor.getInternalApi to look up the configured
     * helper model without exposing the private field directly.
     */
    getPlugin(): ObsidianAgentPlugin {
        return this.plugin;
    }
    private taskId: string;
    private mode: string;
    private apiHandler?: import('../../api/types').ApiHandler;

    /** Per-task result cache for read-only tools. Key = tool:sortedJSON(input). */
    private resultCache = new Map<string, string>();
    /**
     * FIX-PERF-23: per-path index of cache keys so write-tools can
     * invalidate O(1) instead of substring-scanning every cached key.
     */
    private pathIndex = new Map<string, Set<string>>();
    /**
     * FIX-PERF-23: bounded result-cache size. Without a cap a long-
     * running session could hoard arbitrary amounts of read-tool
     * outputs. 200 entries is plenty for normal turn coverage.
     */
    private static readonly RESULT_CACHE_LIMIT = 200;

    /** ADR-063: Context Externalization — large results written to temp files. */
    private resultExternalizer: ResultExternalizer | null = null;

    /**
     * AUDIT-034 M-9: ModeService used to enforce mode.toolGroups at the
     * execution layer (not just in the schema). When set, executeTool
     * rejects model-driven and MCP-driven dispatches of tools the active
     * mode does not allow. FastPath / planner dispatches bypass the gate
     * because recipes are user-authored.
     *
     * Optional: when undefined (legacy callers, MCP boundary that wires
     * its own check), the pipeline falls back to the registry-only check.
     */
    private modeService?: ModeService;

    /**
     * AUDIT-034 H-3: when this pipeline serves a SUBTASK with a
     * profile-restricted tool surface, the parent passes the same
     * allowlist here. The runtime gate then rejects model dispatches of
     * any tool outside the allowlist, regardless of whether the registry
     * or active mode happens to include it. undefined / [] keeps the
     * legacy behaviour (no extra restriction).
     */
    private subagentAllowedTools?: Set<string>;


    /** Tools eligible for result caching (read-only, deterministic within a task). */
    private static readonly CACHEABLE = new Set([
        'read_file', 'list_files', 'search_files', 'get_frontmatter',
        'get_linked_notes', 'search_by_tag', 'get_vault_stats',
        'semantic_search', 'query_base',
    ]);


    constructor(
        plugin: ObsidianAgentPlugin,
        toolRegistry: ToolRegistry,
        taskId: string,
        mode: string,
        apiHandler?: import('../../api/types').ApiHandler,
    ) {
        this.plugin = plugin;
        this.toolRegistry = toolRegistry;
        this.taskId = taskId;
        this.mode = mode;
        this.apiHandler = apiHandler;

        // ADR-063: Initialize result externalizer for large tool results.
        // BUG-014 / FEATURE-1803: Use the vault adapter (not globalFs) so that
        // externalised files land inside the vault and read_file() can resolve
        // the same relative path the agent receives in references.
        // FEATURE-0507: tmp root honors the configurable agentFolderPath setting.
        const vaultFs = new VaultDataFileAdapter(plugin.app.vault.adapter);
        this.resultExternalizer = new ResultExternalizer(vaultFs, taskId, getTmpRoot(plugin));

        // FEAT-44-07: stamp the fresh (empty) run-grant store with the current
        // revocation epoch, so a pipeline built after a reset does not treat
        // its own empty store as revoked and, more importantly, a store filled
        // BEFORE a reset is recognisably stale.
        this.runGrants.epoch = this.getRevocationEpoch();
    }

    /** ADR-063: Get the externalizer (for Fast Path to disable during batch). */
    getExternalizer(): ResultExternalizer | null {
        return this.resultExternalizer;
    }

    /**
     * AUDIT-034 M-9: bind the ModeService so executeTool can enforce the
     * active mode's toolGroups at dispatch time. Called by AgentTask after
     * pipeline construction so the schema filter and the runtime check use
     * the same source of truth. No-op when modeService is undefined.
     */
    setModeService(modeService: ModeService): void {
        this.modeService = modeService;
    }

    /**
     * AUDIT-034 H-3: bind the subagent's tool allowlist so the pipeline
     * can reject hallucinated calls to tools outside the profile. The
     * parent task calls this for every subtask pipeline it constructs.
     * Pass undefined for the top-level pipeline (no extra restriction).
     */
    setSubagentAllowedTools(allowed: readonly string[] | undefined): void {
        if (allowed === undefined || allowed.length === 0) {
            this.subagentAllowedTools = undefined;
            return;
        }
        this.subagentAllowedTools = new Set(allowed);
    }

    /** ADR-063: Clean up temp files after task completion. */
    async cleanupExternalized(): Promise<void> {
        await this.resultExternalizer?.cleanup();
    }

    /**
     * Stable cache key: tool name + deep-sorted JSON of input parameters.
     * FIX-PERF-23: recursive sort so nested objects produce identical
     * keys regardless of insertion order. The previous shallow sort
     * leaked through to nested keys.
     */
    private cacheKey(name: string, input: Record<string, unknown>): string {
        return `${name}:${stableStringify(input ?? {})}`;
    }

    /**
     * CENTRAL EXECUTION METHOD — all tools MUST flow through here.
     *
     * `opts.source` tags the dispatch origin for the mode-gate / subagent-
     * allowlist bypass (AUDIT-034 M-9/H-3): fastpath/planner dispatches of
     * user-authored recipes skip the gates, everything else runs them.
     * Default `'model'` preserves existing behavior. `opts.trust`
     * (IMP-41-02-05) narrows the bypass to user-trusted dispatches.
     */
    async executeTool(
        toolCall: ToolUse,
        callbacks: ToolCallbacks,
        extensions?: ContextExtensions,
        opts?: {
            source?: DispatchSource;
            /**
             * IMP-41-02-05 / ADR-151: dispatch trust level. 'user' keeps the
             * historical gate bypass for user-authored recipes and internal
             * planners; 'learned' (machine-promoted recipes, ADR-058 Gate 3)
             * runs the full mode gate + subagent allowlist like model picks.
             * Absent trust on a fastpath/planner source defaults to 'user'
             * for legacy callers.
             */
            trust?: 'user' | 'learned';
        },
    ): Promise<ToolResult> {
        const startTime = Date.now();

        try {
            // 0. FIX-24-08-03: a stopped task must not start new tools.
            // No tool consumes the abort signal itself, so without this
            // pre-check a Stop only takes effect at the next loop
            // checkpoint and a long tool batch keeps a "stopped" run
            // visibly working. Returning an error result (instead of
            // throwing) keeps every tool_use answered for history
            // consistency and task resume.
            if (extensions?.abortSignal?.aborted) {
                const msg = `Tool "${toolCall.name}" skipped: task was stopped.`;
                this.logOperation(toolCall, false, Date.now() - startTime, msg, undefined);
                return this.errorResult(toolCall.id, msg);
            }

            // 1. Validate tool exists
            const tool = this.toolRegistry.getTool(toolCall.name);
            if (!tool) {
                const msg = `Unknown tool: ${toolCall.name}`;
                return this.errorResult(toolCall.id, msg);
            }

            // 1a. AUDIT-034 H-3: enforce subagent allowlist BEFORE the mode
            // gate. A subskill's allowlist always wins over the broader mode
            // surface -- if the parent restricted the subskill to read-only,
            // a hallucinated write_file call must be rejected even when the
            // active mode normally allows it. Same dispatch-source bypass
            // logic as the mode gate.
            const dispatchSourceForGate: DispatchSource = opts?.source ?? 'model';
            // IMP-41-02-05: the bypass only ever applied because "recipes are
            // user-authored" — machine-promoted (learned) recipes do not get
            // that trust and run the full gates like model picks.
            const enforceModeGate = (dispatchSourceForGate !== 'fastpath' && dispatchSourceForGate !== 'planner')
                || opts?.trust === 'learned';
            if (enforceModeGate && this.subagentAllowedTools !== undefined) {
                if (this.subagentAllowedTools.has(toolCall.name) === false) {
                    const msg = `Tool "${toolCall.name}" is not in this subtask's allowlist.`;
                    console.warn(`[Pipeline] Subagent-gate denied: ${toolCall.name} (source=${dispatchSourceForGate})`);
                    this.logOperation(toolCall, false, Date.now() - startTime, msg, undefined);
                    return this.errorResult(toolCall.id, msg);
                }
            }
            // 1b. AUDIT-034 M-9: enforce active-mode toolGroups at the
            // execution layer. Schema-only filtering (ModeService.getToolDefinitions)
            // does not stop a hallucinated or replayed tool name, and FastPath
            // / MCP / subtask dispatch paths bypass the schema entirely. The
            // runtime gate makes Custom Agents an actual security boundary.
            // Bypass for 'fastpath' and 'planner' sources because those are
            // user-authored recipes / internal classifiers, not model picks.
            // 'model' (and undefined for legacy callers) and any other source
            // are enforced.
            if (
                enforceModeGate
                && this.modeService
                // FIX-44-29: dynamic skill tools (custom_*) are never part of a
                // mode's toolGroups -- they are governed by the skill's own
                // allowedTools and the subagent allowlist above. Enforcing the
                // mode-group check on them would deny every skill tool outright.
                && !toolCall.name.startsWith(DYNAMIC_TOOL_PREFIX)
                // FIX-44-29 follow-up: the progressive-disclosure meta-tools are
                // ALWAYS injected into the schema (even for restricted modes that
                // omit the `agent` group), so the gate must exempt them too --
                // otherwise the model calls a tool it was told it has and gets
                // denied every time. Same list as the injection in AgentTask.
                && !PROGRESSIVE_DISCLOSURE_META_TOOLS.includes(toolCall.name)
            ) {
                const activeMode = this.modeService.getMode(this.mode) ?? this.modeService.getActiveMode();
                if (!this.modeService.modeHasTool(activeMode, toolCall.name)) {
                    const msg = `Tool "${toolCall.name}" is not available in mode "${activeMode.slug}". The active agent does not include this tool in its toolGroups.`;
                    console.warn(`[Pipeline] Mode-gate denied: ${toolCall.name} not in ${activeMode.slug} (source=${dispatchSourceForGate})`);
                    this.logOperation(toolCall, false, Date.now() - startTime, msg, undefined);
                    return this.errorResult(toolCall.id, msg);
                }
            }

            // 2. Governance: ignore / protected path check
            const validation = this.validatePaths(toolCall, tool.isWriteOperation);
            if (!validation.allowed) {
                return this.errorResult(toolCall.id, validation.reason ?? 'Operation denied');
            }

            // 2b. Input schema validation (AUDIT-006 H-5)
            // FIX-PERF-09: validateToolInput is statically imported so
            // the dynamic-import-per-call overhead is gone.
            const definition = tool.getDefinition();
            if (definition.input_schema?.properties && toolCall.input) {
                const schemaErrors = validateToolInput(toolCall.input, definition.input_schema);
                if (schemaErrors.length > 0) {
                    const msg = schemaErrors.map(e => e.message).join('; ');
                    return this.errorResult(toolCall.id, `Input validation failed: ${msg}`);
                }
            }

            // 2c. Result cache: return cached content for identical read-only calls
            if (ToolExecutionPipeline.CACHEABLE.has(toolCall.name)) {
                const cKey = this.cacheKey(toolCall.name, toolCall.input);
                const cached = this.resultCache.get(cKey);
                if (cached !== undefined) {
                    callbacks.log(`[Cache HIT] ${toolCall.name}`);
                    this.logOperation(toolCall, true, 0, undefined, '[cached]');
                    return { type: 'tool_result', tool_use_id: toolCall.id, content: cached, is_error: false };
                }
            }

            // 3. Approval. ADR-153: runs for EVERY tool call, with no pre-filter.
            // Whether confirmation is needed is decided solely by checkApproval,
            // from the central effect class. The pre-filter that used to sit here
            // (`tool.isWriteOperation || group in {mcp, subtask, sandbox}`) let
            // five tools with real side effects through, because they declared
            // `isWriteOperation = false` about themselves -- among them
            // update_settings, which let the agent switch off its own
            // default-deny.
            const approval = await this.checkApproval(toolCall, tool, extensions);
            if (approval.decision === 'rejected') {
                return this.errorResult(toolCall.id, approval.reason ?? 'Operation denied by user');
            }
            // FEAT-29-07: when the user approves a dynamically-discovered
            // plugin-API call, count the approval. Once the per-method
            // threshold is reached AND the method name matches the read
            // heuristic, the method is auto-promoted into
            // safeMethodOverrides so future calls skip the prompt.
            // Only fires for genuine USER approvals -- auto-approved
            // calls (decision === 'auto') don't count, otherwise the
            // promotion would be trivial.
            if (
                approval.decision === 'approved'
                && toolCall.name === 'call_plugin_api'
            ) {
                void this.maybeAutoPromotePluginApi(toolCall.input);
            }

            // 3b. Cache invalidation: write tools invalidate cached reads for affected paths
            // FIX-PERF-23: pathIndex Map gives O(1) per-path invalidation
            // instead of the previous O(N) substring scan over every
            // cached key.
            if (tool.isWriteOperation) {
                const affectedPath = this.writeTargetPath(toolCall);
                if (affectedPath) {
                    const keys = this.pathIndex.get(affectedPath);
                    if (keys) {
                        for (const key of keys) this.resultCache.delete(key);
                        this.pathIndex.delete(affectedPath);
                    }
                }
            }

            // 4. Checkpoint before each write — snapshot the file BEFORE it is modified.
            //    Every write gets its own checkpoint for granular restore (Kilo Code pattern).
            if (tool.isWriteOperation && (this.plugin.settings.enableCheckpoints ?? true)) {
                const path = this.writeTargetPath(toolCall);
                if (path) {
                    try {
                        const cp = await this.plugin.checkpointService?.snapshot(
                            this.taskId, [path], toolCall.name
                        );
                        if (cp && cp.commitOid !== 'empty' && extensions?.onCheckpoint) {
                            extensions.onCheckpoint(cp);
                        }
                    } catch (e) {
                        console.warn('[Pipeline] Checkpoint failed (non-fatal):', e);
                    }
                }
            }

            // FEAT-44-10: the user rewrote the proposal in the approval gate before
            // saying yes. Their version is the one that lands, not the agent's, so
            // we write it and skip execute -- re-running the tool would just
            // recompute the agent's content and overwrite them.
            //
            // FIX-44-19: this sits AFTER the checkpoint and the cache invalidation,
            // not before them. It used to return early, which meant a user-edited
            // write got no snapshot (so Undo could not reach back past it -- the
            // task's earliest checkpoint already contained the edit) and left the
            // read cache holding the pre-write content. A write the user made by
            // hand deserves exactly the same safety net as one the agent made.
            if (approval.decision === 'approved' && typeof approval.finalContent === 'string') {
                // FIX-44-13a: the previewed path wins -- `input.path` is '' for
                // tools that say `note_path` (the memory-source pair), and the
                // preview names the file whose diff the user actually edited.
                const editedPath = approval.editedPath
                    ?? (typeof toolCall.input?.path === 'string' ? toolCall.input.path : '');
                const written = await safeNoteWrite(this.plugin.app, editedPath, approval.finalContent);
                if (!written.ok) {
                    return this.errorResult(toolCall.id, `Approved edit was refused: ${written.reason}`);
                }
                // FIX-44-50: for tools whose effect is not purely the file
                // (memory-source pair: the store registration), skipping
                // execute() must not skip that effect. unmark is the sharp
                // case: the approved diff removed the marker from the note,
                // but without store.remove the note stayed registered and
                // kept being extracted into memory -- after the user approved
                // revoking exactly that. Failures are reported, not swallowed:
                // the gate just showed this change as done.
                let effectsWarning = '';
                if (hasNonFileEffects(tool)) {
                    try {
                        await tool.applyNonFileEffects(toolCall.input, approval.finalContent);
                    } catch (e) {
                        console.warn(`[Pipeline] applyNonFileEffects failed for ${toolCall.name}:`, e);
                        effectsWarning =
                            ` WARNING: the file write landed, but the tool's non-file effect FAILED: `
                            + `${e instanceof Error ? e.message : String(e)}`;
                    }
                }
                this.logOperation(toolCall, true, 0);
                return {
                    type: 'tool_result',
                    tool_use_id: toolCall.id,
                    content:
                        `<success>Applied the user's edited version of ${editedPath}. `
                        + `They changed the content you proposed, so the file now holds THEIR version, not yours. `
                        + `Re-read it before your next edit.${effectsWarning}</success>`,
                    is_error: false,
                };
            }

            // 5. Execute the tool
            const collectedContent: string[] = [];
            let multimodalContent: import('../../api/types').ToolResultContentBlock[] | null = null;
            let executionHadError = false;

            const wrappedCallbacks: ToolCallbacks = {
                pushToolResult: (content: string | import('../../api/types').ToolResultContentBlock[]) => {
                    if (typeof content === 'string') {
                        collectedContent.push(content);
                        if (content.startsWith('<error>')) executionHadError = true;
                    } else {
                        // Multimodal content: store the array, extract text for logging
                        multimodalContent = content;
                        for (const block of content) {
                            if (block.type === 'text') {
                                collectedContent.push(block.text);
                                if (block.text.startsWith('<error>')) executionHadError = true;
                            }
                        }
                    }
                    callbacks.pushToolResult(content);
                },
                // Progress messages go to the UI only — NOT accumulated in conversation history.
                pushProgress: (content: string) => {
                    callbacks.pushToolResult(content);
                },
                handleError: (tool: string, error: unknown) => callbacks.handleError(tool, error),
                log: (msg: string) => callbacks.log(msg),
            };

            const context: ToolExecutionContext = {
                taskId: this.taskId,
                mode: this.mode,
                apiHandler: this.apiHandler,
                abortSignal: extensions?.abortSignal,
                callbacks: wrappedCallbacks,
                askQuestion: extensions?.askQuestion,
                onOptionalAssetRequired: extensions?.onOptionalAssetRequired,
                signalCompletion: extensions?.signalCompletion,
                updateTodos: extensions?.updateTodos,
                switchMode: extensions?.switchMode,
                spawnSubtask: extensions?.spawnSubtask,
                compositionStack: extensions?.compositionStack,
                consumeAdvisorSlot: extensions?.consumeAdvisorSlot,
                invalidateToolCache: extensions?.invalidateToolCache,
                activateDeferredTool: extensions?.activateDeferredTool,
                getReadFiles: extensions?.readFiles ? () => extensions.readFiles! : undefined,
            };

            await tool.execute(toolCall.input, context);

            // FIX-H: track successful file reads for todo-verification (ADR-090 follow-up)
            // Must happen BEFORE the hallucination scan below so this same call's
            // read counts toward the readFiles set if the user does read+write
            // in one batch (rare but possible).
            if (!executionHadError && extensions?.readFiles
                && (toolCall.name === 'read_file' || toolCall.name === 'read_document')) {
                const path = toolCall.input?.path;
                if (typeof path === 'string' && path.length > 0) {
                    extensions.readFiles.add(path);
                }
            }

            // FIX-I: hallucination brake on write tools. If the agent writes a
            // Quellen:/Sources: frontmatter block with [[wikilinks]] to notes
            // it has not read in this task, push a warning into collectedContent
            // BEFORE textContent is finalised so the agent sees it. (ADR-090)
            // Wrapped in try/catch so a scanner bug NEVER blocks tool execution.
            if (!executionHadError && extensions?.readFiles
                && (toolCall.name === 'write_file' || toolCall.name === 'append_to_file' || toolCall.name === 'update_frontmatter')) {
                try {
                    const unread = scanUnreadSources(toolCall.input, extensions.readFiles);
                    if (unread.length > 0) {
                        const warn = `\n[HALLUCINATION BRAKE] You wrote source references to notes you have not read in this task: ${unread.slice(0, 5).map((u) => `"${u}"`).join(', ')}${unread.length > 5 ? `, ... +${unread.length - 5} more` : ''}. Either read those notes now (read_file) and rewrite with verified content, or remove them from the Quellen/Sources frontmatter. Do not claim sources you have not opened.`;
                        collectedContent.push(warn);
                        console.debug(`[HallucinationBrake] ${toolCall.name}: ${unread.length} unread refs — ${unread.slice(0, 3).join(', ')}`);
                    }
                } catch (e) {
                    console.warn('[HallucinationBrake] scan failed (non-fatal, skipping):', e);
                }
            }

            // 6. Persistent operation log + cache write
            const durationMs = Date.now() - startTime;
            const textContent = collectedContent.join('\n');
            this.logOperation(toolCall, !executionHadError, durationMs, undefined, textContent);

            // Cache successful read-only results for deduplication (text-only, FULL content)
            // FIX-PERF-23: enforce LRU cap + update pathIndex for O(1)
            // write-invalidation.
            if (!executionHadError && ToolExecutionPipeline.CACHEABLE.has(toolCall.name)) {
                const key = this.cacheKey(toolCall.name, toolCall.input);
                this.resultCache.delete(key);
                this.resultCache.set(key, textContent);
                if (this.resultCache.size > ToolExecutionPipeline.RESULT_CACHE_LIMIT) {
                    // done-narrowing keeps the key typed as string on both older
                    // and newer TS iterator typings (same pattern as RunSkillScriptCache).
                    const oldest = this.resultCache.keys().next();
                    if (!oldest.done) {
                        this.resultCache.delete(oldest.value);
                        for (const [path, keys] of this.pathIndex) {
                            keys.delete(oldest.value);
                            if (keys.size === 0) this.pathIndex.delete(path);
                        }
                    }
                }
                const path = toolCall.input?.path as string | undefined;
                if (typeof path === 'string') {
                    let bucket = this.pathIndex.get(path);
                    if (!bucket) {
                        bucket = new Set<string>();
                        this.pathIndex.set(path, bucket);
                    }
                    bucket.add(key);
                }
            }

            // 6b. ADR-063: Context Externalization — write large results to temp files
            // Must happen AFTER cache write (cache stores full content) and BEFORE return.
            // Multimodal content (images) is never externalized.
            let finalContent: string | import('../../api/types').ToolResultContentBlock[] = multimodalContent ?? textContent;
            if (!multimodalContent && this.resultExternalizer) {
                const ref = await this.resultExternalizer.maybeExternalize(
                    toolCall.name, toolCall.input, textContent, executionHadError,
                );
                if (ref !== null) {
                    finalContent = ref;
                }
            }

            // 6c. FEAT-24-03 (ADR-63 amendment): hard per-tool output cap — the
            // floor that catches anything the externalizer skipped or that slipped
            // through (e.g. an MCP tool with a huge response).
            {
                const capChars = readAwareOutputCap(
                    toolCall.name,
                    this.apiHandler?.getModel()?.info?.contextWindow,
                );
                const capResult = capOversizedToolOutput(finalContent, executionHadError, capChars);
                if (capResult.capped) {
                    finalContent = capResult.content;
                    console.debug(`[Pipeline] Capped ${toolCall.name} output ${capResult.originalLength} -> ${(finalContent as string).length} chars`);
                }
            }

            // 6d. FIX-44-44: report a write that landed WITHOUT an individual
            // diff approval (settings-auto, run-scope grant, or a name-only
            // card). The finalContent path above returns earlier and never gets
            // here -- there the user saw and shaped the diff. The sidebar opens
            // the post-task review exactly when at least one of these exists.
            if (tool.isWriteOperation && !executionHadError && approval.diffReviewed !== true) {
                extensions?.onUnreviewedWrite?.(toolCall.name);
            }

            // 7. Chat-Linking: track written .md paths for deferred frontmatter stamping (ADR-022)
            if (tool.isWriteOperation && !executionHadError && extensions?.conversationId) {
                const writePath = toolCall.input?.path as string | undefined;
                if (writePath) {
                    this.plugin.trackChatLinkPath(extensions.conversationId, writePath);
                }
            }

            return {
                type: 'tool_result',
                tool_use_id: toolCall.id,
                content: finalContent,
                is_error: executionHadError,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[Pipeline] Tool execution failed: ${toolCall.name}`, error);
            await callbacks.handleError(toolCall.name, error);
            this.logOperation(toolCall, false, Date.now() - startTime, errorMessage, undefined);
            return this.errorResult(toolCall.id, errorMessage);
        }
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /**
     * AUDIT-034 M-10: Per-tool path-key map for multi-path tools whose
     * vault-relevant inputs are NOT named `path`. Without this, move_file
     * (source/destination), extract_zip (zip_path/target_folder),
     * generate_canvas (source/output_path), plan_presentation (source) and
     * the other listed entries silently bypassed IgnoreService. Each entry
     * lists the input keys plus whether the key is read-only (only isIgnored
     * is enforced) or write-side (isIgnored + isProtected when isWrite).
     */
    private static readonly PATH_INPUT_KEYS: Record<string, Array<{ key: string; write: boolean }>> = {
        // single-path tools fall through to the default `path` handling below,
        // but listing them here keeps the contract explicit and is harmless.
        move_file: [
            { key: 'source', write: true },
            { key: 'destination', write: true },
        ],
        extract_zip: [
            { key: 'zip_path', write: false },
            { key: 'target_folder', write: true },
        ],
        generate_canvas: [
            { key: 'source', write: false },
            { key: 'output_path', write: true },
        ],
        plan_presentation: [
            { key: 'source', write: false },
        ],
        restore_checkpoint: [
            { key: 'path', write: true },
        ],
        // FIX-44-51: the memory-source pair addresses its note via `note_path`,
        // which is neither `path` nor was it listed here -- ignore/protected
        // rules never ran for them, so a note under an ignored folder could be
        // frontmatter-tagged AND registered for memory extraction entirely
        // outside governance. Write-side: both tools modify the note.
        mark_note_as_memory_source: [
            { key: 'note_path', write: true },
        ],
        unmark_note_as_memory_source: [
            { key: 'note_path', write: true },
        ],
    };

    /**
     * Check ignore/protected rules for file-path tools.
     *
     * Default behaviour: inspect `input.path`. For multi-path tools that
     * declare their vault keys in PATH_INPUT_KEYS, iterate the declared
     * keys instead so move_file / extract_zip / generate_canvas /
     * plan_presentation / restore_checkpoint cannot bypass governance.
     */
    private validatePaths(toolCall: ToolUse, isWrite: boolean): ValidationResult {
        const ignoreService: IgnoreService | undefined = this.plugin.ignoreService;
        if (!ignoreService) return { allowed: true };

        const keys = ToolExecutionPipeline.PATH_INPUT_KEYS[toolCall.name];
        if (keys && keys.length > 0) {
            for (const entry of keys) {
                const value = toolCall.input?.[entry.key];
                if (typeof value !== 'string' || value.length === 0) continue;
                if (ignoreService.isIgnored(value)) {
                    return { allowed: false, reason: ignoreService.getDenialReason(value) };
                }
                if (entry.write && isWrite && ignoreService.isProtected(value)) {
                    return { allowed: false, reason: ignoreService.getDenialReason(value) };
                }
            }
            return { allowed: true };
        }

        const path = toolCall.input?.path as string | undefined;
        if (!path) return { allowed: true };

        if (ignoreService.isIgnored(path)) {
            return { allowed: false, reason: ignoreService.getDenialReason(path) };
        }

        if (isWrite && ignoreService.isProtected(path)) {
            return { allowed: false, reason: ignoreService.getDenialReason(path) };
        }

        return { allowed: true };
    }

    /**
     * Determine if this tool call needs approval and whether it's already granted.
     * Returns an ApprovalResult with the decision and optional edited content.
     */
    /**
     * Decide whether this tool call needs approval, and obtain it if so.
     *
     * ADR-153: the decision depends SOLELY on the central effect class
     * (toolEffects.ts), no longer on the self-declared `isWriteOperation` and no
     * longer on a local name map. This method runs for EVERY tool call -- there
     * is no pre-filter a tool could slip past.
     */
    /**
     * FEAT-44-02: grant keys the user approved "for the rest of this run". The
     * Pipeline is constructed per task, so this dies with the run -- consent is
     * never carried into the next one, and never persisted.
     *
     * FIX-44-39: the set holds RESOLVED grant keys, not coarse effect classes.
     * For input-dependent effects (plugin-api) the key encodes what the card
     * actually showed ('plugin-api:read' vs 'plugin-api:write'), so a grant
     * given on a read card never covers writes.
     *
     * FEAT-44-07: wrapped in a store together with the revocation epoch the
     * grants were made under, so the kill switch can void them even inside
     * subtasks that inherited the store before the reset.
     *
     * config and self-modify can never land in here: they are alwaysAsk, and the
     * agent must not be able to buy itself a blanket permission by asking nicely
     * once. Enforced BOTH at lookup (checkApproval checks alwaysAsk first) and
     * at insert (askOrDeny refuses to store them, FIX-44-39/S1).
     */
    private runGrants: RunGrantStore = { epoch: 0, keys: new Set<ApprovalGrantKey>() };

    /**
     * FEAT-44-02: adopt the parent run's grant store so "for the rest of this
     * run" survives into a subtask / invoked skill. The parent shares its actual
     * store (not a copy), so a grant made in the child is also visible to the
     * parent and siblings for the remainder of the run. alwaysAsk effects still
     * never enter the set, so this cannot widen config / self-modify.
     */
    setRunApprovedEffects(shared: RunGrantStore): void {
        this.runGrants = shared;
    }

    /** Expose the run-scope grant store so a parent task can share it with subtasks. */
    getRunApprovedEffects(): RunGrantStore {
        return this.runGrants;
    }

    /**
     * FIX-44-39: resolve the key a scope grant is stored/looked up under.
     * Mirrors the permanent path (effectToPermKey + shared isPluginApiWriteCall):
     * plugin-api resolves per input, every other effect keeps its class key.
     */
    private resolveGrantKey(effect: ToolEffect, toolCall: ToolUse): ApprovalGrantKey {
        if (effect === 'plugin-api') {
            return this.isPluginApiWriteCall(toolCall) ? 'plugin-api:write' : 'plugin-api:read';
        }
        return effect;
    }

    /**
     * FEAT-44-02a: the session-scope set lives on the PLUGIN instance (never
     * persisted, dies on reload), so every pipeline sees the same grants without
     * explicit sharing. Optional-typed because legacy test stubs construct the
     * pipeline with a bare plugin object; a missing set simply means "no session
     * grants", which is the fail-closed direction.
     */
    private getSessionGrants(): Set<ApprovalGrantKey> | undefined {
        const holder = this.plugin as Partial<Pick<ObsidianAgentPlugin, 'sessionApprovedGrants'>>;
        return holder.sessionApprovedGrants instanceof Set ? holder.sessionApprovedGrants : undefined;
    }

    /**
     * FEAT-44-07 (kill switch, part b): while paranoid mode is on, every effect
     * except read/ui asks, whatever the config, presets, and scope grants say.
     */
    private isParanoidMode(): boolean {
        return this.plugin.settings.paranoidMode === true;
    }

    private getRevocationEpoch(): number {
        const holder = this.plugin as Partial<Pick<ObsidianAgentPlugin, 'approvalRevocationEpoch'>>;
        return typeof holder.approvalRevocationEpoch === 'number' ? holder.approvalRevocationEpoch : 0;
    }

    /**
     * FEAT-44-07 (kill switch, part a): void the run grants when the plugin's
     * revocation epoch moved past the one the store was filled under. The store
     * (not a bare Set) is what parent and subtasks share, so the epoch travels
     * WITH the grants: whichever pipeline notices the bump first clears the
     * shared keys for everyone. Called lazily on every grant lookup -- the
     * settings tab cannot reach into per-task pipelines directly.
     */
    private syncRunGrantsWithRevocationEpoch(): void {
        const epoch = this.getRevocationEpoch();
        if (this.runGrants.epoch !== epoch) {
            this.runGrants.keys.clear();
            this.runGrants.epoch = epoch;
        }
    }

    /**
     * FEAT-44-02: tools that ALWAYS re-ask, even when their effect class was
     * approved for the run or the session. A scope grant for 'vault-change'
     * should not silently authorise a mass rollback or a bulk archive
     * extraction -- those have a far larger blast radius than the edit the user
     * actually consented to.
     */
    private static readonly SCOPE_GRANT_EXEMPT_TOOLS: ReadonlySet<string> = new Set([
        'restore_checkpoint',
        'extract_zip',
    ]);

    private async checkApproval(
        toolCall: ToolUse,
        tool: unknown,
        extensions?: ContextExtensions,
    ): Promise<ApprovalResult> {
        const cfg = this.plugin.settings.autoApproval;
        const effect = resolveToolEffect(toolCall.name, toolCall.input);

        // Unknown tool: fail-closed. NO fallback to a harmless class -- that
        // fallback was precisely the bug. Registering a tool means adding it to
        // TOOL_EFFECTS (enforced by toolEffectCompleteness.test.ts).
        if (effect === undefined) {
            console.warn(
                `[Pipeline] ${toolCall.name} has no effect class -- approval required (fail-closed)`,
            );
            return await this.askOrDeny(toolCall, tool, extensions, 'unclassified');
        }

        // FEAT-44-07 (kill switch, part b): paranoid mode. Checked FIRST, before
        // any branch that could auto-approve (scope grants, key:null classes,
        // settings), so it clamps ALL of them. Only read/ui stay auto -- they
        // mutate nothing, and gating them would make the plugin unusable.
        if (this.isParanoidMode() && effect !== 'read' && effect !== 'ui') {
            return await this.askOrDeny(toolCall, tool, extensions, effect);
        }

        const policy = EFFECT_POLICY[effect];

        // config + self-modify: never auto-approvable, whatever the settings
        // say. This is the lock against self-escalation (AUDIT-006 H-3) and the
        // M-7 contract for persona/memory/source mutations.
        if (policy.alwaysAsk) {
            return await this.askOrDeny(toolCall, tool, extensions, effect);
        }

        // FEAT-44-02: the user already said yes to this kind of change for this run.
        // Checked AFTER policy.alwaysAsk, so config/self-modify can never be waved
        // through by it. High-blast-radius tools (mass rollback, bulk extract) are
        // exempt -- a run-grant for their effect still re-asks for them.
        // FIX-44-39: looked up under the RESOLVED grant key, so a plugin-api
        // read grant does not cover writes of the same effect class.
        // FEAT-44-02a: scope order is run -> session -> settings. Both scope
        // lookups sit behind the alwaysAsk check and in front of the persisted
        // settings, and both honour the blast-radius exemptions.
        const grantKey = this.resolveGrantKey(effect, toolCall);
        if (!ToolExecutionPipeline.SCOPE_GRANT_EXEMPT_TOOLS.has(toolCall.name)) {
            // FEAT-44-07: the kill switch may have voided run grants since the
            // last lookup; sync before honouring them.
            this.syncRunGrantsWithRevocationEpoch();
            if (this.runGrants.keys.has(grantKey)) {
                return { decision: 'auto' };
            }
            if (this.getSessionGrants()?.has(grantKey) === true) {
                return { decision: 'auto' };
            }
        }

        // read + ui: always auto, DELIBERATELY independent of the master toggle.
        // The master is off by default; if reads hung off it, every read_file
        // would raise a card. plugin-api also has key === null but is resolved
        // from the input below.
        if (policy.key === null && effect !== 'plugin-api') {
            return { decision: 'auto' };
        }

        if (cfg.enabled) {
            const auto = this.isAutoApprovedBySettings(effect, policy.key, toolCall, cfg);
            if (auto) return { decision: 'auto' };
        }

        return await this.askOrDeny(toolCall, tool, extensions, effect);
    }

    /**
     * Whether the effect is auto-approved by settings while the master toggle is
     * on. Only called from checkApproval, after alwaysAsk and the always-auto
     * classes have been handled.
     */
    private isAutoApprovedBySettings(
        effect: ToolEffect,
        key: keyof AutoApprovalConfig | null,
        toolCall: ToolUse,
        cfg: AutoApprovalConfig,
    ): boolean {
        // plugin-api: read and write hang off different flags.
        if (effect === 'plugin-api') {
            return this.isPluginApiWriteCall(toolCall)
                ? cfg.pluginApiWrite === true
                : cfg.pluginApiRead === true;
        }

        if (key === null || cfg[key] !== true) return false;

        // AUDIT-034 L-17: the general skills toggle only covers skills from a
        // trusted source. An imported skill must still go through the per-skill
        // prompt in InvokeSkillTool even when the toggle is on.
        if (effect === 'skill' && toolCall.name === 'invoke_skill') {
            const rawName: unknown = toolCall.input?.skill_name;
            const targetName = typeof rawName === 'string' ? rawName.trim() : '';
            // Malformed call -- let the tool itself reject it.
            if (targetName.length === 0) return true;
            const source = this.plugin.selfAuthoredSkillLoader?.getSkill(targetName)?.source ?? 'user';
            return PIPELINE_TRUSTED_SKILL_SOURCES.has(source);
        }

        return true;
    }

    /**
     * Obtain user approval. With no callback wired we deny rather than wave the
     * call through (ADR-05, fail-closed).
     */
    private async askOrDeny(
        toolCall: ToolUse,
        tool: unknown,
        extensions: ContextExtensions | undefined,
        effect: ToolEffect | 'unclassified',
    ): Promise<ApprovalResult> {
        if (!extensions?.onApprovalRequired) {
            console.warn(
                `[Pipeline] No approval callback for ${toolCall.name} (${effect}) -- denying (fail-closed)`,
            );
            return { decision: 'rejected' };
        }

        // FEAT-44-10: a change is approved on its diff, not on its name. Any tool
        // that can say what it would do WITHOUT doing it gets to show that. This
        // is deliberately not restricted to note edits: delete_file is the most
        // destructive thing the agent can do and used to show the least -- a card
        // with a tool name on it. It now renders the full content of the doomed
        // note as a deletion diff.
        //
        // A failed preview costs the diff, never the approval.
        let preview: EditPreview | undefined;
        if (hasEditPreview(tool)) {
            preview = (await tool.previewEdit(toolCall.input)) ?? undefined;
        }

        const result = await extensions.onApprovalRequired(toolCall.name, toolCall.input, preview);

        // FIX-44-39: store the RESOLVED grant key, and refuse to store alwaysAsk
        // effects (S1) -- the no-config/self-modify invariant must hold in the
        // sets themselves, not only in the lookup order, because the run set is
        // shared with subtasks and the session set with every future task.
        if (
            result.decision === 'approved'
            && effect !== 'unclassified'
            && !EFFECT_POLICY[effect].alwaysAsk
            // FEAT-44-07: while paranoid mode is on, the card hides the scope
            // buttons; if a grant flag arrives anyway, refuse to bank it --
            // otherwise it would silently arm the moment paranoid is turned off.
            && !this.isParanoidMode()
        ) {
            const grantKey = this.resolveGrantKey(effect, toolCall);
            if (result.rememberForRun === true) {
                this.syncRunGrantsWithRevocationEpoch();
                this.runGrants.keys.add(grantKey);
                console.debug(`[Pipeline] '${grantKey}' approved for the rest of this run`);
            }
            // FEAT-44-02a: session scope, one level above the run scope.
            if (result.rememberForSession === true) {
                this.getSessionGrants()?.add(grantKey);
                console.debug(`[Pipeline] '${grantKey}' approved for this session`);
            }
        }
        // FIX-44-13a: remember WHICH file the edited finalContent belongs to.
        // The write branch used to fall back to `toolCall.input.path`, which is
        // '' for tools that address their note via `note_path` (the
        // memory-source pair) -- safeNoteWrite then refused the user's version.
        const editedPath = preview && result.decision === 'approved' && typeof result.finalContent === 'string'
            ? preview.path
            : undefined;
        // FIX-44-44: only the Pipeline decides whether this approval was given on
        // a real diff. The flag from the UI (if any) is overwritten -- a caller
        // must not be able to claim a diff review that never happened.
        return {
            ...result,
            ...(editedPath !== undefined ? { editedPath } : {}),
            diffReviewed: result.decision === 'approved' && preview !== undefined,
        };
    }

    /**
     * FIX-44-13a: the vault path a write tool is about to touch. Most tools
     * say `path`; the memory-source pair says `note_path`. Cache invalidation
     * and the pre-write checkpoint must cover both, otherwise a frontmatter
     * write via mark/unmark got no snapshot and left stale cached reads.
     */
    private writeTargetPath(toolCall: ToolUse): string | undefined {
        const raw = toolCall.input?.path ?? toolCall.input?.note_path;
        if (typeof raw !== 'string' || raw.length === 0) return undefined;
        // FIX-44-52: key checkpoint + cache on the path the write actually
        // lands on. The tools normalize via validateVaultRelativePath
        // (backslashes -> '/', leading '/' stripped); snapshotting the raw
        // string ('Notes\\N.md') snapshots a file that does not exist while
        // the real one changes unprotected. Fall back to the raw string when
        // validation rejects -- such a call is denied downstream anyway, and
        // invalidating whatever was cached under the raw key stays harmless.
        return validateVaultRelativePath(raw) ?? raw;
    }

    /**
     * Write a log entry via OperationLogger (if available).
     * Synchronous by design: the log write itself is fire-and-forget
     * (FIX-PERF-08), so there is nothing to await here.
     */
    private logOperation(
        toolCall: ToolUse,
        success: boolean,
        durationMs: number,
        errorMessage?: string,
        resultContent?: string,
    ): void {
        const logger: OperationLogger | undefined = this.plugin.operationLogger;
        if (logger) {
            // FIX-PERF-08: fire-and-forget. Tool dispatch should not wait
            // for a log write to land on disk. The logger has its own
            // retry/queue; failures surface via .catch() instead of
            // blocking the agent loop.
            void logger.log({
                timestamp: new Date().toISOString(),
                taskId: this.taskId,
                mode: this.mode,
                tool: toolCall.name,
                params: toolCall.input,
                result: resultContent,
                success,
                durationMs,
                error: errorMessage,
            }).catch((err) => {
                console.warn('[Pipeline] operationLogger.log failed (non-fatal):', err);
            });
        } else if (this.plugin.settings.debugMode) {
            // Fallback: console only
            console.debug(`[Pipeline] ${toolCall.name} — ${success ? 'ok' : 'error'} (${durationMs}ms)`);
        }
    }

    /**
     * Determine if a call_plugin_api invocation is a write operation.
     * Built-in allowlist: use isWrite flag. Dynamic discovery: always write
     * unless user marked as safe.
     */
    private isPluginApiWriteCall(toolCall: ToolUse): boolean {
        // FIX-44-03a: shared with the sidebar so gate and grant cannot diverge.
        return resolvePluginApiIsWrite(toolCall.input, this.plugin.settings.pluginApi);
    }

    /**
     * FEAT-29-07: count user-approvals of Tier-2 (dynamically discovered)
     * plugin-API methods. Fires recordApprovalAndMaybePromote which
     * mutates the settings and -- once the threshold + read-heuristic
     * line up -- adds the method to safeMethodOverrides so subsequent
     * calls are auto-approved.
     *
     * Non-blocking: saveSettings is awaited in a detached Promise so
     * the hot path returns immediately. Errors are swallowed: a failed
     * promotion never breaks the user's tool call.
     */
    private async maybeAutoPromotePluginApi(input: Record<string, unknown>): Promise<void> {
        const pluginId = ((input?.plugin_id as string) ?? '').trim();
        const method = ((input?.method as string) ?? '').trim();
        if (!pluginId || !method) return;

        // Only count Tier-2 methods (not in the built-in allowlist).
        // Tier-1 entries already have a static isWrite flag and need no promotion.
        const allowedEntry = findAllowedMethod(pluginId, method);
        if (allowedEntry) return;

        const { recordApprovalAndMaybePromote } = await import('../tools/agent/pluginApiAdaptive');
        const apiSettings = this.plugin.settings.pluginApi;
        if (!apiSettings) return;
        const result = recordApprovalAndMaybePromote(apiSettings, pluginId, method);
        try {
            await this.plugin.saveSettings();
            if (result.promoted) {
                console.debug(`[PluginApi] Auto-promoted ${pluginId}:${method} (count ${result.newCount})`);
            }
        } catch (e) {
            console.warn('[PluginApi] saveSettings after approval failed (non-fatal):', e);
        }
    }

    private errorResult(toolUseId: string, message: string): ToolResult {
        return {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: `<error>${message}</error>`,
            is_error: true,
        };
    }
}


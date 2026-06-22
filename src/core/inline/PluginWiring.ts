/**
 * PluginWiring -- live Obsidian-API adapters for the Inline-Editor-AI layer (EPIC-33).
 *
 * Centralises every adapter that connects the Inline modules to the
 * Obsidian Plugin API so main.ts only needs a single call:
 *
 *   plugin.inlineActionService = wireInlineActions(plugin);
 *
 * Each adapter is small and intentionally defensive. When a probe
 * cannot resolve (no active editor, sidebar leaf missing, ...) it
 * returns null instead of throwing so the InlineActionService can
 * silently no-op.
 *
 * Related: ADR-138 (Sidebar-Independence wiring), PLAN-42 main.ts
 * wiring step.
 */

import { MarkdownView, type App, type WorkspaceLeaf } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { InlineActionRegistry } from './InlineActionRegistry';
import { InlineTriggerResolver } from './InlineTriggerResolver';
import { InlineFloatingMenu } from './InlineFloatingMenu';
import { InlineActionService, type EditorSelectionProbe } from './InlineActionService';
import type { ChatSidebarController } from './actions/SendToMainChatAction';
import { SendToMainChatAction } from './actions/SendToMainChatAction';
import { LookupAction, type VaultRagPipeline } from './actions/LookupAction';
import { RewriteAction } from './actions/RewriteAction';
import { TranslateAction } from './actions/TranslateAction';
import { SummarizeAction } from './actions/SummarizeAction';
import { FindActionItemsAction } from './actions/FindActionItemsAction';
import { InlineChatAction, type NoteWriter } from './chat/InlineChatAction';
import { DefaultVaultRagPipeline, type SemanticIndexProbe } from './lookup/VaultRagPipeline';
import { resolveInlineActionsSettings } from './inlineSettings';
import type { InlineLLMCaller, InlineLLMStreamArgs, InlineLLMStreamCallbacks } from './InlineLLMCaller';
import type { InlineSettingsSnapshot } from './InlineTriggerContext';
import { VIEW_TYPE_AGENT_SIDEBAR } from '../../ui/AgentSidebarView';
import { SelectionWatcher } from './SelectionWatcher';
import { InlineSkillFilter, type SkillCapabilityProbe, type SkillEntry } from './skills/InlineSkillFilter';
import { InlineSkillAction } from './skills/InlineSkillAction';
import { inlineDiffExtension, startDiffSession } from './diff/CodeMirrorDiffAdapter';

/**
 * Live editor probe. Reads MarkdownView -> editor.getSelection() and
 * computes the absolute char offset of the cursor.
 */
function buildEditorProbe(plugin: ObsidianAgentPlugin): EditorSelectionProbe {
    const app: App = plugin.app;
    return {
        probe: () => {
            const view = app.workspace.getActiveViewOfType(MarkdownView);
            if (view === null) return null;
            const editor = view.editor;
            const selection = editor.getSelection();
            const cursor = editor.getCursor();
            // Convert {line, ch} into absolute char offset.
            const cursorPos = editor.posToOffset(cursor);
            // Determine editor mode: 'source' / 'live-preview' / 'reading'.
            // Obsidian's MarkdownView.getMode() returns 'source' (incl. live-preview)
            // or 'preview'. We map 'preview' -> 'reading'.
            const obsMode = view.getMode();
            const editorMode = obsMode === 'preview'
                ? 'reading'
                // EDITORIAL: differentiate source vs live-preview via state if available.
                : (view.getState() as { source?: boolean } | undefined)?.source === true ? 'source' : 'live-preview';
            const notePath = view.file?.path ?? '';
            return {
                selectionText: selection ?? '',
                editorMode,
                cursorPos,
                notePath,
            };
        },
        getMenuContainer: () => {
            const view = app.workspace.getActiveViewOfType(MarkdownView);
            return view?.contentEl ?? null;
        },
        getMenuPosition: () => {
            // Best-effort: cursor-coords would require querying CodeMirror.
            // For Welle 1 we open near the view's content origin; the
            // floating-menu clamps to viewport so this stays usable.
            const view = app.workspace.getActiveViewOfType(MarkdownView);
            const rect = view?.contentEl.getBoundingClientRect();
            if (rect === undefined) return { x: 100, y: 100 };
            return { x: rect.left + 40, y: rect.top + 40 };
        },
    };
}

function buildChatSidebarController(plugin: ObsidianAgentPlugin): ChatSidebarController {
    return {
        isOpen: () => plugin.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT_SIDEBAR).length > 0,
        open: async () => {
            await plugin.activateView();
        },
        insertContextChip: async ({ text, notePath }) => {
            // Light-weight wiring: invoke the existing sidebar leaf and
            // ask it to pre-populate its composer with the selection.
            const leaf = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT_SIDEBAR)[0] as WorkspaceLeaf | undefined;
            if (leaf === undefined) return;
            // The Sidebar-View does not expose a typed public API for
            // context injection yet. We use a CustomEvent so the
            // sidebar can listen and react without a hard import cycle.
            const evt = new CustomEvent('vault-operator:inline-send-to-chat', {
                detail: { text, notePath },
            });
            plugin.app.workspace.containerEl.dispatchEvent(evt);
        },
    };
}

function buildNoteWriter(plugin: ObsidianAgentPlugin): NoteWriter {
    const app = plugin.app;
    return {
        insertAtCursor: async ({ notePath, cursorPos, text }) => {
            const view = app.workspace.getActiveViewOfType(MarkdownView);
            if (view === null) return;
            if (view.file?.path !== notePath) return;
            const editor = view.editor;
            const from = editor.offsetToPos(cursorPos);
            editor.replaceRange(text, from, from);
        },
    };
}

/**
 * Builds an InlineLLMCaller backed by the plugin's active provider.
 * Defensive: returns onError when no apiHandler exists.
 */
function buildLLMCaller(plugin: ObsidianAgentPlugin): InlineLLMCaller {
    return {
        stream: async (args: InlineLLMStreamArgs, callbacks: InlineLLMStreamCallbacks): Promise<void> => {
            try {
                const api = plugin.apiHandler;
                if (api === null || api === undefined) {
                    callbacks.onError(new Error('No active provider'));
                    return;
                }
                const messages = [{ role: 'user' as const, content: args.userMessage }];
                for await (const chunk of api.createMessage(args.systemPrompt, messages, [])) {
                    if (chunk.type === 'text' && typeof chunk.text === 'string') {
                        callbacks.onText(chunk.text);
                    }
                }
                callbacks.onComplete();
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                callbacks.onError(err);
            }
        },
    };
}

function buildSemanticIndexProbe(plugin: ObsidianAgentPlugin): SemanticIndexProbe | null {
    // Live wiring over SemanticIndexService.embedTexts + VectorStore.searchUniqueFiles.
    // Returns null when either dependency is not initialised so LookupAction
    // falls back to LLM-only.
    interface SiHost {
        semanticIndex?: { embedTexts?: (texts: string[]) => Promise<Float32Array[]> } | null;
        vectorStore?: {
            searchUniqueFiles?: (q: Float32Array, topK: number, pathPrefix?: string) => Array<{ path: string; text: string; score: number }>;
        } | null;
    }
    const host = plugin as unknown as SiHost;
    const semantic = host.semanticIndex;
    const vectorStore = host.vectorStore;
    if (semantic === undefined || semantic === null) return null;
    if (vectorStore === undefined || vectorStore === null) return null;
    return {
        embedText: async (text: string) => {
            const fn = semantic.embedTexts;
            if (typeof fn !== 'function') return [];
            try {
                const [vec] = await fn.call(semantic, [text]);
                if (vec instanceof Float32Array) return Array.from(vec);
                return [];
            } catch (e) {
                console.debug('[inline-rag] embedText failed (LLM-only fallback):', e);
                return [];
            }
        },
        queryNoteVectors: async ({ embedding, topN }) => {
            const fn = vectorStore.searchUniqueFiles;
            if (typeof fn !== 'function' || embedding.length === 0) return [];
            try {
                const query = new Float32Array(embedding);
                // pathPrefix undefined = exclude session:/episode:/fact:/... -> only notes.
                const raw = fn.call(vectorStore, query, topN) as Array<{ path: string; text?: string; score?: number }>;
                return raw.map((r) => ({
                    notePath: r.path,
                    excerpt: r.text?.slice(0, 200),
                    cosineSimilarity: typeof r.score === 'number' ? r.score : 0,
                }));
            } catch (e) {
                console.debug('[inline-rag] queryNoteVectors failed (LLM-only fallback):', e);
                return [];
            }
        },
    };
}

function buildSettingsSnapshotProvider(plugin: ObsidianAgentPlugin): () => InlineSettingsSnapshot {
    return () => {
        const settings = plugin.settings;
        const activeKey = settings.activeModelKey;
        const activeModel = settings.activeModels.find(m => m.name === activeKey) ?? settings.activeModels[0];
        return {
            modelId: activeModel?.name ?? '',
            provider: activeModel?.provider ?? settings.defaultProvider ?? 'anthropic',
            skillIds: [],
            customPromptIds: [],
        };
    };
}

/**
 * Build a SkillCapabilityProbe over the active SelfAuthoredSkillLoader.
 * The probe reads skill name + description from the loader and the
 * inline-capability mapping from settings (FEAT-33-08 ADR-141).
 * Returns an empty list when the loader is missing -- safe default.
 */
function buildSkillProbe(plugin: ObsidianAgentPlugin): SkillCapabilityProbe {
    interface LoaderHost {
        selfAuthoredSkillLoader?: { getAllSkills?: () => Array<{ name: string; description?: string }> } | null;
    }
    const host = plugin as unknown as LoaderHost;
    return {
        listSkills: (): SkillEntry[] => {
            const loader = host.selfAuthoredSkillLoader;
            if (loader === undefined || loader === null || typeof loader.getAllSkills !== 'function') return [];
            const skills = loader.getAllSkills();
            const caps = plugin.settings.inlineActions?.skillCapabilities ?? {};
            return skills.map((s): SkillEntry => ({
                id: s.name,
                label: s.name,
                description: s.description,
                capability: caps[s.name],
            }));
        },
    };
}

/**
 * Build action-aware callbacks. For Rewrite the streamed text feeds
 * the CodeMirror diff session. For other actions we surface text via
 * an Obsidian Notice (compact preview-block until the dedicated
 * preview UI ships). Errors always Notice.
 */
function buildActionAwareCallbacks(
    plugin: ObsidianAgentPlugin,
    actionId: string,
    ctx: import('./InlineTriggerContext').InlineTriggerContext,
): import('../AgentTask').AgentTaskCallbacks {
    if (actionId === 'rewrite') {
        let collected = '';
        return {
            onText: (chunk) => { collected += chunk; },
            onToolStart: () => {},
            onToolResult: () => {},
            onComplete: () => {
                try {
                    const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
                    if (view === null) return;
                    const editor = view.editor;
                    const from = ctx.cursorPos;
                    const selLen = ctx.selectionText.length;
                    if (selLen === 0 || collected.length === 0) return;
                    // Find the selection in the doc; fallback to current
                    // editor selection bounds.
                    const cmView = (editor as unknown as { cm?: import('@codemirror/view').EditorView }).cm;
                    if (cmView === undefined) return;
                    startDiffSession(cmView, { from, to: from + selLen, proposedText: collected });
                } catch (e) {
                    console.debug('[inline-action] rewrite diff-start failed:', e);
                }
            },
            onError: (err) => {
                showActionNotice(plugin, actionId, `Error: ${err.message}`);
            },
        };
    }
    // Default: collect text, show via Notice on completion.
    let collected = '';
    return {
        onText: (chunk) => { collected += chunk; },
        onToolStart: () => {},
        onToolResult: () => {},
        onComplete: () => {
            if (collected.length === 0) return;
            showActionNotice(plugin, actionId, collected);
        },
        onError: (err) => {
            showActionNotice(plugin, actionId, `Error: ${err.message}`);
        },
    };
}

function showActionNotice(plugin: ObsidianAgentPlugin, actionId: string, text: string): void {
    try {
        // Lazy obsidian import to avoid module-level dependency on the
        // Notice singleton in unit tests.
        const obsidian = require('obsidian') as { Notice?: new (msg: string, durationMs?: number) => unknown };
        if (typeof obsidian.Notice === 'function') {
            const truncated = text.length > 800 ? text.slice(0, 800) + '…' : text;
            new obsidian.Notice(`[${actionId}]\n${truncated}`, 8000);
        }
    } catch {
        // No-op in unit-test environments.
        void plugin;
    }
}

export interface InlineWiringResult {
    service: InlineActionService;
    dispose: () => void;
}

/**
 * One-shot wiring entry. Call from main.ts onload AFTER plugin.settings
 * and plugin.apiHandler have been initialised.
 */
export function wireInlineActions(plugin: ObsidianAgentPlugin): InlineWiringResult {
    const registry = new InlineActionRegistry();
    const resolver = new InlineTriggerResolver({
        getSettingsSnapshot: buildSettingsSnapshotProvider(plugin),
    });
    const editorProbe = buildEditorProbe(plugin);
    const sidebarCtl = buildChatSidebarController(plugin);
    const noteWriter = buildNoteWriter(plugin);
    const llmCaller = buildLLMCaller(plugin);
    const semProbe = buildSemanticIndexProbe(plugin);

    // Default action set. Translate / Summarize-length variants are
    // registered as multiple instances so the floating menu lists
    // each one explicitly (matches Notion AI sub-menu shape).
    registry.register(new SendToMainChatAction({ controller: sidebarCtl }));

    const vaultRag: VaultRagPipeline | undefined = semProbe !== null
        ? new DefaultVaultRagPipeline({ probe: semProbe })
        : undefined;
    registry.register(new LookupAction({
        caller: llmCaller,
        vaultRagPipeline: vaultRag,
        getRagSettings: () => {
            const r = resolveInlineActionsSettings(plugin.settings.inlineActions);
            return {
                enabled: r.vaultRagInLookup,
                confidenceThreshold: r.vaultRagConfidenceThreshold,
                showSourcesInTooltip: r.showVaultSourcesInTooltip,
                topN: 5,
            };
        },
    }));
    registry.register(new RewriteAction({ caller: llmCaller }));
    registry.register(new TranslateAction({ caller: llmCaller, targetLanguage: 'English' }));
    registry.register(new TranslateAction({ caller: llmCaller, targetLanguage: 'German' }));
    registry.register(new SummarizeAction({ caller: llmCaller, length: 'short' }));
    registry.register(new SummarizeAction({ caller: llmCaller, length: 'medium' }));
    registry.register(new FindActionItemsAction({ caller: llmCaller }));
    registry.register(new InlineChatAction({ caller: llmCaller, writer: noteWriter }));

    // FEAT-33-08: Skills marked as inline-eligible via settings appear
    // in the floating menu. The user opts a skill in via the Settings
    // tab (skillCapabilities mapping). No-op when the loader is not yet
    // initialised or no skill has been opted in.
    const skillProbe = buildSkillProbe(plugin);
    const skillFilter = new InlineSkillFilter({
        probe: skillProbe,
        topN: resolveInlineActionsSettings(plugin.settings.inlineActions).skillsTopN,
    });
    const skillInvoker = async (skill: SkillEntry, _ctx: import('./InlineTriggerContext').InlineTriggerContext, cbs: import('../AgentTask').AgentTaskCallbacks): Promise<void> => {
        // Skill invocation through the existing invoke_skill tool is
        // deferred: the Skill-Engine needs a typed entry-point that
        // does not exist yet on the loader. For now, emit a stub
        // notice so the user sees the skill was triggered.
        cbs.onText(`[skill: ${skill.label}] invocation deferred -- wire SkillEngine.runSkill() to enable.`);
        cbs.onComplete();
    };
    // Register each currently-eligible skill at wire time. The list is
    // captured once; users adding skills later need to reload the plugin.
    for (const entry of skillProbe.listSkills()) {
        if (entry.capability?.eligible !== true) continue;
        registry.register(new InlineSkillAction({ entry, invoker: skillInvoker }));
    }

    const service = new InlineActionService({
        editorProbe,
        registry,
        resolver,
        menuFactory: (onPick) => new InlineFloatingMenu({
            containerEl: editorProbe.getMenuContainer() ?? plugin.app.workspace.containerEl,
            registry,
            onPick,
        }),
        isEnabled: () => resolveInlineActionsSettings(plugin.settings.inlineActions).enabled,
        buildActionCallbacks: (action, ctx) => buildActionAwareCallbacks(plugin, action.id, ctx),
    });

    // FEAT-33-03: register CodeMirror Diff-Decoration-Extension so
    // Rewrite-Action streams land as inline diff with Accept/Reject.
    try {
        plugin.registerEditorExtension(inlineDiffExtension());
    } catch (e) {
        console.debug('[inline-actions] inline-diff-extension registration failed (non-fatal):', e);
    }

    // FEAT-33-01 SC-04: open the menu automatically when the user
    // finishes a selection. Honours the floatingMenuEnabled setting.
    const watcher = new SelectionWatcher({
        target: plugin.app.workspace.containerEl.ownerDocument,
        onSettled: () => { service.triggerMenu(); },
        minLength: 3,
        debounceMs: 300,
        isEnabled: () => {
            const r = resolveInlineActionsSettings(plugin.settings.inlineActions);
            return r.enabled && r.floatingMenuEnabled;
        },
    });
    watcher.start();
    skillFilter; // suppress unused warning (kept available for Settings UI consumers)

    return {
        service,
        dispose: () => {
            watcher.dispose();
            service.dispose();
        },
    };
}

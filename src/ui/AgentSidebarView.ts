/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/restrict-template-expressions, @typescript-eslint/unbound-method -- File-level disable: interacts with external SDK / JSON / Obsidian internals where untyped 'any' values are unavoidable. Inputs are validated at boundaries via type guards or schema checks where security-relevant. */
import { ItemView, WorkspaceLeaf, setIcon, Menu, MarkdownRenderer, MarkdownView, Notice, TFile, TFolder } from 'obsidian';
import type ObsidianAgentPlugin from '../main';
import { AgentTaskRunner } from '../core/agent/AgentTaskRunner';
import {
    DEFAULT_CONDENSING_ENABLED,
    DEFAULT_CONDENSING_THRESHOLD,
    DEFAULT_MICROCOMPACTION_ENABLED,
    DEFAULT_ROLLING_SUMMARY_THRESHOLD,
} from '../core/condensingDefaults';
import { ModeService } from '../core/modes/ModeService';
// ADR-153: the approval card consumes the same effect registry as the Pipeline.
// No second, drifting copy of the group mapping.
import { EFFECT_POLICY, resolveToolEffect, type ToolEffect } from '../core/tools/toolEffects';
import { grantAutoApproval } from '../core/tools/autoApprovalGrant';
import { isPluginApiWriteCall } from '../core/tools/agent/pluginApiAdaptive';
import { confirmModal } from './modals/PromptModal';
// FIX-44-12: checkpoint markers persist into the conversation and rehydrate live.
import {
    planCheckpointMarkerRehydration,
    toPersistedCheckpointMarker,
    type PersistedCheckpointMarker,
} from './checkpointMarkerRehydration';
import type { MessageParam, ContentBlock } from '../api/types';
import { getModelKey, getFirstEnabledModelKey, modelToLLMProvider, OKF_DEFAULTS } from '../types/settings';
import type { CustomModel } from '../types/settings';
import { buildApiHandler, buildApiHandlerForModel } from '../api/index';
import { ToolPickerPopover } from './sidebar/ToolPickerPopover';
import { McpServerPopover } from './sidebar/McpServerPopover';
import { ChatModelPickerPopover, type ChatProviderNav } from './sidebar/ChatModelPickerPopover';
import { resolveEffortLevelsForPin, resolveOverrideModel, resolveStickyChatModel } from './sidebar/chatModelDropdown';
import { shouldSendOnEnter } from './sidebar/composerKeymap';
import {
    DEFAULT_THINKING_OVERRIDE,
    isExplicitThinkingOverride,
    resolveEffectiveThinkingEnabled,
    type ThinkingOverride,
} from './sidebar/thinkingOverride';
import {
    DEFAULT_EFFORT_OVERRIDE,
    resolveEffectiveEffort,
    thinkingSwitchIsOn,
    type EffortOverride,
} from './sidebar/effortOverride';
import type { EffortLevel } from '../types/model-registry';
import { providerConfigToCustomModel, resolveActiveProvider } from '../core/routing/tierResolution';
import { TOOL_METADATA } from '../core/tools/toolMetadata';
import { AttachmentHandler } from './sidebar/AttachmentHandler';
import { wireApprovalTimeout } from './sidebar/approvalTimeout';
import { resolveRunStateButtons } from './sidebar/runStateButtons';
import type { AttachmentItem } from './sidebar/AttachmentHandler';
import { AutocompleteHandler } from './sidebar/AutocompleteHandler';
import { VaultFilePicker } from './sidebar/VaultFilePicker';
import { CommandPicker, type CommandPickerItem } from './sidebar/CommandPicker';
import { resolveObsidianDraggedFiles, resolveObsidianDraggedFolders } from './sidebar/dragManagerBridge';
import { HistoryPanel } from './sidebar/HistoryPanel';
import type { UiMessage } from '../core/history/ConversationStore';
import { LazyConversationId } from '../core/history/LazyConversationId';
import { MemoryRetriever } from '../core/memory/MemoryRetriever';
import { OnboardingService } from '../core/memory/OnboardingService';
import { isActiveOnboardingFlow } from '../core/onboarding-status';
import { ContextTracker } from '../core/context/ContextTracker';
import { TaskMonitor } from './sidebar/TaskMonitor';
import { ContextDisplay } from './sidebar/ContextDisplay';
import { CondensationFeedback } from './sidebar/CondensationFeedback';
import { SuggestionBanner } from './sidebar/SuggestionBanner';
import { OnboardingFlow } from './sidebar/OnboardingFlow';
import { scan as scanTasks } from '../core/tasks/TaskExtractor';
import { TaskNoteCreator } from '../core/tasks/TaskNoteCreator';
import { TaskNotesAdapter } from '../core/tasks/TaskNotesAdapter';
import { TaskSelectionModal } from './TaskSelectionModal';
import { t, getActiveLocale } from '../i18n';
import DOMPurify from 'dompurify';
import { getPerformanceMarks } from '../core/observability/PerformanceMarks';

export const VIEW_TYPE_AGENT_SIDEBAR = 'obsidian-agent-sidebar';

/**
 * AUDIT-034 M-4: Defensive sanitization for rehydrated tool-step HTML.
 *
 * stepsBlockEl.outerHTML is persisted into the conversation JSON on every
 * assistant turn and re-parsed on chat reload. All current writers are
 * first-party safe (setText / createEl / createSpan), but if an attacker
 * gains write access to the conversation JSON (untrusted sync, hostile MCP
 * flow), the stored string would round-trip to the live Electron renderer
 * unchecked. DOMPurify strips script / iframe / object / embed / link / meta
 * tags plus event-handler attributes plus javascript: URLs before we ever
 * touch the live DOM.
 *
 * RETURN_DOM_FRAGMENT gives back a sanitized DocumentFragment we can append
 * via importNode + appendChild, matching the existing rehydration shape.
 */
const TOOL_STEPS_SANITIZE_CONFIG = {
    RETURN_DOM_FRAGMENT: true as const,
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'frame', 'frameset'],
    FORBID_ATTR: ['srcdoc', 'srcset', 'formaction', 'action', 'background', 'poster', 'ping'],
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
};

/**
 * Agent Sidebar View
 *
 * Matches Kilo Code's UI/UX patterns:
 * - Clean header with title + New Chat button
 * - Scrollable messages area with Markdown rendering
 * - Chat input with integrated toolbar (mode, settings, send/stop)
 * - Persistent conversation history across messages
 * - Cancel running requests
 */
export class AgentSidebarView extends ItemView {
    plugin: ObsidianAgentPlugin;
    private modeService!: ModeService;
    private chatContainer: HTMLElement | null = null;
    private inputArea: HTMLElement | null = null;
    private textarea: HTMLTextAreaElement | null = null;
    // Note: modeButton was removed in FEAT-26-05; chat-header has no mode UI anymore.
    private modelButton: HTMLButtonElement | null = null;
    /**
     * EPIC-26 / FEAT-26-05: per-turn chat-header override.
     * null  -> Auto (advisor pattern, tier-resolved main loop)
     * string -> explicit model id on the active provider (advisor off for this turn)
     * Reset to null when the active provider changes.
     */
    private chatModelOverride: string | null = null;
    /**
     * Per-conversation extended-thinking override (issue #44).
     * 'follow' -> use the active model's own thinkingEnabled (default, no change)
     * 'on'/'off' -> force thinking on/off for this conversation only.
     * Lives alongside chatModelOverride; reset to 'follow' on a fresh chat.
     */
    private chatThinkingOverride: ThinkingOverride = DEFAULT_THINKING_OVERRIDE;
    /**
     * Per-conversation reasoning-effort override.
     * 'auto' -> send no effort field (default, byte-identical to today).
     * A native level -> request that effort level. Threaded on every
     * model-resolution path the thinking override uses (chat-pin, mode,
     * default-active), so it works in auto mode too. Applied to the main-loop
     * model only; router tier-swaps to the budget helper or frontier do not
     * carry it, the same accepted limitation as the thinking override.
     * Lives alongside chatModelOverride; reset to 'auto' on a fresh chat.
     */
    private chatEffortOverride: EffortOverride = DEFAULT_EFFORT_OVERRIDE;
    /** EPIC-26 / FEAT-26-05: searchable popover for picking the chat-header model. */
    private chatModelPicker: ChatModelPickerPopover | null = null;
    private sendButton: HTMLElement | null = null;
    private stopButton: HTMLElement | null = null;
    private contextBadgeContainer: HTMLElement | null = null;

    // Feature 1: Persistent conversation history (survives across messages)
    private conversationHistory: MessageParam[] = [];
    /**
     * IMP-41-03-01: inflight snapshot armed for the next send. Set by the
     * boot recovery banner's Resume button; consumed (and cleared) at the
     * execute() call so the loop continues with the snapshot's state and
     * full history instead of starting fresh.
     */
    private pendingResume: import('../core/agent/InflightStore').InflightSnapshot | null = null;
    // Chat History: active conversation tracking + UI messages for persistence
    private activeConversationId: string | null = null;
    /** FIX-03-20-01: race-free lazy id creation when the store initializes late. */
    private readonly lazyConversationId = new LazyConversationId();
    private uiMessages: UiMessage[] = [];
    private historyPanel: HistoryPanel | null = null;

    // Feature 3: AbortController for cancelling in-flight requests
    private currentAbortController: AbortController | null = null;
    /**
     * FIX-24-08-03: signal of the most recently started run. Unlike
     * `currentAbortController` this is NOT nulled by handleStop, so
     * approval cards surfacing from a draining task bind an already-
     * aborted signal (immediate rejection) instead of undefined
     * (10-minute wall-clock hang).
     */
    private lastRunAbortSignal: AbortSignal | null = null;
    /**
     * IMP-24-08-04: per-run hook that swaps the Working spinner for a
     * "Stopping" row the moment Stop is pressed. Without it the spinner
     * keeps spinning until the stopped run drains to its next abort
     * checkpoint, which reads as "Stop did nothing".
     */
    private currentStopFeedback: (() => void) | null = null;
    /** GUARD-L1: true between Stop and the aborted loop's onComplete/onError. */
    private taskDraining = false;
    private taskDrainingTimer = 0;

    // FEAT-24-08 / ADR-114 Steering-Hook: user-typed mid-run messages
    // queue up while a task is running and get drained by AgentTask at the
    // start of the next iteration via consumeSteeringMessages. The bubbleEl
    // reference lets the sidebar flip the UI from "queued" to
    // "delivered at iteration N" the moment AgentTask consumes the entry.
    private steeringQueue: Array<{ text: string; bubbleEl: HTMLElement }> = [];

    // Context: tracks whether user dismissed the auto-injected file for this turn
    private userDismissedContext = false;
    // Session-local flag: the Frontmatter Operator recommendation toast is
    // shown at most once per sidebar-view lifetime (in addition to the
    // persistent frontmatterOperatorHintDismissed setting).
    private frontmatterOperatorHintShownThisSession = false;
    // Last user message text — used by "Regenerate" action
    private lastUserMessage = '';
    // Last known active MarkdownView — tracked because clicking sidebar loses getActiveViewOfType
    private lastMarkdownView: MarkdownView | null = null;
    // Hidden message flag — when true, skip user bubble rendering but still send to LLM
    private nextMessageHidden = false;
    // Onboarding key-setup state machine (chat-based flow, no LLM needed)
    private onboarding: OnboardingFlow | null = null;

    // Health badge (FEATURE-1901)
    private healthBadge: HTMLElement | null = null;
    // Browser-style chat navigation: linear stack of conversation IDs the user
    // visited via arrow nav. navIndex = position in the stack; entries beyond
    // the index are the forward history (truncated when a fresh chat is loaded
    // from outside the back/forward path). null sentinel = "new/empty chat".
    private navStack: Array<string | null> = [];
    private navIndex = -1;
    private navBackBtn: HTMLButtonElement | null = null;
    private navForwardBtn: HTMLButtonElement | null = null;
    // Tool picker (pocket-knife button)
    private toolPickerButton: HTMLElement | null = null;
    // Web search toggle button (globe icon)
    private webToggleButton: HTMLElement | null = null;
    /** Manages tool/skill/workflow picker */
    private toolPicker!: ToolPickerPopover;
    /** Manages MCP server picker (opened from the "+" menu) */
    private mcpPicker!: McpServerPopover;
    /** Manages pending attachments and chip bar UI */
    private attachments!: AttachmentHandler;
    /** Manages / and @ autocomplete dropdown */
    private autocomplete!: AutocompleteHandler;
    /** Vault file picker popover (@ button) */
    private vaultFilePicker!: VaultFilePicker;
    /** Context tracking for condensing */
    private contextTracker: ContextTracker | null = null;
    /** Context window visualization */
    private contextDisplay: ContextDisplay | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: ObsidianAgentPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.modeService = new ModeService(plugin);
        this.toolPicker = new ToolPickerPopover(plugin, this.modeService);

        // FIX-26-99-03 hook: settings ModesTab + NewModeModal need access to
        // the same ModeService instance the sidebar uses, otherwise they
        // edit a fresh detached copy whose state never reaches the agent
        // loop. AgentSettingsTab.findActiveModeService() looks for this
        // method on the open sidebar leaf.
        // (Declared inline to avoid a class field ordering hazard with
        // the property initializer ordering of the file's eslint-disable
        // file header.)
        (this as unknown as { getModeServiceOrNull(): ModeService | null }).getModeServiceOrNull = () => this.modeService ?? null;
        this.mcpPicker = new McpServerPopover(plugin);
        this.vaultFilePicker = new VaultFilePicker(
            this.app,
            async (files) => { for (const f of files) await this.attachments.addVaultFile(f); },
        );
    }

    getViewType(): string {
        return VIEW_TYPE_AGENT_SIDEBAR;
    }

    getDisplayText(): string {
        return t('ui.sidebar.title');
    }

    getIcon(): string {
        return 'square-slash';
    }

    async onOpen(): Promise<void> {
        // MEAS-01: time from view-instantiation to first render-done. This
        // is the TTI a user actually perceives, so it is intentionally
        // wrapped around the readiness-await too.
        const perfMarks = getPerformanceMarks();
        perfMarks.start('sidebar.onOpen');

        // BUG-026 (2026-04-19): wait for plugin.doLoad() to finish before
        // reading settings / mode service. Obsidian instantiates this view
        // the moment registerView runs (layout restore), which during a
        // BRAT hot reload is before settings exist. Without this guard
        // the view threw "Cannot read properties of undefined (reading
        // 'currentMode')" and the whole sidebar stayed broken.
        //
        // FIX-PERF-28: prefer shellReady (settings + ModeService) over
        // the full readyPromise so the sidebar paints its input shell
        // while KnowledgeDB / Memory / Semantic / MCP are still booting
        // in the background. Fall back to readyPromise on older plugin
        // builds that have not introduced shellReady yet.
        const pluginAsAny = this.plugin as unknown as {
            shellReady?: Promise<void>;
            readyPromise?: Promise<void>;
        };
        const readiness = pluginAsAny.shellReady ?? pluginAsAny.readyPromise;
        if (readiness) {
            try { await readiness; } catch { /* doLoad errors are surfaced elsewhere; keep rendering */ }
        }

        // Initialize ModeService — loads global modes from ~/.obsidian-agent/modes.json
        await this.modeService.initialize();

        const container = this.containerEl.children[1];
        if (!(container != null && container.instanceOf(HTMLElement))) return;
        container.empty();
        container.addClass('obsidian-agent-sidebar');

        // Initialize context tracker with current model's context window
        try {
            const currentModeSlug = this.modeService.getActiveMode().slug;
            const modeModelKey = this.resolveEnabledModelKey(currentModeSlug);
            const resolvedModel = this.plugin.settings.activeModels.find((m) => getModelKey(m) === modeModelKey);

            if (resolvedModel) {
                const apiHandler = buildApiHandlerForModel(resolvedModel);
                const model = apiHandler.getModel();
                const contextWindow = model?.info?.contextWindow ?? 200_000;
                const maxTokens = resolvedModel?.maxTokens;
                this.contextTracker = new ContextTracker(contextWindow, maxTokens);
            } else {
                // Fallback if no model is configured
                this.contextTracker = new ContextTracker(200_000, 8192);
            }
        } catch (e) {
            console.debug('[AgentSidebarView] Failed to initialize context tracker:', e);
            this.contextTracker = new ContextTracker(200_000, 8192);
        }

        this.buildHeader(container);
        this.buildChatContainer(container);
        this.buildSuggestionBanner(container);
        this.buildChatInput(container);
        this.buildAiDisclaimer(container);

        // Feature 4: Update context badge when user switches files; reset dismiss on new file
        // Also track last active MarkdownView so "Insert at cursor" works from sidebar
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', (leaf) => {
                this.userDismissedContext = false;
                this.updateContextBadge();
                if (leaf?.view instanceof MarkdownView) {
                    this.lastMarkdownView = leaf.view;
                }
            })
        );
        this.registerEvent(
            this.app.workspace.on('file-open', () => {
                this.userDismissedContext = false;
                this.updateContextBadge();
            })
        );

        // EPIC-33: refresh the history panel when the inline panel
        // saves a new conversation, so the entry appears immediately
        // (otherwise the user has to close+reopen the sidebar).
        const onInlineSaved = (): void => {
            this.historyPanel?.refresh();
        };
        this.app.workspace.containerEl.addEventListener(
            'vault-operator:conversation-list-changed',
            onInlineSaved,
        );
        this.register(() => {
            this.app.workspace.containerEl.removeEventListener(
                'vault-operator:conversation-list-changed',
                onInlineSaved,
            );
        });

        this.showWelcomeMessage();
        // IMP-41-03-01: offer recovery for tasks interrupted by a crash or
        // reload. Non-blocking; skips silently when the store is not ready.
        void this.maybeOfferInflightResume();
        // Language-pack install-prompt: renders the same consent card as
        // tool-triggered asset installs, so a non-English user gets a
        // visible chat card instead of a small notice that is easy to
        // miss. Non-blocking; skips silently when English or already
        // installed. Obsidian policy: download only on explicit click.
        void this.maybeOfferLocalePackCard();
        perfMarks.end('sidebar.onOpen', { log: true });
    }

    /**
     * IMP-41-03-01: boot recovery banner. When a fresh inflight snapshot
     * exists, render a card offering Resume (arms pendingResume, loads the
     * conversation, sends a resume note through the normal send path) or
     * Discard (clears the snapshot). Fail-closed: any error only logs.
     */
    private async maybeOfferInflightResume(): Promise<void> {
        try {
            const store = this.plugin.inflightStore;
            if (!store || !this.chatContainer) return;
            const recoverable = await store.listRecoverable();
            if (recoverable.length === 0) return;
            const snapshot = recoverable[0];

            const row = this.chatContainer.createDiv('tool-approval-row');
            const iconSpan = row.createSpan('tool-approval-icon');
            setIcon(iconSpan, 'history');
            row.createSpan('tool-approval-text').setText(
                t('ui.resume.interrupted', {
                    time: new Date(snapshot.savedAt).toLocaleTimeString(),
                    messages: String(snapshot.history.length),
                }),
            );
            const actions = row.createDiv('tool-approval-actions');
            const resumeBtn = actions.createEl('button', {
                cls: 'tool-approval-btn approval-allow-once',
                text: t('ui.resume.resume'),
            });
            const discardBtn = actions.createEl('button', {
                cls: 'tool-approval-btn approval-deny-small',
                text: t('ui.resume.discard'),
            });

            resumeBtn.addEventListener('click', () => {
                void (async () => {
                    row.remove();
                    // IMP-24-08-04: the card now also appears right after
                    // Stop, in the conversation that is already active --
                    // reloading it would repaint the chat mid-view.
                    if (snapshot.conversationId && snapshot.conversationId !== this.activeConversationId) {
                        await this.loadConversation(snapshot.conversationId, { skipNavPush: true })
                            .catch(() => { /* stale id: resume still works from the snapshot history */ });
                    }
                    this.pendingResume = snapshot;
                    await store.clear(snapshot.taskId);
                    if (this.textarea) {
                        this.textarea.value = '[System] The previous task was interrupted. '
                            + 'Resume from where you left off using the conversation so far; '
                            + 'do not redo work that is already done.';
                        await this.handleSendMessage();
                    }
                })();
            });
            discardBtn.addEventListener('click', () => {
                row.remove();
                void store.clear(snapshot.taskId);
            });
        } catch (e) {
            console.warn('[InflightResume] banner failed (non-fatal):', e instanceof Error ? e.message : e);
        }
    }

    onClose(): Promise<void> {
        this.currentAbortController?.abort();
        // Guard every call: onClose may run before onOpen completed if plugin init failed upstream
        try { this.saveCurrentConversation(); } catch { /* non-fatal */ }
        try { this.enqueueMemoryExtraction(); } catch { /* non-fatal */ }
        this.attachments?.clear();
        return Promise.resolve();
    }

    private buildHeader(container: HTMLElement): void {
        const header = container.createDiv('agent-header');

        const titleRow = header.createDiv('agent-title');
        titleRow.createSpan({
            cls: 'agent-title-wordmark',
            text: '/ Vault Operator', // i18n-ignore: brand wordmark
        });

        const headerRight = header.createDiv('agent-header-right');

        // FEATURE-1901 / BUG-025 (2026-04-19): vault-health indicator moved from
        // next-to-title to left-of-settings in the header-right group, and the
        // severity dot replaced with a `stethoscope` lucide icon. Hidden unless
        // at least one finding exists. Colour comes from the severity-* class
        // via styles.css.
        this.healthBadge = headerRight.createEl('button', {
            cls: 'header-button health-badge',
            attr: { 'aria-label': t('ui.sidebar.vaultHealth') },
        });
        setIcon(this.healthBadge.createSpan('toolbar-icon'), 'stethoscope');
        this.healthBadge.classList.add('agent-u-hidden');
        this.healthBadge.addEventListener('click', () => {
            this.openHealthModal();
        });
        // Sync from the plugin in case the health check already ran before the
        // view mounted (common after a BRAT hot-reload or leaf rebuild).
        this.syncHealthBadge();

        // Settings button — moved here from toolbar
        const settingsBtn = headerRight.createEl('button', {
            cls: 'header-button',
            attr: { 'aria-label': t('ui.sidebar.settings') },
        });
        setIcon(settingsBtn.createSpan('toolbar-icon'), 'settings');
        settingsBtn.addEventListener('click', () => {
            this.app.setting?.open();
            // Navigate to plugin tab after modal is rendered (200ms is robust for most machines)
            window.setTimeout(() => this.app.setting?.openTabById(this.plugin.manifest.id), 200);
        });

        // History button — opens conversation history panel
        const historyBtn = headerRight.createEl('button', {
            cls: 'header-button',
            attr: { 'aria-label': t('ui.sidebar.chatHistory') },
        });
        setIcon(historyBtn.createSpan('toolbar-icon'), 'history');
        historyBtn.addEventListener('click', () => {
            this.ensureHistoryPanel();
            this.historyPanel?.toggle();
        });

        // FEATURE-0318: Save-to-memory is exposed via the chat input "..." menu
        // (Save conversation to memory) and via the per-row star in the
        // history panel. The header had a duplicate star toggle that confused
        // the visual language of "filled = in memory" -- removed.

        // New Chat button — clears conversation history
        const newChatBtn = headerRight.createEl('button', {
            cls: 'header-button',
            attr: { 'aria-label': t('ui.sidebar.newChat') },
        });
        setIcon(newChatBtn.createSpan('toolbar-icon'), 'message-square-plus');
        newChatBtn.addEventListener('click', () => this.clearConversation());

        // Browser-style back/forward through recently opened chats. Sit on
        // the far right of the header so the arrow cluster doesn't compete
        // with the primary controls. Triangles (chevron-left/right) read
        // better than full arrows in the narrow sidebar.
        this.navBackBtn = headerRight.createEl('button', {
            cls: 'header-button header-button--nav',
            attr: { 'aria-label': t('ui.sidebar.previousChat') },
        });
        setIcon(this.navBackBtn.createSpan('toolbar-icon'), 'chevron-left');
        this.navBackBtn.addEventListener('click', () => { void this.navBack(); });

        this.navForwardBtn = headerRight.createEl('button', {
            cls: 'header-button header-button--nav',
            attr: { 'aria-label': t('ui.sidebar.nextChat') },
        });
        setIcon(this.navForwardBtn.createSpan('toolbar-icon'), 'chevron-right');
        this.navForwardBtn.addEventListener('click', () => { void this.navForward(); });

        this.updateNavButtons();
    }

    private buildChatContainer(container: HTMLElement): void {
        // Chat container is wrapped in a relative parent so the history panel can overlay it
        const chatWrapper = container.createDiv('chat-wrapper');

        this.chatContainer = chatWrapper.createDiv('chat-messages');

        // History panel (absolute overlay inside the wrapper)
        const store = this.plugin.conversationStore;
        if (store) {
            this.historyPanel = new HistoryPanel(
                store,
                (id) => { void this.loadConversation(id); },
                (id) => { void this.deleteConversation(id); },
                (convId, title) => { void this.stampChatLinkToActiveFile(convId, title); },
                this.activeConversationId,
                (id, title) => this.saveHistoryConversationToMemory(id, title),
                (id, title) => this.removeHistoryConversationFromMemory(id, title),
                (id) => this.plugin.countMemoryFactsForConversation(id) > 0,
                (id, currentTitle) => this.renameHistoryConversation(id, currentTitle),
                (id, title) => this.confirmPendingConversation(id, title),
            );
            this.historyPanel.mount(chatWrapper);
        }
    }

    /**
     * Lazy-initialize the history panel. Needed because onOpen() may run before
     * doLoad() finishes (Obsidian restores the sidebar layout synchronously),
     * so conversationStore can be null when buildChatContainer() first runs.
     */
    private ensureHistoryPanel(): void {
        if (this.historyPanel) return;
        const store = this.plugin.conversationStore;
        const chatWrapper = this.chatContainer?.parentElement;
        if (!store || !chatWrapper) return;
        this.historyPanel = new HistoryPanel(
            store,
            (id) => { void this.loadConversation(id); },
            (id) => { void this.deleteConversation(id); },
            (convId, title) => { void this.stampChatLinkToActiveFile(convId, title); },
            this.activeConversationId,
            (id, title) => this.saveHistoryConversationToMemory(id, title),
            (id, title) => this.removeHistoryConversationFromMemory(id, title),
            (id) => this.plugin.countMemoryFactsForConversation(id) > 0,
            (id, currentTitle) => this.renameHistoryConversation(id, currentTitle),
        );
        this.historyPanel.mount(chatWrapper);
    }

    private suggestionBanner: SuggestionBanner | null = null;

    /** Mount the suggestion banner (delegates to SuggestionBanner module). */
    private buildSuggestionBanner(container: HTMLElement): void {
        this.suggestionBanner = new SuggestionBanner(this.plugin, this.app);
        this.suggestionBanner.mount(container, (fn) => this.register(fn));
    }

    /**
     * IMP-41-03-05: compact status tile for the single background research
     * task. Subscribes to the runner and unsubscribes on view unload.
     */
    private buildBackgroundTaskTile(container: HTMLElement): void {
        const runner = this.plugin.backgroundTaskRunner;
        if (!runner) return;
        const tile = container.createDiv('background-task-tile');
        tile.hide();
        const icon = tile.createSpan('background-task-tile-icon');
        setIcon(icon, 'satellite');
        const label = tile.createSpan('background-task-tile-label');
        const stopBtn = tile.createEl('button', {
            cls: 'background-task-tile-stop',
            text: t('ui.backgroundTask.stop'),
        });
        stopBtn.addEventListener('click', () => runner.stop());

        const render = (): void => {
            const status = runner.getStatus();
            if (status) {
                label.setText(t('ui.backgroundTask.running', { title: status.title }));
                tile.show();
            } else {
                tile.hide();
            }
        };
        render();
        this.register(runner.onChange(() => render()));
    }

    private buildAiDisclaimer(container: HTMLElement): void {
        const disclaimer = container.createDiv({ cls: 'chat-ai-disclaimer' });
        disclaimer.setText(t('ui.sidebar.aiDisclaimer'));
    }

    private buildChatInput(container: HTMLElement): void {
        this.inputArea = container.createDiv('chat-input-container');
        // IMP-41-03-05: background-task status tile above the input. Hidden
        // by default; the runner's onChange subscription toggles it.
        this.buildBackgroundTaskTile(this.inputArea);
        const inputWrapper = this.inputArea.createDiv('chat-input-wrapper');

        // Context chips at the top of the input wrapper (like Kilo Code)
        this.contextBadgeContainer = inputWrapper.createDiv('chat-context-chips');
        this.updateContextBadge();

        // Attachment chip bar (below context chips, above textarea)
        const chipBar = inputWrapper.createDiv('chat-attachment-chips');
        this.attachments = new AttachmentHandler(this.app.vault, chipBar, this.plugin);

        this.textarea = inputWrapper.createEl('textarea', {
            cls: 'chat-textarea',
            attr: { placeholder: t('ui.sidebar.placeholder'), rows: '3' },
        });

        // Initialize autocomplete handler after textarea is created
        this.autocomplete = new AutocompleteHandler(
            this.plugin,
            this.app,
            () => this.textarea,
            () => this.inputArea,
            (file) => this.attachments.addVaultFile(file),
            // FEAT-02-11: folder-mention. Manifest attachment (path list),
            // lazy-read via read_file / read_document.
            (folder, opts) => this.attachments.addVaultFolder(folder, opts),
        );

        this.textarea.addEventListener('input', () => {
            this.autoResizeTextarea();
            void this.autocomplete.handleInput();
            // FEAT-24-08 Steering: toggle Stop -> Send when user starts typing
            // mid-run (and back to Stop when textarea is cleared).
            this.refreshRunStateButtons();
        });

        this.textarea.addEventListener('keydown', (e: KeyboardEvent) => {
            // Autocomplete navigation takes priority
            if (this.autocomplete.handleKeyDown(e)) return;

            // FIX-24-08-03: Escape always stops a running task, independent
            // of textarea content (the button alone was unreachable while
            // steering text sat in the field).
            if (e.key === 'Escape' && this.currentAbortController) {
                e.preventDefault();
                this.handleStop();
                return;
            }

            // Issue #54.1: shared send-decision. Ctrl/Cmd+Enter always sends
            // (universal accelerator, fixes Windows where it was a no-op),
            // plain Enter sends only when sendWithEnter is on; Shift+Enter and
            // IME composition insert a newline.
            const sendWithEnter = this.plugin.settings.sendWithEnter ?? true;
            if (shouldSendOnEnter(e, sendWithEnter)) {
                e.preventDefault();
                this.autocomplete.hide(); // close any open dropdown after a modifier-send
                void this.handleSendMessage();
            }
        });

        // Paste handler — capture images pasted from clipboard (e.g. screenshots)
        this.textarea.addEventListener('paste', (e: ClipboardEvent) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (const item of Array.from(items)) {
                if (item.kind === 'file') {
                    e.preventDefault();
                    const file = item.getAsFile();
                    if (file) void this.attachments.processFile(file);
                }
            }
        });

        // Drag-and-drop handler on the input wrapper. BUG-019: stopPropagation
        // is required on both events so the workspace doesn't steal the drop
        // and open the file in a new tab. The drop payload is resolved in
        // priority order: external OS files, Obsidian's internal drag manager,
        // finally a plain-text path fallback for older Obsidian builds.
        inputWrapper.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            inputWrapper.addClass('drag-over');
        });
        inputWrapper.addEventListener('dragleave', () => inputWrapper.removeClass('drag-over'));
        inputWrapper.addEventListener('drop', (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            inputWrapper.removeClass('drag-over');

            // OS file drop (external drag from Finder/Explorer/GNOME-Files)
            const files = e.dataTransfer?.files;
            if (files && files.length > 0) {
                for (const file of Array.from(files)) void this.attachments.processFile(file);
                return;
            }

            // BUG-019: Obsidian's internal drag populates app.dragManager.draggable
            // instead of dataTransfer.files. This is undocumented but stable across
            // Obsidian 1.4+ and widely used by community plugins. Guarded by a
            // null-check so a future API change silently falls through to the
            // text/plain path.
            //
            // FEAT-02-11: probe folders BEFORE files -- a folder-drag from the
            // file explorer is a distinct payload (`{ type: 'folder', file: TFolder }`)
            // and the folder path carries semantic meaning that a flattened
            // file list would lose. Default recursive, same as the @-mention
            // recursive row.
            const draggedFolders = resolveObsidianDraggedFolders(this.app);
            if (draggedFolders.length > 0) {
                for (const folder of draggedFolders) {
                    void this.attachments.addVaultFolder(folder, { recursive: true });
                }
                return;
            }
            const draggedFiles = resolveObsidianDraggedFiles(this.app);
            if (draggedFiles.length > 0) {
                for (const file of draggedFiles) void this.attachments.addVaultFile(file);
                return;
            }

            // Last-resort fallback: plain-text vault-relative path.
            const textData = e.dataTransfer?.getData('text/plain');
            if (textData) {
                const vaultFile = this.app.vault.getAbstractFileByPath(textData);
                if (vaultFile instanceof TFile) {
                    void this.attachments.addVaultFile(vaultFile);
                } else if (vaultFile instanceof TFolder) {
                    void this.attachments.addVaultFolder(vaultFile, { recursive: true });
                }
            }
        });

        const toolbar = inputWrapper.createDiv('chat-toolbar');
        const toolbarLeft = toolbar.createDiv('chat-toolbar-left');
        const toolbarRight = toolbar.createDiv('chat-toolbar-right');

        // EPIC-26 / FEAT-26-05: Mode switcher removed from the chat header.
        // 2026-05-18: the Agent/Mode-Button in the chat header is gone
        // (FEAT-26-05). Agent management lives in Settings -> Agents.
        // The mode backend stays functional: `currentMode` setting,
        // ModeService, `switch_agent` tool are unchanged.

        // Model button (left, after mode)
        this.modelButton = toolbarLeft.createEl('button', {
            cls: 'toolbar-button model-button',
            attr: { 'aria-label': t('ui.sidebar.selectModel') },
        });
        this.restoreChatModelOverride(); // Issue #54.3: sticky model on view open
        this.updateModelButton();
        this.modelButton.addEventListener('click', (e) => this.showModelMenu(e));

        // "+" button — context menu for adding files/notes (FEATURE-1907)
        const plusBtn = toolbarLeft.createEl('button', {
            cls: 'toolbar-button toolbar-ghost plus-button',
            attr: { 'aria-label': t('ui.sidebar.addContext') },
        });
        setIcon(plusBtn.createSpan('toolbar-icon'), 'plus');
        plusBtn.addEventListener('click', (e) => {
            this.showPlusMenu(e, plusBtn);
        });

        // "..." button — tools, skills, web search (FEATURE-1907)
        const ellipsisBtn = toolbarLeft.createEl('button', {
            cls: 'toolbar-button toolbar-ghost ellipsis-button',
            attr: { 'aria-label': t('ui.sidebar.moreOptions') },
        });
        setIcon(ellipsisBtn.createSpan('toolbar-icon'), 'ellipsis');
        ellipsisBtn.addEventListener('click', (e) => {
            const menu = new Menu();
            // Tools & Skills — opens existing ToolPicker
            menu.addItem(item => item
                .setTitle(t('ui.sidebar.selectTools'))
                .setIcon('pocket-knife')
                .onClick(() => this.toolPicker.show(e, ellipsisBtn, this.containerEl)));
            // Web search toggle
            const webEnabled = this.plugin.settings.webTools?.enabled ?? false;
            menu.addItem(item => item
                .setTitle(webEnabled ? t('ui.sidebar.webSearchOn') : t('ui.sidebar.webSearchOff'))
                .setIcon('globe')
                .onClick(() => { void this.toggleWebSearch(); }));
            // Save to memory (FEATURE-0318 manual trigger -- bypasses throttle + auto toggle)
            menu.addItem(item => item
                .setTitle(t('ui.sidebar.saveToMemory'))
                .setIcon('star')
                .onClick(() => { void this.handleSaveToMemory(); }));
            menu.addSeparator();
            // Original options menu items
            this.addOptionsMenuItems(menu);
            menu.showAtMouseEvent(e);
        });

        // Keep references for backward compat (hidden, managed via "..." menu now)
        this.toolPickerButton = ellipsisBtn;
        this.webToggleButton = ellipsisBtn;

        // Feature 3: Stop button (hidden by default, shown when task is running)
        this.stopButton = toolbarRight.createEl('button', {
            cls: 'toolbar-button stop-button',
            attr: { 'aria-label': t('ui.sidebar.stop') },
        });
        setIcon(this.stopButton.createSpan('toolbar-icon'), 'square');
        this.stopButton.classList.add('agent-u-hidden');
        this.stopButton.addEventListener('click', () => this.handleStop());

        // Send button
        this.sendButton = toolbarRight.createEl('button', {
            cls: 'toolbar-button send-button',
            attr: { 'aria-label': t('ui.sidebar.send') },
        });
        setIcon(this.sendButton.createSpan('toolbar-icon'), 'send-horizontal');
        this.sendButton.addEventListener('click', () => { void this.handleSendMessage(); });

        // FIX-PERF-28c: when the sidebar opened on shellReady (before
        // servicesReady), disable the send button until services finish
        // booting. The button re-enables itself as soon as servicesReady
        // resolves. Existing aria-label is preserved.
        const pluginAny = this.plugin as unknown as { servicesReady?: Promise<void>; readyPromise?: Promise<void> };
        const services = pluginAny.servicesReady ?? pluginAny.readyPromise;
        if (services) {
            const sendEl = this.sendButton as HTMLButtonElement;
            sendEl.disabled = true;
            sendEl.classList.add('send-button-preparing');
            sendEl.setAttribute('title', t('ui.sidebar.preparingServices'));
            services.then(() => {
                sendEl.disabled = false;
                sendEl.classList.remove('send-button-preparing');
                sendEl.removeAttribute('title');
            }).catch(() => {
                // doLoad errors are surfaced elsewhere; still enable the button.
                sendEl.disabled = false;
                sendEl.classList.remove('send-button-preparing');
            });
        }
    }

    /**
     * `+` menu (FEATURE-2207 / 2208): attachments, skills, prompts, workflows.
     * Picking a skill/prompt/workflow prefixes the textarea with the right
     * trigger and focuses the input so the user can add free text.
     */
    private showPlusMenu(e: MouseEvent, anchor: HTMLElement): void {
        const menu = new Menu();
        menu.addItem(item => item
            .setTitle(t('ui.sidebar.attachFile'))
            .setIcon('paperclip')
            .onClick(() => this.attachments.openFilePicker()));
        menu.addItem(item => item
            .setTitle(t('ui.sidebar.addVaultFile'))
            .setIcon('at-sign')
            .onClick(() => this.vaultFilePicker.show(anchor, this.containerEl)));
        menu.addSeparator();
        menu.addItem(item => item
            .setTitle(t('ui.sidebar.insertSkill'))
            .setIcon('sparkles')
            .onClick(() => this.openCommandPicker('skills', anchor)));
        menu.addItem(item => item
            .setTitle(t('ui.sidebar.insertPrompt'))
            .setIcon('message-square-quote')
            .onClick(() => this.openCommandPicker('prompts', anchor)));
        menu.addItem(item => item
            .setTitle(t('ui.sidebar.insertWorkflow'))
            .setIcon('workflow')
            .onClick(() => this.openCommandPicker('workflows', anchor)));
        menu.addSeparator();
        menu.addItem(item => item
            .setTitle(t('ui.sidebar.selectMcpServers'))
            .setIcon('plug-2')
            .onClick(() => this.mcpPicker.show(e, anchor, this.containerEl)));
        menu.showAtMouseEvent(e);
    }

    private async openCommandPicker(
        category: 'skills' | 'prompts' | 'workflows',
        anchor: HTMLElement,
    ): Promise<void> {
        const items = await this.collectCommandItems(category);
        const title = category === 'skills'
            ? t('ui.commandPicker.searchSkills')
            : category === 'prompts'
                ? t('ui.commandPicker.searchPrompts')
                : t('ui.commandPicker.searchWorkflows');
        const empty = category === 'skills'
            ? t('ui.commandPicker.emptySkills')
            : category === 'prompts'
                ? t('ui.commandPicker.emptyPrompts')
                : t('ui.commandPicker.emptyWorkflows');
        const picker = new CommandPicker(items, title, empty);
        picker.show(anchor, this.containerEl);
    }

    private async collectCommandItems(
        category: 'skills' | 'prompts' | 'workflows',
    ): Promise<CommandPickerItem[]> {
        if (category === 'skills') {
            const skills = this.plugin.selfAuthoredSkillLoader?.getAllSkills() ?? [];
            return skills.map((skill) => {
                const slug = AutocompleteHandler.slugifySkillName(skill.name);
                return {
                    label: skill.name,
                    sub: `/${slug}`,
                    tag: 'Skill',
                    icon: 'sparkles',
                    searchable: skill.description,
                    onSelect: () => this.insertPrefixedCommand('/', slug),
                };
            });
        }

        if (category === 'prompts') {
            const activeMode = this.plugin.settings.currentMode;
            const prompts = (this.plugin.settings.customPrompts ?? []).filter(
                (p) => p.enabled !== false && (!p.mode || p.mode === activeMode),
            );
            return prompts.map((prompt) => ({
                label: prompt.name,
                sub: `#${prompt.slug}`,
                tag: 'Prompt',
                icon: 'message-square-quote',
                searchable: prompt.content,
                onSelect: () => this.insertPrefixedCommand('#', prompt.slug),
            }));
        }

        const workflowLoader = this.plugin.workflowLoader;
        if (!workflowLoader) return [];
        const workflows = await workflowLoader.discoverWorkflows();
        const toggles = this.plugin.settings.workflowToggles ?? {};
        return workflows
            .filter((w) => toggles[w.path] !== false)
            .map((wf) => ({
                label: wf.displayName,
                sub: `\u00a7${wf.slug}`,
                tag: 'Workflow',
                icon: 'workflow',
                onSelect: () => this.insertPrefixedCommand('\u00a7', wf.slug),
            }));
    }

    private insertPrefixedCommand(prefix: string, slug: string): void {
        if (!this.inputArea) return;
        const textarea = this.inputArea.querySelector('textarea');
        if (!(textarea instanceof HTMLTextAreaElement)) return;
        const existing = textarea.value;
        const leadsWithPrefix = /^[/#\u00a7]/.test(existing);
        const body = leadsWithPrefix ? existing.split(/\s+/).slice(1).join(' ') : existing;
        textarea.value = `${prefix}${slug}${body ? ' ' + body : ' '}`;
        textarea.focus();
        const pos = textarea.value.length;
        textarea.setSelectionRange(pos, pos);
    }

    private updateContextBadge(): void {
        if (!this.contextBadgeContainer) return;
        this.contextBadgeContainer.empty();

        if (!this.plugin.settings.autoAddActiveFileContext) return;

        const activeFile = this.userDismissedContext ? null : this.app.workspace.getActiveFile();
        if (activeFile) {
            const chip = this.contextBadgeContainer.createDiv('chat-context-chip');
            chip.title = activeFile.path;
            setIcon(chip.createSpan('context-chip-icon'), 'file-text');
            chip.createSpan('context-chip-label').setText(activeFile.basename);
            const removeBtn = chip.createSpan('context-chip-remove');
            setIcon(removeBtn, 'x');
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.userDismissedContext = true;
                this.updateContextBadge();
            });
        }
    }

    /** Resolve a model key for a mode, skipping disabled models: mode override → global → first enabled */
    private resolveEnabledModelKey(modeSlug: string): string {
        const models = this.plugin.settings.activeModels;

        // Check mode override — skip if model is disabled
        const modeOverrideKey = this.plugin.settings.modeModelKeys?.[modeSlug];
        if (modeOverrideKey) {
            const m = models.find((m) => getModelKey(m) === modeOverrideKey);
            if (m?.enabled) return modeOverrideKey;
        }

        // Check global default — skip if model is disabled
        const globalKey = this.plugin.settings.activeModelKey;
        if (globalKey) {
            const m = models.find((m) => getModelKey(m) === globalKey);
            if (m?.enabled) return globalKey;
        }

        // Fallback: first enabled model
        return getFirstEnabledModelKey(models);
    }

    /** Returns the effective model key for the current mode (mode override → global fallback) */
    private getEffectiveModelKey(): string {
        return this.resolveEnabledModelKey(this.plugin.settings.currentMode);
    }

    private updateModelButton(): void {
        if (!this.modelButton) return;
        this.modelButton.empty();
        // EPIC-26 / FEAT-26-05: when a provider is active, the button
        // shows either "Auto" (default) or the explicit override id.
        const activeProvider = resolveActiveProvider(this.plugin.settings);
        let label: string;
        let title: string;
        if (activeProvider) {
            if (this.chatModelOverride === null) {
                label = t('ui.sidebar.modelAuto');
                title = t('ui.sidebar.modelAutoTitle');
            } else {
                // Chat-header always renders the bare core model id, not the
                // provider-supplied displayName. Bedrock cross-region profiles
                // expand into long strings like "EU Anthropic Claude Opus 4.8
                // [Cross-Region Profile]" that push the composer row off-screen.
                // shortenModelId collapses the underlying id to its core form
                // ("eu.anthropic.claude-opus-4-8-v1:0" -> "claude-opus-4-8");
                // the full id and the descriptive displayName stay in the
                // tooltip and inside the picker popover.
                label = this.shortenModelId(this.chatModelOverride);
                title = t('ui.sidebar.modelOverrideTitle', { label: this.chatModelOverride });
            }
        } else {
            // Legacy / pre-migration path: read the flat activeModels[] selection.
            const effectiveKey = this.getEffectiveModelKey();
            const model = this.plugin.settings.activeModels.find((m) => getModelKey(m) === effectiveKey);
            label = model ? (model.displayName ?? model.name) : t('ui.sidebar.noModel');
            const hasModeOverride = !!this.plugin.settings.modeModelKeys?.[this.plugin.settings.currentMode];
            title = hasModeOverride ? t('ui.sidebar.modeOverride', { label }) : label;
        }
        this.modelButton.createSpan('model-label').setText(label);
        // The thinking state stays visible inside the picker popover
        // (chat-model-picker-thinking-switch); the chat composer pill row only
        // shows the model identity, so a thinking deviation is conveyed via the
        // tooltip without a second chip cluttering the row.
        if (isExplicitThinkingOverride(this.chatThinkingOverride)) {
            const thinkingOn = thinkingSwitchIsOn(this.chatThinkingOverride);
            title = thinkingOn
                ? t('ui.sidebar.thinkingOverrideTitleOn', { label: title })
                : t('ui.sidebar.thinkingOverrideTitleOff', { label: title });
        }
        setIcon(this.modelButton.createSpan('mode-chevron'), 'chevron-down');
        this.modelButton.title = title;
        // Use the effective key for context-tracker logic below.
        const effectiveKey = this.getEffectiveModelKey();
        const model = this.plugin.settings.activeModels.find((m) => getModelKey(m) === effectiveKey);

        // Update context tracker when model changes
        if (this.contextTracker && model) {
            try {
                const apiHandler = buildApiHandlerForModel(model);
                const modelInfo = apiHandler?.getModel().info;
                if (modelInfo?.contextWindow) {
                    this.contextTracker.updateContextWindow(
                        modelInfo.contextWindow,
                        model.maxTokens
                    );
                }
            } catch (e) {
                console.debug('[AgentSidebarView] Failed to update context window for model change:', e);
            }
        }
    }

    private showModelMenu(event: MouseEvent): void {
        // EPIC-26 / FEAT-26-05: when a provider is active, show Auto + the
        // provider's discovered models. Otherwise (pre-migration / fresh
        // install) fall back to the legacy flat model list.
        const activeProvider = resolveActiveProvider(this.plugin.settings);
        if (activeProvider) {
            this.showProviderModelMenu(event, activeProvider);
            return;
        }

        const enabled = this.plugin.settings.activeModels.filter((m) => m.enabled);
        const menu = new Menu();
        const modeSlug = this.plugin.settings.currentMode;
        const modeOverrideKey = this.plugin.settings.modeModelKeys?.[modeSlug] ?? '';
        const globalKey = this.plugin.settings.activeModelKey;
        const effectiveKey = modeOverrideKey || globalKey;

        if (enabled.length === 0) {
            menu.addItem((item) =>
                item.setTitle(t('ui.sidebar.noModelsEnabled')).setIcon('settings').onClick(() => {
                    this.app.setting?.open();
                    window.setTimeout(() => this.app.setting?.openTabById(this.plugin.manifest.id), 50);
                }),
            );
        } else {
            // Option to clear mode override (use global default)
            if (modeOverrideKey) {
                const globalModel = this.plugin.settings.activeModels.find((m) => getModelKey(m) === globalKey);
                const globalLabel = globalModel ? (globalModel.displayName ?? globalModel.name) : t('ui.sidebar.globalDefault');
                menu.addItem((item) =>
                    item
                        .setTitle(t('ui.sidebar.useGlobalDefault', { label: globalLabel }))
                        .setIcon('rotate-ccw')
                        .onClick(async () => {
                            if (this.plugin.settings.modeModelKeys) {
                                delete this.plugin.settings.modeModelKeys[modeSlug];
                            }
                            await this.plugin.saveSettings();
                            this.updateModelButton();
                        }),
                );
                menu.addSeparator();
            }

            enabled.forEach((model) => {
                const key = getModelKey(model);
                menu.addItem((item) =>
                    item
                        .setTitle(model.displayName ?? model.name)
                        .setChecked(effectiveKey === key)
                        .onClick(async () => {
                            // Set as mode-specific override (not global default)
                            if (!this.plugin.settings.modeModelKeys) this.plugin.settings.modeModelKeys = {};
                            this.plugin.settings.modeModelKeys[modeSlug] = key;
                            await this.plugin.saveSettings();
                            this.updateModelButton();
                        }),
                );
            });
        }

        menu.showAtMouseEvent(event);
    }

    /**
     * EPIC-26 / FEAT-26-05: short-label helper for the chat-header model
     * button. Strips OpenRouter vendor prefix ("anthropic/...") and
     * Bedrock region + vendor + version wrappers so the button stays
     * narrow. Display name is preferred upstream of this helper; this
     * runs as a last-resort fallback.
     */
    private shortenModelId(id: string): string {
        let s = id;
        if (s.includes('/')) s = s.split('/').pop() ?? s;
        const m = s.match(/(?:^|\.)(?:anthropic|amazon|meta|mistral|cohere|ai21|stability|deepseek|writer|qwen)\.(.+)$/i);
        if (m) s = m[1];
        s = s.replace(/-v\d+(?::\d+)?$/i, '').replace(/:\d+$/, '');
        return s;
    }

    /**
     * Issue #54.3: persist the chat-header model override for the active
     * provider so it survives restarts and new chats. No-op when
     * persistChatModel is off; null (Auto) clears the stored entry.
     */
    private async persistChatModelOverride(overrideId: string | null): Promise<void> {
        if (!this.plugin.settings.persistChatModel) return;
        const pid = this.plugin.settings.activeProviderId;
        if (!pid) return;
        const map = this.plugin.settings.lastChatModelByProvider ?? {};
        if (overrideId === null) delete map[pid];
        else map[pid] = overrideId;
        this.plugin.settings.lastChatModelByProvider = map;
        await this.plugin.saveSettings();
    }

    /**
     * Issue #54.3: restore the sticky chat-header model for the active provider.
     * Falls back to Auto (null) when persistence is off, no provider is active,
     * or the saved model no longer exists on the provider.
     */
    private restoreChatModelOverride(): void {
        this.chatModelOverride = resolveStickyChatModel(
            resolveActiveProvider(this.plugin.settings),
            this.plugin.settings.lastChatModelByProvider,
            this.plugin.settings.activeProviderId,
            this.plugin.settings.persistChatModel,
        );
    }

    /**
     * EPIC-26 / FEAT-26-05: searchable popover when a provider is active.
     * Bedrock and OpenRouter routinely list 50+ models -- a plain Menu
     * was not scrollable enough; ChatModelPickerPopover adds a filter
     * input matching the ToolPicker pattern.
     */
    private showProviderModelMenu(event: MouseEvent, provider: import('../types/settings').ProviderConfig): void {
        if (!this.modelButton) return;
        if (!this.chatModelPicker) this.chatModelPicker = new ChatModelPickerPopover();
        if (this.chatModelPicker.isOpen()) {
            this.chatModelPicker.close();
            return;
        }
        this.chatModelPicker.show(event, this.modelButton, this.containerEl, provider, {
            getCurrent: () => this.chatModelOverride,
            onSelect: (overrideId) => {
                this.chatModelOverride = overrideId;
                // Effort is a pin-only control. Unpinning (back to Auto) clears
                // any chosen effort so Auto mode falls back to the model's own
                // vendor default; a stale level must not leak onto the router.
                if (overrideId === null) {
                    this.chatEffortOverride = DEFAULT_EFFORT_OVERRIDE;
                }
                void this.persistChatModelOverride(overrideId); // Issue #54.3
                this.updateModelButton();
            },
            getThinking: () => this.chatThinkingOverride,
            onThinkingChange: (override) => {
                this.chatThinkingOverride = override;
                this.updateModelButton();
            },
            getEffort: () => this.chatEffortOverride,
            onEffortChange: (override) => {
                this.chatEffortOverride = override;
                this.updateModelButton();
            },
            getEffortLevels: () => this.resolveEffortLevelsForPinnedModel(provider),
        }, this.buildChatProviderNav(event));
    }

    /**
     * Issue #48.5: provider-switcher wiring for the chat model picker. Lets the
     * user switch the active provider (a global settings change) from the chat
     * without opening Settings > Providers. Only enabled providers are offered;
     * the picker itself hides the row when fewer than two are enabled.
     */
    private buildChatProviderNav(event: MouseEvent): ChatProviderNav {
        const enabled = (this.plugin.settings.providerConfigs ?? []).filter((p) => p.enabled);
        return {
            items: enabled.map((p) => ({ id: p.id, label: p.displayName ?? p.type })),
            activeId: this.plugin.settings.activeProviderId,
            onSelect: (id) => {
                void (async () => {
                    if (id === this.plugin.settings.activeProviderId) return;
                    this.plugin.settings.activeProviderId = id;
                    // Issue #54.3: load the newly active provider's sticky model
                    // (or Auto). A pinned id from the previous provider must never
                    // reach the new one, so resolve against the new provider.
                    this.restoreChatModelOverride();
                    this.chatEffortOverride = DEFAULT_EFFORT_OVERRIDE;
                    await this.plugin.saveSettings();
                    this.updateModelButton();
                    // Re-open the picker on the newly active provider's models.
                    const next = resolveActiveProvider(this.plugin.settings);
                    this.chatModelPicker?.close();
                    if (next) this.showProviderModelMenu(event, next);
                })();
            },
        };
    }

    /**
     * Native effort levels for the PINNED chat-header model, or [] when nothing
     * is pinned. Effort is a pin-only control: in Auto mode the tier router
     * already picks the model for the task, so no effort dial is offered and the
     * model keeps its own vendor default (the provider layer sends no effort
     * field). The empty array hides the effort slider, which is how Auto mode and
     * effort-incapable models (Gemini, local) both end up with no control.
     *
     * IMP-54-05b: delegates to the pure resolveEffortLevelsForPin helper,
     * which applies the provider's per-model effort opt-in (custom /
     * OpenAI-compatible endpoints) before the static registry families.
     */
    private resolveEffortLevelsForPinnedModel(
        provider: import('../types/settings').ProviderConfig,
    ): EffortLevel[] {
        return resolveEffortLevelsForPin(provider, this.chatModelOverride);
    }

    /**
     * 2026-05-18: legacy mode-button + popover removed (FEAT-26-05).
     * Tool-Picker stays in the chat toolbar; with "Ask" gone there is
     * no mode that hides it, so we always show.
     */
    private updateToolPickerButton(): void {
        if (!this.toolPickerButton) return;
        this.toolPickerButton.classList.remove('agent-u-hidden');
        this.updateWebToggleButton();
    }

    /**
     * Manual memory save (FEATURE-0318): always available, bypasses both
     * autoExtractSessions and the message-count threshold. Calls the same
     * Single-Call pipeline the auto-path uses, just with bypassThrottle=true.
     */
    private async handleSaveToMemory(): Promise<void> {
        const mem = this.plugin.settings.memory;
        if (!mem.enabled) {
            new Notice(t('notice.memoryDisabled'));
            return;
        }
        const queue = this.plugin.extractionQueue;
        const snapshot = this.snapshotForMemory();
        if (!queue || !snapshot) {
            new Notice(t('notice.memoryNoActiveConversation'));
            return;
        }
        try {
            await queue.enqueueImmediate(snapshot);
            new Notice(t('notice.memorySaveQueued'));
            void this.pollMemoryStarUntilReady(snapshot.conversationId);
        } catch (e) {
            console.warn('[Memory] Manual save failed:', e);
            new Notice(t('notice.memorySaveFailed'));
        }
    }

    /**
     * After enqueueImmediate, the LLM extraction runs in the background
     * and only THEN do facts land in the DB. Poll for up to 90s so the
     * history panel star eventually reflects the saved state without
     * the user having to reopen the panel.
     */
    private async pollMemoryStarUntilReady(conversationId: string): Promise<void> {
        const startedAt = Date.now();
        const TIMEOUT_MS = 90_000;
        const INTERVAL_MS = 2_000;
        while (Date.now() - startedAt < TIMEOUT_MS) {
            await new Promise(resolve => window.setTimeout(resolve, INTERVAL_MS));
            if (this.plugin.countMemoryFactsForConversation(conversationId) > 0) {
                this.historyPanel?.refresh();
                return;
            }
        }
        this.historyPanel?.refresh();
    }

    /**
     * Save a HISTORY conversation (not the currently active one) to memory.
     * Loads the persisted UiMessages from ConversationStore and enqueues
     * them with bypassThrottle=true. Used by the Star button in HistoryPanel.
     */
    /** Rename a history conversation via prompt modal. */
    private async renameHistoryConversation(id: string, currentTitle: string): Promise<void> {
        const store = this.plugin.conversationStore;
        if (!store) return;
        const { promptModal } = await import('./modals/PromptModal');
        const next = await promptModal(this.app, {
            title: t('ui.history.renameTitle'),
            message: t('ui.history.renameMessage'),
            placeholder: currentTitle,
            defaultValue: currentTitle,
            submitLabel: t('ui.history.renameSubmit'),
        });
        if (next === null) return;
        const trimmed = next.trim();
        if (!trimmed || trimmed === currentTitle) return;
        // issue #45 quirk 2: titleSource='user' lockt den Title gegen
        // spaetere Auto-Writer (LLM-Titler in finalizeConversation,
        // onComplete-Fallback, MCP-Sync). Der Guard sitzt zentral in
        // ConversationStore.updateMeta.
        await store.updateMeta(id, { title: trimmed, titleSource: 'user' });
    }

    /** Un-pin: deprecate all facts that came from this conversation. */
    private async removeHistoryConversationFromMemory(id: string, title: string): Promise<void> {
        const mem = this.plugin.settings.memory;
        if (!mem.enabled) {
            new Notice(t('notice.memoryDisabled'));
            return;
        }
        try {
            const removed = await this.plugin.unpinMemoryFactsForConversation(id);
            new Notice(t('notice.memoryRemoved', { count: removed, title }));
        } catch (e) {
            console.warn('[Memory] Remove failed:', e);
            new Notice(t('notice.memorySaveFailed'));
        }
    }

    private async saveHistoryConversationToMemory(id: string, title: string): Promise<void> {
        const mem = this.plugin.settings.memory;
        if (!mem.enabled) {
            new Notice(t('notice.memoryDisabled'));
            return;
        }
        const queue = this.plugin.extractionQueue;
        const store = this.plugin.conversationStore;
        if (!queue || !store) {
            new Notice(t('notice.memoryNoActiveConversation'));
            return;
        }
        try {
            const data = await store.load(id);
            if (!data || data.uiMessages.length === 0) {
                new Notice(t('notice.memoryNoActiveConversation'));
                return;
            }
            const messages = data.uiMessages.map((m) => ({ role: m.role, text: m.text }));
            await queue.enqueueImmediate({
                conversationId: id,
                messages,
                title,
                queuedAt: new Date().toISOString(),
            });
            new Notice(t('notice.memorySaveQueued'));
            void this.pollMemoryStarUntilReady(id);
        } catch (e) {
            console.warn('[Memory] Save history conversation failed:', e);
            new Notice(t('notice.memorySaveFailed'));
        }
    }

    /**
     * BA-26 / FEAT-23-04: confirm a pending external conversation.
     * Flips syncState 'pending' -> 'confirmed' and enqueues the
     * conversation for memory extraction with shared thresholds.
     */
    private async confirmPendingConversation(id: string, title: string): Promise<void> {
        const store = this.plugin.conversationStore;
        const queue = this.plugin.extractionQueue;
        if (!store) {
            new Notice(t('notice.memoryNoActiveConversation'));
            return;
        }
        try {
            const flipped = await store.confirm(id);
            if (!flipped) {
                new Notice(t('notice.memory.alreadyConfirmed'));
                return;
            }
            // Trigger memory extraction (auto-sync would have done this on save).
            if (this.plugin.settings.memory.enabled && queue) {
                const data = await store.load(id);
                if (data && data.uiMessages.length > 0) {
                    const messages = data.uiMessages.map((m) => ({ role: m.role, text: m.text }));
                    await queue.enqueueImmediate({
                        conversationId: id,
                        messages,
                        title,
                        queuedAt: new Date().toISOString(),
                    });
                }
            }
            new Notice(t('notice.memory.confirmed', { title }));
        } catch (e) {
            console.warn('[Memory] Confirm pending failed:', e);
            new Notice(t('notice.memorySaveFailed'));
        }
    }

    private async toggleWebSearch(): Promise<void> {
        const isEnabled = this.plugin.settings.webTools?.enabled ?? false;
        const newState = !isEnabled;
        if (!this.plugin.settings.webTools) {
            this.plugin.settings.webTools = { enabled: false, provider: 'none', braveApiKey: '', tavilyApiKey: '' };
        }
        this.plugin.settings.webTools.enabled = newState;
        await this.plugin.saveSettings();
        this.updateWebToggleButton();

        // Check for missing provider/API key and show notice
        if (newState) {
            const provider = this.plugin.settings.webTools.provider;
            if (!provider || provider === 'none') {
                new Notice(t('notice.webSearchEnabled'));
            }
        }
    }

    private updateWebToggleButton(): void {
        if (!this.webToggleButton) return;
        // Only show when the active mode supports web tools
        const mode = this.modeService.getMode(this.plugin.settings.currentMode);
        const modeHasWeb = mode?.toolGroups?.includes('web') ?? false;
        this.webToggleButton.classList.toggle('agent-u-hidden', !modeHasWeb);
        // Visual state: active (highlighted) or inactive (ghost)
        const isEnabled = this.plugin.settings.webTools?.enabled ?? false;
        this.webToggleButton.classList.toggle('web-toggle-active', isEnabled);
    }

    // 2026-05-18: showModeMenu + getModeIcon removed (dead since the
    // chat-header Mode-button was retired in FEAT-26-05). Agent-switching
    // now lives entirely in Settings -> Agents. getModeDisplayName stays
    // because the mode-switched Notice still uses it.

    private getModeDisplayName(modeSlug: string): string {
        return this.modeService.getMode(modeSlug)?.name ?? modeSlug;
    }

    // ---------------------------------------------------------------------------

    /**
     * Build the skills section for the system prompt.
     * Combines keyword-matched skills with any forced skills from the tool picker.
     */
    /**
     * Build a compact vault-structure snapshot injected into every user message.
     * Gives the model immediate orientation (top-level folders, note count, recent files)
     * so it doesn't need to call list_files or get_vault_stats just to orient itself.
     * Mirrors the <environment_details> pattern used by Kilo Code and Craft Agents.
     */
    private buildVaultContext(): string {
        // FIX-PERF-33: cache the rendered context string. Previously a
        // 3,653-file vault sorted the full list by mtime on every send-
        // click. The cache is invalidated by vault.on('create' | 'delete'
        // | 'rename' | 'modify') -- see ensureVaultContextWatcher() below.
        if (this.vaultContextCache !== null) return this.vaultContextCache;
        this.ensureVaultContextWatcher();
        try {
            const root = this.app.vault.getRoot();
            const folders: string[] = [];
            const rootFiles: string[] = [];

            for (const child of root.children) {
                if ('children' in child) {
                    // It's a folder — skip hidden/system dirs
                    const name = child.name;
                    if (!name.startsWith('.')) folders.push(name);
                } else {
                    rootFiles.push(child.name);
                }
            }

            const allMd = this.app.vault.getMarkdownFiles();
            const noteCount = allMd.length;

            // 5 most recently modified notes (path only)
            const recent = [...allMd]
                .sort((a, b) => b.stat.mtime - a.stat.mtime)
                .slice(0, 5)
                .map((f) => f.path);

            const lines: string[] = ['<vault_context>'];
            lines.push(`Notes: ${noteCount}`);
            if (folders.length > 0) lines.push(`Top-level folders: ${folders.join(', ')}`);
            if (rootFiles.length > 0) lines.push(`Root files: ${rootFiles.join(', ')}`);
            if (recent.length > 0) lines.push(`Recently modified: ${recent.join(', ')}`);
            lines.push('</vault_context>');
            const out = lines.join('\n');
            this.vaultContextCache = out;
            return out;
        } catch {
            return '';
        }
    }

    private vaultContextCache: string | null = null;
    private vaultContextWatcherInstalled = false;
    private ensureVaultContextWatcher(): void {
        if (this.vaultContextWatcherInstalled) return;
        this.vaultContextWatcherInstalled = true;
        const invalidate = (): void => { this.vaultContextCache = null; };
        // FIX-PERF-33: rebuild on any vault mutation. modify is included
        // because the recent-modified list depends on mtime.
        this.registerEvent(this.app.vault.on('create', invalidate));
        this.registerEvent(this.app.vault.on('delete', invalidate));
        this.registerEvent(this.app.vault.on('rename', invalidate));
        this.registerEvent(this.app.vault.on('modify', invalidate));
    }

    /**
     * Build the SKILLS directory for the stable system-prompt prefix
     * (FEAT-24-09 / ADR-116). Lists every installed skill (name + description,
     * plus inventory lines for self-authored skills) -- the LLM picks a skill
     * itself based on the directory and loads its body via the read_skill
     * tool. Replaces the previous classifier-driven body injection.
     *
     * Honours the manual skill toggles so the directory matches what the
     * user actually exposes.
     */
    private async buildSkillDirectory(): Promise<string | undefined> {
        const skillsManager = this.plugin.skillsManager;
        const selfLoader = this.plugin.selfAuthoredSkillLoader;

        const toggles = this.plugin.settings.manualSkillToggles ?? {};
        const userSkills = skillsManager ? await skillsManager.discoverSkills() : [];
        const filteredUserSkills = Object.keys(toggles).length > 0
            ? userSkills.filter(s => toggles[s.path] !== false)
            : userSkills;

        const selfAuthoredBlock = selfLoader?.getMetadataSummary() ?? '';
        const selfAuthoredNames = new Set(
            (selfLoader?.getAllSkills() ?? []).map(s => s.name),
        );

        const userLines = filteredUserSkills
            .filter(s => !selfAuthoredNames.has(s.name))
            .map(s => `- ${s.name}: ${s.description}`);

        const blocks = [selfAuthoredBlock, userLines.join('\n')].filter(Boolean);
        if (blocks.length === 0) return undefined;

        const directory = blocks.join('\n');
        console.debug(`[buildSkillDirectory] ${selfAuthoredNames.size} self-authored + ${userLines.length} user skill(s)`);
        return directory;
    }

    private autoResizeTextarea(): void {
        if (!this.textarea) return;
        this.textarea.setCssProps({ '--agent-textarea-h': 'auto' });
        this.textarea.setCssProps({ '--agent-textarea-h': Math.min(this.textarea.scrollHeight, 15 * 24) + 'px' });
    }

    /**
     * Show the onboarding welcome message (first activation only).
     * Chat-based flow: scripted assistant bubbles + buttons, no LLM needed.
     * User pastes API key in the normal chat textarea.
     */
    /** Show the welcome message (delegates to OnboardingFlow module). */
    private showWelcomeMessage(): void {
        if (!this.chatContainer) return;
        const ob = this.plugin.settings.onboarding;

        // Phase 2.3: if the FirstRun wizard is still owed to the user
        // (not completed, not dismissed, not yet shown three times),
        // open the wizard instead of the legacy in-chat provider-picker.
        //
        // FIX (2026-06-15): when the user manually restarts the setup from
        // Settings -> Interface / Memory and then cancels the wizard, the
        // pure modalCompleted check would re-open the wizard on every
        // reload even though the user already has a provider configured.
        // `isActiveOnboardingFlow` resolves the ambiguity: any provider in
        // providerConfigs[] OR any legacy entry in activeModels[] means the
        // user is no longer in the first-time wizard.
        const shown = ob?.firstRunModalShownCount ?? 0;
        const wizardPending = ob
            && !ob.modalCompleted
            && !ob.dontShowFirstRunAgain
            && shown < 3
            && isActiveOnboardingFlow(this.plugin.settings);
        if (wizardPending) {
            void this.openFirstRunWizard();
            return;
        }

        // Memory + Soul chat: auto-start once after the modal has been
        // completed, never again. `startedAt` is set the first time
        // startOnboardingChat runs, so a subsequent sidebar restore
        // does not re-trigger the conversation.
        if (ob?.modalCompleted && !ob.completed && !ob.startedAt) {
            this.startOnboardingChat();
            return;
        }

        // Fallback for users who reset their onboarding state and have
        // already dismissed the wizard. OnboardingFlow.showWelcomeMessage
        // self-guards against re-running, so this is safe to call.
        this.onboarding = new OnboardingFlow(this.plugin, this.app);
        this.onboarding.showWelcomeMessage(this.chatContainer, this, this.getOnboardingCallbacks());
    }

    private async openFirstRunWizard(): Promise<void> {
        try {
            const ob = this.plugin.settings.onboarding;
            ob.firstRunModalShownCount = (ob.firstRunModalShownCount ?? 0) + 1;
            await this.plugin.saveSettings();
            const { FirstRunWizardModal } = await import('./modals/FirstRunWizardModal');
            new FirstRunWizardModal(this.app, this.plugin).open();
        } catch (e) {
            console.error('[Plugin] Failed to open FirstRunWizardModal:', e);
        }
    }

    /** Show setup message when no model is configured (delegates to OnboardingFlow). */
    private showNoModelSetupMessage(): void {
        if (!this.chatContainer) return;
        if (!this.onboarding) this.onboarding = new OnboardingFlow(this.plugin, this.app);
        this.onboarding.showNoModelSetupMessage(this.chatContainer, this, this.getOnboardingCallbacks());
    }

    /** Build callbacks for OnboardingFlow to communicate back to the View. */
    private getOnboardingCallbacks() {
        return {
            addAssistantMessage: (md: string) => this.addAssistantMessage(md),
            updateModelButton: () => this.updateModelButton(),
            startOnboardingChat: () => this.startOnboardingChat(),
            openSettings: () => {
                // FIX-26-99-02: route the onboarding "Setup" button straight
                // to the providers tab so the user lands on the
                // providerConfigs[] surface (post-EPIC-26 canonical store),
                // not on whichever tab was last open.
                this.plugin.openSettingsAt('providers');
            },
        };
    }

    /**
     * Start the LLM-driven onboarding conversation.
     * Sends a hidden trigger message; the onboarding system prompt guides the LLM.
     * Called from the welcome card, settings buttons, or programmatically.
     */
    startOnboardingChat(): void {
        this.onboarding?.reset();
        // Mark as started (prevents re-trigger on reload)
        this.plugin.settings.onboarding.startedAt = new Date().toISOString();
        void this.plugin.saveSettings();
        // Clear welcome card, send hidden trigger
        if (this.chatContainer) this.chatContainer.empty();
        this.sendProgrammaticMessage(t('onboarding.trigger'), true);
    }

    /**
     * Programmatically send a message as if the user typed it.
     * Used by Settings buttons (e.g. "Start setup") to trigger agent actions.
     * When hidden=true, the user bubble is not rendered (the agent speaks first).
     */
    sendProgrammaticMessage(text: string, hidden = false): void {
        if (!this.textarea) return;
        this.nextMessageHidden = hidden;
        this.textarea.value = text;
        void this.handleSendMessage();
    }

    /** Open the vault health repair modal with discuss callback. */
    private openHealthModal(): void {
        const findings = this.plugin.vaultHealthService?.getFindings() ?? [];
        if (findings.length === 0) return;
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic import for modal
        const { VaultHealthRepairModal } = require('./modals/VaultHealthRepairModal') as typeof import('./modals/VaultHealthRepairModal');
        const modal = new VaultHealthRepairModal(this.plugin, findings, (prompt) => {
            this.clearConversation();
            this.sendProgrammaticMessage(prompt, false);
        });
        // IMP-19-01-01: opt-in auto-apply for deterministic rule
        // findings (missing_backlinks, category_mismatch,
        // inconsistent_tags). When the setting is on AND there is at
        // least one repairable finding, the modal opens directly into
        // the runRepair() path; the user lands on the same Undo/Done
        // results screen as if they had clicked the Auto-fix banner.
        if (this.plugin.settings.vaultHealth?.autoApplyRuleRepairs) {
            modal.autoApplyOnOpen = true;
        }
        modal.open();
    }

    /** Update the health-pulse icon. Called from main.ts after health check. */
    updateHealthBadge(findingCount: number, maxSeverity: 'high' | 'medium' | 'low' | null): void {
        if (!this.healthBadge) return;
        if (findingCount === 0 || !maxSeverity) {
            this.healthBadge.classList.add('agent-u-hidden');
            return;
        }
        this.healthBadge.classList.remove('agent-u-hidden');
        // Rebuild the className deterministically: keep the base classes, add
        // one severity marker. Avoid clobbering by using classList operations.
        this.healthBadge.classList.remove('severity-high', 'severity-medium', 'severity-low');
        this.healthBadge.classList.add(`severity-${maxSeverity}`);
        this.healthBadge.setAttribute(
            'aria-label',
            `${t('ui.sidebar.vaultHealth')} (${findingCount})`,
        );
    }

    /**
     * Pull the current findings from the plugin and update the badge. Used
     * when the view mounts after the health check already ran (BRAT hot
     * reload, leaf rebuild, etc.).
     */
    private syncHealthBadge(): void {
        const svc = this.plugin.vaultHealthService;
        if (!svc) return;
        const findings = svc.getFindings();
        if (findings.length === 0) {
            this.updateHealthBadge(0, null);
            return;
        }
        const hasHigh = findings.some((f) => f.severity === 'high');
        const hasMedium = findings.some((f) => f.severity === 'medium');
        const severity = hasHigh ? 'high' : (hasMedium ? 'medium' : 'low');
        this.updateHealthBadge(findings.length, severity);
    }

    /** Send vault health findings to the chat. Batch mode for many findings, interactive for few. */
    private sendHealthFindings(): void {
        const healthService = this.plugin.vaultHealthService;
        if (!healthService || healthService.getFindingCount() === 0) return;

        const count = healthService.getFindingCount();
        const BATCH_THRESHOLD = 10;

        if (count >= BATCH_THRESHOLD) {
            this.sendProgrammaticMessage(
                `Vault health: ${count} findings. Run vault_health_check, then work through ` +
                `findings autonomously in batches. Follow the vault-health-batch skill. ` +
                `Ask me only for real decisions, not for each fix.`,
            );
        } else {
            this.sendProgrammaticMessage(
                `Vault health: ${count} findings. Run vault_health_check and suggest fixes.`,
            );
        }
    }

    /**
     * Feature 1+3: Handle sending a message with persistent history and cancellation
     */
    private async handleSendMessage(): Promise<void> {
        if (!this.textarea) return;

        const text = this.textarea.value.trim();
        if (!text && this.attachments.pending.length === 0) return;

        // FEAT-24-08 / ADR-114 Steering-Hook: if a task is already running,
        // queue the text as a mid-run steering message instead of trying to
        // start a new turn. Attachments are not supported in steering mode
        // (corrections are short text-only nudges); they stay queued for the
        // next real turn.
        if (this.currentAbortController) {
            if (!text) return;
            // Render the steering bubble in "pending" state and keep a
            // reference so consumeSteeringMessages can flip it to
            // "delivered at iteration N" when AgentTask actually drains it.
            const bubbleEl = this.addSteeringMessage(text);
            this.steeringQueue.push({ text, bubbleEl });
            this.uiMessages.push({ role: 'user', text, ts: new Date().toISOString() });
            this.textarea.value = '';
            this.autoResizeTextarea();
            this.refreshRunStateButtons();
            return;
        }

        // FIX-24-08-03 / GUARD-L1: a stopped task is still draining to its
        // next abort checkpoint. Starting a new run in this window lets the
        // old run's late onComplete/onError race the new run's controller
        // (and both render into the same chat). Refuse until the drain ends.
        if (this.taskDraining) {
            new Notice(t('ui.sidebar.taskStillStopping'), 6000);
            return;
        }

        // MEAS-02: TTFT split. point captures the send click; the
        // span runs until AgentTask hands off to the provider, then
        // the provider-span runs until the first stream chunk arrives.
        // Placed after the steering early-return so it only fires for
        // real turn starts.
        const perfMarks = getPerformanceMarks();
        perfMarks.point('send.click', { log: true });
        perfMarks.start('send.firstTurn.host');

        const isHidden = this.nextMessageHidden;
        this.nextMessageHidden = false;

        this.lastUserMessage = text;

        // Create a new conversation on first message (if history enabled)
        // FIX-03-20-01: routed through the lazy ensurer so save paths that
        // run before/after this share the same memoized create.
        if (!this.activeConversationId && this.plugin.conversationStore) {
            const ensured = this.ensureConversationId();
            if (ensured) await ensured;
            // If the nav stack top is the "fresh-chat" sentinel (null), upgrade
            // it to this just-created conversation id. That keeps back/forward
            // consistent: visiting a fresh chat counts as one stack entry,
            // not two ("empty" plus its concrete id).
            if (
                this.navStack.length > 0
                && this.navIndex === this.navStack.length - 1
                && this.navStack[this.navIndex] === null
            ) {
                this.navStack[this.navIndex] = this.activeConversationId;
                this.updateNavButtons();
            }
        }

        // Track user UI message for history persistence (skip for hidden messages)
        if (!isHidden) {
            this.uiMessages.push({ role: 'user', text, ts: new Date().toISOString() });

        }

        // Snapshot attachments, clear the chip bar, render user bubble with previews
        const attachments = [...this.attachments.pending];
        this.attachments.clear();
        if (!isHidden) {
            const activeFileForBubble = (this.plugin.settings.autoAddActiveFileContext && !this.userDismissedContext)
                ? this.app.workspace.getActiveFile()
                : null;
            this.addUserMessage(text, attachments, activeFileForBubble);
        }
        this.textarea.value = '';
        this.autoResizeTextarea();

        // Feature 4: Inject active file context into the message sent to LLM
        // Only if setting is on and user hasn't dismissed the context for this turn
        const activeFile = (this.plugin.settings.autoAddActiveFileContext && !this.userDismissedContext)
            ? this.app.workspace.getActiveFile()
            : null;
        const vaultCtx = this.buildVaultContext();
        const textWithContext = text
            + (activeFile ? `\n\n<context>\nActive file in editor: ${activeFile.path}\n</context>` : '')
            + (vaultCtx ? `\n\n${vaultCtx}` : '');

        // Prefix commands (FEATURE-2207 decision 2026-04-19):
        //   '/skill-slug'    -> activate a self-authored skill
        //   '#prompt-slug'   -> inject a custom prompt template
        //   '\u00a7workflow-slug' -> run a workflow
        //
        // Resolved BEFORE the attachment-block build so the expanded
        // skill/prompt/workflow body ends up inside the text-block when
        // the user dropped a PDF/image into the chat. Previous order
        // ran the expansion only on the string branch -- with
        // attachments the slash command stayed literal "/ingest-deep"
        // and the agent fell back to invoke_skill, which fails for
        // Chat-attachments and let the parent improvise the workflow.
        let expandedText: string | null = null;
        if (/^[/#\u00a7]/.test(text)) {
            const prefix = text[0];
            const spaceIdx = text.indexOf(' ');
            const slug = spaceIdx === -1 ? text.slice(1) : text.slice(1, spaceIdx);
            const rest = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim();
            const activeFileTail = activeFile
                ? `\n\n<context>\nActive file in editor: ${activeFile.path}\n</context>`
                : '';

            if (prefix === '/') {
                const skillLoader = this.plugin.selfAuthoredSkillLoader;
                const matchedSkill = skillLoader?.getAllSkills().find(
                    (s) => AutocompleteHandler.slugifySkillName(s.name) === slug,
                );
                if (matchedSkill) {
                    const parts = [
                        `<explicit_instructions skill="${matchedSkill.name}">`,
                        matchedSkill.body,
                        '</explicit_instructions>',
                    ];
                    if (rest) parts.push('', rest);
                    expandedText = parts.join('\n') + activeFileTail;
                }
            } else if (prefix === '#') {
                const prompt = (this.plugin.settings.customPrompts ?? []).find(
                    (p) => p.slug === slug && p.enabled !== false,
                );
                if (prompt) {
                    const activeFileName = activeFile?.name;
                    const { resolvePromptContent } = await import('../core/context/SupportPrompts');
                    const resolved = resolvePromptContent(prompt.content, {
                        userInput: rest,
                        activeFile: activeFileName,
                    });
                    expandedText = resolved + activeFileTail;
                }
            } else if (prefix === '\u00a7') {
                // Workflows expect a leading '/' in the existing loader API so we
                // re-shape the command for backward compat before dispatch.
                const workflowLoader = this.plugin.workflowLoader;
                if (workflowLoader) {
                    const reshaped = `/${slug}${rest ? ' ' + rest : ''}`;
                    const workflowText = await workflowLoader.processSlashCommand(
                        reshaped,
                        this.plugin.settings.workflowToggles ?? {},
                    );
                    if (workflowText !== reshaped) {
                        expandedText = workflowText + activeFileTail;
                    }
                }
            }
        }

        const finalUserText = expandedText ?? textWithContext;

        // Build ContentBlock[] when there are attachments, plain string otherwise
        let messageToSend: string | ContentBlock[];
        if (attachments.length > 0) {
            const blocks: ContentBlock[] = [];
            // Images first (Anthropic convention)
            for (const att of attachments) {
                if (att.block.type === 'image') blocks.push(att.block);
            }
            // User text (with slash command already expanded if applicable)
            blocks.push({ type: 'text', text: finalUserText });
            // Text file blocks after
            for (const att of attachments) {
                if (att.block.type === 'text') blocks.push(att.block);
            }
            messageToSend = blocks;
        } else {
            messageToSend = finalUserText;
        }

        // EPIC-26 / FEAT-26-05: per-turn override -- when the chat-header
        // dropdown has an explicit model picked, build a fresh api handler
        // for it. Falls through to the legacy mode-model resolution when
        // override is null (Auto).
        // Issue #44: a per-conversation thinking override may also force
        // thinking on/off. When it does, a fresh handler is built even for
        // the default-active model so the override takes effect.
        const activeProvider = resolveActiveProvider(this.plugin.settings);
        // The effort control is pin-only and only revealed while thinking is On,
        // so a contradictory Thinking=Off + Effort pair can no longer be
        // expressed and no coherence collapse is needed: the thinking override
        // passes through untouched. The thinking resolution itself is unchanged.
        const effectiveThinkingOverride = this.chatThinkingOverride;
        const thinkingIsExplicit = isExplicitThinkingOverride(effectiveThinkingOverride);
        // Apply the per-conversation thinking override to a model before it is
        // built. In 'follow' mode the model's own value is kept unchanged.
        const applyThinkingOverride = (model: CustomModel): CustomModel => {
            if (!thinkingIsExplicit) return model;
            return {
                ...model,
                thinkingEnabled: resolveEffectiveThinkingEnabled(
                    effectiveThinkingOverride,
                    model.thinkingEnabled,
                ),
            };
        };
        // Apply the per-conversation effort override. Effort is a PIN-ONLY
        // control, so this only runs on the chat-pin path below (the mode and
        // default-active paths do not call it): in Auto mode no effort is sent
        // and the model keeps its own vendor default. 'auto' leaves the model
        // unchanged. It is also gated on the thinking switch being On, since an
        // effort level is meaningless with thinking off and the UI hides the
        // control there; this keeps a stale level from being sent. The provider
        // layer only emits a level valid for the model family, so a mismatch is
        // dropped there rather than here.
        const applyEffortOverride = (model: CustomModel): CustomModel => {
            if (!thinkingSwitchIsOn(this.chatThinkingOverride)) return model;
            const effort = resolveEffectiveEffort(this.chatEffortOverride);
            if (effort === undefined) return model;
            return { ...model, reasoningEffort: effort };
        };
        let resolvedApiHandler = this.plugin.apiHandler;
        // modelOverrideActive means the user pinned a specific model via the
        // chat dropdown: it suppresses TaskRouter and the lean cost-heuristics
        // (#44). handlerResolved is the separate "a handler was already built"
        // signal so the default-active thinking rebuild below does not clobber
        // a mode-specific handler. A mode model is NOT a manual override, so it
        // sets handlerResolved only, keeping its pre-#44 routing behavior.
        let modelOverrideActive = false;
        let handlerResolved = false;
        if (activeProvider && this.chatModelOverride) {
            const m = resolveOverrideModel(activeProvider, this.chatModelOverride);
            if (m) {
                try {
                    // A pinned model suppresses the tier router, so both the
                    // thinking and effort overrides apply to exactly the model
                    // the turn runs on.
                    const cm = applyEffortOverride(
                        applyThinkingOverride(
                            providerConfigToCustomModel(activeProvider, m.id, m),
                        ),
                    );
                    resolvedApiHandler = buildApiHandlerForModel(cm);
                    modelOverrideActive = true;
                    handlerResolved = true;
                } catch {
                    resolvedApiHandler = this.plugin.apiHandler;
                }
            }
        }

        // Legacy mode-specific model resolution (only when no chat override).
        const currentModeSlug = this.modeService.getActiveMode().slug;
        const modeModelKey = this.resolveEnabledModelKey(currentModeSlug);
        const resolvedModel = this.plugin.settings.activeModels.find((m) => getModelKey(m) === modeModelKey);

        if (!handlerResolved && resolvedModel && modeModelKey !== this.plugin.settings.activeModelKey) {
            // Mode has a different model, so build a fresh handler for it.
            // Effort is pin-only, so a mode model carries only the thinking
            // override; its own effort/default is left untouched.
            try {
                resolvedApiHandler = buildApiHandler(
                    modelToLLMProvider(applyThinkingOverride(resolvedModel)),
                );
                handlerResolved = true;
            } catch {
                resolvedApiHandler = this.plugin.apiHandler;
            }
        }

        // Issue #44: default-active model path. When neither a chat-model
        // override nor a mode-specific model rebuilt the handler, but the user
        // forced thinking for this conversation, rebuild from the same default
        // model main.ts uses so the thinking override applies. Effort is NOT
        // threaded here: it is pin-only, so in Auto mode the default model keeps
        // its own vendor effort default.
        if (!handlerResolved && thinkingIsExplicit) {
            const defaultTier = this.plugin.settings.defaultMainModelTier ?? 'mid';
            const defaultModel = this.plugin.getTierModel(defaultTier) ?? this.plugin.getActiveModel();
            if (defaultModel) {
                try {
                    resolvedApiHandler = buildApiHandler(
                        modelToLLMProvider(applyThinkingOverride(defaultModel)),
                    );
                } catch {
                    resolvedApiHandler = this.plugin.apiHandler;
                }
            }
        }

        if (!resolvedApiHandler) {
            // Post-reload race: onload() runs initApiHandler() near the end,
            // but the sidebar view may still be open from before the reload
            // and the user can hit "send" before initApiHandler completes.
            // If a provider is actually configured, recover silently by
            // rebuilding the handler here instead of showing a misleading
            // "no model configured" screen. Only if the recovery attempt
            // still yields null do we surface the setup guidance.
            const hasProvidersConfigured =
                (this.plugin.settings.providerConfigs ?? []).length > 0
                || this.plugin.settings.activeModels.length > 0;
            if (hasProvidersConfigured) {
                console.debug('[Sidebar] apiHandler null on send with providers configured -- retrying initApiHandler once');
                this.plugin.initApiHandler();
                resolvedApiHandler = this.plugin.apiHandler;
                if (!resolvedApiHandler) {
                    // AUDIT-FEAT-14-07 L-3: emit a visible signal when the
                    // retry did not recover a handler. The next branch will
                    // show the setup message; this line makes the underlying
                    // config problem discoverable in the console.
                    console.warn('[Sidebar] apiHandler still null after retry -- provider configuration appears broken');
                }
            }
        }

        if (!resolvedApiHandler) {
            const activeKey = this.plugin.settings.activeModelKey;
            const activeModel = this.plugin.settings.activeModels.find((m) => getModelKey(m) === activeKey);

            if (activeModel?.provider === 'ollama') {
                this.addAssistantMessage(
                    t('ui.error.ollamaNotRunning', { model: activeModel.displayName ?? activeModel.name }),
                );
            } else {
                // No model or no API key — show setup guidance
                this.showNoModelSetupMessage();
            }
            return;
        }

        // Feature 3: Create AbortController, show stop button.
        // FIX-24-08-03: `myController` pins this run's identity -- the
        // completion closures below may fire LATE (after Stop + a newer
        // run's start) and must only clean up their own controller.
        // `lastRunAbortSignal` survives handleStop's nulling so approval
        // cards created by a draining task still bind an (aborted) signal
        // instead of undefined.
        this.currentAbortController = new AbortController();
        const myController = this.currentAbortController;
        this.lastRunAbortSignal = myController.signal;
        // FEAT-24-08 Steering: clear any stale entries before a new task
        // starts so leftover mid-run messages from a previous run cannot
        // leak into a fresh conversation. Any pending bubbles that never
        // got drained (e.g. typed during the very last iteration before
        // attempt_completion fired) are flipped to "discarded" so the user
        // can see they were not applied.
        for (const entry of this.steeringQueue) {
            this.markSteeringDiscarded(entry.bubbleEl);
        }
        this.steeringQueue = [];
        this.setRunningState(true);

        // Prepare streaming message elements (thinking → tools → response text → footer)
        // `let` so onQuestion can create fresh elements for each onboarding turn.
        let { messageEl, thinkingEl, toolsEl, contentEl, footerEl } = this.createStreamingMessageEl();
        let accumulatedText = '';       // text accumulated during/after tool phase
        let accumulatedToolContent = '';  // content written by file-writing tools (for task extraction)
        let accumulatedThinking = '';   // full thinking text for collapse/expand
        let hasTools = false;           // have any tools been called in this task?
        let isThinking = false;         // thinking is currently active
        let activityActionCount = 0;    // number of completed tool calls (for activity badge)

        // Streaming text container: during Q&A streaming we append raw text chunks
        // directly into this element (O(1) per chunk, zero re-parses).
        // On completion a single MarkdownRenderer.render() replaces it with the
        // formatted result.  This gives instant first-character display and avoids
        // the previous 80 ms delay before the user saw anything.
        let streamingPara: HTMLElement | null = null;

        // rAF-throttled scroll: collapses many per-chunk scrollTo() calls into one
        // paint-cycle scroll, eliminating repeated forced reflows.
        let scrollPending = false;
        const scheduleScroll = () => {
            if (scrollPending) return;
            scrollPending = true;
            window.requestAnimationFrame(() => { scrollPending = false; this.chatContainer?.scrollTo({ top: this.chatContainer.scrollHeight }); });
        };

        // Issue #48.3: incremental Q&A markdown render. Previously Q&A text was
        // appended as RAW characters into a <p class="streaming-para"> sized at
        // the editor font, then replaced by a single Markdown pass in onComplete
        // — the user saw large raw markdown syntax that "lingered then
        // reformatted". Now the accumulated text is rendered as Markdown at a
        // throttled cadence (leading edge for instant first paint, then at most
        // every QA_RENDER_INTERVAL_MS), so formatted text grows in place at the
        // final bubble size with no raw->formatted swap. onComplete still does
        // the authoritative pass (sources/followups parsing). Throttling keeps
        // re-parses bounded, preserving the perf goal of the old raw-append path.
        const QA_RENDER_INTERVAL_MS = 120;
        let qaLastRenderAt = 0;
        let qaTrailingTimer = 0;
        const renderQaNow = (): void => {
            if (hasTools) return; // switched to agentic mode; onComplete owns the render
            qaLastRenderAt = Date.now();
            contentEl.empty();
            void this.renderMarkdownAndWire(accumulatedText, contentEl);
            scheduleScroll();
        };
        const scheduleQaRender = (): void => {
            const sinceLast = Date.now() - qaLastRenderAt;
            if (sinceLast >= QA_RENDER_INTERVAL_MS) {
                renderQaNow();
            } else if (qaTrailingTimer === 0) {
                qaTrailingTimer = window.setTimeout(() => { qaTrailingTimer = 0; renderQaNow(); }, QA_RENDER_INTERVAL_MS - sinceLast);
            }
        };
        const cancelQaRender = (): void => {
            if (qaTrailingTimer !== 0) { window.clearTimeout(qaTrailingTimer); qaTrailingTimer = 0; }
        };

        // FIX-PERF-03: coalesce per-chunk tool-progress renders. Previously
        // onToolProgress called MarkdownRenderer.render() for every chunk
        // - on a 20-tool turn that meant 40+ synchronous parser passes per
        // turn. The pending map stores the latest content per output
        // element; a single rAF tick renders the most recent value.
        const toolProgressPending = new WeakMap<HTMLElement, string>();
        let toolProgressFrame = 0;
        const scheduleToolProgressRender = (outputEl: HTMLElement, content: string): void => {
            toolProgressPending.set(outputEl, content);
            if (toolProgressFrame !== 0) return;
            toolProgressFrame = window.requestAnimationFrame(() => {
                toolProgressFrame = 0;
                // Drain every pending output element. The map only retains
                // entries for elements still in the DOM (WeakMap GC).
                // We cannot iterate WeakMap directly; track keys via
                // outputEl identity captured at insert time.
                // For simplicity, the closure renders only the element
                // most recently updated, which matches the only call site.
                const latest = toolProgressPending.get(outputEl);
                if (latest === undefined) return;
                toolProgressPending.delete(outputEl);
                outputEl.empty();
                void this.renderMarkdownAndWire(latest, outputEl);
            });
        };

        // Debounced tool group label updates: batches rapid DOM updates during
        // parallel tool execution to reduce flicker and reflows.
        let groupUpdatePending = false;
        const pendingGroupUpdates = new Set<{ nameEl: HTMLElement; name: string; count: number }>();
        const scheduleGroupUpdate = (group: { nameEl: HTMLElement; name: string; count: number }) => {
            pendingGroupUpdates.add(group);
            if (groupUpdatePending) return;
            groupUpdatePending = true;
            window.requestAnimationFrame(() => {
                groupUpdatePending = false;
                for (const g of pendingGroupUpdates) {
                    g.nameEl.setText(this.formatGroupedLabel(g.name, g.count));
                }
                pendingGroupUpdates.clear();
            });
        };

        // Map for O(1) tool-element lookup in onToolResult.
        // For groupable tools the values are item divs; for others they are details elements.
        const toolElsByName = new Map<string, HTMLElement[]>();

        // ── Agent steps block ─────────────────────────────────────────────────
        // All tool calls are wrapped in a single collapsible block with a thin
        // left border instead of individual boxes. Collapsed by default; the
        // summary line shows a live-updating action count + final status.
        let stepsBlockEl: HTMLDetailsElement | null = null;
        let stepsBodyEl: HTMLElement | null = null;
        let stepsSummaryIconEl: HTMLElement | null = null;
        let stepsSummaryLabelEl: HTMLElement | null = null;
        let stepsTotal = 0;
        let stepsCompleted = 0;
        let stepsHasError = false;

        const ensureStepsBlock = () => {
            if (stepsBlockEl) return;
            stepsBlockEl = toolsEl.createEl('details', { cls: 'agent-steps-block' });
            const summaryEl = stepsBlockEl.createEl('summary', { cls: 'agent-steps-summary' });
            stepsSummaryIconEl = summaryEl.createSpan('steps-icon');
            setIcon(stepsSummaryIconEl, 'loader');
            stepsSummaryLabelEl = summaryEl.createSpan('steps-label');
            stepsSummaryLabelEl.setText(t('ui.sidebar.working'));
            stepsBodyEl = stepsBlockEl.createDiv('agent-steps-body');
        };

        const updateStepsSummary = (allDone: boolean) => {
            if (!stepsSummaryLabelEl || !stepsSummaryIconEl) return;
            const n = stepsTotal;
            const label = n === 1 ? t('ui.sidebar.actionSingular') : t('ui.sidebar.actionPlural', { count: n });
            if (allDone) {
                stepsSummaryLabelEl.setText(label);
                setIcon(stepsSummaryIconEl, stepsHasError ? 'x' : 'check');
                stepsSummaryIconEl.removeClass('steps-icon-spinning');
            } else {
                stepsSummaryLabelEl.setText(label);
            }
        };

        // Tools that are safe to group visually — consecutive same-type calls collapse into one row.
        // Write tools are intentionally excluded so each destructive action stays visible individually.
        const GROUPABLE_TOOLS = new Set([
            'read_file', 'list_files', 'search_files', 'get_frontmatter',
            'get_linked_notes', 'search_by_tag', 'get_vault_stats', 'get_daily_note',
            'web_fetch', 'web_search', 'semantic_search',
        ]);

        // Active tool group — tracks the open <details> container for consecutive same-type tools.
        let activeToolGroup: {
            name: string;
            detailsEl: HTMLDetailsElement;
            nameEl: HTMLElement;
            statusEl: HTMLElement;
            bodyEl: HTMLElement;
            count: number;
        } | null = null;
        // Remove the "Working…" loading indicator and any "Analyzing…" row on first real content
        let loadingRemoved = false;
        const removeLoading = () => {
            if (!loadingRemoved) {
                loadingRemoved = true;
                contentEl.querySelector('.message-loading')?.remove();
                contentEl.classList.remove('has-loading');
            }
            // Also remove any "analyzing" row between iterations (lives inside stepsBodyEl)
            (stepsBodyEl ?? toolsEl).querySelector('.tool-computing-row')?.remove();
            if (stepsSummaryLabelEl && stepsTotal > 0) {
                const n = stepsTotal;
                stepsSummaryLabelEl.setText(n === 1 ? t('ui.sidebar.actionSingular') : t('ui.sidebar.actionPlural', { count: n }));
            }
        };

        const taskId = `task-${Date.now()}`;
        let taskWriteCount = 0;
        let hasRenderedCheckpoints = false;
        // FIX-44-44: true once any write landed WITHOUT an individual diff
        // approval (settings-auto, run-scope grant, name-only card). Decides
        // whether the post-task review opens; see showPostTaskReview.
        let taskHadUnreviewedWrites = false;
        // FIX-44-12: checkpoints of the CURRENT assistant turn. Persisted into
        // the UiMessage (uiMessages.push sites) so a reloaded conversation can
        // re-render live markers; reset with the rest of the per-turn state.
        let turnCheckpoints: import('../core/checkpoints/GitCheckpointService').CheckpointInfo[] = [];

        // IMP-24-08-04: immediate Stop feedback. handleStop swaps the
        // Working spinner for a Stopping row; the drain-end removeLoading
        // (which always clears .tool-computing-row) cleans it up again.
        this.currentStopFeedback = () => {
            removeLoading();
            const host = stepsBodyEl ?? toolsEl;
            host.querySelector('.tool-computing-row')?.remove();
            const row = host.createDiv('tool-computing-row');
            setIcon(row.createSpan('tool-computing-icon'), 'loader');
            row.createSpan('tool-computing-text').setText(t('ui.sidebar.stopping'));
        };
        let lastTodoItems: import('../core/tools/agent/UpdateTodoListTool').TodoItem[] = [];

        // Initialize context tracker for this conversation turn (only if not exists)
        const model = resolvedApiHandler.getModel();
        const contextWindow = model?.info?.contextWindow ?? 200_000;
        const maxTokens = resolvedModel?.maxTokens;

        if (!this.contextTracker) {
            this.contextTracker = new ContextTracker(contextWindow, maxTokens);
        } else {
            // Update existing tracker with current model's context window
            this.contextTracker.updateContextWindow(contextWindow, maxTokens);
        }

        // Pass full (un-truncated) document texts to IngestDocumentTool and ReadDocumentTool
        // and synchronize the tool state every send pass (also with []), so attachments
        // from a prior turn cannot leak into a new turn that has none. ADR-112 / FIX-19-28-05.
        try {
            const docTexts = this.attachments.consumeFullDocTexts();
            for (const toolName of ['ingest_document', 'read_document'] as const) {
                const tool = this.plugin.toolRegistry.getTool(toolName);
                if (tool && typeof (tool as unknown as Record<string, unknown>).setAttachmentTexts === 'function') {
                    (tool as unknown as { setAttachmentTexts(t: string[]): void }).setAttachmentTexts(docTexts);
                }
            }
        } catch { /* non-critical -- tools will fall back to source_path */ }

        // ADR-090 / FEATURE-1804: cost display + telemetry persistence run
        // through TaskMonitor instead of being inlined into the callback hash.
        const taskMonitor = new TaskMonitor({
            plugin: this.plugin,
            app: this.app,
            apiHandler: resolvedApiHandler,
            footerEl,
            getEffectiveModelKey: () => this.getEffectiveModelKey(),
            promptPreview: typeof messageToSend === 'string' ? messageToSend.slice(0, 200) : '<multimodal>',
            mode: this.plugin.settings.currentMode,
            contextTracker: this.contextTracker ?? undefined,
        });

        // EPIC-33 / ADR-138 PR-1.2: Sidebar drives the agent loop via
        // AgentTaskRunner. Encapsulates the 16-positional-parameter
        // constructor in a named options object. Behaviour identical
        // to the prior `new AgentTask(...)` -- callbacks unchanged,
        // closures over view-local mutables preserved.
        const task = new AgentTaskRunner({
            api: resolvedApiHandler,
            toolRegistry: this.plugin.toolRegistry,
            // IMP-41-03-01: foreground tasks snapshot their state per turn
            // so a crash mid-run leaves recoverable data.
            inflightStore: this.plugin.inflightStore ?? undefined,
            callbacks: {
                onIterationStart: (iteration) => {
                    // Show the steps block immediately so the user can expand it from the start.
                    ensureStepsBlock();
                    if (iteration > 0) {
                        // Between iterations — add "Analyzing…" row inside stepsBodyEl (visible when expanded)
                        // and update the summary label so collapsed users also see the state.
                        (stepsBodyEl ?? toolsEl).querySelector('.tool-computing-row')?.remove();
                        const row = (stepsBodyEl ?? toolsEl).createDiv('tool-computing-row');
                        setIcon(row.createSpan('tool-computing-icon'), 'loader');
                        row.createSpan('tool-computing-text').setText(t('ui.sidebar.analyzing'));
                        if (stepsSummaryLabelEl) stepsSummaryLabelEl.setText(t('ui.sidebar.analyzingShort'));
                        scheduleScroll();
                    }
                },
                onThinking: (chunk) => {
                    removeLoading();
                    accumulatedThinking += chunk;
                    if (!isThinking) {
                        // First thinking chunk — build the collapsible section
                        isThinking = true;
                        thinkingEl.classList.remove('agent-u-hidden');
                        thinkingEl.empty();
                        const header = thinkingEl.createDiv('thinking-header');
                        setIcon(header.createSpan('thinking-spinner'), 'loader');
                        header.createSpan('thinking-label').setText(t('ui.sidebar.reasoning'));
                        thinkingEl.createDiv('thinking-content');
                        header.addEventListener('click', () => {
                            const body = thinkingEl.querySelector<HTMLElement>('.thinking-content');
                            if (body) body.classList.toggle('agent-u-hidden');
                        });
                    }
                    // FIX-PERF-02: append the chunk instead of rewriting the
                    // full textContent every time. Previously a 50 KB
                    // reasoning stream rewrote the same text on every
                    // chunk - O(N^2) and visible as freeze. Now append is
                    // O(1) per chunk.
                    const body = thinkingEl.querySelector<HTMLElement>('.thinking-content');
                    if (body) body.insertAdjacentText('beforeend', chunk);
                    scheduleScroll();
                },
                onText: (chunk) => {
                    removeLoading();
                    // When text starts after thinking, collapse the thinking section
                    if (isThinking) {
                        isThinking = false;
                        const header = thinkingEl.querySelector('.thinking-header');
                        const spinner = thinkingEl.querySelector('.thinking-spinner');
                        const label = thinkingEl.querySelector('.thinking-label');
                        if (spinner != null && spinner.instanceOf(HTMLElement)) setIcon(spinner, 'chevron-right');
                        if (label != null && label.instanceOf(HTMLElement)) label.setText(t('ui.sidebar.reasoningCollapsed'));
                        const body = thinkingEl.querySelector<HTMLElement>('.thinking-content');
                        if (body) body.classList.add('agent-u-hidden');
                        if (header != null && header.instanceOf(HTMLElement)) header.addEventListener('click', () => {
                            if (body) body.classList.toggle('agent-u-hidden');
                        }, { once: true });
                    }
                    accumulatedText += chunk;
                    if (!hasTools) {
                        // Q&A streaming: render Markdown incrementally (throttled) so the
                        // user sees formatted text grow at the final bubble size — no raw
                        // markdown syntax, no raw->formatted swap at the end (issue #48.3).
                        if (!streamingPara) {
                            contentEl.empty();
                            streamingPara = contentEl; // sentinel: Q&A stream is active
                        }
                        scheduleQaRender();
                    }
                    // Agentic mode: text is buffered and rendered once in onComplete.
                },
                onToolStart: (name, input) => {
                    removeLoading();
                    if (!hasTools) {
                        hasTools = true;
                        if (name !== 'attempt_completion') {
                            // Hide + clear the streaming UI — text will be re-rendered as
                            // Markdown in onQuestion/onComplete. Hide first to avoid the
                            // flash of raw streaming text disappearing.
                            cancelQaRender();
                            contentEl.classList.add('agent-u-visibility-hidden');
                            contentEl.empty();
                            streamingPara = null;
                        }
                    }

                    // Ensure the outer steps block exists and track this tool call
                    ensureStepsBlock();
                    stepsTotal++;
                    updateStepsSummary(false);

                    const brief = this.getToolBriefParam(input);
                    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    // Tool calls render into the steps block body, not directly into toolsEl
                    const renderTarget = stepsBodyEl!;

                    if (GROUPABLE_TOOLS.has(name)) {
                        // ── Grouped tool ──────────────────────────────────────────────
                        // Break existing group when a different tool type arrives
                        if (activeToolGroup && activeToolGroup.name !== name) {
                            activeToolGroup = null;
                        }

                        if (!activeToolGroup) {
                            // Create new group container inside the steps block
                            const details = renderTarget.createEl('details', { cls: 'tool-call-details' });
                            const summary = details.createEl('summary', { cls: 'tool-call-summary' });
                            setIcon(summary.createSpan('tool-icon'), this.getToolIcon(name));
                            const nameEl = summary.createSpan('tool-name');
                            nameEl.setText(this.formatGroupedLabel(name, 1));
                            summary.createSpan('tool-time').setText(time);
                            const statusEl = summary.createSpan({ cls: 'tool-status tool-running' });
                            const bodyEl = details.createDiv('tool-group-body');
                            activeToolGroup = { name, detailsEl: details, nameEl, statusEl, bodyEl, count: 1 };
                        } else {
                            // Group already exists — update count and reset status
                            activeToolGroup.count++;
                            scheduleGroupUpdate(activeToolGroup);
                            activeToolGroup.statusEl.removeClass('tool-done', 'tool-error');
                            activeToolGroup.statusEl.addClass('tool-running');
                            activeToolGroup.statusEl.setText('');
                        }

                        // Add compact item row to group body
                        const itemEl = activeToolGroup.bodyEl.createDiv('tool-group-item');
                        setIcon(itemEl.createSpan('tool-item-icon'), 'loader');
                        itemEl.createSpan('tool-item-brief').setText(brief || '...');

                        const queue = toolElsByName.get(name) ?? [];
                        queue.push(itemEl);
                        toolElsByName.set(name, queue);

                    } else {
                        // ── Standalone tool ───────────────────────────────────────────
                        // Any non-groupable tool breaks the active group
                        activeToolGroup = null;

                        const details = renderTarget.createEl('details', { cls: 'tool-call-details' });
                        const summary = details.createEl('summary', { cls: 'tool-call-summary' });
                        setIcon(summary.createSpan('tool-icon'), this.getToolIcon(name));
                        summary.createSpan('tool-name').setText(this.formatToolLabel(name));
                        if (brief) summary.createSpan('tool-brief-param').setText(brief);
                        summary.createSpan('tool-time').setText(time);
                        summary.createSpan('tool-status tool-running');

                        if (name !== 'attempt_completion') {
                            const inputEl = details.createDiv('tool-call-input');
                            inputEl.createEl('pre').setText(JSON.stringify(input, null, 2));
                            details.createDiv('tool-call-output');
                            details.open = true;
                        }

                        const pendingEls = toolElsByName.get(name) ?? [];
                        pendingEls.push(details);
                        toolElsByName.set(name, pendingEls);
                    }

                    const writeOps = ['write_file', 'edit_file', 'append_to_file', 'create_folder', 'delete_file', 'move_file'];
                    if (writeOps.includes(name)) taskWriteCount++;

                    // Collect content from file-writing tools for task extraction (ADR-026)
                    const taskRelevantOps = ['write_file', 'append_to_file', 'edit_file'];
                    if (taskRelevantOps.includes(name) && input) {
                        if (typeof input['content'] === 'string') {
                            accumulatedToolContent += '\n' + input['content'];
                        }
                        if (typeof input['new_str'] === 'string') {
                            accumulatedToolContent += '\n' + input['new_str'];
                        }
                    }

                    scheduleScroll();
                },
                onToolResult: (name, content, isError) => {
                    const queue = toolElsByName.get(name);
                    const el = queue?.shift() ?? null;
                    if (!el) return;

                    if (el.classList.contains('tool-group-item')) {
                        // ── Grouped item result ───────────────────────────────────────
                        const iconEl = el.querySelector<HTMLElement>('.tool-item-icon');
                        if (iconEl) {
                            iconEl.empty();
                            setIcon(iconEl, isError ? 'x' : 'check');
                        }
                        el.classList.add(isError ? 'item-error' : 'item-done');

                        // When all items in the group are settled, update the group header
                        const bodyEl = el.parentElement;
                        const detailsEl = bodyEl?.parentElement;
                        if (bodyEl && detailsEl != null && detailsEl.instanceOf(HTMLDetailsElement)) {
                            const stillRunning = bodyEl.querySelectorAll(
                                '.tool-group-item:not(.item-done):not(.item-error)'
                            ).length;
                            if (stillRunning === 0) {
                                const groupStatus = detailsEl.querySelector<HTMLElement>('.tool-status');
                                if (groupStatus) {
                                    groupStatus.removeClass('tool-running');
                                    const anyError = bodyEl.querySelectorAll('.item-error').length > 0;
                                    groupStatus.addClass(anyError ? 'tool-error' : 'tool-done');
                                    groupStatus.setText(anyError ? '✗' : '✓');
                                }
                                // Keep group open so the user can see which files were processed.
                                // Only collapse on error so the user can inspect failures.
                                if (isError) detailsEl.open = false;
                            }
                        }

                    } else if (el != null && el.instanceOf(HTMLDetailsElement)) {
                        // ── Standalone tool result ────────────────────────────────────
                        const details = el;

                        // Parse and strip <diff_stats added="X" removed="Y"/> tag
                        let displayContent = content;
                        const diffMatch = content.match(/<diff_stats added="(\d+)" removed="(\d+)"\/>/);
                        if (diffMatch && !isError) {
                            const diffAdded = parseInt(diffMatch[1], 10);
                            const diffRemoved = parseInt(diffMatch[2], 10);
                            displayContent = content.replace(/\n?<diff_stats[^/]*\/>/g, '');
                            if (diffAdded > 0 || diffRemoved > 0) {
                                const summary = details.querySelector('summary');
                                if (summary) {
                                    const badge = summary.createSpan('tool-diff-badge');
                                    const parts: string[] = [];
                                    if (diffAdded > 0) parts.push(`+${diffAdded}`);
                                    if (diffRemoved > 0) parts.push(`-${diffRemoved}`);
                                    badge.setText(parts.join(' / '));
                                }
                            }
                        }

                        const statusEl = details.querySelector('.tool-status');
                        if (statusEl) {
                            statusEl.removeClass('tool-running');
                            statusEl.addClass(isError ? 'tool-error' : 'tool-done');
                            statusEl.setText(isError ? '✗' : '✓');
                        }
                        const outputEl = details.querySelector('.tool-call-output');
                        if (outputEl && displayContent) {
                            const truncated = displayContent.length > 2000
                                ? displayContent.slice(0, 2000) + '\n…(truncated)'
                                : displayContent;
                            // FIX-19-31-02: clear any <pre> left by onToolProgress so the
                            // final result replaces the live-preview instead of being appended.
                            outputEl.empty();
                            // FIX-19-99-04: render tool output as markdown so [[wikilinks]]
                            // and [text](url) become clickable. Errors are swallowed because
                            // a malformed tool output should not break the chat surface.
                            void this.renderMarkdownAndWire(truncated, outputEl as HTMLElement);
                        }
                        details.open = isError;
                    }
                    // Fire the Frontmatter Operator recommendation toast once
                    // per session on the first successful update_frontmatter
                    // call, only when the plugin is not already active. The
                    // method itself gates on session flag + persistent
                    // dismiss flag + active-plugin check, so calling it
                    // unconditionally on the happy path is safe.
                    if (!isError && name === 'update_frontmatter') {
                        this.showFrontmatterOperatorRecommendation();
                    }

                    // Track step completion and update outer block summary
                    stepsCompleted++;
                    if (isError) stepsHasError = true;
                    updateStepsSummary(stepsCompleted === stepsTotal);

                    // Update activity badge in plan box (only if a plan is active).
                    // Use closest('.assistant-message') so the lookup works both before
                    // and after the DOM-move (toolsEl.parentElement changes on move).
                    activityActionCount++;
                    const actBadge = toolsEl.closest('.assistant-message')?.querySelector<HTMLElement>('.todo-activity-badge') ?? null;
                    if (actBadge) actBadge.setText(t('ui.sidebar.activityCount', { count: activityActionCount }));
                    if (isError) {
                        const actDetails = toolsEl.closest<HTMLDetailsElement>('.todo-activity-log');
                        if (actDetails) actDetails.open = true;
                    }
                },
                onToolProgress: (name, content) => {
                    // Update the live output area of the currently-running standalone tool.
                    const queue = toolElsByName.get(name);
                    const el = queue?.[0] ?? null; // peek without consuming
                    if (!el || el.classList.contains('tool-group-item')) return;
                    const outputEl = el.querySelector<HTMLElement>('.tool-call-output');
                    if (!outputEl) return;
                    // FIX-PERF-03: coalesce into one rAF tick so a 20-tool
                    // turn does not trigger 40+ synchronous parser passes.
                    // FIX-19-99-04 contract preserved: progress is rendered
                    // as markdown so partial wikilinks/links are clickable.
                    scheduleToolProgressRender(outputEl, content);
                },
                onUsage: (inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, modelId, routingMode, usageByModel) => {
                    // ADR-090 / FEATURE-1804: see TaskMonitor.onUsage
                    // FIX-24-05-02: modelId + routingMode must reach the
                    // monitor, otherwise TaskRouter-routed tasks are priced
                    // on the configured main model.
                    // FIX-24-05-05: usageByModel carries the per-model
                    // breakdown for correct mixed-model pricing.
                    taskMonitor.onUsage(inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, modelId, routingMode, usageByModel);
                },
                onTodoUpdate: (items) => {
                    lastTodoItems = items;
                    this.renderTodoBox(toolsEl, items);
                },
                onContextCondensed: (prevTokens?: number, newTokens?: number) => {
                    // Show condensation feedback with token reduction
                    if (footerEl && prevTokens !== undefined && newTokens !== undefined) {
                        const feedback = new CondensationFeedback();
                        feedback.show(footerEl, {
                            prevTokens,
                            newTokens,
                        });
                        footerEl.classList.remove('agent-u-hidden');
                    } else if (footerEl) {
                        // Fallback: show simple badge if token counts not available
                        const badge = footerEl.createSpan('context-condensed-badge');
                        badge.setText(t('ui.sidebar.contextCondensed'));
                        footerEl.classList.remove('agent-u-hidden');
                    }

                    // Update context tracker with new token count after condensing
                    if (this.contextTracker && newTokens !== undefined) {
                        this.contextTracker.setTotalTokens(newTokens);
                        if (this.contextDisplay) {
                            const usage = this.contextTracker.getContextUsage();
                            const color = this.contextTracker.getContextColor();
                            this.contextDisplay.update(usage, color);
                        }
                    }
                },
                onContextCondenseFailed: (error: Error) => {
                    // FIX-COMPACT-02: surface failed condensing so the user
                    // sees that the helper-API call did NOT run, instead of
                    // silently letting the loop re-enter the same over-
                    // threshold state. Renders as a badge in the same footer.
                    if (footerEl) {
                        const badge = footerEl.createSpan('context-condense-failed-badge');
                        badge.setText(t('ui.sidebar.condenseFailed', { error: error.message }));
                        footerEl.classList.remove('agent-u-hidden');
                    }
                    console.warn('[Sidebar] Context condense failed:', error.message);
                },
                // FEAT-24-08 / ADR-114 Steering-Hook: drain the queue and
                // hand mid-run steering messages to AgentTask. Called by
                // AgentTask once per iteration. Order preserved. Each
                // drained bubble is flipped to "delivered at iteration N"
                // so the user can see exactly when their correction landed
                // in the conversation history.
                consumeSteeringMessages: (iteration: number) => {
                    if (this.steeringQueue.length === 0) return [];
                    const drained = this.steeringQueue;
                    this.steeringQueue = [];
                    const texts: string[] = [];
                    for (const entry of drained) {
                        texts.push(entry.text);
                        this.markSteeringDelivered(entry.bubbleEl, iteration);
                    }
                    return texts;
                },
                onModeSwitch: (newModeSlug) => {
                    // Explicitly sync settings before refreshing the button.
                    // ModeService.switchMode() sets this synchronously; we
                    // still update settings here as a safety net.
                    this.plugin.settings.currentMode = newModeSlug;
                    new Notice(t('notice.modeSwitched', { mode: this.getModeDisplayName(newModeSlug) }));
                    // Auto-index on mode switch if configured
                    if (this.plugin.settings.semanticAutoIndex === 'mode-switch' && this.plugin.semanticIndex) {
                        this.plugin.semanticIndex.buildIndex().catch((e) =>
                            console.warn('[AgentSidebarView] Auto-index on mode switch failed:', e)
                        );
                    }
                },
                onCheckpoint: (checkpoint) => {
                    this.renderCheckpointMarker(toolsEl, checkpoint);
                    hasRenderedCheckpoints = true;
                    // FIX-44-12: remember for persistence into the UiMessage.
                    turnCheckpoints.push(checkpoint);
                    scheduleScroll();
                },
                // FIX-44-44: the pipeline reports every write that landed
                // without an individual diff approval; one is enough to owe
                // the user a post-task review.
                onUnreviewedWrite: () => {
                    taskHadUnreviewedWrites = true;
                },
                onQuestion: (question, options, resolve, allowMultiple) => {
                    // Render any accumulated text before the question card.
                    // This is critical for multi-turn flows like onboarding where
                    // onComplete only fires at the very end — the greeting text
                    // would otherwise stay invisible until the entire task finishes.
                    if (accumulatedText.trim()) {
                        // Hide during re-render to avoid flash of raw → markdown transition
                        contentEl.classList.add('agent-u-visibility-hidden');
                        contentEl.empty();
                        void this.renderMarkdownAndWire(accumulatedText, contentEl);
                        window.requestAnimationFrame(() => { contentEl.classList.remove('agent-u-visibility-hidden'); });
                    }
                    // Wrap resolve: after the user answers, show their answer as a
                    // chat bubble and create a fresh message element for the next
                    // agent response. This turns multi-turn flows (onboarding) into
                    // a real back-and-forth conversation in the UI.
                    const wrappedResolve = (answer: string) => {
                        // Finalize current assistant message
                        messageEl.removeClass('message-streaming');
                        if (accumulatedText) {
                            this.uiMessages.push({
                                role: 'assistant',
                                text: accumulatedText,
                                ts: new Date().toISOString(),
                                toolStepsHtml: stepsBlockEl?.outerHTML,
                                taskId,
                                reasoningText: accumulatedThinking || undefined,
                                // FIX-44-12: persist this turn's markers so they
                                // rehydrate live after a reload.
                                checkpoints: turnCheckpoints.length > 0
                                    ? turnCheckpoints.map(toPersistedCheckpointMarker)
                                    : undefined,
                            });
                        }
                        // Render user answer as a regular chat message
                        this.addUserMessage(answer);
                        this.uiMessages.push({ role: 'user', text: answer, ts: new Date().toISOString() });
                        // Create fresh assistant message element for the next response
                        ({ messageEl, thinkingEl, toolsEl, contentEl, footerEl } = this.createStreamingMessageEl());
                        // Reset per-turn state
                        accumulatedText = '';
                        accumulatedThinking = '';
                        accumulatedToolContent = '';
                        hasTools = false;
                        cancelQaRender();
                        qaLastRenderAt = 0;
                        streamingPara = null;
                        stepsBlockEl = null;
                        stepsBodyEl = null;
                        stepsSummaryIconEl = null;
                        stepsSummaryLabelEl = null;
                        stepsTotal = 0;
                        stepsCompleted = 0;
                        stepsHasError = false;
                        loadingRemoved = false;
                        activeToolGroup = null;
                        // FIX-44-12: markers of the finalized turn were just
                        // persisted above; the next turn starts empty.
                        turnCheckpoints = [];
                        // Scroll and continue agent loop
                        scheduleScroll();
                        resolve(answer);
                    };
                    this.showQuestionCard(question, options, wrappedResolve, allowMultiple);
                },
                onApprovalRequired: async (toolName, input, preview) => {
                    return this.showApprovalCard(toolName, input, preview);
                },
                onOptionalAssetRequired: async (spec, toolName) => {
                    return this.showInstallPromptCard(spec, toolName);
                },
                onAttemptCompletion: () => {
                    // Auto-complete any unfinished todo items — agent often skips
                    // a final update_todo_list call before attempt_completion
                    if (lastTodoItems.length > 0) {
                        const allDone = lastTodoItems.map((i) => ({ ...i, status: 'done' as const }));
                        this.renderTodoBox(toolsEl, allDone);
                    }
                    scheduleScroll();
                },
                onEpisodeData: (data) => {
                    // Episodic memory: record task outcome (ADR-018).
                    // Payload includes success, mistakesEncountered,
                    // attemptCompletionFired, fastPathFired. Fires for ALL exit
                    // paths (success, iteration-cap, abort, error). Fire-and-forget.
                    if (this.plugin.episodicExtractor && this.plugin.settings.mastery.enabled) {
                        const resultSummary = data.success
                            ? accumulatedText.slice(0, 300)
                            : (data.attemptCompletionFired ? 'partial' : 'incomplete');
                        const episode = {
                            userMessage: text,
                            mode: activeMode.slug,
                            toolSequence: data.toolSequence,
                            toolLedger: data.toolLedger,
                            success: data.success,
                            resultSummary,
                        };
                        this.plugin.episodicExtractor.recordEpisode(episode).then((ep) => {
                            if (ep && this.plugin.recipePromotionService) {
                                // ADR-058: check for semantic recipe promotion.
                                // recipeWinner routes a FastPath recipe win to a
                                // success-count bump instead of a duplicate promotion.
                                this.plugin.recipePromotionService.checkForPromotion(ep, data.recipeWinner).catch((e) =>
                                    console.warn('[Mastery] Promotion check failed:', e)
                                );
                            }
                        }).catch((e) => console.warn('[Mastery] Episode recording failed:', e));
                    }
                },
                onComplete: () => {
                    // Always clear the loading spinner — covers cases where no text was streamed.
                    removeLoading();
                    // Auto-complete todos on natural task end (mirrors onAttemptCompletion)
                    if (lastTodoItems.length > 0) {
                        const allDone = lastTodoItems.map((i) => ({ ...i, status: 'done' as const }));
                        this.renderTodoBox(toolsEl, allDone);
                    }
                    // Finalize the steps block: remove any trailing "Analyzing…" row,
                    // ensure the summary shows the final count + status icon, and
                    // remove open state from individual tool-call details so the block
                    // is tidy when the user expands it.
                    if (stepsBlockEl) {
                        if (stepsTotal === 0) {
                            // No tools were called — remove the empty block so it doesn't clutter the UI.
                            stepsBlockEl.remove();
                            stepsBlockEl = null;
                        } else {
                            stepsBodyEl?.querySelector('.tool-computing-row')?.remove();
                            updateStepsSummary(true);
                            // Collapse individual tool <details> that were left open during streaming
                            stepsBodyEl?.querySelectorAll('details.tool-call-details').forEach((d) => {
                                if (d != null && d.instanceOf(HTMLDetailsElement)) d.open = false;
                            });
                        }
                    }

                    // Replace the streamed Markdown with the authoritative pass (sources /
                    // followups parsed). Cancel any pending throttled Q&A render first so a
                    // late trailing tick cannot re-render the unparsed text over this one.
                    cancelQaRender();
                    streamingPara = null;
                    // Parse [sources] and [followups] blocks before rendering
                    let renderText = accumulatedText;
                    let parsedSources: { num: number; note: string; context: string }[] = [];
                    let parsedFollowups: string[] = [];
                    let followupHeading = '';
                    if (accumulatedText) {
                        const srcParsed = this.parseSources(accumulatedText);
                        renderText = srcParsed.cleanText;
                        parsedSources = srcParsed.sources;
                        const fuParsed = this.parseFollowups(renderText);
                        renderText = fuParsed.cleanText;
                        followupHeading = fuParsed.heading;
                        parsedFollowups = fuParsed.followups;
                    }
                    if (renderText) {
                        contentEl.empty();
                        void this.renderMarkdownAndWire(renderText, contentEl);
                        contentEl.classList.remove('agent-u-visibility-hidden');
                    } else if (hasTools) {
                        // Tools ran but the model returned no text — show a neutral placeholder
                        // so the user doesn't stare at an empty message bubble.
                        contentEl.empty();
                        contentEl.createEl('p', { cls: 'message-empty-response', text: t('ui.sidebar.emptyResponse') });
                    }
                    // Show timestamp in footer even without token usage
                    if (footerEl.classList.contains('agent-u-hidden')) {
                        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        footerEl.setText(time);
                        footerEl.classList.remove('agent-u-hidden');
                    }
                    // Link wiring now happens inside renderMarkdownAndWire above.
                    // Convert inline [N] to clickable citation badges
                    this.wireCitationBadges(contentEl, parsedSources);
                    // Add response action bar (with sources indicator)
                    this.addResponseActions(messageEl, accumulatedText, parsedSources);
                    // Render follow-up suggestions (parsed from [followups] block)
                    if (parsedFollowups.length > 0) {
                        const followupList = messageEl.createDiv('followup-list');
                        if (followupHeading) {
                            followupList.createEl('div', { cls: 'followup-heading', text: followupHeading });
                        }
                        for (const raw of parsedFollowups) {
                            // Clean [[wikilinks]] → display name only (no folder prefix)
                            const displayText = raw.replace(/\[\[([^\]]+)\]\]/g, (_m, link: string) => {
                                const name = link.contains('|') ? link.split('|').pop()! : link;
                                return name.contains('/') ? name.split('/').pop()! : name;
                            });
                            const itemRow = followupList.createDiv('followup-item-row');
                            // Main button: send immediately (existing behavior)
                            const item = itemRow.createEl('button', { cls: 'followup-item', text: displayText });
                            item.addEventListener('click', () => {
                                if (this.textarea) {
                                    this.textarea.value = displayText;
                                    void this.handleSendMessage();
                                }
                            });
                            // "+" button: append text to textarea without sending (inside item, right-aligned, hover-only)
                            const appendBtn = item.createEl('span', { cls: 'followup-append-btn', text: '+' });
                            appendBtn.setAttribute('aria-label', t('ui.sidebar.addToInput'));
                            appendBtn.addEventListener('click', (ev) => {
                                ev.stopPropagation();
                                ev.preventDefault();
                                if (this.textarea) {
                                    const sep = this.textarea.value.trim() ? '\n' : '';
                                    this.textarea.value = this.textarea.value + sep + displayText;
                                    this.textarea.focus();
                                    this.textarea.dispatchEvent(new Event('input'));
                                }
                            });
                        }
                    }
                    messageEl.removeClass('message-streaming');
                    // FIX-24-08-03: only clean up when this is still OUR
                    // controller. A late onComplete of a stopped, drained
                    // run must not clobber a newer run's controller (which
                    // would make that run unstoppable).
                    if (this.currentAbortController === myController) {
                        this.currentAbortController = null;
                        this.setRunningState(false);
                        this.currentStopFeedback = null;
                    }
                    this.endTaskDraining(); // GUARD-L1
                    // IMP-24-08-04 (stop=pause): a stopped run kept its
                    // inflight snapshot -- offer the Resume card now that
                    // the drain is over and sends are unblocked.
                    if (myController.signal.aborted) {
                        void this.maybeOfferInflightResume();
                    }
                    scheduleScroll();
                    if (taskWriteCount > 0 && (this.plugin.settings.enableCheckpoints ?? true) && !hasRenderedCheckpoints) {
                        this.showUndoBar(taskId, taskWriteCount);
                    }
                    // Post-task review: show all changes for review/undo.
                    // FIX-44-44: gated on writes that never had a diff surface
                    // (regardless of the auto-approval master toggle), NOT on
                    // the toggle itself. When every write was individually
                    // diff-approved at the gate, the review stays closed -- a
                    // second, weaker-looking approval is what misled users
                    // (FIX-44-16).
                    if (taskWriteCount > 0 && taskHadUnreviewedWrites && (this.plugin.settings.enableCheckpoints ?? true)) {
                        void this.showPostTaskReview(taskId);
                    }
                    // Notify when sidebar is not the active (focused) view
                    if (this.app.workspace.getMostRecentLeaf()?.view !== this) {
                        new Notice(t('notice.taskComplete'), 3000);
                    }
                    // Track assistant UI message for history persistence,
                    // including a snapshot of the collapsed steps block so
                    // tool actions remain inspectable after a chat reload.
                    if (accumulatedText) {
                        this.uiMessages.push({
                            role: 'assistant',
                            text: accumulatedText,
                            ts: new Date().toISOString(),
                            toolStepsHtml: stepsBlockEl?.outerHTML,
                            taskId,
                            reasoningText: accumulatedThinking || undefined,
                            // FIX-44-12: persist this turn's markers so they
                            // rehydrate live after a reload.
                            checkpoints: turnCheckpoints.length > 0
                                ? turnCheckpoints.map(toPersistedCheckpointMarker)
                                : undefined,
                        });
                    }
                    // Auto-save conversation to ConversationStore
                    this.saveCurrentConversation();

                    // Task Extraction Post-Processing (ADR-026, FEATURE-100)
                    const taskScanText = (accumulatedText + accumulatedToolContent).trim();
                    if (this.plugin.settings.taskExtraction?.enabled && taskScanText) {
                        void this.maybeExtractTasks(taskScanText);
                    }

                    // Auto-title: set fallback title for immediate history display (ADR-022)
                    // Semantic titling happens later in finalizeConversation() on conversation end.
                    if (this.activeConversationId && this.uiMessages.length <= 2 && this.plugin.conversationStore) {
                        const firstUserMsg = this.uiMessages.find((m) => m.role === 'user');
                        if (firstUserMsg) {
                            const fallback = firstUserMsg.text.slice(0, 60).replace(/\n/g, ' ').trim() || t('ui.sidebar.newConversation');
                            void this.plugin.conversationStore.updateMeta(this.activeConversationId, { title: fallback }).catch(() => {});
                            this.historyPanel?.refresh();
                        }
                    }
                },
                // Feature 5: Error display inside steps dialog
                onError: (error) => {
                    // Clean up spinner and computing row
                    removeLoading();

                    // Show error inside the steps block (not as a separate red banner)
                    ensureStepsBlock();
                    const errorRow = (stepsBodyEl ?? toolsEl).createDiv('tool-step-row tool-step-error');
                    const iconEl = errorRow.createSpan('tool-step-icon');
                    setIcon(iconEl, 'x-circle');
                    const textEl = errorRow.createDiv('tool-step-text');
                    textEl.createDiv('error-title').setText(this.getErrorTitle(error));
                    textEl.createDiv('error-detail').setText(error.message);

                    // Update steps summary to error state
                    stepsHasError = true;
                    updateStepsSummary(true);
                    if (stepsBlockEl) stepsBlockEl.open = true;

                    // Clean up streaming/running state
                    messageEl.removeClass('message-streaming');
                    // FIX-24-08-03: identity check, see onComplete.
                    if (this.currentAbortController === myController) {
                        this.currentAbortController = null;
                        this.setRunningState(false);
                    }
                    this.endTaskDraining(); // GUARD-L1
                },
                onTaskTelemetry: (data) => {
                    // ADR-090 / FEATURE-1804: see TaskMonitor.onTaskTelemetry
                    taskMonitor.onTaskTelemetry(data);
                },
                onCondenseTelemetry: (event) => {
                    // FIX-COMPACT-07: per-condense JSONL for threshold tuning
                    taskMonitor.onCondenseTelemetry(event);
                },
            },
            modeService: this.modeService,
            consecutiveMistakeLimit: this.plugin.settings.advancedApi.consecutiveMistakeLimit,
            rateLimitMs: this.plugin.settings.advancedApi.rateLimitMs,
            // FIX-COMPACT-03: shared defaults so the sidebar fallback can
            // never drift from the settings schema and the Runner. The
            // previous `false` fallback silently disabled condensing for
            // any user whose settings.advancedApi was undefined.
            condensingEnabled: this.plugin.settings.advancedApi.condensingEnabled ?? DEFAULT_CONDENSING_ENABLED,
            condensingThreshold: this.plugin.settings.advancedApi.condensingThreshold ?? DEFAULT_CONDENSING_THRESHOLD,
            powerSteeringFrequency: this.plugin.settings.advancedApi.powerSteeringFrequency ?? 0,
            maxIterations: this.plugin.settings.advancedApi.maxIterations ?? 25,
            depth: 0,  // root task starts at 0
            maxSubtaskDepth: this.plugin.settings.advancedApi.maxSubtaskDepth ?? 2,
            microcompactionEnabled: this.plugin.settings.advancedApi.microcompactionEnabled ?? DEFAULT_MICROCOMPACTION_ENABLED,
            rollingSummaryThreshold: this.plugin.settings.advancedApi.rollingSummaryThreshold ?? DEFAULT_ROLLING_SUMMARY_THRESHOLD,
            modelOverrideActive,
        });

        // Load enabled rules for this task (Sprint 3.2)
        const rulesLoader = this.plugin.rulesLoader;
        const rulesContent = rulesLoader
            ? await rulesLoader.loadEnabledRules(this.plugin.settings.rulesToggles ?? {})
            : undefined;

        // Feature 1: Pass the shared history — it accumulates across messages
        // Feature 4: Pass messageToSend (with active file context) instead of raw text
        const activeMode = this.modeService.getActiveMode();

        // FEAT-24-09 / ADR-116: build the stable SKILLS directory for the
        // cached system-prompt prefix. The model loads a skill body on demand
        // via the read_skill tool -- no per-message LLM classifier any more.
        // Skip only during the active first-time onboarding wizard, not for
        // users who abandoned it but use the plugin productively (FIX-24-09-01).
        const isOnboarding = isActiveOnboardingFlow(this.plugin.settings);
        let skillDirectorySection: string | undefined;
        if (!isOnboarding) {
            skillDirectorySection = await this.buildSkillDirectory();
        }

        // Apply forced workflow from tool picker (when message doesn't start with slash command)
        const forcedWorkflowSlug = this.plugin.settings.forcedWorkflow?.[activeMode.slug] ?? '';
        if (typeof messageToSend === 'string' && !text.startsWith('/') && forcedWorkflowSlug) {
            const workflowLoader = this.plugin.workflowLoader;
            if (workflowLoader) {
                const processedText = await workflowLoader.processSlashCommand(
                    `/${forcedWorkflowSlug} ${text}`,
                    this.plugin.settings.workflowToggles ?? {},
                );
                if (processedText !== `/${forcedWorkflowSlug} ${text}`) {
                    messageToSend = processedText + (activeFile
                        ? `\n\n<context>\nActive file in editor: ${activeFile.path}\n</context>`
                        : '');
                }
            }
        }

        // Build plugin skills section from VaultDNA (PAS-1) — skip during onboarding
        const pluginSkillsSection = isOnboarding ? undefined
            : this.plugin.skillRegistry?.getPluginSkillsPromptSection();

        // 2026-05-18: per-mode MCP allow-list removed. The chat-header pocket
        // knife now toggles activeMcpServers globally instead. The systemprompt
        // tool-section honours activeMcpServers as the source of truth via
        // McpBridge, so passing undefined here means "no per-agent restriction".
        const allowedMcpServers: string[] | undefined = undefined;

        // Memory v2 is the only path. The legacy v1 MD-file pipeline was
        // removed once the upgrade orchestrator landed -- existing users
        // are taken through the upgrade modal on first load, fresh users
        // start on v2 from minute one. ContextComposer renders an empty
        // block until the user has facts; no fallback to v1.
        let memoryContext: string | undefined;
        const isFirstMessage = this.conversationHistory.length === 0;

        if (
            this.plugin.settings.memory.enabled
            && this.plugin.memoryDB?.isOpen()
            && this.plugin.embeddingService?.isReady()
        ) {
            try {
                const { TopicInference } = await import('../core/memory/TopicInference');
                const { UserProfileView } = await import('../core/memory/UserProfileView');
                const { ContextComposer } = await import('../core/memory/ContextComposer');
                const inference = new TopicInference(this.plugin.memoryDB);
                const profileView = new UserProfileView(this.plugin.memoryDB);
                // FIX-32-03-01: the composer renders a stable pause-notice
                // trailer when TokenBudgetGuard has blocked further writes.
                // dayKey comes from the same snapshot the guard uses so the
                // line flips deterministically at the daily reset.
                const composer = new ContextComposer(
                    this.plugin.memoryDB,
                    inference,
                    profileView,
                    this.plugin.driftBus,
                    () => {
                        const guard = this.plugin.tokenBudget;
                        if (!guard) return null;
                        const reason = guard.blockReason();
                        if (!reason) return null;
                        return { reason, dayKey: guard.snapshot().day };
                    },
                );
                let userEmbedding: Float32Array | null = null;
                if (text.trim()) {
                    const vectors = await this.plugin.embeddingService.embed([text]);
                    userEmbedding = vectors[0] ?? null;
                }
                // FEAT-03-26 (BA-25): Top-Hub-Block (Vault-Karte) optional
                // im stabilen Prompt-Prefix. Default off, Setting-gated.
                const topHubBlock = this.plugin.settings.vaultIngest?.topHubBlock?.enabled
                    ? this.plugin.topHubBlockMarkdown
                    : undefined;
                const composed = composer.compose({
                    sessionId: this.activeConversationId ?? 'transient',
                    userMessageEmbedding: userEmbedding,
                    topHubBlockMarkdown: topHubBlock,
                });
                // FEATURE-0319b: prepend the cache-stable Soul block from
                // the agent-self profile (profile_id='_obsilo'). Two
                // separate calls per /architecture decision A so the
                // blocks stay independently cache-stable and ContextRanker
                // remains profile-naive.
                const { SoulView } = await import('../core/memory/SoulView');
                const soulMarkdown = new SoulView(this.plugin.memoryDB).renderMarkdown();
                const parts: string[] = [];
                if (soulMarkdown) parts.push(soulMarkdown);
                if (composed.markdown) parts.push(composed.markdown);
                if (parts.length > 0) memoryContext = parts.join('\n\n');
            } catch (e) {
                console.warn('[Memory] ContextComposer failed:', e);
            }
        }

        // Session retrieval + onboarding: independent of v1/v2 memory engine.
        // Session summaries live in the same memory.db.sessions table either
        // way; onboarding prompts are still surfaced through MemoryService
        // until OnboardingService gets re-homed onto the v2 stores
        // (FEATURE-0323).
        if (this.plugin.settings.memory.enabled && this.plugin.memoryService) {
            try {
                const parts: string[] = memoryContext ? [memoryContext] : [];

                // Onboarding: inject step-specific setup instructions when setup is incomplete
                const onboarding = new OnboardingService(this.plugin.memoryService, this.plugin);
                const onboardingPrompt = onboarding.getOnboardingPrompt(getActiveLocale());
                if (onboardingPrompt) parts.unshift(onboardingPrompt);

                // Session retrieval — only on first message, using raw user text
                // (not userMessageText which includes <context> and <vault_context> blocks).
                // Skipped entirely when no sessions exist to avoid a wasted embedding API call.
                if (isFirstMessage && text.trim()) {
                    const stats = await this.plugin.memoryService.getStats();
                    if (stats.sessionCount > 0) {
                        const retriever = new MemoryRetriever(
                            this.plugin.globalFs,
                            this.plugin.memoryService,
                            () => this.plugin.semanticIndex,
                            this.plugin.memoryDB,
                        );
                        const sessionContext = await retriever.retrieveSessionContext(text);
                        if (sessionContext) parts.push(sessionContext);
                    }
                }

                if (parts.length > 0) memoryContext = parts.join('\n\n');
            } catch (e) {
                console.warn('[Memory] Session retrieval failed:', e);
            }
        }

        // Recipe matching (ADR-017) — find procedural recipes before starting the task
        let recipesSection: string | undefined;
        // Capture the matches so we can pass
        // them into AgentTask.run via `recipeMatches`. Without this the
        // FastPath gate inside AgentTask would re-run `match()` and could
        // diverge from the Sidebar's `recipesSection` source.
        let recipeMatchesForRun: import('../core/mastery/RecipeMatchingService').RecipeMatchResult[] | undefined;
        if (this.plugin.settings.mastery.enabled && this.plugin.recipeMatchingService) {
            try {
                const matches = this.plugin.recipeMatchingService.match(text, activeMode.slug);
                console.debug(`[Mastery] Recipe matching: ${matches.length} match(es) for mode "${activeMode.slug}"`, matches.map(m => `${m.recipe.id} (${m.score.toFixed(2)})`));
                recipeMatchesForRun = matches;
                if (matches.length > 0) {
                    recipesSection = this.plugin.recipeMatchingService.buildPromptSection(matches);
                    console.debug(`[Mastery] Recipe section injected (${recipesSection.length} chars)`);
                }
            } catch (e) {
                console.warn('[Mastery] Recipe matching failed (non-fatal):', e);
            }
        } else {
            console.debug(`[Mastery] Skipped: enabled=${this.plugin.settings.mastery.enabled}, service=${!!this.plugin.recipeMatchingService}`);
        }

        // IMP-41-03-01: an armed resume snapshot replaces the working history
        // with the (more complete) inflight copy and hands the loop its
        // persisted state. One-shot: consumed here, cleared immediately.
        const resumeSnapshot = this.pendingResume;
        this.pendingResume = null;
        if (resumeSnapshot) {
            this.conversationHistory = [...resumeSnapshot.history];
        }

        await task.execute({
            userMessage: messageToSend,
            taskId,
            initialMode: activeMode,
            history: this.conversationHistory,
            resumeState: resumeSnapshot?.state,
            // FIX-24-08-03: bind the pinned controller, not the mutable
            // field -- awaits between controller creation and this call
            // could otherwise hand this run a different run's signal.
            abortSignal: myController.signal,
            globalCustomInstructions: this.plugin.settings.globalCustomInstructions || undefined,
            includeTime: this.plugin.settings.includeCurrentTimeInContext ?? false,
            rulesContent: rulesContent || undefined,
            // FEAT-24-09 / ADR-116: SKILLS directory for the cached prefix.
            skillDirectorySection: skillDirectorySection || undefined,
            mcpClient: this.plugin.mcpClient,
            allowedMcpServers,
            memoryContext,
            pluginSkillsSection: pluginSkillsSection || undefined,
            recipesSection,
            // Hand the SAME matches to AgentTask so the FastPath gate
            // sees what `recipesSection` was built from.
            recipeMatches: recipeMatchesForRun,
            configDir: this.app.vault.configDir,
            conversationId: this.activeConversationId ?? undefined,
        });
    }

    /**
     * Trigger manual context condensing
     */
    private triggerManualCondensing(): void {
        if (!this.contextTracker) {
            new Notice(t('notice.context.trackerNotInitialized'));
            return;
        }

        const usage = this.contextTracker.getContextUsage();
        const percentage = usage.maxTokens > 0 ? (usage.tokensUsed / usage.maxTokens) * 100 : 0;

        if (percentage < 60) {
            new Notice(t('notice.context.condenseBelowThreshold'));
            return;
        }

        new Notice(t('notice.context.manualCondenseNotImplemented'));
        // TODO: Implement manual condensing trigger
        // This requires either:
        // 1. Storing reference to current AgentTask
        // 2. Implementing condensing via separate API call
        // 3. Using event system to trigger condensing
        //
        // For now, automatic condensing at 65% threshold is active.
    }

    /**
     * Feature 3: Cancel the running request
     */
    private handleStop(): void {
        if (this.currentAbortController) this.beginTaskDraining(); // GUARD-L1
        this.currentAbortController?.abort();
        this.currentAbortController = null;
        // IMP-24-08-04: swap the Working spinner for a Stopping row NOW --
        // the run drains to its next abort checkpoint in the background
        // and offers a Resume card when it ends.
        this.currentStopFeedback?.();
        this.currentStopFeedback = null;
        // FEAT-24-08 Steering: pending bubbles never reached the agent --
        // flip them to "discarded" so the user knows the correction was
        // never applied.
        for (const entry of this.steeringQueue) {
            this.markSteeringDiscarded(entry.bubbleEl);
        }
        this.steeringQueue = [];
        this.setRunningState(false);
    }

    /**
     * Toggle between send and stop button states.
     *
     * FEAT-24-08 / ADR-114 Steering-Hook: when a task is running and the
     * textarea has content, show Send (Claude-Code-style: typing morphs
     * Stop -> Send so Enter sends a steering message instead of stopping).
     * Empty textarea while running keeps Stop visible.
     * Textarea stays enabled so the user can type mid-run.
     */
    private setRunningState(running: boolean): void {
        if (this.modelButton) this.modelButton.disabled = running;
        // Textarea is no longer disabled when running -- needed for steering.
        if (this.textarea) this.textarea.disabled = false;
        this.refreshRunStateButtons();
    }

    /**
     * Pick the correct primary action button (Send vs Stop) based on running
     * state + textarea content. Called on running-state changes and on every
     * textarea input event.
     */
    private refreshRunStateButtons(): void {
        const running = this.currentAbortController !== null;
        const hasText = (this.textarea?.value.trim().length ?? 0) > 0;
        // FIX-24-08-03: Stop stays visible for the whole task lifetime;
        // Send appears NEXT TO it in steering mode. The old morph replaced
        // Stop with Send at the same position, making a running task
        // unstoppable as soon as text sat in the textarea.
        const { showSend, showStop } = resolveRunStateButtons(running, hasText);
        if (this.sendButton) this.sendButton.classList.toggle('agent-u-hidden', !showSend);
        if (this.stopButton) this.stopButton.classList.toggle('agent-u-hidden', !showStop);
    }

    /**
     * FIX-01-01-02: while a task runs, the loop holds THE reference to
     * this.conversationHistory and pushes into it. Reassigning the array
     * mid-task (load/clear/import/delete-active) decouples the running task
     * from what gets persisted: saves then freeze the api history mid-task
     * (orphaned tool_use tails) while onComplete pushes the final answer
     * into the NEW uiMessages array -- the divergence behind two documented
     * data-loss incidents. Conversation switches are therefore refused
     * until the task finishes or the user stops it.
     */
    private refuseWhileTaskRuns(): boolean {
        // GUARD-L1 (audit 2026-07-07): after Stop the controller is nulled
        // immediately, but the aborted loop keeps draining until its next
        // abort checkpoint (a running tool call or approval wait can hold it
        // for seconds to minutes) and then still fires onComplete. Switching
        // conversations inside that window would let the late onComplete
        // closure push the stopped task's text into the WRONG conversation,
        // so the guard also holds while a stopped task drains. A timeout
        // fallback keeps a wedged task from locking the user out forever.
        if (!this.currentAbortController && !this.taskDraining) return false;
        new Notice(t('ui.sidebar.taskRunningNoSwitch'), 6000);
        return true;
    }

    /** GUARD-L1: hold the switch guard while a stopped task drains. */
    private beginTaskDraining(): void {
        this.taskDraining = true;
        if (this.taskDrainingTimer) window.clearTimeout(this.taskDrainingTimer);
        this.taskDrainingTimer = window.setTimeout(() => {
            this.taskDraining = false;
            this.taskDrainingTimer = 0;
        }, 30_000);
    }

    private endTaskDraining(): void {
        this.taskDraining = false;
        if (this.taskDrainingTimer) {
            window.clearTimeout(this.taskDrainingTimer);
            this.taskDrainingTimer = 0;
        }
    }

    /**
     * Clear conversation history and chat UI (New Chat)
     */
    private clearConversation(opts: { skipNavPush?: boolean } = {}): void {
        if (this.refuseWhileTaskRuns()) return;
        // Save current conversation before clearing (if there is one)
        this.saveCurrentConversation();
        // Enqueue memory extraction (fire-and-forget, threshold-gated)
        this.enqueueMemoryExtraction();
        // Finalize outgoing conversation: semantic title + frontmatter links (ADR-022)
        // Capture messages before clearing -- finalizeConversation runs async
        if (this.activeConversationId) {
            const msgs = [...this.uiMessages];
            void this.finalizeConversation(this.activeConversationId, msgs);
        }
        this.activeConversationId = null;
        this.lazyConversationId.reset(); // FIX-03-20-01: fresh chat, fresh memo
        this.uiMessages = [];
        this.conversationHistory = [];
        this.userDismissedContext = false;
        // Issue #54.3: the model override is sticky (survives a fresh chat);
        // thinking + effort stay per-conversation and reset here.
        this.restoreChatModelOverride();
        this.chatThinkingOverride = DEFAULT_THINKING_OVERRIDE;
        this.chatEffortOverride = DEFAULT_EFFORT_OVERRIDE;
        this.updateModelButton();
        // ADR-048: Reset session flags when starting a new conversation
        this.plugin.sessionFlags.clear();
        this.onboarding?.reset();
        this.attachments.clear();
        // Conversation reset drops any pending fullDocTexts too (FIX-19-28-05 audit).
        void this.attachments.consumeFullDocTexts();
        if (this.chatContainer) {
            this.chatContainer.empty();
        }
        this.showWelcomeMessage();
        this.updateContextBadge();
        this.historyPanel?.setActiveId(null);

        if (!opts.skipNavPush) {
            this.pushNav(null);
        } else {
            this.updateNavButtons();
        }
    }

    /**
     * FIX-03-20-01: create the conversation id as soon as the store allows.
     * Returns null while no store exists (nothing to save against).
     */
    private ensureConversationId(): Promise<string> | null {
        return this.lazyConversationId.ensure(
            this.activeConversationId,
            this.plugin.conversationStore,
            () => {
                const mode = this.modeService.getActiveMode().slug;
                const modelKey = this.resolveEnabledModelKey(mode);
                const model = this.plugin.settings.activeModels.find((m) => getModelKey(m) === modelKey);
                return { mode, model: model?.displayName ?? model?.name ?? modelKey };
            },
            (id) => {
                // Only adopt the id if the view still has none -- the user
                // may have switched to a loaded conversation meanwhile.
                if (!this.activeConversationId) this.activeConversationId = id;
            },
        );
    }

    /** Save the current conversation to ConversationStore (non-blocking). */
    private saveCurrentConversation(): void {
        const store = this.plugin.conversationStore;
        if (!store || this.uiMessages.length === 0) return;
        // FIX-03-20-01: a send during boot may predate store init. Create
        // the id lazily now instead of silently skipping the save (this
        // was how a completed chat could vanish from history entirely).
        const ensured = this.ensureConversationId();
        if (!ensured) return;
        // AUDIT-2026-07-02 L-2: snapshot BOTH arrays at call time. The id may
        // resolve after the user switched conversations (boot-race + load);
        // saving live this.* would then persist the newly loaded
        // conversation's content under this save's id. Snapshots bind the
        // payload to the conversation that was active when the save fired.
        const messagesSnapshot = [...this.uiMessages];
        const historySnapshot = [...this.conversationHistory];
        ensured.then(async (convId) => {
            await store.save(convId, historySnapshot, messagesSnapshot);
            // FEATURE-0320 Phase 6: re-index history_chunks after every save.
            void this.plugin.historyIndexer?.onConversationSaved(convId, messagesSnapshot);
        }).catch((e) => console.warn('[History] Save failed:', e));
    }

    /**
     * Post-processing hook: scan agent response for `- [ ]` items and show selection modal.
     * ADR-026: Fire-and-forget (void-prefixed), does not block onComplete.
     */
    private maybeExtractTasks(text: string): void {
        try {
            const items = scanTasks(text);
            if (items.length === 0) return;

            const sourceNote = this.app.workspace.getActiveFile()?.basename ?? '';
            const settings = this.plugin.settings.taskExtraction;

            const taskNotesActive = this.isTaskNotesActive();
            const useTaskNotes = taskNotesActive && (settings.preferTaskNotesPlugin ?? true);

            // Show recommendation if TaskNotes is not active and hint not dismissed
            if (!taskNotesActive && !(settings.taskNotesHintDismissed ?? false)) {
                this.showTaskNotesRecommendation();
            }

            new TaskSelectionModal(
                this.app,
                items,
                useTaskNotes,
                async (selected) => {
                    try {
                        const creator = useTaskNotes
                            ? new TaskNotesAdapter(this.app)
                            : new TaskNoteCreator(this.app, {
                                categoryProperty: this.plugin.settings.categoryProperty,
                                summaryProperty: this.plugin.settings.summaryProperty,
                                backlinksProperty: this.plugin.settings.backlinksProperty,
                            });
                        const created = await creator.createNotes(selected, settings, sourceNote);
                        if (created.length > 0) {
                            const format = useTaskNotes ? t('notice.taskNotesCreatedFormatSuffix') : '';
                            new Notice(t('notice.taskNotesCreated', { count: created.length, format }));
                        }
                    } catch (err) {
                        console.warn('[TaskExtraction] Failed to create task notes:', err);
                        new Notice(t('notice.taskNotesError'));
                    }
                },
            ).open();
        } catch (err) {
            console.error('[TaskExtraction] Scan failed:', err);
            new Notice(t('notice.taskExtractionError', { error: err instanceof Error ? err.message : String(err) }));
        }
    }

    /** Checks whether the TaskNotes community plugin is currently enabled */
    private isTaskNotesActive(): boolean {
        const plugins = (this.app as unknown as { plugins?: { enabledPlugins?: Set<string> } }).plugins;
        return plugins?.enabledPlugins?.has('tasknotes') ?? false;
    }

    /** Shows a non-blocking recommendation notice for the TaskNotes plugin */
    private showTaskNotesRecommendation(): void {
        const plugins = (this.app as unknown as { plugins?: { manifests?: Record<string, unknown> } }).plugins;
        const isInstalled = !!plugins?.manifests?.['tasknotes'];

        const message = isInstalled
            ? t('notice.taskNotes.hintDisabled')
            : t('notice.taskNotes.hintNotInstalled');

        const fragment = createFragment((frag) => {
            frag.createSpan({ text: message });
            const dismissLink = frag.createEl('a', {
                text: t('ui.sidebar.doNotShowAgain'),
                cls: 'agent-u-task-hint-dismiss',
            });
            dismissLink.addClass('agent-u-task-hint-dismiss-link');
            dismissLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.plugin.settings.taskExtraction = {
                    ...this.plugin.settings.taskExtraction,
                    taskNotesHintDismissed: true,
                };
                void this.plugin.saveSettings();
                notice.hide();
            });
        });
        const notice = new Notice(fragment, 12000);
    }

    /** Checks whether the Frontmatter Operator community plugin is currently enabled */
    private isFrontmatterOperatorActive(): boolean {
        const plugins = (this.app as unknown as { plugins?: { enabledPlugins?: Set<string> } }).plugins;
        return plugins?.enabledPlugins?.has('frontmatter-operator') ?? false;
    }

    /**
     * Non-blocking recommendation notice for the Frontmatter Operator plugin.
     * Fires at most once per sidebar-view session and never again after the
     * user clicks "Do not show again" (persisted via
     * settings.frontmatterOperatorHintDismissed). English UI language per
     * feedback_ui_language_and_naming.
     */
    private showFrontmatterOperatorRecommendation(): void {
        if (this.frontmatterOperatorHintShownThisSession) return;
        if (this.plugin.settings.frontmatterOperatorHintDismissed) return;
        if (this.isFrontmatterOperatorActive()) return;
        this.frontmatterOperatorHintShownThisSession = true;

        const plugins = (this.app as unknown as { plugins?: { manifests?: Record<string, unknown> } }).plugins;
        const isInstalled = !!plugins?.manifests?.['frontmatter-operator'];

        const message = isInstalled
            ? t('notice.frontmatterOperator.hintDisabled')
            : t('notice.frontmatterOperator.hintNotInstalled');

        const fragment = createFragment((frag) => {
            frag.createSpan({ text: message + ' ' });
            const dismissLink = frag.createEl('a', {
                text: t('ui.sidebar.doNotShowAgain'),
                cls: 'agent-u-task-hint-dismiss',
            });
            dismissLink.addClass('agent-u-task-hint-dismiss-link');
            dismissLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.plugin.settings.frontmatterOperatorHintDismissed = true;
                void this.plugin.saveSettings();
                notice.hide();
            });
        });
        const notice = new Notice(fragment, 12000);
    }

    /** Enqueue memory extraction if the conversation meets the threshold. Fire-and-forget. */
    private enqueueMemoryExtraction(): void {
        const mem = this.plugin.settings.memory;
        const queue = this.plugin.extractionQueue;
        if (!mem.enabled || !mem.autoExtractSessions || !queue) return;
        if (!this.activeConversationId) return;

        // Pinned conversations (already have facts in memory) get a
        // lower threshold of 1 -- the user explicitly opted into memory
        // for them, every new message is potentially relevant. Fresh
        // conversations still wait for the configured threshold so
        // smalltalk doesn't trigger an extraction.
        const isPinned = this.plugin.countMemoryFactsForConversation(this.activeConversationId) > 0;
        const threshold = isPinned ? 1 : mem.extractionThreshold;
        if (this.uiMessages.length < threshold) return;

        const snapshot = this.snapshotForMemory();
        if (!snapshot) return;
        queue.enqueue(snapshot).catch((e) => console.warn('[Memory] Enqueue failed:', e));
    }

    /**
     * Public snapshot of the active conversation in the shape ExtractionQueue
     * needs. Returns null when nothing is queueable. Used by the manual paths
     * (Star button, mark_for_memory tool) which always run regardless of the
     * autoExtractSessions toggle and the message-threshold.
     */
    snapshotForMemory(): { conversationId: string; messages: Array<{ role: 'user' | 'assistant'; text: string }>; title: string; queuedAt: string } | null {
        if (!this.activeConversationId || this.uiMessages.length === 0) return null;
        const messages = this.uiMessages.map((m) => ({ role: m.role, text: m.text }));
        const title = this.uiMessages.find((m) => m.role === 'user')?.text.slice(0, 60).replace(/\n/g, ' ').trim()
            || t('ui.sidebar.conversation');
        return {
            conversationId: this.activeConversationId,
            messages,
            title,
            queuedAt: new Date().toISOString(),
        };
    }

    /**
     * Finalize a conversation on end (clear/switch/unload): generate semantic title,
     * stamp frontmatter links, clean up pending paths. (ADR-022)
     * Fire-and-forget caller — errors are caught internally.
     */
    /** Stamp a chat link into the currently active file's frontmatter. */
    private async stampChatLinkToActiveFile(conversationId: string, title: string): Promise<void> {
        const file = this.app.workspace.getActiveFile();
        if (!(file instanceof TFile) || file.extension !== 'md') {
            new Notice(t('ui.history.noActiveNote'));
            return;
        }
        const uri = `obsidian://vault-operator-chat?id=${encodeURIComponent(conversationId)}`;
        const link = `[${title}](${uri})`;
        try {
            await this.app.fileManager.processFrontMatter(file, (fm) => {
                const links: string[] = fm['Chats'] ?? [];
                if (links.some((l: string) => l.includes(conversationId))) {
                    new Notice(t('ui.history.linkAlreadyExists'));
                    return;
                }
                links.push(link);
                fm['Chats'] = links;
            });
            new Notice(t('ui.history.linkAdded'));
        } catch (e) {
            console.warn('[ChatLink] Failed to stamp active file:', e);
            new Notice(t('ui.history.linkAddFailed'));
        }
    }

    /**
     * Finalize a conversation: generate semantic title, stamp frontmatter links.
     * Messages are passed in because this.uiMessages may already be cleared when this runs.
     */
    private async finalizeConversation(
        conversationId: string,
        messages: Array<{ role: string; text: string }>,
    ): Promise<void> {
        const settings = this.plugin.settings;
        const store = this.plugin.conversationStore;
        if (!store) return;

        // 1. Semantic titling (always, if model resolvable)
        // FEAT-24-08 Welle A: resolver falls back to active-provider
        // fast-tier when no explicit key is set, so titling stays alive
        // after the EPIC-26 migration to provider-only config.
        const model = this.plugin.getTitlingModel();

        if (model) {
            const userMsg = messages.find((m) => m.role === 'user')?.text ?? '';
            const assistantMsg = messages.find((m) => m.role === 'assistant')?.text ?? '';

            if (userMsg) {
                try {
                    const api = buildApiHandlerForModel(model);
                    const stream = api.createMessage(
                        'Create a short title (maximum 5-8 words) for this conversation. '
                        + 'The title must capture the essence, not summarize. '
                        + 'Output ONLY the title. No quotes, no prefix, no explanation. '
                        + 'Same language as the user.',
                        [{ role: 'user', content: `User: ${userMsg.slice(0, 300)}\nAssistant: ${assistantMsg.slice(0, 300)}` }],
                        [],
                    );
                    let title = '';
                    for await (const chunk of stream) {
                        if (chunk.type === 'text') title += chunk.text;
                    }
                    title = title.trim().replace(/^["']|["']$/g, '').replace(/\n.*/s, '');
                    if (title.length > 60) title = title.slice(0, 57) + '...';
                    if (title) {
                        console.debug(`[ChatLink] Semantic title: "${title}"`);
                        await store.updateMeta(conversationId, { title });
                    }
                } catch (e) {
                    console.warn('[ChatLink] Semantic title generation failed (non-fatal):', e);
                }
            }
        }

        // 2. Stamp frontmatter links with final title
        if (settings.chatLinking?.enabled) {
            await this.plugin.flushPendingChatLinks(conversationId);
            this.plugin.clearPendingChatLinks(conversationId);
        }

        this.historyPanel?.refresh();
    }

    /** Public entry point for deep-link protocol handler (ADR-022, FEATURE-300). */
    loadConversationById(id: string): Promise<void> {
        return this.loadConversation(id);
    }

    /**
     * Push the next conversation onto the nav stack and truncate forward
     * history -- standard browser semantics. Called from loadConversation
     * for "fresh" navigations (deep-links, history-panel clicks); skipped
     * when the navigation itself comes from the back/forward arrows.
     */
    private pushNav(id: string | null): void {
        // Drop any "forward" entries beyond the current cursor.
        if (this.navIndex < this.navStack.length - 1) {
            this.navStack = this.navStack.slice(0, this.navIndex + 1);
        }
        // Don't stack consecutive duplicates (e.g. re-loading the same chat).
        const top = this.navStack[this.navStack.length - 1];
        if (top !== id) {
            this.navStack.push(id);
            this.navIndex = this.navStack.length - 1;
        }
        // Soft cap at 50 entries so a long session doesn't grow unbounded.
        if (this.navStack.length > 50) {
            const overflow = this.navStack.length - 50;
            this.navStack = this.navStack.slice(overflow);
            this.navIndex = Math.max(0, this.navIndex - overflow);
        }
        this.updateNavButtons();
    }

    private async navBack(): Promise<void> {
        if (this.navIndex <= 0) return;
        this.navIndex -= 1;
        const target = this.navStack[this.navIndex];
        await this.loadConversation(target ?? null, { skipNavPush: true });
    }

    private async navForward(): Promise<void> {
        if (this.navIndex >= this.navStack.length - 1) return;
        this.navIndex += 1;
        const target = this.navStack[this.navIndex];
        await this.loadConversation(target ?? null, { skipNavPush: true });
    }

    private updateNavButtons(): void {
        if (this.navBackBtn) {
            const canBack = this.navIndex > 0;
            this.navBackBtn.disabled = !canBack;
            this.navBackBtn.classList.toggle('agent-u-hidden', this.navStack.length < 2);
        }
        if (this.navForwardBtn) {
            const canForward = this.navIndex < this.navStack.length - 1;
            this.navForwardBtn.disabled = !canForward;
            this.navForwardBtn.classList.toggle('agent-u-hidden', this.navStack.length < 2);
        }
    }

    /** Load a conversation from history and restore it in the chat panel. */
    private async loadConversation(
        id: string | null,
        opts: { skipNavPush?: boolean } = {},
    ): Promise<void> {
        if (id === null) {
            // Back-arrow target was an "empty chat" sentinel -- clear without
            // re-pushing it onto the stack. clearConversation reads navStack
            // state via the same skipNavPush flag.
            this.clearConversation({ skipNavPush: true });
            return;
        }
        if (this.refuseWhileTaskRuns()) return; // FIX-01-01-02
        const store = this.plugin.conversationStore;
        if (!store) return;

        const data = await store.load(id);
        if (!data) {
            new Notice(t('notice.loadConversationFailed'));
            return;
        }
        // DELTA-0707B-L1: re-check after the await -- a task started from
        // the composer while the file was loading would otherwise get its
        // history arrays swapped mid-run (the exact decoupling this guard
        // exists to prevent). The loaded data is simply discarded.
        if (this.refuseWhileTaskRuns()) return;

        // Save current conversation before switching
        this.saveCurrentConversation();
        // Finalize outgoing conversation: semantic title + frontmatter links (ADR-022)
        // Capture messages before switching -- finalizeConversation runs async
        if (this.activeConversationId) {
            const msgs = [...this.uiMessages];
            void this.finalizeConversation(this.activeConversationId, msgs);
        }

        // Reset state
        this.conversationHistory = data.messages;
        this.uiMessages = data.uiMessages;
        this.activeConversationId = id;
        this.lazyConversationId.reset(); // FIX-03-20-01: drop any in-flight create
        this.userDismissedContext = false;
        this.attachments.clear();
        // Conversation switch drops any pending fullDocTexts too (FIX-19-28-05 audit).
        void this.attachments.consumeFullDocTexts();

        // Re-render chat. Collect (uiMessage, DOM) pairs so the checkpoint
        // rehydrate step below can attach live markers per assistant turn.
        const assistantPairs: { msg: UiMessage; el: HTMLElement }[] = [];
        if (this.chatContainer) {
            this.chatContainer.empty();
            for (const msg of data.uiMessages) {
                if (msg.role === 'user') {
                    this.addUserMessage(msg.text);
                } else {
                    const el = this.renderMarkdownMessage(msg.text, 'assistant', msg.toolStepsHtml, msg.reasoningText);
                    if (el) assistantPairs.push({ msg, el });
                }
            }
        }
        this.historyPanel?.setActiveId(id);
        this.updateContextBadge();

        // FIX-01-07-02 / FIX-44-12: rebuild checkpoint markers inline at the
        // assistant message they belong to. Markers never survive into
        // toolStepsHtml (they render as siblings of the steps block), so this
        // step re-renders them from UiMessage.checkpoints (verified live, or
        // expired) with the legacy shadow-repo scan as fallback for older
        // conversations.
        void this.rehydrateCheckpointMarkers(assistantPairs);

        if (!opts.skipNavPush) {
            this.pushNav(id);
        } else {
            this.updateNavButtons();
        }
    }

    /**
     * FEAT-33-12: live probe for the InlineToSidebarTransferService.
     * Returns true while a request is in flight (stream + tool loop).
     * Used by the inline-chat "Send to sidebar" button to decide
     * between save-and-foreground (idle) and the busy fallback modal.
     */
    public get isBusy(): boolean {
        return this.currentAbortController !== null;
    }

    /**
     * FEAT-33-12: take over a conversation that was started in the inline
     * chat. Mirrors the read-side of loadConversation() but takes the
     * state directly instead of pulling it from disk -- the inline panel
     * has the live MessageParam[] + UiMessage[] already in memory.
     *
     * Contract:
     *   - The caller (InlineToSidebarTransferService) is responsible for
     *     gating on isBusy. importConversation does NOT abort an in-flight
     *     turn; calling it mid-stream is undefined.
     *   - The outgoing sidebar conversation (if any) is saved + finalized
     *     just like a History click would do.
     *   - After import the composer is focused so the user can keep typing.
     */
    // eslint-disable-next-line @typescript-eslint/require-await -- public transfer API keeps its Promise signature for callers; the body is synchronous by design
    public async importConversation(state: {
        conversationId: string | null;
        history: MessageParam[];
        uiMessages: UiMessage[];
    }): Promise<boolean> {
        // GUARD-I1: a refusal must be distinguishable from success -- the
        // inline-transfer caller closes its panel on ok.
        if (this.refuseWhileTaskRuns()) return false; // FIX-01-01-02
        // Save current conversation before switching (same as loadConversation).
        this.saveCurrentConversation();
        if (this.activeConversationId) {
            const msgs = [...this.uiMessages];
            void this.finalizeConversation(this.activeConversationId, msgs);
        }

        // Reset state to the transferred conversation.
        this.conversationHistory = [...state.history];
        this.uiMessages = [...state.uiMessages];
        this.activeConversationId = state.conversationId;
        this.lazyConversationId.reset(); // FIX-03-20-01: drop any in-flight create
        this.userDismissedContext = false;
        this.attachments.clear();
        void this.attachments.consumeFullDocTexts();

        // Re-render chat exactly like loadConversation.
        const assistantPairs: { msg: UiMessage; el: HTMLElement }[] = [];
        if (this.chatContainer) {
            this.chatContainer.empty();
            for (const msg of state.uiMessages) {
                if (msg.role === 'user') {
                    this.addUserMessage(msg.text);
                } else {
                    const el = this.renderMarkdownMessage(msg.text, 'assistant', msg.toolStepsHtml, msg.reasoningText);
                    if (el) assistantPairs.push({ msg, el });
                }
            }
        }
        this.historyPanel?.setActiveId(state.conversationId);
        this.updateContextBadge();
        void this.rehydrateCheckpointMarkers(assistantPairs);

        if (state.conversationId !== null) this.pushNav(state.conversationId);
        try { this.textarea?.focus(); } catch { /* noop in test stubs */ }
        return true;
    }

    /**
     * User feedback 2026-06-24: editor-menu + Ctrl+i+i hotkey hand the
     * current editor selection to the sidebar chat instead of opening
     * the inline panel. We prepend a <context>...</context> block (same
     * shape the inline panel uses on its first turn) so the LLM sees a
     * consistent boundary, then place the cursor below the block so the
     * user can type their question immediately.
     *
     * Idempotent: re-invoking with the same (text, notePath) does not
     * double-insert the block, it just refocuses the composer.
     */
    public prepopulateComposerWithContext(args: { text: string; notePath: string }): void {
        const trimmed = args.text.trim();
        if (trimmed.length === 0) return;
        if (this.textarea === null) return;
        const block = `<context>Selected text (from note: ${args.notePath}): ${trimmed}</context>\n\n`;
        const existing = this.textarea.value;
        if (!existing.startsWith(block)) {
            this.textarea.value = block + existing;
            this.autoResizeTextarea();
            this.refreshRunStateButtons();
        }
        const caret = this.textarea.value.length;
        this.textarea.selectionStart = caret;
        this.textarea.selectionEnd = caret;
        try { this.textarea.focus(); } catch { /* noop in test stubs */ }
    }

    /** Delete a conversation from history. */
    private async deleteConversation(id: string): Promise<void> {
        // FIX-01-01-02: deleting the ACTIVE conversation mid-task would
        // reassign the shared history arrays under the running loop.
        if (this.activeConversationId === id && this.refuseWhileTaskRuns()) return;
        const store = this.plugin.conversationStore;
        if (!store) return;
        // Cascade: remove derived memory artefacts (facts, session summary,
        // thread-delta) before the conversation file itself is gone, so the
        // user expectation "delete the chat = delete its memory" holds.
        await this.plugin.deleteMemoryForConversationCascade(id).catch((e) =>
            console.warn('[Memory] cascade delete failed (non-fatal):', e),
        );
        await store.delete(id);
        // If the deleted conversation is the active one, clear the chat
        if (this.activeConversationId === id) {
            // DELTA-0707B-L1: re-check after the awaits above. If a task
            // started meanwhile, keep the in-memory arrays under the running
            // loop; its next save recreates the conversation file.
            if (this.refuseWhileTaskRuns()) return;
            this.activeConversationId = null;
            this.lazyConversationId.reset(); // FIX-03-20-01: fresh chat, fresh memo
            this.uiMessages = [];
            this.conversationHistory = [];
            this.plugin.sessionFlags.clear(); // ADR-048
            if (this.chatContainer) {
                this.chatContainer.empty();
            }
            this.showWelcomeMessage();
        }
        this.historyPanel?.refresh();
    }

    /**
     * Create the streaming message container.
     * Structure: thinkingEl → toolsEl → contentEl → footerEl
     */
    private createStreamingMessageEl(): {
        messageEl: HTMLElement;
        thinkingEl: HTMLElement;
        toolsEl: HTMLElement;
        contentEl: HTMLElement;
        footerEl: HTMLElement;
    } {
        if (!this.chatContainer) throw new Error('Chat container not initialized');
        const messageEl = this.chatContainer.createDiv('message assistant-message message-streaming');
        // Reasoning/thinking section (hidden until thinking chunks arrive)
        const thinkingEl = messageEl.createDiv('thinking-block');
        thinkingEl.classList.add('agent-u-hidden');
        // Tool calls area (populated by onToolStart)
        const toolsEl = messageEl.createDiv('message-tools');
        // Text response (streamed directly for Q&A, rendered on complete for agentic)
        const contentEl = messageEl.createDiv('message-content');
        // v2.10.4: also flag the content element so CSS can suppress the
        // streaming-cursor ::after without using :has(.message-loading)
        // (review-bot warns about :has() invalidation cost).
        contentEl.classList.add('has-loading');
        // Show a loading indicator immediately so the user sees something right away
        const loadingEl = contentEl.createDiv('message-loading');
        setIcon(loadingEl.createSpan('message-loading-icon'), 'loader');
        loadingEl.createSpan('message-loading-text').setText(t('ui.sidebar.working'));
        // Token usage + timestamp footer
        const footerEl = messageEl.createDiv('message-footer');
        footerEl.classList.add('agent-u-hidden');
        this.chatContainer.scrollTo({ top: this.chatContainer.scrollHeight });
        return { messageEl, thinkingEl, toolsEl, contentEl, footerEl };
    }

    /**
     * Feature 5: Map API error to a friendly title
     */
    private getErrorTitle(error: Error): string {
        const msg = error.message.toLowerCase();
        const status = (error as Error & { status?: number; statusCode?: number }).status ?? (error as Error & { statusCode?: number }).statusCode;
        if (status === 401 || msg.includes('api key') || msg.includes('authentication')) {
            return t('ui.error.invalidKey');
        }
        if (status === 404 || msg.includes('not found')) {
            return t('ui.error.modelNotFound');
        }
        if (status === 429 || msg.includes('rate limit')) {
            return t('ui.error.rateLimit');
        }
        if (status === 529 || msg.includes('overload')) {
            return t('ui.error.overloaded');
        }
        if (msg.includes('network') || msg.includes('fetch') || msg.includes('econnrefused')) {
            return t('ui.error.network');
        }
        return t('ui.error.generic');
    }

    /**
     * Feature 2: Render markdown into a new assistant message (for static messages)
     */
    private renderMarkdownMessage(
        markdown: string,
        role: 'assistant' | 'user',
        toolStepsHtml?: string,
        reasoningText?: string,
    ): HTMLElement | null {
        if (!this.chatContainer) return null;
        const msgEl = this.chatContainer.createDiv(`message ${role}-message`);
        // FIX-04-03-07: re-inject captured reasoning text as a collapsed
        // "Reasoning..." bubble (same class names + behavior as the live
        // stream block so the existing CSS applies). Above tool steps and
        // markdown content -- mirrors the order the model produced.
        if (role === 'assistant' && reasoningText && reasoningText.length > 0) {
            const thinkingEl = msgEl.createDiv('thinking-block');
            const header = thinkingEl.createDiv('thinking-header');
            setIcon(header.createSpan('thinking-spinner'), 'chevron-right');
            header.createSpan('thinking-label').setText(t('ui.sidebar.reasoningCollapsed'));
            const body = thinkingEl.createDiv('thinking-content');
            body.classList.add('agent-u-hidden');
            body.setText(reasoningText);
            header.addEventListener('click', () => {
                body.classList.toggle('agent-u-hidden');
            });
        }
        // Re-inject the collapsed agent steps block above the markdown so
        // the user can still expand "what did the agent do?" after a chat
        // reload. Parsed via DOMPurify (AUDIT-034 M-4) so persisted HTML
        // cannot smuggle script / iframe / event handlers / javascript:
        // URLs into the live renderer if the conversation JSON was tampered
        // with on disk.
        if (role === 'assistant' && toolStepsHtml) {
            const toolsEl = msgEl.createDiv('message-tools');
            try {
                const fragment = DOMPurify.sanitize(toolStepsHtml, TOOL_STEPS_SANITIZE_CONFIG);
                // RETURN_DOM_FRAGMENT yields a DocumentFragment whose first
                // element is the sanitized <details> root from stepsBlockEl.
                // Import it into the live document before append so the node
                // is owned by the right document.
                const root = fragment.firstElementChild;
                if (root) {
                    toolsEl.appendChild(activeDocument.importNode(root, true));
                    // Always start collapsed on rehydration so the chat
                    // doesn't visually explode when an old turn is reopened.
                    toolsEl.querySelectorAll('details').forEach((d) => {
                        if (d != null && d.instanceOf(HTMLDetailsElement)) d.open = false;
                    });
                }
            } catch (e) {
                console.warn('[AgentSidebar] Failed to rehydrate tool steps block:', e);
            }
        }
        const contentEl = msgEl.createDiv('message-content');
        void this.renderMarkdownAndWire(markdown, contentEl);
        // Restore action buttons for history messages
        if (role === 'assistant') {
            this.addResponseActions(msgEl, markdown);
        } else {
            this.addUserMessageActions(msgEl, markdown);
        }
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
        return msgEl;
    }

    /**
     * FEAT-24-08 / ADR-114 Steering-Hook: render a mid-run user correction
     * as a distinct bubble. Three lifecycle states tracked via CSS classes:
     *
     *   - `steering-pending`    queued, waiting for next iteration
     *   - `steering-delivered`  picked up by AgentTask at iteration N
     *   - `steering-discarded`  task ended (Stop or completion) before drain
     *
     * Returns the bubble element so the queue can update its state later.
     */
    private addSteeringMessage(text: string): HTMLElement {
        const msgEl = this.chatContainer!.createDiv('message user-message chat-message-steering steering-pending');
        // Marker row above the content: small arrow icon + "Steering" label
        const markerRow = msgEl.createDiv('steering-marker');
        setIcon(markerRow.createSpan('steering-marker-icon'), 'corner-down-right');
        markerRow.createSpan('steering-marker-label').setText(t('ui.sidebar.steeringLabel'));
        // Bubble content
        msgEl.createDiv('message-content').setText(text);
        // Status footer (pending now, will be replaced on delivery / discard)
        const footer = msgEl.createDiv('steering-footer');
        setIcon(footer.createSpan('steering-footer-icon'), 'clock');
        footer.createSpan('steering-footer-text').setText(t('ui.sidebar.steeringQueued'));
        this.chatContainer!.scrollTop = this.chatContainer!.scrollHeight;
        return msgEl;
    }

    /**
     * Flip a steering bubble to "delivered" state once AgentTask has
     * consumed it. Updates icon (clock -> check) and footer label
     * ("queued" -> "delivered at iteration N").
     */
    private markSteeringDelivered(bubbleEl: HTMLElement, iteration: number): void {
        bubbleEl.classList.remove('steering-pending');
        bubbleEl.classList.add('steering-delivered');
        const footer = bubbleEl.querySelector<HTMLElement>('.steering-footer');
        if (!footer) return;
        footer.empty();
        setIcon(footer.createSpan('steering-footer-icon'), 'check');
        footer.createSpan('steering-footer-text').setText(
            t('ui.sidebar.steeringDelivered', { iteration: String(iteration) }),
        );
    }

    /**
     * Flip a steering bubble to "discarded" state when the task ended
     * (Stop or natural completion) before the queue entry was drained.
     * Updates icon (clock -> x) and footer label ("queued" -> "not delivered").
     */
    private markSteeringDiscarded(bubbleEl: HTMLElement): void {
        bubbleEl.classList.remove('steering-pending');
        bubbleEl.classList.add('steering-discarded');
        const footer = bubbleEl.querySelector<HTMLElement>('.steering-footer');
        if (!footer) return;
        footer.empty();
        setIcon(footer.createSpan('steering-footer-icon'), 'x');
        footer.createSpan('steering-footer-text').setText(t('ui.sidebar.steeringDiscarded'));
    }

    private addUserMessage(text: string, attachments: AttachmentItem[] = [], activeFile?: TFile | null): void {
        if (!this.chatContainer) return;
        const msgEl = this.chatContainer.createDiv('message user-message');
        // Render attachment previews above the text bubble
        const hasAttachments = attachments.length > 0 || !!activeFile;
        if (hasAttachments) {
            const previewRow = msgEl.createDiv('message-attachment-previews');
            // "Current" chip for the auto-injected active file
            if (activeFile) {
                const chip = previewRow.createDiv('message-attachment-chip');
                setIcon(chip.createSpan('attachment-chip-icon'), 'file-text');
                chip.createSpan('attachment-chip-name').setText(activeFile.basename);
                chip.createSpan('attachment-current-badge').setText(t('ui.sidebar.currentFile'));
            }
            for (const att of attachments) {
                const chip = previewRow.createDiv('message-attachment-chip');
                if (att.objectUrl) {
                    const img = chip.createEl('img', { cls: 'attachment-chip-thumb' });
                    img.src = att.objectUrl;
                    img.alt = att.name;
                } else if (att.folderMeta) {
                    // FEAT-02-11: folder-manifest chip.
                    const icon = att.folderMeta.recursive ? 'folder-tree' : 'folder';
                    setIcon(chip.createSpan('attachment-chip-icon'), icon);
                    const label = `${att.folderMeta.path || att.name}/ (${att.folderMeta.fileCount})`;
                    chip.createSpan('attachment-chip-name').setText(label);
                } else {
                    setIcon(chip.createSpan('attachment-chip-icon'), 'file-text');
                    chip.createSpan('attachment-chip-name').setText(att.name);
                }
            }
        }
        if (text) {
            msgEl.createDiv('message-content').setText(text);
        }
        // Action bar: copy + edit/resend
        this.addUserMessageActions(msgEl, text);
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    /** Add copy and edit+resend action buttons below a user message bubble. */
    private addUserMessageActions(msgEl: HTMLElement, text: string): void {
        const bar = msgEl.createDiv('user-message-actions');
        const makeBtn = (icon: string, tooltip: string, onClick: () => void) => {
            const btn = bar.createEl('button', { cls: 'message-action-btn', attr: { 'aria-label': tooltip } });
            setIcon(btn, icon);
            btn.title = tooltip;
            btn.addEventListener('click', onClick);
        };

        // Copy message text
        makeBtn('copy', t('ui.sidebar.copy'), () => {
            void navigator.clipboard.writeText(text);
            new Notice(t('notice.copied'));
        });

        // Edit and resend: put text back in textarea, remove this message + all following
        makeBtn('pencil', t('ui.sidebar.editResend'), () => {
            if (!this.textarea || !this.chatContainer) return;
            this.textarea.value = text;
            this.autoResizeTextarea();
            this.textarea.focus();
            // Remove this message and everything after it
            const allMessages = Array.from(this.chatContainer.querySelectorAll('.message'));
            const idx = allMessages.indexOf(msgEl);
            if (idx >= 0) {
                for (let i = allMessages.length - 1; i >= idx; i--) {
                    allMessages[i].remove();
                }
            }
            // Also trim uiMessages and conversationHistory to match
            const userMsgIndices: number[] = [];
            this.uiMessages.forEach((m, i) => { if (m.role === 'user') userMsgIndices.push(i); });
            // Count which user message this is in the DOM
            const userBubblesBefore = allMessages.slice(0, idx).filter(el => el.classList.contains('user-message')).length;
            const uiIdx = userMsgIndices[userBubblesBefore];
            if (uiIdx !== undefined) {
                this.uiMessages.splice(uiIdx);
            }
            if (this.conversationHistory.length > 0) {
                let userCount = 0;
                for (let i = 0; i < this.conversationHistory.length; i++) {
                    if (this.conversationHistory[i].role === 'user') {
                        if (userCount === userBubblesBefore) {
                            this.conversationHistory.splice(i);
                            break;
                        }
                        userCount++;
                    }
                }
            }
        });
    }

    private addAssistantMessage(markdown: string): void {
        this.renderMarkdownMessage(markdown, 'assistant');
    }

    private switchMode(modeSlug: string): void {
        void this.modeService.switchMode(modeSlug); // saves settings
        this.updateModelButton(); // model may differ per agent
    }



    // ── Ellipsis options menu ─────────────────────────────────────────────────

    /** Add options menu items to an existing menu (used by both ellipsis and standalone). */
    private addOptionsMenuItems(menu: Menu): void {
        const settings = this.plugin.settings;

        // Refresh Index (current file)
        menu.addItem((item) => {
            item.setTitle(t('ui.menu.refreshIndex'));
            item.setIcon('refresh-cw');
            item.onClick(async () => {
                const activeFile = this.app.workspace.getActiveFile();
                if (!activeFile) { new Notice(t('notice.noActiveFile')); return; }
                if (!this.plugin.semanticIndex) { new Notice(t('notice.semanticDisabled')); return; }
                await this.plugin.semanticIndex.updateFile(activeFile.path);
                new Notice(t('notice.indexRefreshed'));
            });
        });

        // Force Reindex Vault
        menu.addItem((item) => {
            item.setTitle(t('ui.menu.forceReindex'));
            item.setIcon('database');
            item.onClick(() => {
                if (!this.plugin.semanticIndex) { new Notice(t('notice.semanticDisabled')); return; }
                if (this.plugin.semanticIndex.building) { new Notice(t('notice.indexingInProgress')); return; }
                new Notice(t('notice.reindexingVault'));
                this.plugin.semanticIndex.buildIndex(undefined, true).then(() =>
                    new Notice(t('notice.vaultIndexRebuilt'))
                ).catch((e: Error) => new Notice(t('notice.reindexFailed', { error: e.message })));
            });
        });

        // Vault Health Check
        menu.addItem((item) => {
            item.setTitle(t('modal.vaultHealth.title'));
            item.setIcon('stethoscope');
            item.onClick(async () => {
                if (!this.plugin.vaultHealthService) {
                    new Notice(t('notice.vaultHealth.serviceUnavailable'));
                    return;
                }
                new Notice(t('notice.vaultHealth.checkRunning'));
                await this.plugin.vaultHealthService.runChecks(undefined, {
                    backlinksProperty: this.plugin.settings.backlinksProperty ?? OKF_DEFAULTS.backlinksProperty,
                    silenceWithContextOrphans: this.plugin.settings.vaultHealth?.silenceWithContextOrphans ?? true,
                    orphanExcludePathPrefixes: this.plugin.settings.vaultHealth?.orphanExcludePathPrefixes ?? [],
                    reciprocalProperties: this.plugin.settings.vaultHealth?.reciprocalProperties ?? [['Notizen', 'Quellen']],
                });
                const findings = this.plugin.vaultHealthService.getFindings();
                if (findings.length === 0) {
                    new Notice(t('notice.vaultHealth.noIssues'));
                    return;
                }
                this.openHealthModal();
            });
        });

        // Cancel Indexing (only shown while building)
        if (this.plugin.semanticIndex?.building) {
            menu.addItem((item) => {
                item.setTitle(t('ui.menu.cancelIndexing'));
                item.setIcon('x-circle');
                item.onClick(() => {
                    this.plugin.semanticIndex?.cancelBuild();
                    new Notice(t('notice.indexingCancelled'));
                });
            });
        }

        menu.addSeparator();

        // Add Open Note in Context (toggle)
        menu.addItem((item) => {
            const enabled = settings.autoAddActiveFileContext;
            item.setTitle(t('ui.menu.addOpenNote'));
            item.setIcon(enabled ? 'check' : 'file-text');
            item.setChecked(enabled);
            item.onClick(async () => {
                settings.autoAddActiveFileContext = !enabled;
                await this.plugin.saveSettings();
                this.updateContextBadge();
            });
        });

        // Auto-accept Edits (toggle)
        menu.addItem((item) => {
            // FIX-44-03c: the check must reflect what the gate actually does.
            // note/vault edits only auto-approve when the MASTER is on too, so a
            // check that ignored the master showed "on" while every edit still
            // prompted. Derive the state from the master as well.
            const cfg = settings.autoApproval;
            const enabled = cfg.enabled && cfg.noteEdits && cfg.vaultChanges;
            item.setTitle(t('ui.menu.autoAcceptEdits'));
            item.setIcon(enabled ? 'check' : 'pencil');
            item.setChecked(enabled);
            item.onClick(async () => {
                const flags = cfg as unknown as Record<string, unknown>;
                if (!enabled) {
                    // Turning on: flip the master (clearing dormant flags,
                    // FIX-44-03b) and grant both edit categories.
                    grantAutoApproval(flags, 'noteEdits');
                    flags.vaultChanges = true;
                } else {
                    // Turning off: drop just these two; leave the master and any
                    // other grants as they are.
                    flags.noteEdits = false;
                    flags.vaultChanges = false;
                }
                await this.plugin.saveSettings();
                new Notice(t('notice.autoAcceptEdits', { value: !enabled ? 'on' : 'off' }));
            });
        });

    }

    /** Show the options menu (standalone, for backward compat). */
    private showOptionsMenu(e: MouseEvent): void {
        const menu = new Menu();
        this.addOptionsMenuItems(menu);
        menu.showAtMouseEvent(e);
    }


    // -------------------------------------------------------------------------
    // Tool display helpers (Kilo Code style)
    // -------------------------------------------------------------------------

    private getToolIcon(toolName: string): string {
        return TOOL_METADATA[toolName]?.icon ?? 'terminal';
    }

    private formatToolLabel(toolName: string): string {
        return TOOL_METADATA[toolName]?.label ?? toolName;
    }

    private getToolBriefParam(input: Record<string, unknown>): string {
        return (input?.path ?? input?.url ?? input?.query ?? input?.question ?? '') as string;
    }

    /**
     * Label for grouped tool calls — shows singular or plural form with count.
     * Used when consecutive same-type groupable tool calls are collapsed into one row.
     */
    private formatGroupedLabel(name: string, count: number): string {
        const labels: Record<string, [string, string]> = {
            read_file:        [t('ui.toolActivity.readFile'),       t('ui.toolActivity.readFiles')],
            list_files:       [t('ui.toolActivity.listFiles'),      t('ui.toolActivity.listFiles')],
            search_files:     [t('ui.toolActivity.searching'),      t('ui.toolActivity.searching')],
            get_frontmatter:  [t('ui.toolActivity.readingMetadata'),t('ui.toolActivity.readingMetadata')],
            get_linked_notes: [t('ui.toolActivity.findingLinks'),   t('ui.toolActivity.findingLinks')],
            search_by_tag:    [t('ui.toolActivity.searchingByTag'), t('ui.toolActivity.searchingByTag')],
            get_vault_stats:  [t('ui.toolActivity.vaultOverview'),  t('ui.toolActivity.vaultOverview')],
            get_daily_note:   [t('ui.toolActivity.readingDailyNote'),t('ui.toolActivity.readingDailyNotes')],
            web_fetch:        [t('ui.toolActivity.fetchingPage'),   t('ui.toolActivity.fetchingPages')],
            web_search:       [t('ui.toolActivity.searchingWeb'),   t('ui.toolActivity.searchingWeb')],
            semantic_search:  [t('ui.toolActivity.semanticSearch'), t('ui.toolActivity.semanticSearches')],
        };
        const [singular, plural] = labels[name] ?? [name, name];
        return count === 1 ? singular : `${plural} (${count})`;
    }

    // -------------------------------------------------------------------------
    // Response action bar + link wiring
    // -------------------------------------------------------------------------

    /**
     * Render markdown into `containerEl` and wire any internal/wikilink
     * anchors so they navigate via `openLinkText`. Awaits the render so
     * the link wiring runs after Obsidian has actually inserted the
     * anchors -- a sync `void MarkdownRenderer.render(...)` followed by
     * `wireInternalLinks` races against post-processors and leaves
     * freshly created anchors unwired (the bug behind unclickable
     * [[wikilinks]] in chat responses, tool output and history reloads).
     *
     * Uses the active file as `sourcePath` so wikilink resolution has a
     * context to fall back on -- matches the inline chat bridge in
     * `PluginWiring.ts`.
     */
    /** DOM-D1: newest render generation per container; stale passes skip link wiring. */
    private renderGenerations = new WeakMap<HTMLElement, number>();

    private async renderMarkdownAndWire(markdown: string, containerEl: HTMLElement): Promise<void> {
        // AUDIT 2026-07-07 DOM-D1: overlapping passes into the same container
        // (throttled Q&A streaming render vs. the next tick or onComplete's
        // authoritative render) stacked duplicate click handlers -- the stale
        // pass resolved after a newer pass had emptied and re-rendered the
        // container, then wired the newer pass's anchors a second time. Only
        // the newest pass per container may wire links.
        const gen = (this.renderGenerations.get(containerEl) ?? 0) + 1;
        this.renderGenerations.set(containerEl, gen);
        const sourcePath = this.app.workspace.getActiveFile()?.path ?? '';
        await MarkdownRenderer.render(this.app, markdown, containerEl, sourcePath, this);
        if (this.renderGenerations.get(containerEl) !== gen) return;
        this.wireInternalLinks(containerEl);
    }

    /**
     * Make internal [[wikilinks]] and note links in the rendered markdown clickable.
     * MarkdownRenderer handles most links, but we intercept to ensure sidebar context.
     *
     * Special-case obsidian://obsilo-chat?id=X URLs (used by recall_memory and
     * search_history outputs): route through the plugin's deep-link handler
     * directly. Without this they'd fall through to openLinkText() and the
     * ":" in the protocol scheme triggers a createFolder error.
     */
    private wireInternalLinks(contentEl: HTMLElement): void {
        contentEl.querySelectorAll('a').forEach((anchor) => {
            const href = anchor.getAttribute('href') ?? '';
            if (href.startsWith('obsidian://vault-operator-chat') || href.startsWith('obsidian://obsilo-chat')) {
                anchor.addEventListener('click', (e) => {
                    e.preventDefault();
                    const match = /[?&]id=([^&]+)/.exec(href);
                    if (match) {
                        const id = decodeURIComponent(match[1]);
                        void this.plugin.openChatById(id);
                    }
                });
                return;
            }
            // Internal links: [[Note]] renders as data-href or href without http
            if (!href.startsWith('http') && !href.startsWith('mailto')) {
                anchor.addEventListener('click', (e) => {
                    e.preventDefault();
                    const linkText = anchor.getAttribute('data-href') ?? href;
                    void this.app.workspace.openLinkText(linkText, '', false);
                });
            }
        });
    }

    // -------------------------------------------------------------------------
    // Perplexity-style inline citations
    // -------------------------------------------------------------------------

    /**
     * Parse and extract [sources]...[/sources] block from the model's response.
     * Returns cleaned text (without the block) and an array of parsed sources.
     */
    private parseSources(text: string): { cleanText: string; sources: { num: number; note: string; context: string }[] } {
        const match = text.match(/\[sources\]\s*\n?([\s\S]*?)\[\/sources\]/);
        if (!match) return { cleanText: text, sources: [] };

        const cleanText = text.replace(/\[sources\]\s*\n?[\s\S]*?\[\/sources\]/, '').trimEnd();
        const sources: { num: number; note: string; context: string }[] = [];

        for (const line of match[1].split('\n')) {
            const lineMatch = line.trim().match(/^(\d+)\.\s+(.+?)(?:\s+[—-]+\s+(.+))?$/);
            if (lineMatch) {
                sources.push({
                    num: parseInt(lineMatch[1]),
                    note: lineMatch[2].trim(),
                    context: lineMatch[3]?.trim() ?? '',
                });
            }
        }

        return { cleanText, sources };
    }

    /**
     * Parse and extract [followups]...[/followups] block from the model's response.
     * Returns cleaned text and an array of follow-up action strings.
     */
    private parseFollowups(text: string): { cleanText: string; heading: string; followups: string[] } {
        const match = text.match(/\[followups(?:\s+heading="([^"]*)")?\]\s*\n?([\s\S]*?)\[\/followups\]/);
        if (!match) return { cleanText: text, heading: '', followups: [] };

        const cleanText = text.replace(/\[followups(?:\s+heading="[^"]*")?\]\s*\n?[\s\S]*?\[\/followups\]/, '').trimEnd();
        const heading = match[1] || '';
        const followups = match[2].split('\n')
            .map(line => line.replace(/^[-*]\s*/, '').trim())
            .filter(line => line.length > 0);

        return { cleanText, heading, followups };
    }

    /**
     * Convert inline [N] references in rendered HTML to clickable citation badges.
     * Only converts numbers that match a parsed source.
     */
    private wireCitationBadges(contentEl: HTMLElement, sources: { num: number; note: string; context: string }[]): void {
        if (sources.length === 0) return;

        const sourceNums = new Set(sources.map(s => s.num));
        const walker = activeDocument.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT);
        const replacements: { node: Text; text: string }[] = [];

        while (walker.nextNode()) {
            const textNode = walker.currentNode as Text;
            // Skip text inside code blocks
            if (textNode.parentElement?.closest('code, pre')) continue;
            const text = textNode.textContent ?? '';
            if (/\[\d+\]/.test(text)) {
                replacements.push({ node: textNode, text });
            }
        }

        for (const { node, text } of replacements) {
            const fragment = activeDocument.createDocumentFragment();
            let lastIndex = 0;
            let replaced = false;

            for (const m of text.matchAll(/\[(\d+)\]/g)) {
                const num = parseInt(m[1]);
                if (!sourceNums.has(num)) continue;
                const matchIndex = m.index ?? 0;

                const source = sources.find(s => s.num === num);
                if (!source) continue;

                // Text before this match
                if (matchIndex > lastIndex) {
                    fragment.appendChild(activeDocument.createTextNode(text.slice(lastIndex, matchIndex)));
                }

                // Citation badge
                const badge = activeDocument.createElement('span');
                badge.className = 'source-badge';
                badge.textContent = String(num);
                badge.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.showSourcePopup(badge, source);
                });
                fragment.appendChild(badge);

                lastIndex = matchIndex + m[0].length;
                replaced = true;
            }

            if (replaced) {
                // Remaining text after last match
                if (lastIndex < text.length) {
                    fragment.appendChild(activeDocument.createTextNode(text.slice(lastIndex)));
                }
                node.parentNode?.replaceChild(fragment, node);
            }
        }
    }

    /**
     * Clamp a fixed-position popup to the visible viewport.
     * Call after appending to activeDocument.body so dimensions are known.
     */
    private clampPopupToViewport(popup: HTMLElement): void {
        window.requestAnimationFrame(() => {
            const r = popup.getBoundingClientRect();
            const pad = 8;
            if (r.right > window.innerWidth) {
                popup.setCssProps({ '--popup-left': `${window.innerWidth - r.width - pad}px` });
            }
            if (r.left < 0) {
                popup.setCssProps({ '--popup-left': `${pad}px` });
            }
            if (r.bottom > window.innerHeight) {
                popup.setCssProps({ '--popup-top': `${window.innerHeight - r.height - pad}px`, '--popup-bottom': '' });
            }
            if (r.top < 0) {
                popup.setCssProps({ '--popup-top': `${pad}px`, '--popup-bottom': '' });
            }
        });
    }

    /**
     * Attach a click-outside close handler to a popup.
     */
    private attachPopupCloseHandler(popup: HTMLElement, anchor: HTMLElement): void {
        const close = (e: MouseEvent) => {
            if (!popup.contains(e.target as Node) && e.target !== anchor) {
                popup.remove();
                activeDocument.removeEventListener('click', close);
            }
        };
        window.setTimeout(() => activeDocument.addEventListener('click', close), 10);
    }

    /**
     * Show a popup card for a single source (badge click).
     */
    private showSourcePopup(anchor: HTMLElement, source: { num: number; note: string; context: string }): void {
        activeDocument.querySelectorAll('.source-popup').forEach(el => el.remove());

        const popup = activeDocument.createElement('div');
        popup.className = 'source-popup';

        const titleEl = activeDocument.createElement('div');
        titleEl.className = 'source-popup-title';
        const noteName = source.note.replace(/^\[\[|\]\]$/g, '');
        titleEl.textContent = noteName;
        titleEl.addEventListener('click', () => {
            void this.app.workspace.openLinkText(noteName, '', false);
            popup.remove();
        });
        popup.appendChild(titleEl);

        if (source.context) {
            const ctxEl = activeDocument.createElement('div');
            ctxEl.className = 'source-popup-context';
            ctxEl.textContent = source.context;
            popup.appendChild(ctxEl);
        }

        const rect = anchor.getBoundingClientRect();
        popup.setCssProps({ '--popup-top': `${rect.bottom + 4}px`, '--popup-left': `${Math.max(4, rect.left - 40)}px` });

        activeDocument.body.appendChild(popup);
        this.clampPopupToViewport(popup);
        this.attachPopupCloseHandler(popup, anchor);
    }

    /**
     * Show a panel listing all sources (sources indicator click).
     */
    private showSourcesPanel(anchor: HTMLElement, sources: { num: number; note: string; context: string }[]): void {
        activeDocument.querySelectorAll('.source-popup').forEach(el => el.remove());

        const popup = activeDocument.createElement('div');
        popup.className = 'source-popup sources-panel';

        for (const source of sources) {
            const row = activeDocument.createElement('div');
            row.className = 'source-panel-row';

            const numEl = activeDocument.createElement('span');
            numEl.className = 'source-badge';
            numEl.textContent = String(source.num);
            row.appendChild(numEl);

            const titleEl = activeDocument.createElement('span');
            titleEl.className = 'source-panel-title';
            const noteName = source.note.replace(/^\[\[|\]\]$/g, '');
            titleEl.textContent = noteName;
            titleEl.addEventListener('click', () => {
                void this.app.workspace.openLinkText(noteName, '', false);
                popup.remove();
            });
            row.appendChild(titleEl);

            if (source.context) {
                const ctxEl = activeDocument.createElement('div');
                ctxEl.className = 'source-panel-context';
                ctxEl.textContent = source.context;
                row.appendChild(ctxEl);
            }

            popup.appendChild(row);
        }

        const rect = anchor.getBoundingClientRect();
        popup.setCssProps({ '--popup-bottom': `${window.innerHeight - rect.top + 4}px`, '--popup-left': `${rect.left}px` });

        activeDocument.body.appendChild(popup);
        this.clampPopupToViewport(popup);
        this.attachPopupCloseHandler(popup, anchor);
    }

    /**
     * Add the response action icon bar below a completed assistant message.
     */
    private addResponseActions(messageEl: HTMLElement, responseText: string, sources?: { num: number; note: string; context: string }[]): void {
        const bar = messageEl.createDiv('message-actions');

        // Sources indicator (left-aligned, before action buttons)
        if (sources && sources.length > 0) {
            const indicator = bar.createEl('span', { cls: 'sources-indicator' });
            const iconEl = indicator.createSpan('sources-indicator-icon');
            setIcon(iconEl, 'book-open');
            indicator.createSpan({ text: t('ui.sidebar.sources', { count: sources.length }) });
            indicator.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showSourcesPanel(indicator, sources);
            });
        }

        const makeBtn = (icon: string, tooltip: string, onClick: () => void) => {
            const btn = bar.createEl('button', { cls: 'message-action-btn', attr: { 'aria-label': tooltip } });
            setIcon(btn, icon);
            btn.title = tooltip;
            btn.addEventListener('click', onClick);
        };

        // Insert at cursor in active note
        // iterateAllLeaves with instanceof is the most reliable way to find a markdown editor
        // because getActiveViewOfType returns null when the sidebar has focus
        makeBtn('text-cursor-input', t('ui.sidebar.insertAtCursor'), () => {
            let view: MarkdownView | null =
                this.app.workspace.getActiveViewOfType(MarkdownView) ?? this.lastMarkdownView;
            if (!view) {
                this.app.workspace.iterateAllLeaves((leaf) => {
                    if (!view && leaf.view instanceof MarkdownView) {
                        view = leaf.view;
                    }
                });
            }
            if (view?.editor) {
                view.editor.replaceSelection(responseText);
                new Notice(t('notice.insertedAtCursor'));
            } else {
                new Notice(t('notice.noOpenNote'));
            }
        });

        // Create new note from response — open in a new leaf (not in sidebar)
        makeBtn('file-plus', t('ui.sidebar.createNote'), () => {
            void (async () => {
                const now = new Date();
                // Colons are forbidden in filenames on macOS/Windows — use dashes for HH-MM
                const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
                const fileName = `Agent response ${ts}.md`;
                try {
                    const file = await this.app.vault.create(fileName, responseText);
                    // getLeaf(true) always creates a new leaf in the main content area
                    const leaf = this.app.workspace.getLeaf(true);
                    await leaf.openFile(file);
                } catch (e) {
                    new Notice(t('notice.createNoteFailed', { error: (e as Error).message }));
                }
            })();
        });

        // Synthesis note: Agent summarizes the chat and creates a connected note
        if (this.plugin.settings.enableSynthesisButton !== false) {
            makeBtn('notebook-pen', t('ui.sidebar.synthesisZettel'), () => {
                this.sendProgrammaticMessage(
                    'Erstelle eine Synthese-Note aus diesem Chat. ' +
                    'Fasse die wichtigsten Erkenntnisse, Entscheidungen und Ergebnisse zusammen. ' +
                    'Erstelle die Note mit vollstaendigem Frontmatter (Zusammenfassung, Themen, Konzepte, Tags, Kategorie: Zettel) ' +
                    'und vernetze sie mit bestehenden Notes im Vault. ' +
                    'Speichere die Note in Inbox/. Oeffne die Note nach dem Erstellen.',
                    true, // hidden: user bubble not shown
                );
            });
        }

        // Copy to clipboard
        makeBtn('copy', t('ui.sidebar.copyResponse'), () => {
            void navigator.clipboard.writeText(responseText).then(() => {
                new Notice(t('notice.copiedToClipboard'));
            });
        });

        // Regenerate
        makeBtn('refresh-cw', t('ui.sidebar.regenerate'), () => {
            // Remove this message and re-run
            messageEl.remove();
            // Remove last two history entries (assistant + tool_results if any)
            // and re-send the last user message
            if (this.lastUserMessage) {
                if (this.textarea) this.textarea.value = this.lastUserMessage;
                void this.handleSendMessage();
            }
        });

        // Delete message
        makeBtn('trash-2', t('ui.sidebar.deleteResponse'), () => {
            messageEl.remove();
        });
    }

    // -------------------------------------------------------------------------
    // Completion, Question, Approval cards
    // -------------------------------------------------------------------------

    /**
     * Render (or update) the Plan box for a streaming message.
     *
     * First call: creates the plan box BEFORE toolsEl in the message, then
     * DOM-moves toolsEl (with any already-rendered tool calls) into a collapsed
     * <details> inside the plan box — making tool calls hidden by default.
     *
     * Subsequent calls: updates the todo items list and badge in place.
     */
    private renderTodoBox(
        toolsEl: HTMLElement,
        items: import('../core/tools/agent/UpdateTodoListTool').TodoItem[],
    ): void {
        const messageEl = toolsEl.closest<HTMLElement>('.assistant-message');
        if (!messageEl) return;

        let planBoxEl = messageEl.querySelector<HTMLElement>(':scope > .agent-todo-box');
        let planListEl: HTMLElement;

        if (!planBoxEl) {
            // First call — build the plan box and move toolsEl into it
            planBoxEl = activeDocument.createElement('div');
            planBoxEl.className = 'agent-todo-box';
            // Insert before toolsEl (direct child of messageEl on first call)
            messageEl.insertBefore(planBoxEl, toolsEl);

            const header = planBoxEl.createDiv('todo-box-header');
            setIcon(header.createSpan('todo-box-icon'), 'list-checks');
            header.createSpan('todo-box-title').setText(t('ui.sidebar.plan'));
            header.createSpan('todo-activity-badge');

            planListEl = planBoxEl.createDiv('todo-box-list');

            const activityDetails = planBoxEl.createEl('details', { cls: 'todo-activity-log' });
            activityDetails.createEl('summary', { cls: 'todo-activity-summary', text: t('ui.sidebar.activity') });
            // DOM-move: relocate toolsEl (with any already-rendered tool calls) into collapsed details
            activityDetails.appendChild(toolsEl);
        } else {
            planListEl = planBoxEl.querySelector<HTMLElement>('.todo-box-list')!;
            planBoxEl.querySelector<HTMLElement>('.todo-activity-badge');
        }

        // Update the todo items list
        planListEl.empty();
        for (const item of items) {
            const row = planListEl.createDiv('todo-item');
            const icon = row.createSpan('todo-item-icon');
            if (item.status === 'done') {
                setIcon(icon, 'check-circle-2');
                row.addClass('todo-done');
            } else if (item.status === 'in_progress') {
                setIcon(icon, 'loader-2');
                row.addClass('todo-in-progress');
            } else {
                setIcon(icon, 'circle');
                row.addClass('todo-pending');
            }
            row.createSpan('todo-item-text').setText(item.text);
        }

        this.chatContainer?.scrollTo({ top: this.chatContainer.scrollHeight });
    }

    private showQuestionCard(
        question: string,
        options: string[] | undefined,
        resolve: (answer: string) => void,
        allowMultiple = false,
    ): void {
        if (!this.chatContainer) { resolve(''); return; }

        const card = this.chatContainer.createDiv('followup-list');
        card.createDiv('followup-heading').setText(question);
        const cleanup = () => card.remove();

        if (options && options.length > 0) {
            if (allowMultiple) {
                // Multi-select mode: checkboxes + confirm button
                const selected = new Set<string>();
                const optionEls: HTMLElement[] = [];
                options.forEach((opt) => {
                    const item = card.createEl('button', { cls: 'followup-item followup-item-multi', text: opt });
                    optionEls.push(item);
                    item.addEventListener('click', () => {
                        if (selected.has(opt)) {
                            selected.delete(opt);
                            item.removeClass('followup-item-selected');
                        } else {
                            selected.add(opt);
                            item.addClass('followup-item-selected');
                        }
                    });
                });
                const confirmBtn = card.createEl('button', {
                    cls: 'followup-confirm-btn',
                    text: t('ui.question.confirm'),
                });
                confirmBtn.addEventListener('click', () => {
                    if (selected.size === 0) return;
                    cleanup();
                    resolve([...selected].join(', '));
                });
            } else {
                // Single-select mode: click to answer
                options.forEach((opt) => {
                    const item = card.createEl('button', { cls: 'followup-item', text: opt });
                    item.addEventListener('click', () => { cleanup(); resolve(opt); });
                });
            }
        }

        const inputRow = card.createDiv('question-input-row');
        const input = inputRow.createEl('input', {
            cls: 'question-input',
            attr: { type: 'text', placeholder: t('ui.question.placeholder') },
        });
        const submitBtn = inputRow.createEl('button', { cls: 'question-submit-btn', text: t('ui.question.answer') });
        const submit = () => {
            const val = input.value.trim();
            if (!val) return;
            cleanup();
            resolve(val);
        };
        submitBtn.addEventListener('click', submit);
        input.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter') submit(); });
        this.chatContainer.scrollTo({ top: this.chatContainer.scrollHeight });
    }

    /**
     * Build a human-readable explanation for a tool call.
     * Returns { text, target? } where text is the explanation sentence
     * and target is the highlighted value (path, URL, query etc.).
     */
    private buildHumanReadableExplanation(
        toolName: string,
        input: Record<string, unknown>,
    ): { text: string; target?: string } {
        const str = (key: string): string => { const v = input[key]; return typeof v === 'string' ? v : ''; };

        switch (toolName) {
            case 'write_file':
                return { text: t('ui.approval.explain.writeFile'), target: str('path') };
            case 'edit_file':
                return { text: t('ui.approval.explain.editFile'), target: str('path') };
            case 'append_to_file':
                return { text: t('ui.approval.explain.appendFile'), target: str('path') };
            case 'update_frontmatter':
                return { text: t('ui.approval.explain.frontmatter'), target: str('path') };
            case 'delete_file':
                return { text: t('ui.approval.explain.deleteFile'), target: str('path') };
            case 'move_file': {
                const from = str('source');
                const to = str('destination');
                return { text: t('ui.approval.explain.moveFile'), target: to ? `${from} ${t('ui.approval.explain.moveFileTo')} ${to}` : from };
            }
            case 'create_folder':
                return { text: t('ui.approval.explain.createFolder'), target: str('path') };
            case 'generate_canvas':
                return { text: t('ui.approval.explain.canvas'), target: str('output_path') };
            case 'create_excalidraw':
                return { text: t('ui.approval.explain.excalidraw'), target: str('output_path') };
            case 'evaluate_expression':
                return { text: t('ui.approval.explain.sandbox') };
            case 'web_fetch':
                return { text: t('ui.approval.explain.webFetch'), target: str('url') };
            case 'web_search':
                return { text: t('ui.approval.explain.webSearch'), target: str('query') };
            case 'new_task':
                return { text: t('ui.approval.explain.newTask') };
            case 'use_mcp_tool': {
                const server = str('server_name');
                const tool = str('tool_name');
                return { text: t('ui.approval.explain.mcpTool'), target: tool ? `${tool} (${server})` : server };
            }
            case 'call_plugin_api':
                return { text: t('ui.approval.explain.pluginApi'), target: str('plugin_id') };
            case 'execute_command':
                return { text: t('ui.approval.explain.command'), target: str('command_id') };
            case 'execute_recipe':
                return { text: t('ui.approval.explain.recipe'), target: str('recipe_id') };
            case 'switch_agent':
                return { text: t('ui.approval.explain.switchMode') };
            case 'manage_source':
                return { text: t('ui.approval.explain.selfModify') };
            default:
                return { text: t('ui.approval.explain.fallback'), target: this.formatToolLabel(toolName) };
        }
    }

    /**
     * Truncate a string to maxLen characters, appending "..." if truncated.
     */
    private truncateForApproval(value: string, maxLen: number): string {
        if (value.length <= maxLen) return value;
        return value.slice(0, maxLen) + '...';
    }

    /**
     * Selector-carrying Frontmatter Operator API methods. Bulk-write ops
     * that accept a NoteSelector under `select` can be previewed via the
     * auto-approvable read method `getMatchingPaths`. Methods without a
     * selector (undoLast, restoreSnapshot, cleanupRefusalTags with vault-
     * wide default, dedupeWikilinks) render no preview.
     */
    private readonly FO_SELECTOR_METHODS = new Set([
        'setProperty',
        'deleteProperties',
        'renameProperty',
        'renameValues',
        'copyProperty',
        'mergeProperties',
    ]);

    /**
     * Render an "Affects N note(s)" preview line in the approval card for
     * Frontmatter Operator selector-based bulk writes. Returns a Promise
     * that resolves once the preview has settled (success or failure) so
     * the caller can gate the Allow-button on it (AUDIT-FEAT-14-07 L-5).
     * Returns `null` when no preview is applicable to the current tool
     * call -- the caller keeps normal button behaviour in that case.
     *
     * Reads only (getMatchingPaths is Tier-1 auto-approvable), so the
     * preview itself does not trigger another approval prompt.
     */
    private maybeRenderFrontmatterOperatorPreview(
        toolName: string,
        input: Record<string, unknown>,
        row: HTMLElement,
    ): Promise<void> | null {
        if (toolName !== 'call_plugin_api') return null;
        if (input['plugin_id'] !== 'frontmatter-operator') return null;
        const method = typeof input['method'] === 'string' ? input['method'] : '';
        if (!this.FO_SELECTOR_METHODS.has(method)) return null;

        // args on call_plugin_api is an ordered array; FO opts sit in args[0].
        const args = Array.isArray(input['args']) ? input['args'] : [];
        const opts = (args[0] ?? {}) as Record<string, unknown>;
        const selector = opts['select'];
        if (!selector || typeof selector !== 'object') return null;

        const plugins = (this.app as unknown as {
            plugins?: { plugins?: Record<string, { api?: Record<string, unknown> }> };
        }).plugins;
        const foInstance = plugins?.plugins?.['frontmatter-operator'];
        const getMatchingPaths = foInstance?.api?.['getMatchingPaths'];
        if (typeof getMatchingPaths !== 'function') return null;

        // Insert placeholder immediately so it appears above the details toggle.
        const previewEl = row.createDiv('tool-approval-fo-preview');
        previewEl.setText(t('ui.sidebar.resolvingAffectedNotes'));

        // Async resolution. Failures silently remove the placeholder.
        // AUDIT-FEAT-14-07 L-2: guard every DOM mutation with an isConnected
        // check. When the user resolves the approval before getMatchingPaths
        // returns, `row` has already been removed and previewEl is detached.
        // Continuing to mutate a detached node wastes CPU and keeps a stale
        // reference on `row`.
        return (async () => {
            try {
                const result = await (getMatchingPaths as (s: unknown) => Promise<unknown>)(selector);
                if (!previewEl.isConnected) return;
                if (!result || typeof result !== 'object') {
                    previewEl.remove();
                    return;
                }
                const typed = result as { count?: unknown; paths?: unknown };
                const count = typeof typed.count === 'number' ? typed.count : NaN;
                const paths = Array.isArray(typed.paths) ? typed.paths.filter((p): p is string => typeof p === 'string') : [];
                if (Number.isNaN(count)) {
                    previewEl.remove();
                    return;
                }
                previewEl.empty();
                const label = count === 1 ? 'Affects 1 note.' : `Affects ${count} notes.`;
                previewEl.createSpan({ text: label });
                if (paths.length > 0) {
                    const sample = paths.slice(0, 5).join(', ');
                    const suffix = paths.length > 5 ? `, ... (+${count - 5} more)` : '';
                    previewEl.createSpan('tool-approval-fo-preview-sample').setText(` ${sample}${suffix}`);
                }
            } catch {
                if (previewEl.isConnected) previewEl.remove();
            }
        })();
    }

    /**
     * Format the raw tool input as a readable string for the details section.
     */
    private formatInputForDetails(input: Record<string, unknown>): string {
        const MAX_VALUE_LEN = 500;
        const lines: string[] = [];
        for (const [key, value] of Object.entries(input)) {
            const strVal = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
            lines.push(`${key}: ${this.truncateForApproval(strVal, MAX_VALUE_LEN)}`);
        }
        return lines.join('\n');
    }

    /**
     * FEAT-44-10: approve a note edit on its DIFF, before it is written.
     *
     * The post-task review that used to be the only diff in the product opens
     * after every write has landed, and its "reject" only declines the user's own
     * manual edits -- the agent's version stays on disk. That is a gate in
     * appearance only. When the Pipeline hands us a preview, we put the real diff
     * in front of the write: Apply approves (with whatever the user typed),
     * discard rejects and nothing is written.
     */
    private async showEditApprovalGate(
        toolName: string,
        preview: import('../core/tools/editPreview').EditPreview,
    ): Promise<import('../core/tool-execution/ToolExecutionPipeline').ApprovalResult> {
        const { showEditReviewModal } = await import('./edit-review/EditReviewModal');
        const result = await showEditReviewModal({
            app: this.app,
            source: this.formatToolLabel(toolName),
            title: preview.isDeleted ? t('ui.approval.gateTitleDelete') : t('ui.approval.gateTitle'),
            entries: [{
                path: preview.path,
                before: preview.before,
                after: preview.after,
                isNew: preview.isNew,
                isDeleted: preview.isDeleted,
            }],
            // FEAT-44-02: one approval for the whole run is impossible -- the agent
            // only decides its next tool call after seeing this one's result, so
            // there is nothing to preview yet. Offering to REMEMBER the answer is
            // the honest version of what the user actually wants.
            allowRememberForRun: true,
        });

        // Discarded, or the single file was skipped: nothing happens.
        const decision = result.decisions?.[0];
        if (!result.decisions || !decision || decision.skipped) {
            return { decision: 'rejected', reason: 'Rejected by user in the diff view.' };
        }

        const rememberForRun = result.rememberForRun === true;

        // A deletion has no meaningful "edited after-state" -- the only real
        // choices are let it go or keep it. Whatever the textarea says, we do not
        // turn a delete into a write behind the user's back.
        if (preview.isDeleted) {
            return { decision: 'approved', rememberForRun };
        }

        // Approved as proposed -- let the tool do its own write.
        if (decision.finalContent === preview.after) {
            return { decision: 'approved', rememberForRun };
        }

        // The user rewrote it in the diff. Their content wins; the Pipeline
        // writes it instead of re-running the tool.
        //
        // Say so out loud. The note is usually not open yet at this point (skills
        // call open_note at the END of a run), so the write lands silently and the
        // user is left wondering whether their edit survived. It did.
        new Notice(t('ui.approval.editApplied', { path: preview.path }));
        return { decision: 'approved', finalContent: decision.finalContent, rememberForRun };
    }

    private async showApprovalCard(
        toolName: string,
        input: Record<string, unknown>,
        preview?: import('../core/tools/editPreview').EditPreview,
    ): Promise<import('../core/tool-execution/ToolExecutionPipeline').ApprovalResult> {
        // FEAT-44-10: a note edit with a computable diff gets the real gate.
        if (preview) {
            return await this.showEditApprovalGate(toolName, preview);
        }
        // Everything else uses the inline card. Rendered in chatContainer (not
        // toolsEl) so it stays visible even when .agent-steps-block is collapsed.
        return new Promise((resolve) => {
            // FIX-44-28: fail CLOSED, not open. If there is no chat container to
            // show the card in, we cannot have obtained consent -- approving
            // anyway would run an unconfirmed CUD action. Deny instead.
            if (!this.chatContainer) {
                resolve({ decision: 'rejected', reason: 'Approval UI unavailable; operation denied.' });
                return;
            }

            const group = this.getToolEffect(toolName, input);
            const groupLabels: Record<string, string> = {
                'note-edit': t('ui.approval.noteEdits'), 'vault-change': t('ui.approval.vaultChanges'),
                web: t('ui.approval.web'), mcp: t('ui.approval.mcp'), read: t('ui.approval.read'),
                ui: t('ui.approval.agentControl'), subtask: t('ui.approval.subAgents'),
                skill: t('ui.approval.pluginSkills'),
                'plugin-api': t('ui.approval.pluginApi'), recipe: t('ui.approval.recipes'),
                sandbox: t('ui.approval.sandbox'),
                config: t('ui.approval.config'),
                'self-modify': t('ui.approval.selfModify'),
                unclassified: t('ui.approval.unclassified'),
            };

            // Always render in chatContainer (like Question-Cards)
            const row = this.chatContainer.createDiv('tool-approval-row');
            const iconSpan = row.createSpan('tool-approval-icon');
            setIcon(iconSpan, 'shield-alert');
            row.createSpan('tool-approval-text').setText(
                t('ui.approval.notEnabled', { tool: this.formatToolLabel(toolName), group: groupLabels[group] ?? group })
            );

            // Human-readable explanation
            const { text: explanationText, target } = this.buildHumanReadableExplanation(toolName, input);
            const explanationEl = row.createDiv('tool-approval-explanation');
            explanationEl.createSpan().setText(explanationText);
            if (target) {
                explanationEl.createSpan('tool-approval-target').setText(target);
            }

            // For sandbox: show code preview (first 3 lines)
            if (toolName === 'evaluate_expression' && typeof input['expression'] === 'string') {
                const expr = input['expression'];
                const previewLines = expr.split('\n').slice(0, 3);
                const preview = previewLines.join('\n') + (expr.split('\n').length > 3 ? '\n...' : '');
                const codePreview = row.createDiv('tool-approval-code-preview');
                codePreview.createEl('code').setText(preview);
            }

            // For Frontmatter Operator bulk writes: preview how many notes
            // the selector matches BEFORE the user approves. Uses the
            // auto-approvable read method getMatchingPaths, so the preview
            // itself does not trigger another approval prompt.
            const previewPromise = this.maybeRenderFrontmatterOperatorPreview(toolName, input, row);

            // Collapsible details for power users
            const detailsToggle = row.createEl('span', {
                cls: 'tool-approval-details-toggle',
                text: t('ui.approval.explain.showDetails'),
            });
            const detailsContainer = row.createDiv('tool-approval-details');
            detailsContainer.createEl('pre', { cls: 'tool-approval-details-content' })
                .setText(this.formatInputForDetails(input));

            detailsToggle.addEventListener('click', () => {
                const isVisible = detailsContainer.hasClass('is-visible');
                if (isVisible) {
                    detailsContainer.removeClass('is-visible');
                    detailsToggle.setText(t('ui.approval.explain.showDetails'));
                } else {
                    detailsContainer.addClass('is-visible');
                    detailsToggle.setText(t('ui.approval.explain.hideDetails'));
                }
            });

            // Shai Hulud Mitigation: warn when writing to configDir (plugins/themes/settings)
            const inputPath = typeof input['path'] === 'string' ? input['path'] : '';
            const cfgDir = this.plugin.app.vault.configDir;
            if (inputPath && (inputPath.startsWith(`${cfgDir}/`) || inputPath === cfgDir)) {
                const warning = row.createDiv('tool-approval-config-warning');
                const warnIcon = warning.createSpan('tool-approval-warning-icon');
                setIcon(warnIcon, 'alert-triangle');
                warning.createSpan('tool-approval-warning-text').setText(
                    t('ui.approval.configDirWarning', { path: inputPath })
                );
            }

            const actions = row.createDiv('tool-approval-actions');
            const allowBtn = actions.createEl('button', { cls: 'tool-approval-btn approval-allow-once', text: t('ui.approval.allowOnce') });
            // ADR-153: only offer "Always allow" when a settings flag actually
            // backs it. config and self-modify (alwaysAsk) have none -- a button
            // promising a permanent grant that never takes effect would be a lie,
            // and it would set an unrelated permission instead.
            const permKey = this.effectToPermKey(group, input);
            // FEAT-44-02: a run-scoped grant is offered for the same effects that
            // can be remembered (not alwaysAsk). It applies to the rest of THIS
            // run only, dies with the task, and cannot buy off config/self-modify.
            const runBtn = permKey
                ? actions.createEl('button', { cls: 'tool-approval-btn approval-allow-run', text: t('ui.approval.allowForRun') })
                : null;
            const enableBtn = permKey
                ? actions.createEl('button', { cls: 'tool-approval-btn approval-enable', text: t('ui.approval.enableInSettings') })
                : null;
            const denyBtn = actions.createEl('button', { cls: 'tool-approval-btn approval-deny-small', text: '✕' });

            // AUDIT-FEAT-14-07 L-5: gate the Allow-button on the preview
            // for Frontmatter Operator bulk writes so the user cannot
            // approve before seeing the affected-note count. The Deny-
            // button stays enabled so the user can always bail out. A 2s
            // hard timeout re-enables Allow even if the plugin call hangs.
            if (previewPromise) {
                allowBtn.disabled = true;
                if (enableBtn) enableBtn.disabled = true;
                const releaseTimeout = window.setTimeout(() => {
                    allowBtn.disabled = false;
                    if (enableBtn) enableBtn.disabled = false;
                }, 2000);
                void previewPromise.finally(() => {
                    window.clearTimeout(releaseTimeout);
                    allowBtn.disabled = false;
                    if (enableBtn) enableBtn.disabled = false;
                });
            }

            // IMP-41-01-02: wall-clock timeout + abort coupling. Without this
            // the loop parks forever on a walked-away user, and Stop during an
            // open card still required a second click on the card itself.
            const timeoutMinutes = this.plugin.settings.advancedApi?.approvalTimeoutMinutes ?? 10;
            const countdownEl = timeoutMinutes > 0 ? actions.createSpan('tool-approval-countdown') : null;
            // Declared before wireApprovalTimeout: an ALREADY-aborted signal
            // fires onAbort synchronously inside the call.
            let timeoutHandle: import('./sidebar/approvalTimeout').ApprovalTimeoutHandle | null = null;
            const cleanup = () => { timeoutHandle?.dispose(); row.remove(); };
            timeoutHandle = wireApprovalTimeout({
                timeoutMs: timeoutMinutes * 60_000,
                // FIX-24-08-03: bind the run's signal, not the mutable
                // controller field. handleStop nulls the field immediately,
                // so a card surfacing from a still-draining tool would bind
                // undefined and hang until the wall-clock timeout. The
                // already-aborted signal fires onAbort synchronously inside
                // wireApprovalTimeout instead.
                abortSignal: this.lastRunAbortSignal ?? undefined,
                onExpire: () => {
                    cleanup();
                    resolve({
                        decision: 'rejected',
                        reason: `Approval timed out after ${timeoutMinutes} minute(s); operation denied.`,
                    });
                },
                onAbort: () => {
                    cleanup();
                    resolve({ decision: 'rejected', reason: 'Task was stopped while approval was pending.' });
                },
                onCountdownTick: (remainingSec) => {
                    countdownEl?.setText(t('ui.approval.expiresIn', { seconds: String(remainingSec) }));
                },
            });

            allowBtn.addEventListener('click', () => { cleanup(); resolve({ decision: 'approved' }); });
            runBtn?.addEventListener('click', () => { cleanup(); resolve({ decision: 'approved', rememberForRun: true }); });
            denyBtn.addEventListener('click', () => { cleanup(); resolve({ decision: 'rejected' }); });
            if (enableBtn && permKey) {
                enableBtn.addEventListener('click', () => {
                    void (async () => {
                        const cfg = this.plugin.settings.autoApproval;
                        const flags = cfg as unknown as Record<string, boolean>;

                        // FIX-44-03b: sandbox auto-approval means arbitrary
                        // agent-authored code writes the vault without a further
                        // prompt. Require an explicit confirm, as the Settings tab
                        // does -- a single card click must not arm it silently.
                        if (permKey === 'sandbox') {
                            const ok = await confirmModal(this.app, {
                                title: t('ui.approval.sandbox'),
                                message: t('ui.approval.sandboxGrantWarning'),
                                confirmLabel: t('ui.approval.enableInSettings'),
                                destructive: true,
                            });
                            if (!ok) return; // leave the card open, grant nothing
                        }

                        // FIX-44-03b: flipping the master ON must not silently
                        // re-arm category flags left true by a past permissive
                        // session. grantAutoApproval clears them first.
                        grantAutoApproval(flags, permKey);
                        await this.plugin.saveSettings();
                        cleanup();
                        resolve({ decision: 'approved' });
                    })();
                });
            }

            this.chatContainer?.scrollTo({ top: this.chatContainer.scrollHeight });
        });
    }

    /**
     * Offer the missing language pack as a visible in-chat card at
     * sidebar open. Reuses `showInstallPromptCard` so the visual is
     * identical to tool-triggered asset installs. Skips silently on
     * English, when the pack is already installed, or when the pack
     * offer for this locale was previously handled (persisted via
     * settings.localePackPromptedFor). Fire-and-forget.
     */
    private async maybeOfferLocalePackCard(): Promise<void> {
        try {
            const { activeLocaleSpec, LOCALE_LABELS } = await import('../i18n/localePacks');
            const { needsLocalePack, getActiveLocale } = await import('../i18n');
            if (!needsLocalePack()) return;
            const spec = activeLocaleSpec(this.plugin);
            if (!spec) return;
            const { OptionalAssetManager } = await import('../core/assets/OptionalAssetManager');
            const manager = new OptionalAssetManager(this.plugin);
            const snap = await manager.snapshot(spec);
            if (snap.status === 'installed') return;
            const outcome = await this.showInstallPromptCard(spec, 'language-pack');
            if (outcome.decision === 'installed') {
                const locale = getActiveLocale();
                const label = (LOCALE_LABELS as Record<string, string>)[locale] ?? locale;
                new Notice(t('notice.localePack.installedReload', { language: label }), 10_000);
            }
        } catch (e) {
            console.debug('[i18n] locale pack card skipped:', e);
        }
    }

    /**
     * Inline install-prompt card. Rendered when a tool needs an optional
     * asset (office bundle, pdfjs bundle, reranker WASM, ...) that is not
     * yet installed. Obsidian community policy requires network fetches
     * to be triggered by an explicit user click -- this card IS that
     * click. Resolves to `installed` once download+SHA verification
     * succeeded (tool retries its asset load), `skipped` if the user
     * dismisses, `failed` on download/verification error.
     */
    private async showInstallPromptCard(
        spec: import('../core/assets/OptionalAssetManager').AssetSpec,
        toolName: string,
    ): Promise<import('../core/tool-execution/ToolExecutionPipeline').OptionalAssetInstallResult> {
        return new Promise((resolve) => {
            if (!this.chatContainer) { resolve({ decision: 'skipped' }); return; }

            const row = this.chatContainer.createDiv('tool-approval-row install-prompt-row');

            const iconSpan = row.createSpan('tool-approval-icon');
            setIcon(iconSpan, 'download-cloud');

            const toolLabel = toolName === 'language-pack'
                ? t('ui.installPrompt.languagePackToolLabel')
                : this.formatToolLabel(toolName);
            const title = t('ui.installPrompt.title', {
                tool: toolLabel,
                asset: spec.label,
            });
            row.createSpan('tool-approval-text').setText(title);

            const explanation = row.createDiv('tool-approval-explanation');
            explanation.createSpan().setText(t('ui.installPrompt.body', {
                asset: spec.label,
                sizeMb: String(spec.sizeMb),
            }));

            const detailsToggle = row.createEl('span', {
                cls: 'tool-approval-details-toggle',
                text: t('ui.installPrompt.whatHappens'),
            });
            const detailsContainer = row.createDiv('tool-approval-details');
            const details = detailsContainer.createEl('pre', { cls: 'tool-approval-details-content' });
            details.setText(t('ui.installPrompt.details', {
                filename: spec.filename,
                sizeMb: String(spec.sizeMb),
                sha: spec.expectedSha256.slice(0, 16) + '...',
                url: spec.downloadUrl,
            }));
            detailsToggle.addEventListener('click', () => {
                const visible = detailsContainer.hasClass('is-visible');
                if (visible) {
                    detailsContainer.removeClass('is-visible');
                    detailsToggle.setText(t('ui.installPrompt.whatHappens'));
                } else {
                    detailsContainer.addClass('is-visible');
                    detailsToggle.setText(t('ui.installPrompt.hideDetails'));
                }
            });

            const statusEl = row.createDiv('tool-approval-explanation is-hidden');
            const actions = row.createDiv('tool-approval-actions');
            const installBtn = actions.createEl('button', {
                cls: 'tool-approval-btn approval-allow-once',
                text: t('ui.installPrompt.installNow', { sizeMb: String(spec.sizeMb) }),
            });
            const skipBtn = actions.createEl('button', {
                cls: 'tool-approval-btn approval-deny-small',
                text: '✕',
            });
            skipBtn.setAttr('title', t('ui.installPrompt.skipTooltip'));

            let done = false;
            const cleanup = () => { done = true; row.remove(); };

            installBtn.addEventListener('click', () => {
                void (async () => {
                    if (done) return;
                    installBtn.disabled = true;
                    skipBtn.disabled = true;
                    installBtn.setText(t('ui.installPrompt.downloading', { asset: spec.label }));
                    statusEl.removeClass('is-hidden');
                    statusEl.setText(t('ui.installPrompt.downloadingStatus'));
                    try {
                        const { OptionalAssetManager } = await import('../core/assets/OptionalAssetManager');
                        const manager = new OptionalAssetManager(this.plugin);
                        await manager.install(spec);
                        new Notice(t('notice.assets.installed', { label: spec.label }));
                        cleanup();
                        resolve({ decision: 'installed' });
                    } catch (e) {
                        const msg = e instanceof Error ? e.message : String(e);
                        installBtn.disabled = false;
                        skipBtn.disabled = false;
                        installBtn.setText(t('ui.installPrompt.retry'));
                        statusEl.setText(t('ui.installPrompt.failed', { error: msg }));
                        // Do not cleanup -- user can retry or skip.
                        // We only resolve on skip after a failed try so the
                        // model sees the error message via the tool's fallback.
                        skipBtn.onclick = () => {
                            cleanup();
                            resolve({ decision: 'failed', error: msg });
                        };
                    }
                })();
            });

            skipBtn.addEventListener('click', () => {
                cleanup();
                resolve({ decision: 'skipped' });
            });

            this.chatContainer?.scrollTo({ top: this.chatContainer.scrollHeight });
        });
    }

    /**
     * ADR-153: the effect class comes from the central registry, not from a
     * local copy.
     *
     * A hand-maintained list used to sit here that had drifted from the
     * Pipeline: anything unknown fell back to 'note-edit'. Clicking "Always
     * allow" on e.g. a restore_checkpoint card therefore wrote
     * `autoApproval.noteEdits` -- a DIFFERENT permission from the one displayed
     * -- and did not even suppress the next prompt for the tool that was
     * clicked.
     */
    private getToolEffect(toolName: string, input: Record<string, unknown>): ToolEffect | 'unclassified' {
        return resolveToolEffect(toolName, input) ?? 'unclassified';
    }

    /**
     * The settings flag that "Always allow" would set for this effect.
     *
     * `null` means there is nothing to grant permanently, so the button is not
     * rendered at all. That covers `config` and `self-modify` (alwaysAsk --
     * otherwise the agent could unlock itself) and unclassified tools.
     */
    private effectToPermKey(
        effect: ToolEffect | 'unclassified',
        input?: Record<string, unknown>,
    ): string | null {
        if (effect === 'unclassified') return null;
        const policy = EFFECT_POLICY[effect];
        if (policy.alwaysAsk) return null;
        // FIX-44-03a: plugin-api read vs write hangs off the INPUT, exactly as
        // the gate resolves it. Granting the write flag for a read card (the old
        // hardcoded 'pluginApiWrite') handed the user a permission the card never
        // showed. Mirror the gate via the shared helper.
        if (effect === 'plugin-api') {
            return isPluginApiWriteCall(input, this.plugin.settings.pluginApi)
                ? 'pluginApiWrite'
                : 'pluginApiRead';
        }
        return policy.key;
    }

    // -------------------------------------------------------------------------
    // Checkpoint markers (Kilo Code pattern: CheckpointSaved.tsx)
    // -------------------------------------------------------------------------

    private renderCheckpointMarker(
        container: HTMLElement,
        checkpoint: import('../core/checkpoints/GitCheckpointService').CheckpointInfo,
    ): void {
        const marker = container.createDiv('checkpoint-marker');

        const iconEl = marker.createSpan('checkpoint-icon');
        setIcon(iconEl, 'git-commit-vertical');

        const label = marker.createSpan('checkpoint-label');
        const files = checkpoint.filesChanged.map((f) => f.split('/').pop()).join(', ');
        const newFileNames = checkpoint.newFiles?.map((f) => f.split('/').pop()).join(', ');
        const allFiles = [files, newFileNames].filter(Boolean).join(', ');
        const time = new Date(checkpoint.timestamp).toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit',
        });
        label.setText(t('ui.checkpoint.label', { files: allFiles, time }));

        // Action buttons -- always visible, ghost-style, Lucide icons + Obsidian
        // tooltip via aria-label. Pattern adapted from Kilo Code's CheckpointMenu
        // (forked-kilocode/webview-ui/src/components/chat/checkpoints/CheckpointMenu.tsx):
        // three primary icon buttons inline, plus a "more" overflow with the
        // less common option (delete chat from here).
        const actions = marker.createDiv('checkpoint-actions');

        const diffBtn = this.makeCheckpointActionBtn(actions, 'file-diff', t('ui.checkpoint.action.diff'));
        diffBtn.addEventListener('click', () => {
            void this.showCheckpointDiff(checkpoint);
        });

        const undoThisBtn = this.makeCheckpointActionBtn(actions, 'undo-2', t('ui.checkpoint.undoThis'));
        undoThisBtn.addEventListener('click', () => {
            void this.restoreCheckpoint(checkpoint, marker, actions, false);
        });

        const undoFromHereBtn = this.makeCheckpointActionBtn(actions, 'rotate-ccw', t('ui.checkpoint.undoFromHere'));
        undoFromHereBtn.addEventListener('click', () => {
            void this.restoreCheckpointsForward(checkpoint, marker, actions);
        });

        const moreBtn = this.makeCheckpointActionBtn(actions, 'more-vertical', t('ui.checkpoint.action.more'));
        moreBtn.addEventListener('click', (ev) => {
            const menu = new Menu();
            menu.addItem((item) => {
                item.setTitle(t('ui.checkpoint.deleteFromHere'));
                item.setIcon('trash-2');
                item.onClick(() => {
                    void this.restoreCheckpoint(checkpoint, marker, actions, true);
                });
            });
            menu.showAtMouseEvent(ev);
        });
    }

    /**
     * Make a ghost icon button for the checkpoint marker action row. The
     * button has no border by default; styling lives on `.checkpoint-action-btn`.
     * The aria-label is what Obsidian renders as the tooltip on hover.
     */
    private makeCheckpointActionBtn(parent: HTMLElement, icon: string, tooltip: string): HTMLButtonElement {
        const btn = parent.createEl('button', { cls: 'checkpoint-action-btn' });
        btn.setAttribute('aria-label', tooltip);
        setIcon(btn, icon);
        return btn;
    }

    /**
     * "Undo all changes from here": restore the given checkpoint AND every
     * checkpoint that came after it in the same task. Equivalent to walking
     * the task's snapshot history forward from this point and rolling each
     * write back. Files are restored in reverse-chronological order so the
     * oldest (= pre-CP) content wins when multiple checkpoints touch the
     * same path.
     *
     * Takes a pre-restore snapshot of the union of affected files first so
     * the multi-step rollback can itself be undone via the next checkpoint
     * marker.
     */
    private async restoreCheckpointsForward(
        startCp: import('../core/checkpoints/GitCheckpointService').CheckpointInfo,
        marker: HTMLElement,
        optionsEl: HTMLElement,
    ): Promise<void> {
        optionsEl.querySelectorAll('button').forEach((b) => (b.disabled = true));
        optionsEl.empty();
        optionsEl.setText(t('ui.checkpoint.restoring'));

        const service = this.plugin.checkpointService;
        if (!service) {
            optionsEl.setText(t('ui.checkpoint.error'));
            return;
        }

        try {
            const all = await service.loadCheckpointsForTask(startCp.taskId);
            const startIdx = all.findIndex((c) => c.commitOid === startCp.commitOid);
            if (startIdx < 0) {
                // Fall back to single-CP restore if we somehow can't locate the start
                console.warn('[Checkpoint] undoFromHere: start oid not in task list, falling back to single restore');
                await this.restoreCheckpoint(startCp, marker, optionsEl, false);
                return;
            }
            const tail = all.slice(startIdx);

            // Pre-restore snapshot: union of every file the multi-step rollback
            // will touch. Lets the user undo the undo via the next checkpoint
            // marker in the chat (the per-tool pipeline snapshot only covers
            // toolCall.input.path, which is irrelevant for a UI-triggered batch).
            const affected = new Set<string>();
            for (const cp of tail) {
                for (const f of cp.filesChanged) affected.add(f);
                for (const f of cp.newFiles ?? []) affected.add(f);
            }
            try {
                await service.snapshot(`restore-${Date.now()}`, [...affected], 'undo_from_here');
            } catch (e) {
                console.warn('[Checkpoint] Pre-restore snapshot failed (non-fatal):', e);
            }

            // Reverse chronological so older content overwrites newer for the
            // same path (later CPs hold the in-between state, the start CP
            // holds the original pre-task content for its files).
            const allRestored: string[] = [];
            const allErrors: string[] = [];
            for (const cp of [...tail].reverse()) {
                const result = await service.restore(cp);
                allRestored.push(...result.restored);
                allErrors.push(...result.errors);
            }

            optionsEl.remove();
            const successEl = marker.createSpan('checkpoint-restored');
            const unique = new Set(allRestored).size;
            successEl.setText(t('ui.checkpoint.restored', { count: unique }));

            if (unique > 0) {
                const restoredFiles = [...new Set(allRestored)].join(', ');
                this.conversationHistory.push({
                    role: 'user',
                    content: `[System] Multi-checkpoint undo: ${tail.length} checkpoint(s) rolled back from ${startCp.commitOid.slice(0, 8)} forward. Files: ${restoredFiles}. ${allErrors.length} error(s). Vault state changed.`,
                });
                this.saveCurrentConversation();
            }
        } catch (e) {
            console.error('[Checkpoint] undoFromHere failed:', e);
            optionsEl.setText(t('ui.checkpoint.failed'));
        }
    }

    /**
     * Execute a checkpoint restore with either "keep chat" or "delete chat from here".
     */
    private async restoreCheckpoint(
        checkpoint: import('../core/checkpoints/GitCheckpointService').CheckpointInfo,
        marker: HTMLElement,
        optionsEl: HTMLElement,
        deleteChatFromHere: boolean,
    ): Promise<void> {
        optionsEl.querySelectorAll('button').forEach((b) => (b.disabled = true));
        optionsEl.empty();
        optionsEl.setText(t('ui.checkpoint.restoring'));

        try {
            console.debug('[Checkpoint] Restoring:', JSON.stringify(checkpoint, null, 2));
            const result = await this.plugin.checkpointService?.restore(checkpoint);
            console.debug('[Checkpoint] Result:', JSON.stringify(result, null, 2));
            if (!result || result.restored.length === 0) {
                optionsEl.setText(result?.errors?.length ? t('ui.checkpoint.error') : t('ui.checkpoint.nothingToRestore'));
                return;
            }

            optionsEl.remove();
            const successEl = marker.createSpan('checkpoint-restored');
            successEl.setText(t('ui.checkpoint.restored', { count: result.restored.length }));

            if (deleteChatFromHere) {
                this.deleteChatFromCheckpoint(marker);
            } else {
                const restoredFiles = result.restored.join(', ');
                const deletedNote = checkpoint.newFiles?.length
                    ? ` Deleted: ${checkpoint.newFiles.join(', ')}.`
                    : '';
                this.conversationHistory.push({
                    role: 'user',
                    content: `[System] Checkpoint restored. Files: ${restoredFiles}.${deletedNote} Vault state changed.`,
                });
            }

            this.saveCurrentConversation();
        } catch (e) {
            console.error('[Checkpoint] Restore failed:', e);
            optionsEl.setText(t('ui.checkpoint.failed'));
        }
    }

    /**
     * Remove the assistant message containing this checkpoint and all subsequent
     * messages from the DOM, uiMessages, and conversationHistory.
     */
    private deleteChatFromCheckpoint(marker: HTMLElement): void {
        if (!this.chatContainer) return;

        const assistantMsg = marker.closest('.assistant-message') ?? marker.closest('.message');
        if (!assistantMsg) return;

        const allMessages = Array.from(this.chatContainer.querySelectorAll('.message'));
        const idx = allMessages.indexOf(assistantMsg);
        if (idx < 0) return;

        // Count assistant bubbles before this one (for array truncation)
        const assistantBubblesBefore = allMessages
            .slice(0, idx)
            .filter((el) => el.classList.contains('assistant-message')).length;

        // Remove messages from DOM (this one + all after)
        for (let i = allMessages.length - 1; i >= idx; i--) {
            allMessages[i].remove();
        }

        // Truncate uiMessages at the corresponding assistant index
        const assistantIndices: number[] = [];
        this.uiMessages.forEach((m, i) => { if (m.role === 'assistant') assistantIndices.push(i); });
        const uiIdx = assistantIndices[assistantBubblesBefore];
        if (uiIdx !== undefined) {
            this.uiMessages.splice(uiIdx);
        }

        // Truncate conversationHistory at the corresponding assistant position
        let assistantCount = 0;
        for (let i = 0; i < this.conversationHistory.length; i++) {
            if (this.conversationHistory[i].role === 'assistant') {
                if (assistantCount === assistantBubblesBefore) {
                    this.conversationHistory.splice(i);
                    break;
                }
                assistantCount++;
            }
        }

        this.saveCurrentConversation();
    }

    /**
     * Open the EditReviewModal in checkpoint-mode for a single checkpoint
     * (read-only side-by-side + Restore button). EPIC-33 Diff-UX-refresh
     * (2026-06-22) replaced the section-accordion DiffReviewModal here so
     * inline + sidebar use one consistent surface.
     */
    private async showCheckpointDiff(
        checkpoint: import('../core/checkpoints/GitCheckpointService').CheckpointInfo,
    ): Promise<void> {
        const service = this.plugin.checkpointService;
        if (!service) return;

        const { showCheckpointReviewModal } = await import('./edit-review/EditReviewModal');
        const entries: import('./edit-review/EditReviewPanel').EditReviewEntry[] = [];

        for (const filePath of checkpoint.filesChanged) {
            const before = await service.getSnapshotContent(checkpoint, filePath);
            if (before === null) continue;

            let after = '';
            try {
                const file = this.app.vault.getFileByPath(filePath);
                if (file) after = await this.app.vault.read(file);
            } catch { /* file deleted */ }

            entries.push({ path: filePath, before, after });
        }

        if (entries.length === 0) return;

        showCheckpointReviewModal({
            app: this.app,
            entries,
            source: `Checkpoint ${new Date(checkpoint.timestamp).toLocaleString()}`,
            title: 'Checkpoint anzeigen',
            onRestore: async () => {
                const result = await service.restore(checkpoint);
                if (result && result.restored.length > 0) {
                    const restoredFiles = result.restored.join(', ');
                    const deletedNote = checkpoint.newFiles?.length
                        ? ` Deleted: ${checkpoint.newFiles.join(', ')}.`
                        : '';
                    this.conversationHistory.push({
                        role: 'user',
                        content: `[System] Checkpoint restored. Files: ${restoredFiles}.${deletedNote} Vault state changed.`,
                    });
                }
            },
        });
    }

    // -------------------------------------------------------------------------
    // Checkpoint markers: rehydrate undo bars after chat history reload
    // -------------------------------------------------------------------------

    /**
     * FIX-01-07-02 / FIX-44-12: after loadConversation rebuilds the chat DOM,
     * rehydrate the checkpoint markers inline at the assistant message they
     * belong to. Markers are never part of toolStepsHtml (they render as
     * siblings of the steps block), so without this step a reloaded chat has
     * no markers at all.
     *
     * FIX-44-12: messages that persisted their markers (UiMessage.checkpoints)
     * get them back at their own bubble -- LIVE (verified against the shadow
     * repo, full Diff/Undo buttons) or EXPIRED (dimmed, tooltip) when the repo
     * no longer holds the snapshot (REF_RETENTION_DAYS pruning). Older
     * conversations without the field keep the legacy behavior: every loaded
     * checkpoint of a task at its last assistant bubble. The planning logic
     * lives in checkpointMarkerRehydration.ts (pure, tested).
     */
    private async rehydrateCheckpointMarkers(
        pairs: { msg: UiMessage; el: HTMLElement }[],
    ): Promise<void> {
        if (!(this.plugin.settings.enableCheckpoints ?? true)) return;
        const service = this.plugin.checkpointService;
        if (!service) return;

        try {
            const plan = await planCheckpointMarkerRehydration(
                pairs.map((p) => p.msg),
                (taskId) => service.loadCheckpointsForTask(taskId),
            );

            for (const [index, items] of plan) {
                const messageEl = pairs[index]?.el;
                if (!messageEl) continue;

                // Defensive: never render the same marker twice if rehydration
                // runs again over the same DOM.
                messageEl.querySelectorAll('.checkpoint-marker').forEach((el) => el.remove());

                const toolsEl = messageEl.querySelector<HTMLElement>('.message-tools') ?? messageEl;
                for (const item of items) {
                    if (item.kind === 'live') {
                        this.renderCheckpointMarker(toolsEl, item.checkpoint);
                    } else {
                        this.renderExpiredCheckpointMarker(toolsEl, item.marker);
                    }
                }
            }
        } catch (e) {
            console.warn('[Checkpoints] rehydrate failed:', e);
        }
    }

    /**
     * FIX-44-12: a persisted marker whose snapshot the shadow repo no longer
     * holds (pruned after REF_RETENTION_DAYS, deleted repo). Rendered dimmed,
     * without action buttons, with a tooltip saying why -- the honest version
     * of "this existed, but its undo data is gone". Dropping it silently made
     * users hunt for buttons that could never come back.
     */
    private renderExpiredCheckpointMarker(
        container: HTMLElement,
        marker: PersistedCheckpointMarker,
    ): void {
        const el = container.createDiv('checkpoint-marker checkpoint-marker-expired');
        el.setAttribute('aria-label', t('ui.checkpoint.snapshotExpired'));

        const iconEl = el.createSpan('checkpoint-icon');
        setIcon(iconEl, 'git-commit-vertical');

        const label = el.createSpan('checkpoint-label');
        const files = [...marker.filesChanged, ...(marker.newFiles ?? [])]
            .map((f) => f.split('/').pop())
            .filter(Boolean)
            .join(', ');
        const time = new Date(marker.timestamp).toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit',
        });
        label.setText(t('ui.checkpoint.label', { files, time }));
    }

    // -------------------------------------------------------------------------
    // Post-task review: show all changes for review/undo after agent finishes
    // -------------------------------------------------------------------------

    private async showPostTaskReview(taskId: string): Promise<void> {
        const service = this.plugin.checkpointService;
        if (!service) return;

        // FIX-44-16: the diff belongs BEFORE the write, not after it. A write the
        // user individually approved on its real diff must not be re-approved
        // here -- a second, weaker-looking approval is what misled a user into
        // thinking the POST-task modal was the gate.
        //
        // FIX-44-44: but "the user saw the diff at the gate" only holds for tools
        // with previewEdit. Name-only card approvals, settings-auto and run-scope
        // grants land with no diff surface at all, and they exist with the master
        // toggle OFF too. The caller therefore gates this method on the
        // pipeline's onUnreviewedWrite signal (taskHadUnreviewedWrites), not on
        // `autoApproval.enabled`. For those writes this review is the last line
        // of defence, and its explicit revert really does take the changes back.

        const checkpoints = service.getCheckpointsForTask(taskId);
        if (checkpoints.length === 0) return;

        // Collect the earliest checkpoint content per file (pre-task state)
        const fileOldContent = new Map<string, string>();
        for (const cp of checkpoints) {
            for (const filePath of cp.filesChanged) {
                if (!fileOldContent.has(filePath)) {
                    const content = await service.getSnapshotContent(cp, filePath);
                    if (content !== null) {
                        fileOldContent.set(filePath, content);
                    }
                }
            }
        }

        // Build entries: before = earliest checkpoint, after = current disk
        // state. EPIC-33 Diff-UX-refresh (2026-06-22) replaced the
        // section-accordion DiffReviewModal with the unified EditReviewModal
        // so inline + sidebar share a single review surface.
        // FIX-01-07-04: the after-state MUST come from an index-independent
        // read. vault.getFileByPath returns null for dot-paths (.obsidian/,
        // agent folder), which made the review show after='' and Apply then
        // zeroed the file through a raw adapter.write.
        const { readCurrentContent, applyReviewDecisions, revertReviewedFiles } = await import('./edit-review/postTaskReviewIO');
        const { showEditReviewModal } = await import('./edit-review/EditReviewModal');
        const entries: import('./edit-review/EditReviewPanel').EditReviewEntry[] = [];

        for (const [filePath, before] of fileOldContent) {
            const after = (await readCurrentContent(this.app, filePath)) ?? '';
            if (before === after) continue;
            entries.push({ path: filePath, before, after });
        }

        const newFiles = new Set<string>();
        for (const cp of checkpoints) {
            if (cp.newFiles) {
                for (const f of cp.newFiles) newFiles.add(f);
            }
        }
        for (const filePath of newFiles) {
            const after = await readCurrentContent(this.app, filePath);
            if (after) {
                entries.push({ path: filePath, before: '', after, isNew: true });
            }
        }

        if (entries.length === 0) return;

        const result = await showEditReviewModal({
            app: this.app,
            entries,
            title: t('ui.editReview.titleReview'),
            source: t('ui.editReview.sourceTask', { taskId }),
            // FIX-44-16: in a POST-task review the writes have already landed, so
            // "discard" cannot mean "do not write" -- it has to mean "take it
            // back". The label says so, and the handler below does so.
            discardLabel: t('ui.editReview.revertAll'),
        });

        // FIX-44-38: Esc / X / backdrop is NOT "Revert all". A user who merely
        // closes the review keeps every file exactly as the agent left it.
        if (result.outcome === 'dismissed') return;

        if (result.outcome === 'discarded') {
            // FIX-44-16: this used to be a bare `return`. The user pressed the
            // button that says the changes go away, and the changes stayed. The
            // pre-task content is right here in `entries`, so give it back.
            // FIX-44-38: only the EXPLICIT revert button lands here, and since it
            // destroys the agent's finished work it gets a confirm step.
            const ok = await confirmModal(this.app, {
                title: t('ui.editReview.confirmRevertTitle'),
                message: t('ui.editReview.confirmRevertBody', { count: entries.length }),
                confirmLabel: t('ui.editReview.revertAll'),
                destructive: true,
            });
            if (!ok) return; // keep everything
            const undone = await revertReviewedFiles(this.app, entries);
            if (undone.reverted.length > 0) {
                new Notice(t('ui.editReview.reverted', { count: undone.reverted.length }));
            }
            if (undone.failed.length > 0) {
                new Notice(t('ui.editReview.revertFailed', { paths: undone.failed.join(', ') }));
            }
            return;
        }
        if (result.decisions === null) return; // defensive: applied always carries decisions

        // FIX-01-07-04: only decisions the user actually changed are written,
        // through the atomic + empty-guarded path. An unchanged Apply is a
        // no-op instead of a rewrite of the displayed after-state.
        const reviewedAfter = new Map(entries.map(e => [e.path, e.after]));
        const outcome = await applyReviewDecisions(this.app, result.decisions, reviewedAfter);
        if (outcome.written.length > 0) {
            this.conversationHistory.push({
                role: 'user',
                content: `[System] Post-task review: User edited ${outcome.written.length} file(s): ${outcome.written.join(', ')}.`,
            });
        }
        // AUDIT 2026-07-07 PTR-2: guarded/failed decisions previously died in
        // the console -- the user edited, clicked Apply, the modal closed,
        // and the change was silently gone. Surface them.
        const notApplied = [...outcome.guarded, ...outcome.failed];
        if (notApplied.length > 0) {
            new Notice(t('ui.editReview.applyIncomplete', {
                count: notApplied.length,
                paths: notApplied.join(', '),
            }), 10000);
        }
    }

    // -------------------------------------------------------------------------
    // Undo bar (fallback when no checkpoint markers rendered)
    // -------------------------------------------------------------------------

    private showUndoBar(taskId: string, writeCount: number): void {
        if (!this.chatContainer) return;
        const bar = this.chatContainer.createDiv('undo-bar');
        bar.createSpan('undo-label').setText(
            t('ui.undo.modified', { count: writeCount })
        );
        const undoBtn = bar.createEl('button', { cls: 'undo-btn', text: t('ui.undo.undoAll') });
        undoBtn.addEventListener('click', () => {
            void (async () => {
                undoBtn.disabled = true;
                undoBtn.setText(t('ui.undo.restoring'));
                console.debug(`[Undo] Attempting restore for taskId=${taskId} hasService=${!!this.plugin.checkpointService}`);
                try {
                    const result = await this.plugin.checkpointService?.restoreLatestForTask(taskId);
                    console.debug('[Undo] Restore result:', result);
                    bar.empty();
                    if (result && result.restored.length > 0) {
                        bar.createSpan('undo-success').setText(
                            t('ui.undo.restored', { count: result.restored.length })
                        );
                    } else {
                        bar.createSpan('undo-error').setText(t('ui.undo.noCheckpoint'));
                    }
                } catch {
                    bar.empty();
                    bar.createSpan('undo-error').setText(t('ui.undo.restoreFailed'));
                }
            })();
        });
        this.chatContainer.scrollTo({ top: this.chatContainer.scrollHeight });
    }

    /**
     * Format token count for display (e.g., 1500 → 1.5k, 1500000 → 1.5M)
     */
    private formatTokens(num: number): string {
        if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
        if (num >= 1_000) return (num / 1_000).toFixed(1) + 'k';
        return num.toString();
    }
}


/* eslint-enable -- end of file-level disable for boundary code (SDK/JSON/Obsidian internals) */

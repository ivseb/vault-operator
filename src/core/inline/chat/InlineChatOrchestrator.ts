/**
 * InlineChatOrchestrator -- glue between editor-trigger and InlineChatPanel (FEAT-33-05 UX-refresh).
 *
 * Replaces the older FloatingMenu trigger flow:
 * - On trigger (hotkey / auto-on-selection / command-palette) the
 *   orchestrator probes the active editor, builds the TriggerContext,
 *   and opens a single InlineChatPanel near the cursor.
 * - Toolbar-actions (Lookup, Rewrite, Translate, Summarize, Send-to-
 *   Main, Find-Action-Items) and free-chat all stream their LLM
 *   output into the panel's message body.
 * - Status pill captures errors / "thinking..." indicators.
 *
 * The orchestrator owns the active panel reference so re-triggering
 * focuses the existing panel instead of stacking copies.
 *
 * Related: FEAT-33-05, FEAT-33-01 (Trigger-Layer surface), ADR-138.
 */

import type { AgentTaskCallbacks } from '../../AgentTask';
import type { InlineAction, InlineActionRegistry } from '../InlineActionRegistry';
import type { InlineTriggerResolver, SelectionTriggerInput } from '../InlineTriggerResolver';
import type { InlineTriggerContext } from '../InlineTriggerContext';
import {
    InlineChatPanel,
    type InlinePanelActionId,
    type InlinePanelDispatchArgs,
    type InlinePanelHandle,
    type SetIconHook,
} from './InlineChatPanel';

export interface EditorChatProbe {
    /** Returns selection-input from active editor, or null. */
    probe(): SelectionTriggerInput | null;
    /** Container the panel attaches to. */
    getPanelContainer(): HTMLElement | null;
    /** Best-effort cursor coordinates for panel placement. */
    getPanelPosition(): { x: number; y: number };
}

export interface InlineChatOrchestratorOptions {
    editorProbe: EditorChatProbe;
    registry: InlineActionRegistry;
    resolver: InlineTriggerResolver;
    /** Live master-switch (settings.inlineActions.enabled). */
    isEnabled?: () => boolean;
    /** Optional bridge to Obsidian's setIcon for Lucide rendering. */
    setIcon?: SetIconHook;
    /**
     * Optional bridge for the "..." (more actions) menu. The plugin
     * entry-point typically builds an Obsidian Menu and offers Rewrite,
     * Translate, Summarize, Find-Action-Items, Send-to-Main here.
     * Each menu item dispatches a panel-action by calling
     * handle.appendMessage + handle.setStatus and then the registered
     * InlineAction via the dispatcher exposed in the handle.
     */
    showMoreMenu?: (
        anchor: HTMLElement,
        ctx: InlineTriggerContext,
        handle: InlinePanelHandle,
        dispatch: (actionId: InlinePanelActionId) => void,
    ) => void;
    /** Optional bridge for the "+" menu. */
    showPlusMenu?: (anchor: HTMLElement, ctx: InlineTriggerContext) => void;
}

/** Map panel-action ids onto registered InlineAction ids. */
function panelActionToRegistryId(panelId: InlinePanelActionId): string | null {
    switch (panelId) {
        case 'lookup': return 'lookup';
        case 'rewrite': return 'rewrite';
        case 'translate': return 'translate:english';
        case 'summarize': return 'summarize:medium';
        case 'find-action-items': return 'find-action-items';
        case 'send-to-main': return 'send-to-main-chat';
        case 'free-chat': return 'inline-chat';
    }
}

export class InlineChatOrchestrator {
    private readonly editorProbe: EditorChatProbe;
    private readonly registry: InlineActionRegistry;
    private readonly resolver: InlineTriggerResolver;
    private readonly isEnabled: () => boolean;
    private readonly setIconHook?: SetIconHook;
    private readonly showMoreMenu?: (
        anchor: HTMLElement,
        ctx: InlineTriggerContext,
        handle: InlinePanelHandle,
        dispatch: (actionId: InlinePanelActionId) => void,
    ) => void;
    private readonly showPlusMenu?: (anchor: HTMLElement, ctx: InlineTriggerContext) => void;

    private activePanel: InlineChatPanel | null = null;

    constructor(options: InlineChatOrchestratorOptions) {
        this.editorProbe = options.editorProbe;
        this.registry = options.registry;
        this.resolver = options.resolver;
        this.isEnabled = options.isEnabled ?? (() => true);
        this.setIconHook = options.setIcon;
        this.showMoreMenu = options.showMoreMenu;
        this.showPlusMenu = options.showPlusMenu;
    }

    /** Main entry from hotkey / command-palette / SelectionWatcher. */
    triggerPanel(): void {
        if (this.isEnabled() !== true) return;
        const input = this.editorProbe.probe();
        if (input === null) return;
        const container = this.editorProbe.getPanelContainer();
        if (container === null) return;

        const ctx = this.resolver.resolveFromSelection(input);

        // Re-trigger: close the old one and open fresh so the anchor + position update.
        this.closePanel();

        const panel = new InlineChatPanel({
            containerEl: container,
            ctx,
            position: this.editorProbe.getPanelPosition(),
            onDispatch: (args, handle) => { void this.handleDispatch(args, handle); },
            onShowMoreMenu: this.showMoreMenu !== undefined
                ? (anchor, c, handle) => {
                    this.showMoreMenu!(anchor, c, handle, (actionId) => {
                        // Dispatch helper for the secondary menu items.
                        void this.handleDispatch({ actionId, userInput: '', ctx: c }, handle);
                    });
                }
                : undefined,
            onShowPlusMenu: this.showPlusMenu,
            onClose: () => { this.activePanel = null; },
            setIcon: this.setIconHook,
        });
        panel.open();
        this.activePanel = panel;
    }

    closePanel(): void {
        if (this.activePanel !== null) {
            this.activePanel.close();
            this.activePanel = null;
        }
    }

    dispose(): void { this.closePanel(); }

    private async handleDispatch(args: InlinePanelDispatchArgs, handle: InlinePanelHandle): Promise<void> {
        const registryId = panelActionToRegistryId(args.actionId);
        if (registryId === null) {
            handle.setStatus(`Unknown action: ${args.actionId}`, 'error');
            return;
        }
        const action = this.registry.getAction(registryId);
        if (action === undefined) {
            handle.setStatus(`Action not registered: ${registryId}`, 'error');
            return;
        }
        if (action.isEligible(args.ctx) !== true) {
            handle.setStatus(`Not eligible in current editor mode.`, 'error');
            return;
        }

        // Free-chat carries the user-typed prompt as a synthetic
        // user-bubble; quick-actions just show a status pill.
        if (args.actionId === 'free-chat') {
            handle.appendMessage({ role: 'user', text: args.userInput });
        } else {
            handle.appendMessage({ role: 'user', text: `[${action.label}]` });
        }
        const assistantId = handle.appendMessage({ role: 'assistant', text: '' });
        handle.setStatus('Thinking…');

        const callbacks = this.buildPanelCallbacks(handle, assistantId);
        try {
            await action.execute(this.augmentForFreeChat(args), callbacks);
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            handle.setStatus(`Error: ${err.message}`, 'error');
        }
    }

    /**
     * When the user free-chats we want to feed the typed prompt into
     * the InlineChatAction. The action's contract is to seed the
     * conversation with the selection; we extend the user message via
     * a synthetic selectionText override that includes both the
     * selection AND the user question. Minimal patch -- richer
     * multi-turn loops are a follow-up.
     */
    private augmentForFreeChat(args: InlinePanelDispatchArgs): InlineTriggerContext {
        if (args.actionId !== 'free-chat') return args.ctx;
        const combinedSelection = args.ctx.selectionText.length === 0
            ? args.userInput
            : `${args.ctx.selectionText}\n\nUser question: ${args.userInput}`;
        return { ...args.ctx, selectionText: combinedSelection };
    }

    private buildPanelCallbacks(handle: InlinePanelHandle, assistantBubbleId: string): AgentTaskCallbacks {
        return {
            onText: (chunk) => handle.appendStreamChunk(assistantBubbleId, chunk),
            onToolStart: () => {},
            onToolResult: () => {},
            onComplete: () => { handle.setStatus('Done'); },
            onError: (err) => { handle.setStatus(`Error: ${err.message}`, 'error'); },
        };
    }
}

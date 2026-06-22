/**
 * PanelChatController -- Sidebar-style chat session driver for the InlineChatPanel (EPIC-33).
 *
 * Replaces the old single-turn / NoteWriter-based InlineChatAction
 * flow. One controller per open panel (lifetime = panel lifetime).
 * Holds the in-memory MessageParam[] history so consecutive
 * sendTurn() calls produce true multi-turn behaviour, exactly like
 * the Sidebar chat: the AgentTask mutates the array in place, the
 * controller hands the same reference back on every turn.
 *
 * Surface: identical to AgentTaskCallbacks. Streaming text lands in
 * the assistant bubble, tool calls show up as a single status line,
 * errors flip the status pill. Nothing is ever written to the vault
 * note from this path -- the panel is the only conversation surface.
 *
 * Selection injection: the original selection is prepended to the
 * FIRST user turn as a `<context>` block (mirrors how
 * AgentSidebarView.handleSendMessage injects active-file context).
 * Subsequent turns do not re-inject the selection.
 *
 * Constraints (deliberately out of scope for v1, all documented in
 * the EPIC-33 audit refactor risks):
 *  - No persistence to ConversationStore / disk -- the panel is
 *    ephemeral by design.
 *  - No recipe-matching / memory-context / skill-directory / plugin-
 *    skills section -- minimal subset shipped, can grow once usage
 *    patterns emerge.
 *  - No mid-run steering (composer disables Send while running).
 *
 * Related: EPIC-33 audit (wd39z8ehx), ADR-138, AgentSidebarView.handleSendMessage.
 */

import type { MessageParam, ContentBlock } from '../../../api/types';
import type { AgentTaskCallbacks } from '../../AgentTask';
import { AgentTaskRunner } from '../../agent/AgentTaskRunner';
import type ObsidianAgentPlugin from '../../../main';
import type { InlineTriggerContext } from '../InlineTriggerContext';
import type { InlinePanelHandle } from './InlineChatPanel';

export interface PanelChatControllerOptions {
    plugin: ObsidianAgentPlugin;
    /** TriggerContext captured at panel-open time (selection + notePath). */
    ctx: InlineTriggerContext;
}

export class PanelChatController {
    private readonly plugin: ObsidianAgentPlugin;
    private readonly ctx: InlineTriggerContext;
    /**
     * In-memory chat history. AgentTask MUTATES this array in place;
     * we keep the same reference across turns so the model sees prior
     * user / assistant / tool messages. Mirrors the Sidebar pattern
     * (AgentSidebarView.conversationHistory).
     */
    private readonly history: MessageParam[] = [];
    private abortController: AbortController | null = null;
    /** Counter for synthetic per-panel task ids. */
    private turnCounter = 0;
    /** True between sendTurn entry and final callback (any of onComplete/onError). */
    private running = false;

    constructor(options: PanelChatControllerOptions) {
        this.plugin = options.plugin;
        this.ctx = options.ctx;
    }

    get isRunning(): boolean { return this.running; }

    /**
     * Run one chat turn through the agent loop. Streams into the
     * panel via the provided handle + assistant bubble id.
     *
     * The selection is prepended to the FIRST user turn only. From
     * the second turn onwards the user message is sent verbatim.
     */
    async sendTurn(args: {
        userInput: string;
        handle: InlinePanelHandle;
        assistantBubbleId: string;
    }): Promise<void> {
        if (this.running === true) {
            args.handle.setStatus('Already running -- wait for the current turn to finish.', 'error');
            return;
        }
        this.running = true;
        this.abortController = new AbortController();
        this.turnCounter += 1;

        // EPIC-33 Sidebar-parity: resolve /skill, #prompt, §workflow
        // prefixes BEFORE we wrap the selection. Mirrors
        // AgentSidebarView.handleSendMessage:1575-1638.
        const expansionMod = await import('./composerExpansion');
        const activeFile = this.plugin.app.workspace.getActiveFile?.();
        const expanded = await expansionMod.expandComposerPrefix(this.plugin, {
            text: args.userInput,
            activeFilePath: activeFile?.path,
            activeFileName: activeFile?.name,
        });
        const effectiveInput = expanded ?? args.userInput;

        const userMessage = this.buildUserMessage(effectiveInput);
        const callbacks = this.buildCallbacks(args.handle, args.assistantBubbleId);

        if (this.plugin.apiHandler === null) {
            args.handle.setStatus('No API handler configured. Open Settings and set up a provider.', 'error');
            this.running = false;
            this.abortController = null;
            return;
        }
        try {
            const runner = new AgentTaskRunner({
                api: this.plugin.apiHandler,
                toolRegistry: this.plugin.toolRegistry,
                callbacks,
                // ModeService lives on AgentSidebarView, not on the plugin.
                // Panel runs without per-mode role-definitions for v1; AgentTask
                // falls back to the configured mode slug from initialMode.
                modeService: undefined,
                consecutiveMistakeLimit: this.plugin.settings.advancedApi?.consecutiveMistakeLimit ?? 0,
                rateLimitMs: this.plugin.settings.advancedApi?.rateLimitMs ?? 0,
                condensingEnabled: this.plugin.settings.advancedApi?.condensingEnabled ?? true,
                condensingThreshold: this.plugin.settings.advancedApi?.condensingThreshold ?? 80,
                maxIterations: this.plugin.settings.advancedApi?.maxIterations ?? 25,
                microcompactionEnabled: this.plugin.settings.advancedApi?.microcompactionEnabled ?? true,
                rollingSummaryThreshold: this.plugin.settings.advancedApi?.rollingSummaryThreshold ?? 50,
            });

            await runner.execute({
                userMessage,
                taskId: `inline-panel-${Date.now()}-${this.turnCounter}`,
                initialMode: this.plugin.settings.currentMode,
                history: this.history,
                abortSignal: this.abortController.signal,
                configDir: this.plugin.app.vault.configDir,
            });
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            args.handle.setStatus(`Error: ${err.message}`, 'error');
        } finally {
            this.running = false;
            this.abortController = null;
        }
    }

    /** Abort an in-flight turn (panel close, Esc, etc.). */
    abort(): void {
        if (this.abortController !== null) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.running = false;
    }

    dispose(): void { this.abort(); }

    /**
     * On the first turn the selection is injected as a `<context>`
     * block so the model sees what the user is asking about without
     * the selection text becoming the user's literal turn. From the
     * second turn onwards we send the raw user input.
     *
     * If the selection is empty we always send the raw user input.
     */
    private buildUserMessage(userInput: string): string | ContentBlock[] {
        const isFirstTurn = this.history.length === 0;
        const sel = this.ctx.selectionText.trim();
        if (isFirstTurn === false || sel.length === 0) {
            return userInput;
        }
        const noteRef = this.ctx.notePath !== '' ? ` (from note: ${this.ctx.notePath})` : '';
        return `<context>Selected text${noteRef}:\n${sel}</context>\n\n${userInput}`;
    }

    private buildCallbacks(handle: InlinePanelHandle, assistantBubbleId: string): AgentTaskCallbacks {
        return {
            onIterationStart: () => {},
            onText: (chunk) => handle.appendStreamChunk(assistantBubbleId, chunk),
            onThinking: () => {},
            onToolStart: (name) => { handle.setStatus(`Calling ${name}...`); },
            onToolResult: () => {},
            onComplete: () => { handle.setStatus('Done'); },
            onAttemptCompletion: () => {},
            onError: (err) => { handle.setStatus(`Error: ${err.message}`, 'error'); },
            consumeSteeringMessages: () => [],
        };
    }
}

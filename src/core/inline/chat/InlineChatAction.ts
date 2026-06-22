/**
 * InlineChatAction -- persistent Conversation-Block per ADR-143 (FEAT-33-05).
 *
 * Starts a multi-turn inline chat anchored to the user's selection.
 * The very first turn (user) is the selection itself; the LLM
 * answers, and the conversation block is persisted as a markdown
 * code fence under the selection (`vault-operator-chat-v1`).
 *
 * Subsequent turns happen via the FollowUpController interface which
 * the plugin entry-point implements (it owns the inline-UI for the
 * follow-up input). The action itself just runs the first turn so
 * the persistence + multi-turn loop is testable in isolation.
 *
 * Note-writing is delegated to a NoteWriter probe so this module
 * stays Obsidian-API-free.
 *
 * Related: FEAT-33-05, ADR-143.
 */

import type { AgentTaskCallbacks } from '../../AgentTask';
import type { InlineAction } from '../InlineActionRegistry';
import type { InlineTriggerContext } from '../InlineTriggerContext';
import type { InlineLLMCaller } from '../InlineLLMCaller';
import {
    appendTurn,
    createChatBlock,
    serializeChatBlock,
    type InlineChatBlock,
    type InlineChatTurn,
} from './InlineChatBlock';

export interface NoteWriter {
    /**
     * Insert text into the active note at the given cursor position.
     * Implementations must preserve the rest of the note and the
     * user's selection. The plugin entry-point implements this via
     * the Obsidian editor API.
     */
    insertAtCursor(args: { notePath: string; cursorPos: number; text: string }): Promise<void>;
}

export interface InlineChatActionOptions {
    caller: InlineLLMCaller;
    writer: NoteWriter;
    /**
     * Produces stable timestamps. Defaults to `() => new Date().toISOString()`
     * but tests pass a deterministic value.
     */
    now?: () => string;
    /** Stable identifier generator. Defaults to a timestamp + random suffix. */
    nextId?: () => string;
    /** Optional override id/label. */
    id?: string;
    label?: string;
}

const SYSTEM_PROMPT = `You are an inline chat assistant anchored to a passage the user selected in their note. Stay focused on the passage. Cite the passage when the user asks "what does this mean". Use markdown. Keep answers concise (4-8 sentences) unless the user asks for more.`;

export class InlineChatAction implements InlineAction {
    readonly id: string;
    readonly label: string;
    readonly description: string;
    private readonly caller: InlineLLMCaller;
    private readonly writer: NoteWriter;
    private readonly now: () => string;
    private readonly nextId: () => string;

    constructor(options: InlineChatActionOptions) {
        this.caller = options.caller;
        this.writer = options.writer;
        this.now = options.now ?? (() => new Date().toISOString());
        this.nextId = options.nextId ?? (() => `ic-${Math.random().toString(36).slice(2, 10)}`);
        this.id = options.id ?? 'inline-chat';
        this.label = options.label ?? 'Chat about this';
        this.description = 'Start a persistent inline conversation about the selection';
    }

    isEligible(ctx: InlineTriggerContext): boolean {
        if (ctx.editorMode === 'reading') return false;
        return ctx.selectionText.trim().length > 0;
    }

    async execute(ctx: InlineTriggerContext, callbacks: AgentTaskCallbacks): Promise<void> {
        const created = this.now();
        let block = createChatBlock({
            id: this.nextId(),
            selection_anchor: ctx.selectionText,
            model: ctx.settingsSnapshot.modelId,
            created,
        });

        // First user-turn = the selection itself.
        const userTurn: InlineChatTurn = { role: 'user', content: ctx.selectionText, at: created };
        block = appendTurn(block, userTurn);

        let assistantText = '';
        await this.caller.stream(
            {
                systemPrompt: SYSTEM_PROMPT,
                userMessage: `The user has anchored a chat to this selection:\n\n${ctx.selectionText}\n\nProvide an initial helpful response.`,
            },
            {
                onText: (chunk) => {
                    assistantText += chunk;
                    callbacks.onText(chunk);
                },
                onComplete: async () => {
                    block = appendTurn(block, {
                        role: 'assistant',
                        content: assistantText,
                        at: this.now(),
                    });
                    try {
                        const text = `\n\n${serializeChatBlock(block)}`;
                        await this.writer.insertAtCursor({
                            notePath: ctx.notePath,
                            cursorPos: ctx.cursorPos,
                            text,
                        });
                        callbacks.onComplete();
                    } catch (e) {
                        const err = e instanceof Error ? e : new Error(String(e));
                        callbacks.onError(err);
                    }
                },
                onError: (err) => callbacks.onError(err),
            },
        );
    }
}

/**
 * save_conversation -- BA-26 / FEAT-23-01.
 *
 * External MCP clients call this to copy a Chat conversation into
 * Obsilo's ConversationStore + HistoryDB. Conversation appears in
 * the matching source-tab of the History sidebar; Memory-extraction
 * triggers via ExtractionQueue when sync-mode resolves to 'auto'.
 *
 * sync-mode is resolved per-provider (FEAT-23-04). ChatGPT and
 * Perplexity default to 'manual' so family-shared accounts do not
 * leak into Sebastian's personal memory.
 */

import type ObsidianAgentPlugin from '../../main';
import type { McpToolResult } from '../types';
import type { MessageParam } from '../../api/types';
import {
    validateSourceInterface,
    resolveSyncMode,
    DEFAULT_CROSS_SURFACE_SETTINGS,
} from '../../core/memory/SourceInterface';

interface InputMessage {
    role: 'user' | 'assistant';
    text: string;
    ts?: string;
}

function isInputMessage(m: unknown): m is InputMessage {
    return typeof m === 'object' && m !== null
        && typeof (m as { role?: unknown }).role === 'string'
        && ((m as { role?: string }).role === 'user' || (m as { role?: string }).role === 'assistant')
        && typeof (m as { text?: unknown }).text === 'string';
}

export async function handleSaveConversation(
    plugin: ObsidianAgentPlugin,
    args: Record<string, unknown>,
): Promise<McpToolResult> {
    const messagesRaw = args.messages;
    if (!Array.isArray(messagesRaw) || messagesRaw.length === 0) {
        return errorResult('messages array is required and must be non-empty');
    }
    const messages: InputMessage[] = messagesRaw.filter(isInputMessage);
    if (messages.length === 0) {
        return errorResult('messages had no valid {role, text} entries');
    }
    if (messages.length > 500) {
        return errorResult('too many messages (max 500); split into multiple conversations');
    }

    const sourceInterface = validateSourceInterface(args.source_interface);
    if (sourceInterface === 'obsilo') {
        return errorResult('source_interface "obsilo" is reserved for the plugin itself');
    }
    const title = typeof args.title === 'string' && args.title.trim()
        ? args.title.trim().slice(0, 200)
        : `${sourceInterface} conversation`;

    const store = plugin.conversationStore;
    if (!store) {
        return errorResult('ConversationStore is not available');
    }

    // Resolve sync-mode per provider. Manual-mode parks the conversation
    // in `pending`; auto-mode marks it confirmed and lets the
    // ExtractionQueue pick it up.
    const crossSurface = plugin.settings.memory?.crossSurface ?? DEFAULT_CROSS_SURFACE_SETTINGS;
    const syncMode = resolveSyncMode(sourceInterface, crossSurface);
    const syncState = syncMode === 'auto' ? 'confirmed' : 'pending';

    try {
        const id = await store.create('mcp', sourceInterface, { sourceInterface, syncState });
        await store.updateMeta(id, { title });

        // Persist messages: api MessageParam[] for replay, UiMessage[] for sidebar render.
        const apiMessages: MessageParam[] = messages.map((m) => ({
            role: m.role,
            content: m.text,
        }));
        const uiMessages = messages.map((m) => ({
            role: m.role,
            text: m.text,
            ts: m.ts ?? new Date().toISOString(),
        }));
        await store.save(id, apiMessages, uiMessages);

        // Index into HistoryDB for search_history coverage. Best-effort.
        try {
            await plugin.historyIndexer?.onConversationSaved?.(id, uiMessages);
        } catch (e) {
            console.debug('[save_conversation] HistoryIndexer notify failed:', e);
        }

        // Auto-mode: enqueue for memory extraction with shared thresholds.
        if (syncMode === 'auto' && plugin.extractionQueue) {
            try {
                await plugin.extractionQueue.enqueue({
                    conversationId: id,
                    messages: messages.map((m) => ({ role: m.role, text: m.text })),
                    title,
                    queuedAt: new Date().toISOString(),
                });
            } catch (e) {
                console.debug('[save_conversation] enqueue failed:', e);
            }
        }

        const stateMsg = syncMode === 'auto'
            ? 'confirmed (auto-sync)'
            : 'pending (manual-sync; star or mark_for_memory to confirm)';
        return {
            content: [{
                type: 'text',
                text: `Conversation ${id} saved (${messages.length} messages, source: ${sourceInterface}, ${stateMsg}).`,
            }],
        };
    } catch (e) {
        return errorResult(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
}

function errorResult(text: string): McpToolResult {
    return { content: [{ type: 'text', text: 'Error: ' + text }], isError: true };
}

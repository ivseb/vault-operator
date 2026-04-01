/**
 * sync_session -- Save the full conversation transcript to Obsilo's shared history.
 * Claude MUST call this at the end of every conversation that uses Obsilo tools.
 * The transcript appears in Obsilo's chat history sidebar.
 */

import type ObsidianAgentPlugin from '../../main';
import type { McpToolResult } from '../types';
import { getAutoSessionId } from './index';

interface TranscriptMessage {
    role: 'user' | 'assistant' | 'tool';
    text: string;
}

export async function handleSyncSession(
    plugin: ObsidianAgentPlugin,
    args: Record<string, unknown>,
): Promise<McpToolResult> {
    const rawTitle = String(args.title ?? 'MCP Session');
    const title = rawTitle.startsWith('Claude:') ? rawTitle : `Claude: ${rawTitle}`;
    const transcript = (args.transcript as TranscriptMessage[]) ?? [];
    const learnings = String(args.learnings ?? '');
    const toolsUsed = (args.tools_used as string[]) ?? [];

    if (transcript.length === 0) {
        return { content: [{ type: 'text', text: 'Error: transcript is required (array of {role, text})' }], isError: true };
    }

    const sessionId = getAutoSessionId() ?? `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const results: string[] = [];

    // Save transcript to conversation store (shared history)
    // Loads existing messages and APPENDS new ones (conversation continues across multiple sync calls)
    if (plugin.conversationStore) {
        try {
            // Load existing conversation data (may have messages from earlier sync calls)
            const existing = await plugin.conversationStore.load(sessionId);
            const existingMessages = existing?.messages ?? [];
            const existingUiMessages = existing?.uiMessages ?? [];

            // Build new messages from transcript
            const newMessages: Array<{ role: 'user' | 'assistant'; content: Array<{ type: 'text'; text: string }> }> = [];
            const newUiMessages: Array<{ role: 'user' | 'assistant'; text: string; ts: string }> = [];

            for (const m of transcript) {
                const role = (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant';
                const text = m.role === 'tool' ? `[Tool] ${m.text}` : m.text;
                newMessages.push({ role, content: [{ type: 'text', text }] });
                newUiMessages.push({ role, text, ts: now });
            }

            // Deduplicate: skip messages that already exist (compare by text + role)
            const existingTexts = new Set(existingUiMessages.map(m => `${m.role}:${m.text}`));
            const filteredMessages: typeof newMessages = [];
            const filteredUiMessages: typeof newUiMessages = [];
            for (let i = 0; i < newMessages.length; i++) {
                const key = `${newUiMessages[i].role}:${newUiMessages[i].text}`;
                if (!existingTexts.has(key)) {
                    filteredMessages.push(newMessages[i]);
                    filteredUiMessages.push(newUiMessages[i]);
                }
            }

            // Append new messages to existing
            const allMessages = [...existingMessages, ...filteredMessages];
            const allUiMessages = [...existingUiMessages, ...filteredUiMessages];

            await plugin.conversationStore.save(sessionId, allMessages, allUiMessages);
            await plugin.conversationStore.updateMeta(sessionId, { title });
            results.push(`Conversation updated: "${title}" (${allUiMessages.length} messages total, ${filteredUiMessages.length} new)`);
        } catch (e) {
            results.push(`History save failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    // Save session summary to memory
    if (plugin.memoryService) {
        try {
            const summary = transcript
                .filter(m => m.role === 'assistant')
                .map(m => m.text.slice(0, 200))
                .join(' | ')
                .slice(0, 500);

            const sessionContent = [
                '---',
                `conversation: ${sessionId}`,
                `title: ${title}`,
                `date: ${new Date().toISOString()}`,
                `source: mcp`,
                '---',
                '',
                `## Summary`,
                summary,
                learnings ? `\n## Learnings\n${learnings}` : '',
            ].filter(Boolean).join('\n');

            await plugin.memoryService.writeSessionSummary(sessionId, sessionContent, title, 'mcp');
            results.push('Session summary saved to memory');

            // Index for semantic search
            if (plugin.semanticIndex?.isIndexed) {
                await plugin.semanticIndex.indexSessionSummary(sessionId, sessionContent);
                results.push('Session indexed for search');
            }
        } catch (e) {
            results.push(`Memory save failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    // Record episode for recipe promotion
    if (plugin.episodicExtractor && toolsUsed.length >= 2) {
        try {
            const episode = await plugin.episodicExtractor.recordEpisode({
                userMessage: title,
                mode: 'mcp',
                toolSequence: toolsUsed,
                toolLedger: `MCP session: ${toolsUsed.join(' -> ')}`,
                success: true,
                resultSummary: title,
            });
            if (episode && plugin.recipePromotionService) {
                void plugin.recipePromotionService.checkForPromotion(episode);
            }
        } catch { /* non-fatal */ }
    }

    return { content: [{ type: 'text', text: results.join('\n') }] };
}

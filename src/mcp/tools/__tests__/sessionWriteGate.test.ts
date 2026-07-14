/**
 * AUDIT 2026-07-14 (Codex) H-2 / FIX-44-57: persistent session tools carried the
 * ungated `session` effect but wrote to long-term memory, the semantic index and
 * recipe learning via auto-extraction. With `mcpAllowWriteTools=false` (default),
 * those write side effects must be suppressed while the history bookkeeping still
 * runs.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleSaveConversation } from '../saveConversation';
import { handleSyncSession } from '../syncSession';
import { ActiveMcpSessions } from '../../../core/memory/ActiveMcpSessions';
import { DEFAULT_CROSS_SURFACE_SETTINGS } from '../../../core/memory/SourceInterface';
import type ObsidianAgentPlugin from '../../../main';

function makePlugin(allowWrite: boolean) {
    const enqueue = vi.fn(async () => { /* noop */ });
    const writeSessionSummary = vi.fn(async () => { /* noop */ });
    const indexSessionSummary = vi.fn(async () => { /* noop */ });
    const recordEpisode = vi.fn(async () => null);
    const store = {
        create: vi.fn(async () => 'conv-1'),
        updateMeta: vi.fn(async () => { /* noop */ }),
        save: vi.fn(async () => { /* noop */ }),
        load: vi.fn(async () => null),
        appendMessages: vi.fn(async () => 1),
    };
    const plugin = {
        conversationStore: store,
        activeMcpSessions: new ActiveMcpSessions(),
        extractionQueue: { enqueue, enqueueImmediate: vi.fn() },
        historyIndexer: { onConversationSaved: vi.fn(async () => { /* noop */ }) },
        memoryService: { writeSessionSummary },
        semanticIndex: { isIndexed: true, indexSessionSummary },
        episodicExtractor: { recordEpisode },
        recipePromotionService: { checkForPromotion: vi.fn() },
        settings: {
            mcpServerToken: 'tok',
            mcpAllowWriteTools: allowWrite,
            memory: {
                crossSurface: {
                    ...DEFAULT_CROSS_SURFACE_SETTINGS,
                    defaultSyncMode: 'auto',
                    perProvider: { 'claude-ai': 'global' },
                },
            },
        },
    } as unknown as ObsidianAgentPlugin;
    return { plugin, enqueue, writeSessionSummary, indexSessionSummary, recordEpisode };
}

describe('save_conversation write gate (H-2)', () => {
    it('does NOT enqueue memory extraction when mcpAllowWriteTools=false', async () => {
        const { plugin, enqueue } = makePlugin(false);
        const res = await handleSaveConversation(plugin, {
            source_interface: 'claude-ai',
            messages: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'yo' }],
        });
        expect(res.isError).toBeUndefined();
        expect(enqueue).not.toHaveBeenCalled();
        // History bookkeeping still ran.
        expect((plugin.conversationStore as unknown as { create: ReturnType<typeof vi.fn> }).create).toHaveBeenCalled();
    });

    it('enqueues memory extraction when mcpAllowWriteTools=true', async () => {
        const { plugin, enqueue } = makePlugin(true);
        await handleSaveConversation(plugin, {
            source_interface: 'claude-ai',
            messages: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'yo' }],
        });
        expect(enqueue).toHaveBeenCalledTimes(1);
    });
});

describe('sync_session write gate (H-2)', () => {
    const transcript = [
        { role: 'user', text: 'do a thing' },
        { role: 'assistant', text: 'done the thing' },
    ];

    it('does NOT write memory summary / index / episode when gate is off', async () => {
        const { plugin, writeSessionSummary, indexSessionSummary, recordEpisode } = makePlugin(false);
        const res = await handleSyncSession(plugin, {
            title: 'T', transcript, tools_used: ['a', 'b'],
        });
        expect(res.isError).toBeUndefined();
        expect(writeSessionSummary).not.toHaveBeenCalled();
        expect(indexSessionSummary).not.toHaveBeenCalled();
        expect(recordEpisode).not.toHaveBeenCalled();
    });

    it('writes memory summary / index / episode when gate is on', async () => {
        const { plugin, writeSessionSummary, indexSessionSummary, recordEpisode } = makePlugin(true);
        await handleSyncSession(plugin, {
            title: 'T', transcript, tools_used: ['a', 'b'],
        });
        expect(writeSessionSummary).toHaveBeenCalledTimes(1);
        expect(indexSessionSummary).toHaveBeenCalledTimes(1);
        expect(recordEpisode).toHaveBeenCalledTimes(1);
    });
});

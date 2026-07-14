/**
 * AUDIT 2026-07-14 (Codex) H-1 + review: an external MCP client must not be able
 * to CLAIM source_interface='obsilo' (the plugin-internal trust anchor) to read
 * personal memory via get_context, nor to tag a written conversation into the
 * obsilo history partition via sync_session. Handler-level regression tests, so
 * a revert to validateSourceInterface in any handler fails CI.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetContext } from '../getContext';
import { handleSyncSession } from '../syncSession';
import type ObsidianAgentPlugin from '../../../main';

describe('get_context obsilo spoof (H-1 read)', () => {
    function makePlugin(strict: boolean) {
        return {
            settings: { memory: { crossSurface: { strictSourceIsolation: strict } } },
            memoryService: {
                loadMemoryFiles: vi.fn(async () => ({})),
                buildMemoryContext: vi.fn(() => 'SECRET personal memory: user profile, soul'),
            },
            toolRegistry: { getAllTools: () => [] },
            app: { vault: { getMarkdownFiles: () => [], getAllFolders: () => [] } },
            graphStore: undefined,
            semanticIndex: undefined,
            implicitConnectionService: undefined,
            skillsManager: undefined,
            rulesLoader: undefined,
        } as unknown as ObsidianAgentPlugin;
    }

    it('omits memory for a spoofed obsilo caller when strict isolation is ON', async () => {
        const plugin = makePlugin(true);
        const res = await handleGetContext(plugin, { source_interface: 'obsilo' });
        const text = res.content.map(c => c.text).join('\n');
        expect(text).not.toContain('SECRET personal memory');
        expect(text).toContain('omitted');
    });

    it('still exposes memory to obsilo spoof when strict isolation is OFF (default, unchanged)', async () => {
        const plugin = makePlugin(false);
        const res = await handleGetContext(plugin, { source_interface: 'obsilo' });
        const text = res.content.map(c => c.text).join('\n');
        expect(text).toContain('SECRET personal memory');
    });
});

describe('sync_session obsilo spoof (H-1 write)', () => {
    it('coerces a client-supplied obsilo tag to unknown', async () => {
        const updateMeta = vi.fn(async (_id: string, _patch: Record<string, unknown>) => { /* noop */ });
        const plugin = {
            conversationStore: {
                load: vi.fn(async () => null),
                save: vi.fn(async () => { /* noop */ }),
                updateMeta,
            },
            settings: { mcpAllowWriteTools: false },
        } as unknown as ObsidianAgentPlugin;

        await handleSyncSession(plugin, {
            title: 'X',
            source_interface: 'obsilo',
            transcript: [{ role: 'assistant', text: 'hi' }],
        });

        expect(updateMeta).toHaveBeenCalled();
        const meta = updateMeta.mock.calls[0][1] as { sourceInterface?: string };
        expect(meta.sourceInterface).toBe('unknown');
    });
});

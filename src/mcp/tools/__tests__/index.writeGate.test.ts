/**
 * FIX-44-47 / FIX-44-48: the dispatcher write gate is derived from the
 * effect declarations (fail-closed) and its wire-facing error names the
 * exact settings path, so an external client can tell the user where to
 * flip the switch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../saveToMemory', () => ({
    handleSaveToMemory: vi.fn(() => Promise.resolve({
        content: [{ type: 'text' as const, text: 'FACT_SAVED' }],
        isError: false,
    })),
}));

vi.mock('../readNotes', () => ({
    handleReadNotes: vi.fn(() => Promise.resolve({
        content: [{ type: 'text' as const, text: 'NOTE_BODY' }],
        isError: false,
    })),
}));

import { handleToolCall } from '../index';
import { handleSaveToMemory } from '../saveToMemory';
import { handleReadNotes } from '../readNotes';
import type ObsidianAgentPlugin from '../../../main';

function makePlugin(allowWrite: boolean): ObsidianAgentPlugin {
    return {
        operationLogger: undefined,
        conversationStore: undefined,
        mcpRateLimiter: undefined,
        settings: { mcpServerToken: '', mcpAllowWriteTools: allowWrite },
        app: { vault: { getMarkdownFiles: () => [] } },
    } as unknown as ObsidianAgentPlugin;
}

describe('handleToolCall: derived write gate (FIX-44-47)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('blocks a write-class tool when the toggle is off, naming the exact settings path', async () => {
        const res = await handleToolCall(makePlugin(false), 'save_to_memory', { content: 'x' });
        expect(res.isError).toBe(true);
        const text = res.content.map((c) => c.text).join('\n');
        expect(text).toContain('Allow write tools over MCP');
        expect(text).toContain('Settings > Vault Operator > Customize > Connectors');
        expect(handleSaveToMemory).not.toHaveBeenCalled();
    });

    it('dispatches a write-class tool when the toggle is on', async () => {
        const res = await handleToolCall(makePlugin(true), 'save_to_memory', { content: 'x' });
        const text = res.content.map((c) => c.text).join('\n');
        expect(text).toContain('FACT_SAVED');
        expect(handleSaveToMemory).toHaveBeenCalledTimes(1);
    });

    it('read-class tools stay ungated regardless of the toggle', async () => {
        const res = await handleToolCall(makePlugin(false), 'read_notes', { paths: ['a.md'] });
        const text = res.content.map((c) => c.text).join('\n');
        expect(text).toContain('NOTE_BODY');
        expect(handleReadNotes).toHaveBeenCalledTimes(1);
    });
});

/**
 * FIX-44-53: a failed frontmatter write must not report unconditional success.
 *
 * Both memory-source tools caught every frontmatter-write failure and then
 * pushed the same success line as if the previewed diff had landed. For unmark
 * that is worse than a lie about cosmetics: the marker stays in the note, so
 * the FrontmatterIndexer re-registers it on its next pass
 * (fromFrontmatter=true, not registered -> upsert) and the unmark the user
 * just approved is silently undone.
 */

import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { MarkNoteAsMemorySourceTool } from '../MarkNoteAsMemorySourceTool';
import { UnmarkNoteAsMemorySourceTool } from '../UnmarkNoteAsMemorySourceTool';
import type { ToolCallbacks, ToolExecutionContext } from '../../types';
import type ObsidianAgentPlugin from '../../../../main';

const UNMARKED = '---\ntitle: T\n---\n\nbody\n';
const MARKED = '---\ntitle: T\nmemory-source: true\n---\n\nbody\n';

function makePlugin(initial: string, modifyFails: boolean) {
    const file = Object.assign(new TFile(), { path: 'Notes/N.md', extension: 'md' });
    const plugin = {
        app: {
            vault: {
                getAbstractFileByPath: () => file,
                read: () => Promise.resolve(initial),
                modify: () => (modifyFails
                    ? Promise.reject(new Error('disk full'))
                    : Promise.resolve()),
            },
            workspace: { getLeavesOfType: () => [] },
        },
        memorySourceStore: {
            upsert: vi.fn(),
            remove: vi.fn(() => true),
        },
        frontmatterIndexer: { indexNote: vi.fn(() => Promise.resolve()) },
    } as unknown as ObsidianAgentPlugin;
    return plugin;
}

function makeCtx(): { context: ToolExecutionContext; results: string[] } {
    const results: string[] = [];
    const callbacks: ToolCallbacks = {
        pushToolResult(c) { results.push(typeof c === 'string' ? c : JSON.stringify(c)); },
        handleError() { /* no-op */ },
        log() { /* no-op */ },
    };
    return { context: { taskId: 't', mode: 'agent', callbacks }, results };
}

describe('FIX-44-53: unmark degrades honestly when the frontmatter clear fails', () => {
    it('reports the failure instead of "no longer marked"', async () => {
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => { /* silence */ });
        const tool = new UnmarkNoteAsMemorySourceTool(makePlugin(MARKED, true));
        const { context, results } = makeCtx();

        await tool.execute({ note_path: 'Notes/N.md' }, context);

        expect(results).toHaveLength(1);
        expect(results[0]).toContain('<error>');
        expect(results[0]).toContain('disk full');
        // The DB half DID succeed; the agent must learn that too.
        expect(results[0]).toMatch(/removed/i);
        // The marker is still in the note -- warn about the re-registration loop.
        expect(results[0]).toMatch(/re-register/i);
        expect(results[0]).not.toContain('no longer marked as memory-source');
        consoleWarn.mockRestore();
    });

    it('still reports plain success when the write lands', async () => {
        const tool = new UnmarkNoteAsMemorySourceTool(makePlugin(MARKED, false));
        const { context, results } = makeCtx();
        await tool.execute({ note_path: 'Notes/N.md' }, context);
        expect(results[0]).toContain('no longer marked as memory-source');
    });
});

describe('FIX-44-53: mark degrades honestly when the frontmatter write fails', () => {
    it('reports the failure instead of the previewed-diff success line', async () => {
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => { /* silence */ });
        const plugin = makePlugin(UNMARKED, true);
        const tool = new MarkNoteAsMemorySourceTool(plugin);
        const { context, results } = makeCtx();

        await tool.execute({ note_path: 'Notes/N.md' }, context);

        expect(results).toHaveLength(1);
        expect(results[0]).toContain('<error>');
        expect(results[0]).toContain('disk full');
        // The registration itself succeeded and extraction will run.
        expect(results[0]).toMatch(/registered/i);
        expect(results[0]).not.toContain('marked as memory-source. Extraction will run');
        consoleWarn.mockRestore();
    });
});

/**
 * FIX-44-13a: mark/unmark_note_as_memory_source are approved on their diff.
 *
 * Both tools write frontmatter (`memory-source: true` in / out) but showed only
 * a name card at the approval gate. They now carry previewEdit through the same
 * one-resolver pattern as UpdateFrontmatterTool: `resolveFrontmatterUpdate`
 * computes the content ONCE, previewEdit shows it, execute writes it. The old
 * write path (`fileManager.processFrontMatter`) reads/mutates/writes atomically
 * and therefore cannot say what it is ABOUT to write -- keeping it would make
 * the diff come from one code path and the write from another.
 *
 * ingest_triage is deliberately NOT here: despite the review's claim it
 * performs no frontmatter write at all -- its persistent effect is a
 * triage-log DB row (IngestTriageLogStore), for which a file diff does not
 * exist. It stays on the plain approval card.
 */

import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { MarkNoteAsMemorySourceTool } from '../MarkNoteAsMemorySourceTool';
import { UnmarkNoteAsMemorySourceTool } from '../UnmarkNoteAsMemorySourceTool';
import type { ToolCallbacks, ToolExecutionContext } from '../../types';
import type ObsidianAgentPlugin from '../../../../main';

const WITH_FM = '---\ntitle: T\n---\n\nbody\n';
const MARKED = '---\ntitle: T\nmemory-source: true\n---\n\nbody\n';
const NO_FM = '# Heading\n\nbody\n';

function makePlugin(initial: string) {
    const file = Object.assign(new TFile(), { path: 'Notes/N.md', extension: 'md' });
    const written: string[] = [];
    const processFrontMatter = vi.fn(() => Promise.resolve());
    const plugin = {
        app: {
            vault: {
                getAbstractFileByPath: () => file,
                read: () => Promise.resolve(initial),
                modify: (_f: TFile, c: string) => { written.push(c); return Promise.resolve(); },
            },
            workspace: { getLeavesOfType: () => [] },
            fileManager: { processFrontMatter },
        },
        memorySourceStore: {
            upsert: vi.fn(),
            remove: vi.fn(() => true),
        },
        frontmatterIndexer: { indexNote: vi.fn(() => Promise.resolve()) },
    } as unknown as ObsidianAgentPlugin;
    return { plugin, written, processFrontMatter };
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

describe('FIX-44-13a: mark_note_as_memory_source previews its frontmatter write', () => {
    it('shows the real before/after diff for the marker', async () => {
        const { plugin } = makePlugin(WITH_FM);
        const preview = await new MarkNoteAsMemorySourceTool(plugin).previewEdit({ note_path: 'Notes/N.md' });

        expect(preview).not.toBeNull();
        expect(preview!.path).toBe('Notes/N.md');
        expect(preview!.before).toBe(WITH_FM);
        expect(preview!.after).toContain('memory-source: true');
        expect(preview!.after).toContain('title: T');
        expect(preview!.after).toContain('body');
    });

    it('preview matches what execute writes (one resolver, no drift)', async () => {
        const preview = await new MarkNoteAsMemorySourceTool(makePlugin(WITH_FM).plugin)
            .previewEdit({ note_path: 'Notes/N.md' });

        const { plugin, written, processFrontMatter } = makePlugin(WITH_FM);
        const { context } = makeCtx();
        await new MarkNoteAsMemorySourceTool(plugin).execute({ note_path: 'Notes/N.md' }, context);

        expect(written).toHaveLength(1);
        expect(written[0]).toBe(preview!.after);
        // The un-previewable write path must be gone.
        expect(processFrontMatter).not.toHaveBeenCalled();
    });

    it('creates the frontmatter block when the note has none', async () => {
        const { plugin } = makePlugin(NO_FM);
        const preview = await new MarkNoteAsMemorySourceTool(plugin).previewEdit({ note_path: 'Notes/N.md' });
        expect(preview!.after.startsWith('---\n')).toBe(true);
        expect(preview!.after).toContain('memory-source: true');
        expect(preview!.after).toContain('# Heading');
    });

    it('returns null with write_frontmatter=false (nothing to diff, plain card)', async () => {
        const { plugin } = makePlugin(WITH_FM);
        const preview = await new MarkNoteAsMemorySourceTool(plugin)
            .previewEdit({ note_path: 'Notes/N.md', write_frontmatter: false });
        expect(preview).toBeNull();
    });

    it('previewEdit never writes and never touches the store', async () => {
        const { plugin, written } = makePlugin(WITH_FM);
        await new MarkNoteAsMemorySourceTool(plugin).previewEdit({ note_path: 'Notes/N.md' });
        expect(written).toHaveLength(0);
        expect((plugin as unknown as { memorySourceStore: { upsert: ReturnType<typeof vi.fn> } })
            .memorySourceStore.upsert).not.toHaveBeenCalled();
    });

    it('skips the write when the marker is already there (idempotent)', async () => {
        const { plugin, written } = makePlugin(MARKED);
        const { context } = makeCtx();
        await new MarkNoteAsMemorySourceTool(plugin).execute({ note_path: 'Notes/N.md' }, context);
        expect(written).toHaveLength(0);   // marker set, nothing to rewrite
    });
});

describe('FIX-44-13a: unmark_note_as_memory_source previews the marker removal', () => {
    it('shows the marker leaving the frontmatter', async () => {
        const { plugin } = makePlugin(MARKED);
        const preview = await new UnmarkNoteAsMemorySourceTool(plugin).previewEdit({ note_path: 'Notes/N.md' });

        expect(preview).not.toBeNull();
        expect(preview!.before).toBe(MARKED);
        expect(preview!.after).not.toContain('memory-source');
        expect(preview!.after).toContain('title: T');
        expect(preview!.after).toContain('body');
    });

    it('preview matches what execute writes', async () => {
        const preview = await new UnmarkNoteAsMemorySourceTool(makePlugin(MARKED).plugin)
            .previewEdit({ note_path: 'Notes/N.md' });

        const { plugin, written, processFrontMatter } = makePlugin(MARKED);
        const { context } = makeCtx();
        await new UnmarkNoteAsMemorySourceTool(plugin).execute({ note_path: 'Notes/N.md' }, context);

        expect(written).toHaveLength(1);
        expect(written[0]).toBe(preview!.after);
        expect(processFrontMatter).not.toHaveBeenCalled();
    });

    it('returns null and does not write when the note never carried the marker', async () => {
        // Without this gate the resolver would ADD an empty frontmatter block
        // to a note that has none -- an unmark must never mutate such a note.
        const { plugin, written } = makePlugin(NO_FM);
        const preview = await new UnmarkNoteAsMemorySourceTool(plugin).previewEdit({ note_path: 'Notes/N.md' });
        expect(preview).toBeNull();

        const { context } = makeCtx();
        await new UnmarkNoteAsMemorySourceTool(plugin).execute({ note_path: 'Notes/N.md' }, context);
        expect(written).toHaveLength(0);
    });

    it('returns null with clear_frontmatter=false', async () => {
        const { plugin } = makePlugin(MARKED);
        const preview = await new UnmarkNoteAsMemorySourceTool(plugin)
            .previewEdit({ note_path: 'Notes/N.md', clear_frontmatter: false });
        expect(preview).toBeNull();
    });

    it('previewEdit never writes', async () => {
        const { plugin, written } = makePlugin(MARKED);
        await new UnmarkNoteAsMemorySourceTool(plugin).previewEdit({ note_path: 'Notes/N.md' });
        expect(written).toHaveLength(0);
    });
});

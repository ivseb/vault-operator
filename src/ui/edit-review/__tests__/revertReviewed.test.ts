/**
 * FIX-44-16: "Discard" in the post-task review must actually undo the changes.
 *
 * Live incident 2026-07-13. The agent wrote the frontmatter and the summary, the
 * review opened afterwards, the user rejected everything -- and nothing was
 * undone. The code read:
 *
 *     if (result.decisions === null) return;      // <- that is the entire discard
 *
 * `applyReviewDecisions` only ever WRITES; there was no path that took anything
 * back. Discard meant "do not apply my manual edits", so the agent's version
 * simply stayed on disk. The user pressed the button that says the changes go
 * away, and the changes did not go away.
 *
 * The pre-write gate (FEAT-44-10) fixes this for the normal case -- reject there
 * and nothing is ever written. But whenever auto-approval is on, the write is not
 * gated and this review is the only surface left. A button labelled "discard"
 * that discards nothing is the same lie in a different place.
 *
 * The before-state is already in hand (it comes from the task's earliest
 * checkpoint), so a real undo is simply: write it back.
 */

import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { revertReviewedFiles } from '../postTaskReviewIO';

function makeApp(files: Record<string, string>) {
    const written = new Map<string, string>();
    const trashed: string[] = [];
    const handles = new Map<string, TFile>();
    for (const p of Object.keys(files)) {
        handles.set(p, Object.assign(new TFile(), { path: p, extension: 'md' }));
    }
    const app = {
        vault: {
            getFileByPath: (p: string) => handles.get(p) ?? null,
            getAbstractFileByPath: (p: string) => handles.get(p) ?? null,
            read: (f: TFile) => Promise.resolve(files[f.path] ?? ''),
            modify: (f: TFile, c: string) => { written.set(f.path, c); return Promise.resolve(); },
            adapter: {
                exists: (p: string) => Promise.resolve(p in files),
                read: (p: string) => Promise.resolve(files[p] ?? ''),
                write: (p: string, c: string) => { written.set(p, c); return Promise.resolve(); },
            },
            createFolder: () => Promise.resolve(),
        },
        fileManager: {
            trashFile: (f: { path: string }) => { trashed.push(f.path); return Promise.resolve(); },
        },
        workspace: { getLeavesOfType: () => [] },
    };
    return { app: app as never, written, trashed };
}

const BEFORE = '---\ntitle: Alt\n---\n\nAlter Text.\n';
const AFTER = '---\ntitle: Neu\n---\n\nNeuer Text vom Agenten.\n';

describe('FIX-44-16: discarding a post-task review really undoes the changes', () => {
    it('writes the pre-task content back to the file', async () => {
        const { app, written } = makeApp({ 'Notes/a.md': AFTER });

        const outcome = await revertReviewedFiles(app, [
            { path: 'Notes/a.md', before: BEFORE, after: AFTER },
        ]);

        expect(written.get('Notes/a.md')).toBe(BEFORE);
        expect(outcome.reverted).toEqual(['Notes/a.md']);
    });

    it('trashes a file the agent newly created -- its "before" is nothing', async () => {
        const { app, trashed, written } = makeApp({ 'Notes/neu.md': AFTER });

        const outcome = await revertReviewedFiles(app, [
            { path: 'Notes/neu.md', before: '', after: AFTER, isNew: true },
        ]);

        // Undoing a creation means removing it, not writing an empty file.
        expect(trashed).toEqual(['Notes/neu.md']);
        expect(written.size).toBe(0);
        expect(outcome.reverted).toEqual(['Notes/neu.md']);
    });

    it('leaves a file alone when it already matches its pre-task state', async () => {
        const { app, written } = makeApp({ 'Notes/a.md': BEFORE });

        const outcome = await revertReviewedFiles(app, [
            { path: 'Notes/a.md', before: BEFORE, after: BEFORE },
        ]);

        expect(written.size).toBe(0);
        expect(outcome.reverted).toEqual([]);
    });

    it('refuses a traversal path at the sink instead of writing outside the vault', async () => {
        const { app, written } = makeApp({});

        const outcome = await revertReviewedFiles(app, [
            { path: '../../etc/passwd', before: 'x', after: 'y' },
        ]);

        expect(written.size).toBe(0);
        expect(outcome.failed).toEqual(['../../etc/passwd']);
    });

    it('FIX-44-40: reverts a file that was EMPTY before the task', async () => {
        const { app, written } = makeApp({ 'Notes/leer.md': AFTER });

        const outcome = await revertReviewedFiles(app, [
            { path: 'Notes/leer.md', before: '', after: AFTER },
        ]);

        // The P0 empty-overwrite guard protects forward writes; the revert
        // target is the genuine pre-task snapshot and must win here.
        expect(written.get('Notes/leer.md')).toBe('');
        expect(outcome.reverted).toEqual(['Notes/leer.md']);
        expect(outcome.failed).toEqual([]);
    });

    it('FIX-44-40: reverts to a pre-task state whose frontmatter was already broken', async () => {
        const broken = '---\ntitle: Alt\n\nBody war schon vor dem Task im YAML\n';
        const { app, written } = makeApp({ 'Notes/kaputt.md': AFTER });

        const outcome = await revertReviewedFiles(app, [
            { path: 'Notes/kaputt.md', before: broken, after: AFTER },
        ]);

        expect(written.get('Notes/kaputt.md')).toBe(broken);
        expect(outcome.reverted).toEqual(['Notes/kaputt.md']);
        expect(outcome.failed).toEqual([]);
    });

    it('reverts what it can and reports what it could not', async () => {
        const { app, written } = makeApp({ 'Notes/a.md': AFTER });

        const outcome = await revertReviewedFiles(app, [
            { path: 'Notes/a.md', before: BEFORE, after: AFTER },
            { path: '../evil.md', before: 'x', after: 'y' },
        ]);

        expect(written.get('Notes/a.md')).toBe(BEFORE);
        expect(outcome.reverted).toEqual(['Notes/a.md']);
        expect(outcome.failed).toEqual(['../evil.md']);
    });
});

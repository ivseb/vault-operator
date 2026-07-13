/**
 * FIX-44-19: a hand-edited write must reach the open editor, not just the disk.
 *
 * Live incident 2026-07-13. The user rewrote the agent's proposal in the approval
 * gate, pressed Apply, and their edit did not appear in the note -- it only showed
 * up later, after an unrelated tool write refreshed the view. It looked like the
 * edit had been thrown away.
 *
 * It had not. It was on disk. `safeNoteWrite` resolved the file with
 * `getFileByPath`, and when that returned nothing it fell through to the raw
 * adapter -- which writes the file but never pushes into the open CodeMirror
 * buffer. Disk correct, editor stale, user staring at their vanished edit.
 *
 * Every write tool resolves the file with getAbstractFileByPath + instanceof
 * TFile. This one now does too, and it refreshes on BOTH write paths.
 */

import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';

const refreshSpy = vi.fn();
vi.mock('../refreshMarkdownView', () => ({
    refreshOpenMarkdownViewsFor: (...args: unknown[]) => {
        refreshSpy(...args);
        return Promise.resolve(1);
    },
}));

const NOTE = '---\ntitle: Alt\n---\n\nAlter Text.\n';
const EDITED = '---\ntitle: Von Hand\n---\n\nVon Hand geschrieben.\n';

function makeApp(opts: { indexed: boolean }) {
    const file = Object.assign(new TFile(), { path: 'Notes/a.md', extension: 'md' });
    const modified: string[] = [];
    const adapterWritten: string[] = [];

    const app = {
        vault: {
            getAbstractFileByPath: () => (opts.indexed ? file : null),
            // The old lookup. Deliberately broken here to prove we no longer rely
            // on it: if the code still used it, the write would take the adapter
            // path and skip the refresh.
            getFileByPath: () => null,
            read: () => Promise.resolve(NOTE),
            modify: (_f: unknown, c: string) => { modified.push(c); return Promise.resolve(); },
            createFolder: () => Promise.resolve(),
            adapter: {
                exists: () => Promise.resolve(opts.indexed),
                read: () => Promise.resolve(NOTE),
                write: (_p: string, c: string) => { adapterWritten.push(c); return Promise.resolve(); },
            },
        },
    };
    return { app: app as never, modified, adapterWritten, file };
}

describe('FIX-44-19: the user edit reaches the open editor', () => {
    it('writes through the vault API and refreshes the open view', async () => {
        refreshSpy.mockClear();
        const { safeNoteWrite } = await import('../safeNoteWrite');
        const { app, modified, adapterWritten } = makeApp({ indexed: true });

        const out = await safeNoteWrite(app, 'Notes/a.md', EDITED);

        expect(out.ok).toBe(true);
        // Vault API, not the raw adapter...
        expect(modified).toEqual([EDITED]);
        expect(adapterWritten).toHaveLength(0);
        // ...and the open editor is told about it. This is the whole bug.
        expect(refreshSpy).toHaveBeenCalledTimes(1);
        expect(refreshSpy.mock.calls[0][2]).toBe(EDITED);
    });

    it('still refuses to break the frontmatter, even for a user edit', async () => {
        const { safeNoteWrite } = await import('../safeNoteWrite');
        const { app, modified } = makeApp({ indexed: true });

        // Closing fence eaten: the exact shape of the incident that started this.
        const broken = '---\ntitle: Alt\n\n# Body im YAML\n\nProsa ohne Doppelpunkt hier\n---\n\nRest\n';
        const out = await safeNoteWrite(app, 'Notes/a.md', broken);

        expect(out.ok).toBe(false);
        expect(modified).toHaveLength(0);
    });

    it('still refuses to empty a non-empty note', async () => {
        const { safeNoteWrite } = await import('../safeNoteWrite');
        const { app, modified } = makeApp({ indexed: true });

        const out = await safeNoteWrite(app, 'Notes/a.md', '   \n');

        expect(out.ok).toBe(false);
        expect(modified).toHaveLength(0);
    });
});

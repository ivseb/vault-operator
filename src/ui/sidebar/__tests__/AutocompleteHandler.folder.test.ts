/**
 * FEAT-02-11: folder rows in the @ autocomplete. RED-first: the ordner-callback
 * is not wired yet; the implementation makes these tests GREEN.
 */

import { describe, it, expect, vi } from 'vitest';
import { TFile, TFolder } from 'obsidian';
import { AutocompleteHandler } from '../AutocompleteHandler';
import type ObsidianAgentPlugin from '../../../main';
import type { App } from 'obsidian';

interface FakeFile { path: string; name: string; basename: string; extension: string; }
interface FakeFolder { path: string; name: string; children: unknown[]; }

function file(path: string): TFile {
    const parts = path.split('/');
    const name = parts[parts.length - 1];
    const dot = name.lastIndexOf('.');
    const basename = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot + 1) : '';
    const f: FakeFile = { path, name, basename, extension };
    return Object.assign(new TFile(), f) as unknown as TFile;
}
function folder(path: string, children: Array<TFile | TFolder> = []): TFolder {
    const parts = path.split('/');
    const name = parts[parts.length - 1] || path;
    const f: FakeFolder = { path, name, children };
    return Object.assign(new TFolder(), f) as unknown as TFolder;
}

interface Harness {
    handler: AutocompleteHandler;
    textarea: { value: string; selectionStart: number };
    fileCalls: TFile[];
    folderCalls: Array<{ folder: TFolder; opts: { recursive: boolean } }>;
    setInput(v: string): void;
}

function makeHarness(opts: {
    files?: TFile[];
    folders?: TFolder[];
    activeFile?: TFile | null;
}): Harness {
    const files = opts.files ?? [];
    const folders = opts.folders ?? [];
    const activeFile = opts.activeFile ?? null;

    const textarea = { value: '', selectionStart: 0 };
    // AutocompleteHandler mutates textarea.value + calls setSelectionRange/focus.
    // We stub those as no-ops so the handler can complete an onSelect() call
    // without crashing on a plain-object textarea.
    const textareaEl = Object.assign(textarea, {
        setSelectionRange(_a: number, _b: number): void { /* no-op */ },
        focus(): void { /* no-op */ },
    }) as unknown as HTMLTextAreaElement;

    const app = {
        vault: {
            getMarkdownFiles(): TFile[] {
                return files.filter((f) => (f as unknown as FakeFile).extension === 'md');
            },
            getAllLoadedFiles(): Array<TFile | TFolder> {
                return [...files, ...folders];
            },
            getRoot(): TFolder { return folder('', [...files, ...folders]); },
        },
        workspace: { getActiveFile: () => activeFile },
    } as unknown as App;

    const fileCalls: TFile[] = [];
    const folderCalls: Array<{ folder: TFolder; opts: { recursive: boolean } }> = [];

    const handler = new AutocompleteHandler(
        {} as ObsidianAgentPlugin,
        app,
        () => textareaEl,
        () => null, // no inputArea -> render() returns early, no DOM built
        async (f: TFile) => { fileCalls.push(f); },
        async (fld: TFolder, o: { recursive: boolean }) => { folderCalls.push({ folder: fld, opts: o }); },
    );

    return {
        handler,
        textarea,
        fileCalls,
        folderCalls,
        setInput(v: string): void {
            textarea.value = v;
            textarea.selectionStart = v.length;
        },
    };
}

/** Reach the private items[] the handler renders from. */
function items(h: AutocompleteHandler): Array<{
    label: string;
    sub?: string;
    tag?: string;
    onSelect: () => void | Promise<void>;
}> {
    return (h as unknown as { items: Array<{ label: string; sub?: string; tag?: string; onSelect: () => void | Promise<void> }> }).items;
}

describe('AutocompleteHandler folder candidates (FEAT-02-11)', () => {
    it('emits a recursive row for a matching folder', async () => {
        const notesFolder = folder('Notes');
        const h = makeHarness({ folders: [notesFolder] });
        h.setInput('@Notes');

        await h.handler.handleInput();

        const list = items(h.handler);
        const folderRows = list.filter((i) => i.tag === 'Folder');
        expect(folderRows.length).toBeGreaterThanOrEqual(1);
        expect(folderRows[0].label).toBe('Notes/');
        expect(folderRows[0].sub).toMatch(/recursive/);
    });

    it('adds a second top-level row only when the folder has sub-folders', async () => {
        const withSub = folder('Projects', [
            file('Projects/root.md'),
            folder('Projects/inner', [file('Projects/inner/nested.md')]),
        ]);
        const withoutSub = folder('Flat', [
            file('Flat/a.md'),
            file('Flat/b.md'),
        ]);
        const hWith = makeHarness({ folders: [withSub] });
        hWith.setInput('@Projects');
        await hWith.handler.handleInput();
        const withRows = items(hWith.handler).filter((i) => i.tag === 'Folder');
        expect(withRows.length).toBe(2);
        expect(withRows.some((r) => (r.sub ?? '').includes('top-level'))).toBe(true);

        const hFlat = makeHarness({ folders: [withoutSub] });
        hFlat.setInput('@Flat');
        await hFlat.handler.handleInput();
        const flatRows = items(hFlat.handler).filter((i) => i.tag === 'Folder');
        expect(flatRows.length).toBe(1);
        expect(flatRows[0].sub ?? '').not.toContain('top-level');
    });

    it('files rank before folders in the popup', async () => {
        const noteFile = file('project-notes.md');
        const projFolder = folder('Projects');
        const h = makeHarness({ files: [noteFile], folders: [projFolder] });
        h.setInput('@proj');
        await h.handler.handleInput();

        const list = items(h.handler);
        const firstFolderIdx = list.findIndex((i) => i.tag === 'Folder');
        const firstFileIdx = list.findIndex((i) => i.tag !== 'Folder' && i.sub !== undefined);
        expect(firstFileIdx).toBeGreaterThanOrEqual(0);
        expect(firstFolderIdx).toBeGreaterThan(firstFileIdx);
    });

    it('on-select invokes the folder callback with the right recursive flag', async () => {
        const projFolder = folder('Projects', [
            file('Projects/a.md'),
            folder('Projects/inner', [file('Projects/inner/b.md')]),
        ]);
        const h = makeHarness({ folders: [projFolder] });
        h.setInput('@Projects');
        await h.handler.handleInput();

        const folderRows = items(h.handler).filter((i) => i.tag === 'Folder');
        // Row A = recursive
        await folderRows[0].onSelect();
        // Row B = top-level
        await folderRows[1].onSelect();

        expect(h.folderCalls).toHaveLength(2);
        expect(h.folderCalls[0].opts.recursive).toBe(true);
        expect(h.folderCalls[1].opts.recursive).toBe(false);
        expect(h.folderCalls[0].folder).toBe(projFolder);
    });

    it('parent folder outranks sub-folder for the same substring hit (bug fix)', async () => {
        // Regression for user report 2026-07-13:
        // `Schreibtische/Acme Cowork` disappeared while
        // `Schreibtische/Acme Cowork/Insights` still showed up.
        const parent = folder('Schreibtische/Acme Cowork', [
            file('Schreibtische/Acme Cowork/README.md'),
        ]);
        const child = folder('Schreibtische/Acme Cowork/Insights', [
            file('Schreibtische/Acme Cowork/Insights/note.md'),
        ]);
        const h = makeHarness({ folders: [child, parent] }); // ordered child-first on purpose
        h.setInput('@Acme Cowork');
        await h.handler.handleInput();

        const folderRows = items(h.handler).filter((i) => i.tag === 'Folder');
        // Both should appear; the parent must show up FIRST (shorter path).
        expect(folderRows.length).toBeGreaterThanOrEqual(2);
        expect(folderRows[0].sub ?? '').toContain('Schreibtische/Acme Cowork');
        expect(folderRows[0].sub ?? '').not.toContain('Insights');
    });

    it('does NOT emit folder rows when nothing matches the query', async () => {
        const h = makeHarness({ folders: [folder('Notes')] });
        h.setInput('@xyzzy');
        await h.handler.handleInput();

        const folderRows = items(h.handler).filter((i) => i.tag === 'Folder');
        expect(folderRows).toHaveLength(0);
    });

    it('total popup capped at 10 combined rows (files + folders + active-note)', async () => {
        const files: TFile[] = [];
        const folders: TFolder[] = [];
        for (let i = 0; i < 15; i++) files.push(file(`match-${i}.md`));
        for (let i = 0; i < 15; i++) folders.push(folder(`match-folder-${i}`));
        const h = makeHarness({ files, folders });
        h.setInput('@match');
        await h.handler.handleInput();

        expect(items(h.handler).length).toBeLessThanOrEqual(10);
    });
});

describe('AutocompleteHandler active-note i18n (FEAT-02-11 side-cleanup)', () => {
    it('uses an i18n label for the active-note shortcut instead of hardcoded "Active note"', async () => {
        const active = file('Current.md');
        const h = makeHarness({ activeFile: active });
        h.setInput('@');
        await h.handler.handleInput();

        const list = items(h.handler);
        const activeItem = list.find((i) => (i.sub ?? '').includes('@active'));
        expect(activeItem).toBeDefined();
        // Label goes through the i18n layer; getLanguage() returns 'en' in the
        // stub so English string is expected. Point: it must not be a raw
        // TypeScript literal.
        expect(activeItem?.label).toBe('Active note');
    });
});

// Silence unused-vi warning if we later add spies.
void vi;

/**
 * FEAT-02-11: folder-mention via @ attaches a manifest (path list) rather than
 * full text. RED-first: `addVaultFolder` and the `folderMeta` field do not
 * exist yet; the implementation makes them GREEN.
 */

import { describe, it, expect } from 'vitest';
import { Vault, TFile, TFolder } from 'obsidian';
import { AttachmentHandler } from '../AttachmentHandler';
import type ObsidianAgentPlugin from '../../../main';

const stubPlugin = {} as ObsidianAgentPlugin;

/**
 * DOM-neutral fake element that answers every method renderChips() calls with a
 * further fake element. Keeps AttachmentHandler.renderChips a no-op without
 * touching production code.
 */
function fakeEl(): HTMLElement {
    const el: Record<string, unknown> = {};
    el.empty = () => undefined;
    el.createDiv = () => fakeEl();
    el.createEl = () => fakeEl();
    el.createSpan = () => fakeEl();
    el.setText = () => undefined;
    el.appendChild = () => undefined;
    el.addEventListener = () => undefined;
    el.addClass = () => undefined;
    el.classList = { add: () => undefined, remove: () => undefined };
    el.src = '';
    el.alt = '';
    return el as unknown as HTMLElement;
}

function makeHandler(): AttachmentHandler {
    const vault = new Vault();
    return new AttachmentHandler(vault, fakeEl(), stubPlugin);
}

interface FakeFile {
    path: string;
    name: string;
    basename: string;
    extension: string;
    stat: { size: number };
}
interface FakeFolder {
    path: string;
    name: string;
    children: Array<FakeFile | FakeFolder>;
}

function file(path: string, size = 100): TFile {
    const parts = path.split('/');
    const name = parts[parts.length - 1];
    const dot = name.lastIndexOf('.');
    const basename = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot + 1) : '';
    const f: FakeFile = { path, name, basename, extension, stat: { size } };
    // instanceof-check works because we build on a real TFile prototype
    return Object.assign(new TFile(), f) as unknown as TFile;
}

function folder(path: string, children: Array<TFile | TFolder> = []): TFolder {
    const parts = path.split('/');
    const name = parts[parts.length - 1] || path;
    const f: FakeFolder = { path, name, children: children as unknown as Array<FakeFile | FakeFolder> };
    return Object.assign(new TFolder(), f) as unknown as TFolder;
}

/** Extract the manifest ContentBlock text from the most recent attachment. */
function lastAttachmentText(h: AttachmentHandler): string {
    const last = h.pending[h.pending.length - 1];
    if (!last) throw new Error('no attachment');
    if (last.block.type !== 'text') throw new Error('not a text block');
    return last.block.text;
}

describe('AttachmentHandler.addVaultFolder (FEAT-02-11)', () => {
    describe('recursive walk', () => {
        it('lists every markdown file in the tree', async () => {
            const h = makeHandler();
            const tree = folder('Notes', [
                file('Notes/root.md', 500),
                folder('Notes/2026', [
                    file('Notes/2026/a.md', 800),
                    file('Notes/2026/b.md', 200),
                ]),
                folder('Notes/2026/inner', [
                    file('Notes/2026/inner/c.md', 300),
                ]),
            ]);

            await h.addVaultFolder(tree, { recursive: true });

            const text = lastAttachmentText(h);
            expect(text).toContain('<attached_folder');
            expect(text).toContain('recursive="true"');
            expect(text).toContain('Notes/root.md');
            expect(text).toContain('Notes/2026/a.md');
            expect(text).toContain('Notes/2026/b.md');
            expect(text).toContain('Notes/2026/inner/c.md');
            expect(text).toContain('file_count="4"');
        });

        it('advertises read_file / read_document in the trailer', async () => {
            const h = makeHandler();
            const tree = folder('Docs', [file('Docs/x.md', 10)]);

            await h.addVaultFolder(tree, { recursive: true });

            const text = lastAttachmentText(h);
            expect(text).toContain('read_file');
            expect(text).toContain('read_document');
        });

        it('does NOT populate fullDocTexts (Manifest ist Lazy-Read)', async () => {
            const h = makeHandler();
            const tree = folder('Notes', [file('Notes/big.md', 10_000)]);

            await h.addVaultFolder(tree, { recursive: true });

            expect(h.getFullDocTexts()).toEqual([]);
        });
    });

    describe('top-level walk', () => {
        it('lists only direct children when recursive=false', async () => {
            const h = makeHandler();
            const tree = folder('Notes', [
                file('Notes/root.md'),
                folder('Notes/inner', [
                    file('Notes/inner/skip.md'),
                ]),
            ]);

            await h.addVaultFolder(tree, { recursive: false });

            const text = lastAttachmentText(h);
            expect(text).toContain('recursive="false"');
            expect(text).toContain('Notes/root.md');
            expect(text).not.toContain('Notes/inner/skip.md');
            expect(text).toContain('file_count="1"');
        });
    });

    describe('extension whitelist', () => {
        it('filters out unsupported extensions (.exe, .zip)', async () => {
            const h = makeHandler();
            const tree = folder('Mix', [
                file('Mix/notes.md'),
                file('Mix/bin.exe'),
                file('Mix/archive.zip'),
                file('Mix/report.pdf'),
                file('Mix/data.csv'),
                file('Mix/image.png'),
            ]);

            await h.addVaultFolder(tree, { recursive: true });

            const text = lastAttachmentText(h);
            expect(text).toContain('Mix/notes.md');
            expect(text).toContain('Mix/report.pdf');
            expect(text).toContain('Mix/data.csv');
            expect(text).toContain('Mix/image.png');
            expect(text).not.toContain('Mix/bin.exe');
            expect(text).not.toContain('Mix/archive.zip');
            expect(text).toContain('file_count="4"');
        });
    });

    describe('500-file cap', () => {
        it('truncates a very large folder and notes the cap', async () => {
            const h = makeHandler();
            const children: TFile[] = [];
            for (let i = 0; i < 700; i++) children.push(file(`Big/file-${i}.md`, 100));
            const tree = folder('Big', children);

            await h.addVaultFolder(tree, { recursive: true });

            const text = lastAttachmentText(h);
            expect(text).toContain('Big/file-0.md');
            expect(text).toContain('Big/file-499.md');
            expect(text).not.toContain('Big/file-500.md');
            expect(text).toContain('showing first 500 of 700');
        });
    });

    describe('per-turn budget interaction', () => {
        type Priv = {
            truncateTextFileForContext(text: string, vaultPath: string): string;
            contextCharsUsed: number;
        };

        it('honors the shared 64k budget with existing text attachments', async () => {
            const h = makeHandler();
            (h as unknown as Priv).truncateTextFileForContext('x'.repeat(60_000), 'Big.md');
            const before = (h as unknown as Priv).contextCharsUsed;

            const children: TFile[] = [];
            for (let i = 0; i < 50; i++) children.push(file(`Later/n-${i}.md`, 100));
            await h.addVaultFolder(folder('Later', children), { recursive: true });

            const after = (h as unknown as Priv).contextCharsUsed;
            // Manifest also charges against the budget.
            expect(after).toBeGreaterThan(before);
            // But the manifest is never zero-sized (invariant: >=2000 remaining).
            const text = lastAttachmentText(h);
            expect(text).toContain('<attached_folder');
        });
    });

    describe('folderMeta on AttachmentItem', () => {
        it('marks the attachment with folder metadata for chip rendering', async () => {
            const h = makeHandler();
            const tree = folder('Notes', [file('Notes/a.md'), file('Notes/b.md')]);

            await h.addVaultFolder(tree, { recursive: true });

            const last = h.pending[h.pending.length - 1];
            expect(last.folderMeta).toEqual({
                path: 'Notes',
                recursive: true,
                fileCount: 2,
            });
        });
    });
});

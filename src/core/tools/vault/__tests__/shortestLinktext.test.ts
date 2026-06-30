import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import { toShortestLinktext } from '../shortestLinktext';

/**
 * FIX-19-99-04: Wikilink-Output muss Obsidians "New link format" Setting
 * respektieren. Vorher hardcodeten IngestTriage + RecallMemory den vollen
 * Pfad in `[[...]]`, was bei Setting "Shortest path when possible" zu
 * `[[Notes/Foo]]` statt `[[Foo]]` fuehrte (ausser bei echten Duplikaten).
 */
describe('toShortestLinktext', () => {
    function makeApp(opts: {
        getFile?: (p: string) => unknown;
        linktext?: (f: unknown, src: string, omitExt: boolean) => string;
    }): App {
        return {
            vault: { getAbstractFileByPath: opts.getFile ?? (() => null) },
            metadataCache: {
                fileToLinktext: opts.linktext ?? (() => { throw new Error('not stubbed'); }),
            },
        } as unknown as App;
    }

    it('delegates to fileToLinktext when the file exists, with omitMdExtension=true', () => {
        const file = Object.assign(new TFile(), { path: 'Notes/MyNote.md', basename: 'MyNote' });
        const calls: Array<{ file: unknown; src: string; omit: boolean }> = [];
        const app = makeApp({
            getFile: (p) => (p === 'Notes/MyNote.md' ? file : null),
            linktext: (f, src, omit) => {
                calls.push({ file: f, src, omit });
                return 'MyNote';
            },
        });

        const result = toShortestLinktext(app, 'Notes/MyNote.md');

        expect(result).toBe('MyNote');
        expect(calls).toEqual([{ file, src: '', omit: true }]);
    });

    it('keeps disambiguation path when Obsidian needs it (duplicate basenames)', () => {
        // Obsidians fileToLinktext returnt 'Notes/Foo' wenn es im Vault ein
        // zweites 'Other/Foo.md' gibt -- der Helper darf die Disambiguierung
        // nicht ueberschreiben.
        const file = Object.assign(new TFile(), { path: 'Notes/Foo.md', basename: 'Foo' });
        const app = makeApp({
            getFile: () => file,
            linktext: () => 'Notes/Foo',
        });

        expect(toShortestLinktext(app, 'Notes/Foo.md')).toBe('Notes/Foo');
    });

    it('falls back to path-without-md-extension when file does not exist', () => {
        const app = makeApp({ getFile: () => null });
        expect(toShortestLinktext(app, 'Notes/Ghost.md')).toBe('Notes/Ghost');
    });

    it('falls back to path when getAbstractFileByPath returns a non-TFile (e.g. TFolder)', () => {
        // Defensive: a folder collision should not crash; render the raw path.
        const folderLike = { path: 'Notes/MyFolder' };
        const app = makeApp({ getFile: () => folderLike });
        expect(toShortestLinktext(app, 'Notes/MyFolder')).toBe('Notes/MyFolder');
    });

    it('handles paths without .md extension by returning them as-is in fallback', () => {
        const app = makeApp({ getFile: () => null });
        expect(toShortestLinktext(app, 'Attachments/diagram.png')).toBe('Attachments/diagram.png');
    });
});

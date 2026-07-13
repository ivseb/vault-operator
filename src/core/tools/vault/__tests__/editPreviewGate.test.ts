/**
 * FEAT-44-10: the approval diff must be the truth.
 *
 * The gate shows `previewEdit()`. The write performs `execute()`. If those two
 * ever disagree, the user approves one thing and gets another -- which is the
 * exact failure mode (a diff that does not bind the write) we set out to fix.
 * These tests pin them to each other.
 */

import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { EditFileTool } from '../EditFileTool';
import type { ToolCallbacks } from '../../types';

const NOTE = [
    '---',
    'uid: abc',
    'title: Eine Notiz',
    '---',
    '',
    '## Abschnitt',
    '',
    'Hallo Welt.',
    '',
].join('\n');

function makeApp(content: string) {
    const written: string[] = [];
    // Real TFile instance: EditFileTool gates on `instanceof TFile`.
    const file = Object.assign(new TFile(), { path: 'Notes/a.md', extension: 'md' });
    const app = {
        vault: {
            getAbstractFileByPath: () => file,
            getFileByPath: () => file,
            read: () => Promise.resolve(content),
            modify: (_f: unknown, c: string) => { written.push(c); return Promise.resolve(); },
            adapter: {
                exists: () => Promise.resolve(true),
                read: () => Promise.resolve(content),
                write: (_p: string, c: string) => { written.push(c); return Promise.resolve(); },
            },
        },
    };
    return { app, written, file };
}

function makeTool(content: string) {
    const { app, written, file } = makeApp(content);
    // TFile instanceof checks: make the stub pass by prototype-patching.
    const tool = new (EditFileTool as unknown as new (p: unknown) => EditFileTool)({ app });
    return { tool, app, written, file };
}

function makeCallbacks(): { callbacks: ToolCallbacks; results: string[] } {
    const results: string[] = [];
    return {
        results,
        callbacks: {
            pushToolResult: (c) => { if (typeof c === 'string') results.push(c); },
            handleError: () => Promise.resolve(),
            log: () => { /* no-op */ },
        },
    };
}

describe('FEAT-44-10: previewEdit matches what execute writes', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
        ['exact single replacement', { path: 'Notes/a.md', old_str: 'Hallo Welt.', new_str: 'Hallo Theresa.' }],
        ['replacement inside a heading', { path: 'Notes/a.md', old_str: '## Abschnitt', new_str: '## Kontext' }],
        ['multi-line replacement', { path: 'Notes/a.md', old_str: '## Abschnitt\n\nHallo Welt.', new_str: '## Kontext\n\nText.' }],
    ];

    it.each(cases)('%s', async (_name, input) => {
        const preview = await makeTool(NOTE).tool.previewEdit(input);
        expect(preview).not.toBeNull();

        const { tool, written } = makeTool(NOTE);
        const { callbacks } = makeCallbacks();
        await tool.execute(input, { callbacks } as never);

        expect(written).toHaveLength(1);
        expect(preview!.after).toBe(written[0]);
        expect(preview!.before).toBe(NOTE);
    });

    it('returns null (no diff, but still an approval) when old_str is not found', async () => {
        const { tool } = makeTool(NOTE);
        const preview = await tool.previewEdit({
            path: 'Notes/a.md', old_str: 'gibt es nicht', new_str: 'x',
        });
        expect(preview).toBeNull();
    });

    it('previewEdit never writes', async () => {
        const { tool, written } = makeTool(NOTE);
        await tool.previewEdit({ path: 'Notes/a.md', old_str: 'Hallo Welt.', new_str: 'Neu.' });
        expect(written).toHaveLength(0);
    });
});

describe('FIX-44-09: the frontmatter guard blocks the live-incident edit', () => {
    it('edit_file refuses to eat the closing fence', async () => {
        // Exactly the live shape: closing fence followed by a stray rule.
        const live = ['---', 'uid: abc', 'timestamp: x', '---', '---', '', '', '---', '', '### Transkript', ''].join('\n');
        const { tool, written } = makeTool(live);
        const { callbacks, results } = makeCallbacks();

        await tool.execute({
            path: 'Notes/a.md',
            old_str: '---\n---\n\n\n---\n\n### Transkript',
            new_str: '\n# Zusammenfassung\n\nText.\n\n---\n\n### Transkript',
        }, { callbacks } as never);

        expect(written).toHaveLength(0);
        expect(results.join('\n')).toMatch(/frontmatter/i);
    });
});

/**
 * FEAT-44-10 (Abschluss): write_file, append_to_file and delete_file are approved
 * on their diff too. Every CUD tool now follows the same pattern.
 *
 * delete_file is the one that matters most. It is the most destructive thing the
 * agent can do and it used to show the least: a card with a tool name and a path.
 * The gate now renders the entire content of the doomed note as a deletion diff,
 * so the loss is approved with open eyes -- and a rejection must leave the file
 * exactly where it is.
 */

import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { WriteFileTool } from '../WriteFileTool';
import { AppendToFileTool } from '../AppendToFileTool';
import { DeleteFileTool } from '../DeleteFileTool';
import type { ToolCallbacks, ToolExecutionContext } from '../../types';

function makeCtx(): { context: ToolExecutionContext; results: string[] } {
    const results: string[] = [];
    const callbacks: ToolCallbacks = {
        pushToolResult(c) { results.push(typeof c === 'string' ? c : JSON.stringify(c)); },
        handleError() { /* no-op */ },
        log() { /* no-op */ },
    };
    return { context: { taskId: 't', mode: 'agent', callbacks }, results };
}

/** @param exists false -> the path is a brand new file. */
function makeVault(content: string, exists = true) {
    const written: string[] = [];
    const trashed: string[] = [];
    const file = Object.assign(new TFile(), { path: 'Notes/a.md', extension: 'md' });
    const app = {
        vault: {
            // write_file consults configDir to decide between the indexed vault
            // API and the raw adapter.
            configDir: '.obsidian',
            getAbstractFileByPath: () => (exists ? file : null),
            getFileByPath: () => (exists ? file : null),
            read: () => Promise.resolve(content),
            modify: (_f: unknown, c: string) => { written.push(c); return Promise.resolve(); },
            create: (_p: string, c: string) => { written.push(c); return Promise.resolve(file); },
            createFolder: () => Promise.resolve(),
            adapter: {
                exists: () => Promise.resolve(exists),
                read: () => Promise.resolve(content),
                write: (_p: string, c: string) => { written.push(c); return Promise.resolve(); },
            },
        },
        fileManager: {
            trashFile: (f: { path: string }) => { trashed.push(f.path); return Promise.resolve(); },
        },
        workspace: { getLeavesOfType: () => [] },
    };
    const plugin = { app, settings: { agentFolderPath: '.vault-operator' } };
    return { plugin: plugin as never, written, trashed, file };
}

const NOTE = '---\ntitle: A\n---\n\nHallo Welt.\n';

describe('FEAT-44-10: write_file preview matches what execute writes', () => {
    it('shows the existing note as "before", so an overwrite reveals what it destroys', async () => {
        const v = makeVault(NOTE);
        const tool = new WriteFileTool(v.plugin);
        const input = { path: 'Notes/a.md', content: '---\ntitle: A\n---\n\nNeuer Text.\n' };

        const preview = await tool.previewEdit(input);
        expect(preview).not.toBeNull();
        expect(preview!.before).toBe(NOTE);
        expect(preview!.isNew).toBeUndefined();

        const v2 = makeVault(NOTE);
        const { context } = makeCtx();
        await new WriteFileTool(v2.plugin).execute(input, context);
        expect(v2.written).toHaveLength(1);
        expect(preview!.after).toBe(v2.written[0]);
    });

    it('flags a brand new file as isNew with an empty before', async () => {
        const v = makeVault('', false);
        const preview = await new WriteFileTool(v.plugin).previewEdit({
            path: 'Notes/a.md', content: 'Neu.',
        });
        expect(preview).toMatchObject({ before: '', after: 'Neu.', isNew: true });
    });

    it('previewEdit never writes', async () => {
        const v = makeVault(NOTE);
        await new WriteFileTool(v.plugin).previewEdit({ path: 'Notes/a.md', content: 'x' });
        expect(v.written).toHaveLength(0);
    });
});

describe('FEAT-44-10: append_to_file preview matches what execute writes', () => {
    it('previews the appended result', async () => {
        const input = { path: 'Notes/a.md', content: 'Angehaengt.' };

        const preview = await new AppendToFileTool(makeVault(NOTE).plugin).previewEdit(input);
        expect(preview!.before).toBe(NOTE);

        const v2 = makeVault(NOTE);
        const { context } = makeCtx();
        await new AppendToFileTool(v2.plugin).execute(input, context);

        expect(v2.written).toHaveLength(1);
        expect(preview!.after).toBe(v2.written[0]);
        expect(preview!.after).toContain('Angehaengt.');
    });

    it('previewEdit never writes', async () => {
        const v = makeVault(NOTE);
        await new AppendToFileTool(v.plugin).previewEdit({ path: 'Notes/a.md', content: 'x' });
        expect(v.written).toHaveLength(0);
    });
});

describe('FEAT-44-10: delete_file shows what is about to be lost', () => {
    it('previews the whole doomed note as a deletion', async () => {
        const v = makeVault(NOTE);
        const preview = await new DeleteFileTool(v.plugin).previewEdit({ path: 'Notes/a.md' });

        expect(preview).toEqual({
            path: 'Notes/a.md',
            before: NOTE,      // the full content the user is being asked to give up
            after: '',
            isDeleted: true,
        });
    });

    it('previewEdit never trashes anything', async () => {
        const v = makeVault(NOTE);
        await new DeleteFileTool(v.plugin).previewEdit({ path: 'Notes/a.md' });
        expect(v.trashed).toHaveLength(0);
    });

    it('execute trashes the file (it does not hard-delete it)', async () => {
        const v = makeVault(NOTE);
        const { context } = makeCtx();
        await new DeleteFileTool(v.plugin).execute({ path: 'Notes/a.md' }, context);
        expect(v.trashed).toEqual(['Notes/a.md']);
    });

    it('returns null for a path that is not a file, so the plain card covers it', async () => {
        const v = makeVault('', false);
        expect(await new DeleteFileTool(v.plugin).previewEdit({ path: 'Notes/gone.md' })).toBeNull();
    });
});

describe('FEAT-44-10: rejecting in the gate must not touch the vault', () => {
    it('a rejected delete leaves the file alone (the tool never runs)', async () => {
        // The gate lives in the Pipeline: on decision 'rejected' it returns an
        // error result and never calls tool.execute. This asserts the contract
        // the gate depends on: nothing is trashed unless execute runs.
        const v = makeVault(NOTE);
        const tool = new DeleteFileTool(v.plugin);
        const spy = vi.spyOn(tool, 'execute');

        await tool.previewEdit({ path: 'Notes/a.md' });   // gate renders the diff
        // ...user rejects -> Pipeline short-circuits, execute is never called.

        expect(spy).not.toHaveBeenCalled();
        expect(v.trashed).toHaveLength(0);
    });
});

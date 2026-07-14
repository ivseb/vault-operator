/**
 * FIX-44-41: append_to_file must see EXISTING dot-path files.
 *
 * Dot-paths (`.vault-operator/...`) live outside Obsidian's file index, so
 * `vault.getAbstractFileByPath` returns null for them. previewEdit treated
 * that null as "brand new file" and produced a preview whose after-content was
 * ONLY the appended chunk. If the user edited that proposal in the gate and
 * approved, the pipeline's finalContent path wrote the chunk as the FULL file
 * content -- truncating the file. Same dot-path class as FIX-01-07-04.
 *
 * execute had the same blindness: for an existing-but-unindexed file it ran
 * into the create branch instead of appending, violating the previewEdit
 * contract (the preview MUST be what execute would write).
 *
 * WriteFileTool and EditFileTool already carry the adapter.exists +
 * adapter.read fallback; this pins the same behaviour for append_to_file.
 */

import { describe, it, expect, vi } from 'vitest';
import { AppendToFileTool } from '../AppendToFileTool';
import type { ToolCallbacks, ToolExecutionContext } from '../../types';
import type ObsidianAgentPlugin from '../../../../main';

const HIDDEN_PATH = '.vault-operator/skill-data/log.md';
const EXISTING = '# Log\n\n- alter Eintrag\n';

/** In-memory adapter-backed vault where NOTHING is in the Obsidian index. */
function makeHiddenVault(initial: Record<string, string>) {
    const files = new Map(Object.entries(initial));
    const createCalls: string[] = [];
    const adapter = {
        exists: (p: string) => Promise.resolve(files.has(p)),
        read: (p: string) => {
            const c = files.get(p);
            return c !== undefined ? Promise.resolve(c) : Promise.reject(new Error(`not found: ${p}`));
        },
        write: (p: string, c: string) => { files.set(p, c); return Promise.resolve(); },
        rename: (from: string, to: string) => {
            const c = files.get(from);
            if (c === undefined) return Promise.reject(new Error(`missing: ${from}`));
            files.delete(from);
            files.set(to, c);
            return Promise.resolve();
        },
        remove: (p: string) => { files.delete(p); return Promise.resolve(); },
        mkdir: () => Promise.resolve(),
        list: () => Promise.resolve({ files: [], folders: [] }),
        stat: () => Promise.resolve(null),
    };
    const app = {
        vault: {
            configDir: '.obsidian',
            // Dot-paths are never indexed: this is exactly what Obsidian returns.
            getAbstractFileByPath: () => null,
            adapter,
            // Obsidian's vault.create refuses paths it cannot index/that exist.
            create: (p: string) => {
                createCalls.push(p);
                return Promise.reject(new Error('File already exists.'));
            },
            createFolder: () => Promise.resolve(),
        },
        workspace: { getLeavesOfType: () => [] },
    };
    const plugin = { app, settings: { agentFolderPath: '.vault-operator' } } as unknown as ObsidianAgentPlugin;
    return { plugin, files, createCalls };
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

describe('FIX-44-41: append_to_file on an existing dot-path file', () => {
    it('previews the REAL before-content, not a fake "new file"', async () => {
        const { plugin } = makeHiddenVault({ [HIDDEN_PATH]: EXISTING });
        const preview = await new AppendToFileTool(plugin).previewEdit({
            path: HIDDEN_PATH, content: '- neuer Eintrag',
        });

        expect(preview).not.toBeNull();
        expect(preview!.isNew).toBeUndefined();
        expect(preview!.before).toBe(EXISTING);
        expect(preview!.after).toBe(`${EXISTING}\n- neuer Eintrag`);
    });

    it('bases the after-content on the full file, so a user-edited approve cannot truncate it', async () => {
        // The pipeline writes approval.finalContent verbatim. The user edits
        // whatever `after` the gate showed them -- so `after` MUST already
        // contain the prior content, otherwise approving the edit destroys it.
        const { plugin } = makeHiddenVault({ [HIDDEN_PATH]: EXISTING });
        const preview = await new AppendToFileTool(plugin).previewEdit({
            path: HIDDEN_PATH, content: '- neuer Eintrag',
        });
        expect(preview!.after.startsWith(EXISTING)).toBe(true);
    });

    it('execute appends via the adapter and writes exactly what the preview showed', async () => {
        const v = makeHiddenVault({ [HIDDEN_PATH]: EXISTING });
        const input = { path: HIDDEN_PATH, content: '- neuer Eintrag' };

        const preview = await new AppendToFileTool(v.plugin).previewEdit(input);
        const { context, results } = makeCtx();
        await new AppendToFileTool(v.plugin).execute(input, context);

        expect(v.createCalls).toHaveLength(0);                    // never the create branch
        expect(v.files.get(HIDDEN_PATH)).toBe(preview!.after);    // preview === execute
        expect(results[0]).toContain('<success>');
    });

    it('previewEdit never writes', async () => {
        const v = makeHiddenVault({ [HIDDEN_PATH]: EXISTING });
        await new AppendToFileTool(v.plugin).previewEdit({ path: HIDDEN_PATH, content: 'x' });
        expect(v.files.get(HIDDEN_PATH)).toBe(EXISTING);
    });

    it('still previews a genuinely new dot-path file as isNew', async () => {
        const { plugin } = makeHiddenVault({});
        const preview = await new AppendToFileTool(plugin).previewEdit({
            path: HIDDEN_PATH, content: 'erster Eintrag',
        });
        expect(preview).toMatchObject({ before: '', after: 'erster Eintrag', isNew: true });
    });

    it('a rejected append leaves the file alone (execute never runs)', async () => {
        const v = makeHiddenVault({ [HIDDEN_PATH]: EXISTING });
        const tool = new AppendToFileTool(v.plugin);
        const spy = vi.spyOn(tool, 'execute');

        await tool.previewEdit({ path: HIDDEN_PATH, content: '- neuer Eintrag' });
        // ...user rejects -> Pipeline short-circuits, execute is never called.

        expect(spy).not.toHaveBeenCalled();
        expect(v.files.get(HIDDEN_PATH)).toBe(EXISTING);
    });
});

/**
 * FIX-44-13a: a user-edited approval writes to the PREVIEWED path.
 *
 * The finalContent branch used to resolve the target from `toolCall.input.path`
 * alone. The memory-source tools address their note via `note_path`, so the
 * moment they gained previewEdit, a user who edited their diff and approved got
 * "Approved edit was refused: invalid path:" -- safeNoteWrite received ''.
 * The previewed path is authoritative: it is the file whose before/after the
 * user just saw and edited.
 *
 * Also pinned here: the pre-write checkpoint covers `note_path` tools, so a
 * user-edited frontmatter write has the same Undo net as a `path` one.
 */

import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import type { ToolUse, ToolCallbacks } from '../../tools/types';
import type { EditPreview } from '../../tools/editPreview';

function makeCallbacks(): ToolCallbacks {
    return {
        pushToolResult: () => { /* no-op */ },
        handleError: () => Promise.resolve(),
        log: () => { /* no-op */ },
    };
}

const NOTE_PATH = 'Notes/N.md';
const BEFORE = '---\ntitle: T\n---\n\nbody\n';
const AGENT_AFTER = '---\ntitle: T\nmemory-source: true\n---\n\nbody\n';
const USER_AFTER = '---\ntitle: T\nmemory-source: true\nreviewed: true\n---\n\nbody\n';

function makeHarness() {
    const written: Array<{ path: string; content: string }> = [];
    const file = Object.assign(new TFile(), { path: NOTE_PATH, extension: 'md' });
    const snapshots: string[][] = [];

    const tool = {
        name: 'mark_note_as_memory_source',
        isWriteOperation: true,
        execute: vi.fn(() => Promise.resolve()),
        getDefinition: () => ({
            name: 'mark_note_as_memory_source',
            description: 'stub',
            input_schema: { type: 'object' as const },
        }),
        previewEdit: vi.fn((): Promise<EditPreview | null> =>
            Promise.resolve({ path: NOTE_PATH, before: BEFORE, after: AGENT_AFTER })),
    };
    const toolRegistry = {
        getTool: () => tool,
        getAllTools: () => [tool],
    };
    const plugin = {
        app: {
            vault: {
                getAbstractFileByPath: (p: string) => (p === NOTE_PATH ? file : null),
                read: () => Promise.resolve(BEFORE),
                modify: (f: TFile, c: string) => { written.push({ path: f.path, content: c }); return Promise.resolve(); },
                createFolder: () => Promise.resolve(),
                adapter: {
                    exists: () => Promise.resolve(false),
                    read: () => Promise.resolve(''),
                    write: () => Promise.resolve(),
                    mkdir: () => Promise.resolve(),
                    remove: () => Promise.resolve(),
                    list: () => Promise.resolve({ files: [], folders: [] }),
                    stat: () => Promise.resolve(null),
                },
            },
            workspace: { getLeavesOfType: () => [] },
        },
        settings: {
            enableCheckpoints: true,
            agentFolderPath: '.vault-operator',
            autoApproval: {
                enabled: false,
                read: true, noteEdits: false, vaultChanges: false,
                web: false, mcp: false, subtasks: false, skills: false,
                pluginApiRead: true, pluginApiWrite: false, recipes: false, sandbox: false,
            },
        },
        ignoreService: {
            isIgnored: () => false,
            isProtected: () => false,
            getDenialReason: () => 'Denied',
        },
        operationLogger: { log: () => Promise.resolve() },
        checkpointService: {
            snapshot: vi.fn((_taskId: string, paths: string[]) => {
                snapshots.push(paths);
                return Promise.resolve({ commitOid: 'abc', taskId: 't', paths });
            }),
        },
        trackChatLinkPath: () => { /* no-op */ },
    };
    return { plugin, toolRegistry, tool, written, snapshots };
}

async function runWithEditedApproval() {
    const { ToolExecutionPipeline } = await import('../ToolExecutionPipeline');
    const h = makeHarness();
    const pipeline = new (ToolExecutionPipeline as unknown as new (
        p: unknown, r: unknown, t: string, m: string,
    ) => InstanceType<typeof ToolExecutionPipeline>)(h.plugin, h.toolRegistry, 'task-1', 'agent');

    const call: ToolUse = {
        type: 'tool_use',
        id: 'tu-1',
        name: 'mark_note_as_memory_source',
        input: { note_path: NOTE_PATH },              // note_path, NOT path
    };
    const onApprovalRequired = vi.fn(() =>
        Promise.resolve({ decision: 'approved' as const, finalContent: USER_AFTER }));
    const result = await pipeline.executeTool(call, makeCallbacks(), { onApprovalRequired });
    return { ...h, result, onApprovalRequired };
}

describe('FIX-44-13a: user-edited approval on a note_path tool', () => {
    it('writes the edited content to the previewed path, not to ""', async () => {
        const { result, written, tool } = await runWithEditedApproval();

        expect(result.is_error).toBeFalsy();
        expect(written).toEqual([{ path: NOTE_PATH, content: USER_AFTER }]);
        // The user's version won; the tool must not run and overwrite it.
        expect(tool.execute).not.toHaveBeenCalled();
    });

    it('snapshots the note_path target before the write (Undo reaches past it)', async () => {
        const { snapshots } = await runWithEditedApproval();
        expect(snapshots).toEqual([[NOTE_PATH]]);
    });
});

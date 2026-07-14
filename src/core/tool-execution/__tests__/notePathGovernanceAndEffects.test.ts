/**
 * FIX-44-50 / FIX-44-51 / FIX-44-52: the note_path seam, closed for real.
 *
 * FIX-44-50: a user-edited approval takes the finalContent branch, which writes
 * via safeNoteWrite and SKIPS execute(). For the memory-source pair the file is
 * only the SECONDARY effect -- the primary one is the MemorySourceStore
 * registration. Without a side-effect hook, an edited-and-approved unmark
 * removed the frontmatter marker but left the note registered: it kept being
 * extracted into Memory v2 forever, after the user revoked exactly that.
 *
 * FIX-44-51: validatePaths only knew `input.path` plus the PATH_INPUT_KEYS
 * map; `note_path` was in neither, so ignore/protected rules never ran for
 * mark/unmark. A note under an ignored folder could be registered for memory
 * extraction entirely outside governance.
 *
 * FIX-44-52: writeTargetPath returned the RAW input string while the write
 * lands on the normalized path (backslashes, leading '/'), so the pre-write
 * checkpoint and the read-cache invalidation could key a path that names no
 * file.
 */

import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { MarkNoteAsMemorySourceTool } from '../../tools/vault/MarkNoteAsMemorySourceTool';
import { UnmarkNoteAsMemorySourceTool } from '../../tools/vault/UnmarkNoteAsMemorySourceTool';
import type { ToolUse, ToolCallbacks } from '../../tools/types';
import type ObsidianAgentPlugin from '../../../main';

const NOTE_PATH = 'Notes/N.md';
const UNMARKED = '---\ntitle: T\n---\n\nbody\n';
const MARKED = '---\ntitle: T\nmemory-source: true\n---\n\nbody\n';
// User-edited variants: differ from the agent's preview.after, so the
// approval carries finalContent and the Pipeline takes the edited branch.
const USER_MARKED = '---\ntitle: T\nmemory-source: true\nreviewed: true\n---\n\nbody\n';
const USER_UNMARKED = '---\ntitle: T\nreviewed: true\n---\n\nbody\n';
const USER_MARK_STRIPPED = '---\ntitle: T\nreviewed: true\n---\n\nbody\n';

function makeCallbacks(): ToolCallbacks {
    return {
        pushToolResult: () => { /* no-op */ },
        handleError: () => Promise.resolve(),
        log: () => { /* no-op */ },
    };
}

interface HarnessOpts {
    initial: string;
    notePath?: string;
    ignored?: (p: string) => boolean;
    protectedFn?: (p: string) => boolean;
}

function makeHarness(opts: HarnessOpts) {
    const notePath = opts.notePath ?? NOTE_PATH;
    const written: Array<{ path: string; content: string }> = [];
    const file = Object.assign(new TFile(), { path: notePath, extension: 'md' });
    const snapshots: string[][] = [];
    const store = {
        upsert: vi.fn(),
        remove: vi.fn(() => true),
    };
    const indexer = { indexNote: vi.fn(() => Promise.resolve()) };

    const plugin = {
        app: {
            vault: {
                getAbstractFileByPath: (p: string) => (p === notePath ? file : null),
                read: () => Promise.resolve(opts.initial),
                modify: (f: TFile, c: string) => {
                    written.push({ path: (f as TFile & { path: string }).path, content: c });
                    return Promise.resolve();
                },
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
            isIgnored: opts.ignored ?? (() => false),
            isProtected: opts.protectedFn ?? (() => false),
            getDenialReason: (p: string) => `Denied by governance: ${p}`,
        },
        operationLogger: { log: () => Promise.resolve() },
        checkpointService: {
            snapshot: vi.fn((_taskId: string, paths: string[]) => {
                snapshots.push(paths);
                return Promise.resolve({ commitOid: 'abc', taskId: 't', paths });
            }),
        },
        memorySourceStore: store,
        frontmatterIndexer: indexer,
        trackChatLinkPath: () => { /* no-op */ },
    };
    return { plugin, written, snapshots, store, indexer };
}

type MemorySourceToolName = 'mark_note_as_memory_source' | 'unmark_note_as_memory_source';

async function makePipeline(h: ReturnType<typeof makeHarness>, toolName: MemorySourceToolName) {
    const { ToolExecutionPipeline } = await import('../ToolExecutionPipeline');
    const plugin = h.plugin as unknown as ObsidianAgentPlugin;
    const tool = toolName === 'mark_note_as_memory_source'
        ? new MarkNoteAsMemorySourceTool(plugin)
        : new UnmarkNoteAsMemorySourceTool(plugin);
    const executeSpy = vi.spyOn(tool, 'execute');
    const toolRegistry = {
        getTool: (n: string) => (n === toolName ? tool : undefined),
        getAllTools: () => [tool],
    };
    const pipeline = new (ToolExecutionPipeline as unknown as new (
        p: unknown, r: unknown, t: string, m: string,
    ) => InstanceType<typeof ToolExecutionPipeline>)(h.plugin, toolRegistry, 'task-1', 'agent');
    return { pipeline, tool, executeSpy };
}

function toolCall(name: MemorySourceToolName, notePath: string): ToolUse {
    return { type: 'tool_use', id: 'tu-1', name, input: { note_path: notePath } };
}

describe('FIX-44-50: user-edited approval still delivers the non-file effects', () => {
    it('unmark: edited approval ends with store.remove (registration revoked)', async () => {
        const h = makeHarness({ initial: MARKED });
        const { pipeline, executeSpy } = await makePipeline(h, 'unmark_note_as_memory_source');

        const result = await pipeline.executeTool(
            toolCall('unmark_note_as_memory_source', NOTE_PATH),
            makeCallbacks(),
            {
                onApprovalRequired: () =>
                    Promise.resolve({ decision: 'approved' as const, finalContent: USER_UNMARKED }),
            },
        );

        expect(result.is_error).toBeFalsy();
        // The user's version landed on disk...
        expect(h.written).toEqual([{ path: NOTE_PATH, content: USER_UNMARKED }]);
        // ...execute stayed skipped (their content must not be recomputed)...
        expect(executeSpy).not.toHaveBeenCalled();
        // ...and the PRIMARY effect still happened: the note is no longer
        // registered for memory extraction.
        expect(h.store.remove).toHaveBeenCalledWith(NOTE_PATH);
    });

    it('mark: edited approval that keeps the marker still registers the note', async () => {
        const h = makeHarness({ initial: UNMARKED });
        const { pipeline, executeSpy } = await makePipeline(h, 'mark_note_as_memory_source');

        const result = await pipeline.executeTool(
            toolCall('mark_note_as_memory_source', NOTE_PATH),
            makeCallbacks(),
            {
                onApprovalRequired: () =>
                    Promise.resolve({ decision: 'approved' as const, finalContent: USER_MARKED }),
            },
        );

        expect(result.is_error).toBeFalsy();
        expect(executeSpy).not.toHaveBeenCalled();
        expect(h.store.upsert).toHaveBeenCalledWith(NOTE_PATH, 'agent-tool');
        // Extraction is kicked off right away, same as the execute path.
        expect(h.indexer.indexNote).toHaveBeenCalled();
    });

    it('mark: when the user STRIPS the marker in their edit, nothing is registered', async () => {
        const h = makeHarness({ initial: UNMARKED });
        const { pipeline } = await makePipeline(h, 'mark_note_as_memory_source');

        await pipeline.executeTool(
            toolCall('mark_note_as_memory_source', NOTE_PATH),
            makeCallbacks(),
            {
                onApprovalRequired: () =>
                    Promise.resolve({ decision: 'approved' as const, finalContent: USER_MARK_STRIPPED }),
            },
        );

        // The user's edit removed `memory-source: true` -- registering the note
        // anyway would override the edit they just made in the gate.
        expect(h.store.upsert).not.toHaveBeenCalled();
    });
});

describe('FIX-44-51: note_path tools obey IgnoreService', () => {
    it('denies mark on an ignored path before approval and before any effect', async () => {
        const h = makeHarness({
            initial: UNMARKED,
            notePath: 'Secret/N.md',
            ignored: (p) => p.startsWith('Secret/'),
        });
        const { pipeline, executeSpy } = await makePipeline(h, 'mark_note_as_memory_source');
        const onApprovalRequired = vi.fn(() =>
            Promise.resolve({ decision: 'approved' as const }));

        const result = await pipeline.executeTool(
            toolCall('mark_note_as_memory_source', 'Secret/N.md'),
            makeCallbacks(),
            { onApprovalRequired },
        );

        expect(result.is_error).toBe(true);
        expect(JSON.stringify(result.content)).toContain('Denied by governance');
        expect(onApprovalRequired).not.toHaveBeenCalled();
        expect(executeSpy).not.toHaveBeenCalled();
        expect(h.store.upsert).not.toHaveBeenCalled();
        expect(h.written).toEqual([]);
    });

    it('denies unmark on a protected path (write-side rule)', async () => {
        const h = makeHarness({
            initial: MARKED,
            notePath: 'Templates/N.md',
            protectedFn: (p) => p.startsWith('Templates/'),
        });
        const { pipeline } = await makePipeline(h, 'unmark_note_as_memory_source');

        const result = await pipeline.executeTool(
            toolCall('unmark_note_as_memory_source', 'Templates/N.md'),
            makeCallbacks(),
            { onApprovalRequired: () => Promise.resolve({ decision: 'approved' as const }) },
        );

        expect(result.is_error).toBe(true);
        expect(h.store.remove).not.toHaveBeenCalled();
        expect(h.written).toEqual([]);
    });
});

describe('FIX-44-52: checkpoint keys the NORMALIZED write target', () => {
    it('backslash input snapshots the forward-slash path the write lands on', async () => {
        const h = makeHarness({ initial: UNMARKED });
        const { pipeline } = await makePipeline(h, 'mark_note_as_memory_source');

        const result = await pipeline.executeTool(
            toolCall('mark_note_as_memory_source', 'Notes\\N.md'),
            makeCallbacks(),
            { onApprovalRequired: () => Promise.resolve({ decision: 'approved' as const }) },
        );

        expect(result.is_error).toBeFalsy();
        // The tool normalizes and writes to Notes/N.md; the Undo snapshot must
        // cover THAT file, not the raw 'Notes\\N.md' string which names nothing.
        expect(h.snapshots).toEqual([[NOTE_PATH]]);
    });
});

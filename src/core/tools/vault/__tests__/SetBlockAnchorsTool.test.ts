/**
 * IMP-01-09-01: SetBlockAnchorsTool wiring coverage.
 *
 * The tool reads the target note once, runs the pure blockAnchorMatcher,
 * writes the result exactly once, and pushes a compact
 * `{set, missed, ambiguous}` signal so the meeting-summary skill never
 * needs the evaluate_expression debug loop. These tests pin: single
 * write, compact recovery signal, the dot-path atomic-write branch, and
 * path-traversal rejection (mirrors EditFileTool.pathTraversal.test.ts).
 */

import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';

import { SetBlockAnchorsTool } from '../SetBlockAnchorsTool';
import type { ToolCallbacks, ToolExecutionContext } from '../../types';
import type ObsidianAgentPlugin from '../../../../main';

function makeIndexedTool(initial: string): {
    tool: SetBlockAnchorsTool;
    captured: { content: string; modifyCalls: number };
} {
    const file = new TFile();
    const captured = { content: initial, modifyCalls: 0 };
    const plugin = {
        app: {
            vault: {
                getAbstractFileByPath: (_p: string) => file,
                read: (_f: TFile) => Promise.resolve(captured.content),
                modify: async (_f: TFile, content: string) => {
                    captured.content = content;
                    captured.modifyCalls++;
                },
            },
            workspace: { getLeavesOfType: () => [] },
        },
    } as unknown as ObsidianAgentPlugin;
    return { tool: new SetBlockAnchorsTool(plugin), captured };
}

function makeDotPathTool(initial: string): {
    tool: SetBlockAnchorsTool;
    captured: { content: string; writeCalls: number };
} {
    const captured = { content: initial, writeCalls: 0 };
    const plugin = {
        app: {
            vault: {
                // Dot-path files are not in Obsidian's TFile index.
                getAbstractFileByPath: (_p: string) => null,
                adapter: {
                    exists: (_p: string) => Promise.resolve(true),
                    read: (_p: string) => Promise.resolve(captured.content),
                    write: async (_p: string, content: string) => {
                        captured.content = content;
                        captured.writeCalls++;
                    },
                    // atomicAdapterWrite may probe/rename; keep it tolerant.
                    stat: (_p: string) => Promise.resolve(null),
                    remove: (_p: string) => Promise.resolve(),
                    rename: (_a: string, _b: string) => Promise.resolve(),
                },
            },
            workspace: { getLeavesOfType: () => [] },
        },
    } as unknown as ObsidianAgentPlugin;
    return { tool: new SetBlockAnchorsTool(plugin), captured };
}

function makeCapturedContext(): { context: ToolExecutionContext; results: string[]; errors: unknown[] } {
    const results: string[] = [];
    const errors: unknown[] = [];
    const callbacks: ToolCallbacks = {
        pushToolResult(content) {
            results.push(typeof content === 'string' ? content : JSON.stringify(content));
        },
        handleError(_name, err) { errors.push(err); },
        log() { /* ignore */ },
    };
    const context: ToolExecutionContext = { taskId: 'test-task', mode: 'agent', callbacks };
    return { context, results, errors };
}

describe('SetBlockAnchorsTool', () => {
    it('sets anchors on an indexed note in a single write and reports the counts', async () => {
        const { tool, captured } = makeIndexedTool(
            'Erste Aussage hier. Zweite Aussage folgt.',
        );
        const { context, results } = makeCapturedContext();

        await tool.execute(
            {
                path: 'Inbox/Meeting.md',
                anchors: [
                    { find: 'Erste Aussage hier.', id: 1 },
                    { find: 'Zweite Aussage folgt.', id: 2 },
                ],
            },
            context,
        );

        expect(captured.modifyCalls).toBe(1);
        expect(captured.content).toContain('^block-1');
        expect(captured.content).toContain('^block-2');
        expect(results).toHaveLength(1);
        expect(results[0]).toContain('2'); // set count surfaced
        expect(results[0].toLowerCase()).toContain('set');
    });

    it('reports missed anchors without corrupting the note and does not write when nothing matched', async () => {
        const { tool, captured } = makeIndexedTool('Ein ganz anderer Inhalt.');
        const { context, results } = makeCapturedContext();

        await tool.execute(
            {
                path: 'Inbox/Meeting.md',
                anchors: [{ find: 'Diese Aussage kommt im Transkript gar nicht vor.', id: 9 }],
            },
            context,
        );

        expect(captured.content).toBe('Ein ganz anderer Inhalt.'); // untouched
        expect(captured.modifyCalls).toBe(0); // nothing to write
        expect(results[0].toLowerCase()).toContain('missed');
        expect(results[0]).toContain('9');
    });

    it('uses the atomic adapter write branch for dot-path (non-indexed) files', async () => {
        const { tool, captured } = makeDotPathTool('Ein Satz im versteckten Ordner.');
        const { context } = makeCapturedContext();

        await tool.execute(
            {
                path: '.vault-operator/cache/note.md',
                anchors: [{ find: 'Ein Satz im versteckten Ordner.', id: 1 }],
            },
            context,
        );

        expect(captured.writeCalls).toBeGreaterThan(0);
        expect(captured.content).toContain('^block-1');
    });

    it('rejects a path-traversal attempt without reading or writing', async () => {
        const { tool, captured } = makeIndexedTool('irrelevant');
        const { context, results } = makeCapturedContext();

        await tool.execute(
            { path: '../../etc/passwd', anchors: [{ find: 'x', id: 1 }] },
            context,
        );

        expect(captured.modifyCalls).toBe(0);
        expect(results[0]).toContain('<error>');
    });
});

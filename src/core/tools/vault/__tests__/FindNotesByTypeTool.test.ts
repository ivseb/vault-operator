/**
 * FindNotesByTypeTool: find notes by their OKF `type` frontmatter value.
 *
 * The OKF schema keys notes by `type` (e.g. `topic`, `concept`, `meeting`,
 * `person`). Skills that link into the vault's map-of-content structure
 * (meeting-summary's `moc`/`related`, ingest, knowledge-ingest) need the
 * actual typed notes, not guessed names. This tool returns them from the
 * MetadataCache in one call, no file reads.
 */

import { describe, it, expect } from 'vitest';
import { FindNotesByTypeTool } from '../FindNotesByTypeTool';
import type { ToolCallbacks, ToolExecutionContext } from '../../types';
import type ObsidianAgentPlugin from '../../../../main';

interface FakeNote { path: string; basename: string; type?: unknown; tags?: unknown }

function makeTool(notes: FakeNote[]): FindNotesByTypeTool {
    const files = notes.map((n) => ({ path: n.path, basename: n.basename }));
    const cacheByPath = new Map(
        notes.map((n) => [n.path, { frontmatter: { type: n.type, tags: n.tags } }]),
    );
    const plugin = {
        app: {
            vault: { getMarkdownFiles: () => files },
            metadataCache: { getFileCache: (f: { path: string }) => cacheByPath.get(f.path) ?? null },
        },
        ignoreService: { isIgnored: (_p: string) => false },
    } as unknown as ObsidianAgentPlugin;
    return new FindNotesByTypeTool(plugin);
}

function makeCtx(): { context: ToolExecutionContext; results: string[] } {
    const results: string[] = [];
    const callbacks: ToolCallbacks = {
        pushToolResult(c) { results.push(typeof c === 'string' ? c : JSON.stringify(c)); },
        handleError() {},
        log() {},
    };
    return { context: { taskId: 't', mode: 'agent', callbacks }, results };
}

describe('FindNotesByTypeTool', () => {
    const vault: FakeNote[] = [
        { path: 'Themen/LLM-Gateway.md', basename: 'LLM-Gateway', type: ['topic'], tags: ['llm', 'kosten'] },
        { path: 'Themen/MCP-Katalog.md', basename: 'MCP-Katalog', type: 'topic', tags: ['mcp'] },
        { path: 'Konzepte/Verrechenbarkeit.md', basename: 'Verrechenbarkeit', type: ['concept'], tags: ['kosten'] },
        { path: 'Inbox/Some Meeting.md', basename: 'Some Meeting', type: ['meeting'], tags: [] },
        { path: 'People/Sven.md', basename: 'Sven', type: 'person' },
        { path: 'Inbox/Untyped.md', basename: 'Untyped' }, // no type
    ];

    it('returns only notes whose OKF type matches (string or array), across requested types', async () => {
        const tool = makeTool(vault);
        const { context, results } = makeCtx();

        await tool.execute({ types: ['topic', 'concept'] }, context);

        expect(results).toHaveLength(1);
        const out = results[0];
        expect(out).toContain('LLM-Gateway');
        expect(out).toContain('MCP-Katalog');
        expect(out).toContain('Verrechenbarkeit');
        // Non-matching types excluded
        expect(out).not.toContain('Some Meeting');
        expect(out).not.toContain('Sven');
        expect(out).not.toContain('Untyped');
    });

    it('is case-insensitive on the type value', async () => {
        const tool = makeTool([{ path: 'a.md', basename: 'A', type: 'Topic' }]);
        const { context, results } = makeCtx();
        await tool.execute({ types: ['topic'] }, context);
        expect(results[0]).toContain('A');
    });

    it('includes tags so a caller can match by theme, and the basename for the wikilink', async () => {
        const tool = makeTool(vault);
        const { context, results } = makeCtx();
        await tool.execute({ types: ['topic'] }, context);
        expect(results[0]).toContain('LLM-Gateway');
        expect(results[0]).toContain('llm'); // a tag surfaced for matching
    });

    it('reports no matches cleanly', async () => {
        const tool = makeTool(vault);
        const { context, results } = makeCtx();
        await tool.execute({ types: ['nonexistent-type'] }, context);
        expect(results[0].toLowerCase()).toContain('no notes');
    });

    it('rejects an empty types array', async () => {
        const tool = makeTool(vault);
        const { context, results } = makeCtx();
        await tool.execute({ types: [] }, context);
        expect(results[0]).toContain('<error>');
    });

    it('respects a limit and says the list was truncated', async () => {
        const many: FakeNote[] = Array.from({ length: 10 }, (_, i) => ({
            path: `t${i}.md`, basename: `T${i}`, type: 'topic',
        }));
        const tool = makeTool(many);
        const { context, results } = makeCtx();
        await tool.execute({ types: ['topic'], limit: 3 }, context);
        const lineCount = (results[0].match(/T\d/g) ?? []).length;
        expect(lineCount).toBe(3);
        // The model must know the list was cut, so it raises the limit ONCE
        // instead of guessing which notes are missing.
        expect(results[0].toLowerCase()).toContain('truncated');
    });

    it('keeps the result compact: at most 3 tags per note, no file paths', async () => {
        // Compactness is load-bearing: a 100-note result with 5 tags + path
        // crossed the 2k externalize threshold and sent the model into a
        // capped-tmp-re-read loop (live incident 2026-07-08).
        const tool = makeTool([{
            path: 'Notes/Deep/Nested/LLM-Gateway.md', basename: 'LLM-Gateway',
            type: 'topic', tags: ['a', 'b', 'c', 'd', 'e', 'f'],
        }]);
        const { context, results } = makeCtx();
        await tool.execute({ types: ['topic'] }, context);
        expect(results[0]).toContain('[[LLM-Gateway]]');
        expect(results[0]).toContain('a, b, c');
        expect(results[0]).not.toContain('d');
        expect(results[0]).not.toContain('Notes/Deep/Nested');
    });
});

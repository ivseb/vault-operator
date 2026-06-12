/**
 * Retrieval wave 1, item 1: prefer the opener chunk (chunkIndex 0) for
 * search excerpts so the agent sees the lede of a note instead of a
 * random middle paragraph.
 *
 * The excerpt bookkeeping in SemanticSearchTool used to be strictly
 * first-write-wins per path. These tests pin the new contract:
 *  - a result with chunkIndex === 0 provides the rendered excerpt even
 *    when a mid-document chunk arrived first, and
 *  - results without chunkIndex (older code paths, MCP) keep the old
 *    first-write-wins behavior.
 */

import { describe, it, expect } from 'vitest';
import { SemanticSearchTool } from '../SemanticSearchTool';
import type ObsidianAgentPlugin from '../../../../main';
import type { ToolExecutionContext } from '../../types';
import type { SemanticResult } from '../../../semantic/SemanticIndexService';

function ctx(): { ctx: ToolExecutionContext; results: string[]; logs: string[] } {
    const results: string[] = [];
    const logs: string[] = [];
    return {
        ctx: {
            callbacks: {
                pushToolResult: (r: string) => { results.push(r); },
                log: (m: string) => { logs.push(m); },
                handleError: async () => { /* no-op */ },
            },
        } as unknown as ToolExecutionContext,
        results,
        logs,
    };
}

function mockPlugin(opts: {
    semanticResults?: SemanticResult[];
    keywordResults?: SemanticResult[];
    tagResults?: SemanticResult[];
}): ObsidianAgentPlugin {
    const { semanticResults = [], keywordResults = [], tagResults = [] } = opts;
    return {
        app: {},
        settings: {
            hydeEnabled: false,
            enableReranking: false,
            enableGraphExpansion: false,
            enableImplicitConnections: false,
        },
        apiHandler: undefined,
        rerankerService: undefined,
        graphStore: undefined,
        ontologyStore: undefined,
        implicitConnectionService: undefined,
        semanticIndex: {
            isIndexed: true,
            search: async () => semanticResults,
            keywordSearch: async () => keywordResults,
            tagMatchSearch: async () => tagResults,
            getChunksByPath: async () => [],
        },
    } as unknown as ObsidianAgentPlugin;
}

describe('SemanticSearchTool excerpt selection (opener chunk preference)', () => {
    it('prefers the opener excerpt (chunkIndex 0) over a mid-document chunk that arrived first', async () => {
        const plugin = mockPlugin({
            // Mid-document chunk arrives first (semantic arm is remembered first)
            semanticResults: [
                { path: 'Notes/A.md', excerpt: 'MIDDLE PARAGRAPH from chunk five', score: 0.9, chunkIndex: 5 },
            ],
            // Opener chunk arrives second (keyword arm)
            keywordResults: [
                { path: 'Notes/A.md', excerpt: 'OPENER LEDE from chunk zero', score: 0.8, chunkIndex: 0 },
            ],
        });
        const tool = new SemanticSearchTool(plugin);
        const { ctx: c, results } = ctx();
        await tool.execute({ query: 'test query' }, c);

        const out = results[0];
        expect(out).toContain('Notes/A.md');
        expect(out).toContain('OPENER LEDE from chunk zero');
        expect(out).not.toContain('MIDDLE PARAGRAPH from chunk five');
    });

    it('keeps first-write-wins behavior when chunkIndex is undefined (graceful degradation)', async () => {
        const plugin = mockPlugin({
            semanticResults: [
                { path: 'Notes/A.md', excerpt: 'FIRST SEEN excerpt', score: 0.9 },
            ],
            keywordResults: [
                { path: 'Notes/A.md', excerpt: 'SECOND SEEN excerpt', score: 0.8 },
            ],
        });
        const tool = new SemanticSearchTool(plugin);
        const { ctx: c, results } = ctx();
        await tool.execute({ query: 'test query' }, c);

        const out = results[0];
        expect(out).toContain('FIRST SEEN excerpt');
        expect(out).not.toContain('SECOND SEEN excerpt');
    });

    it('prefers the opener excerpt over an undefined-chunkIndex excerpt that arrived first', async () => {
        const plugin = mockPlugin({
            semanticResults: [
                { path: 'Notes/A.md', excerpt: 'LEGACY excerpt without chunk index', score: 0.9 },
            ],
            tagResults: [
                { path: 'Notes/A.md', excerpt: 'OPENER from tag arm', score: 0.5, chunkIndex: 0 },
            ],
        });
        const tool = new SemanticSearchTool(plugin);
        const { ctx: c, results } = ctx();
        await tool.execute({ query: 'test query' }, c);

        const out = results[0];
        expect(out).toContain('OPENER from tag arm');
        expect(out).not.toContain('LEGACY excerpt without chunk index');
    });

    it('uses the opener excerpt of each path independently across multiple results', async () => {
        const plugin = mockPlugin({
            semanticResults: [
                { path: 'Notes/A.md', excerpt: 'A middle chunk', score: 0.9, chunkIndex: 3 },
                { path: 'Notes/B.md', excerpt: 'B opener chunk', score: 0.8, chunkIndex: 0 },
            ],
            keywordResults: [
                { path: 'Notes/A.md', excerpt: 'A opener chunk', score: 0.7, chunkIndex: 0 },
                { path: 'Notes/B.md', excerpt: 'B middle chunk', score: 0.6, chunkIndex: 4 },
            ],
        });
        const tool = new SemanticSearchTool(plugin);
        const { ctx: c, results } = ctx();
        await tool.execute({ query: 'test query' }, c);

        const out = results[0];
        expect(out).toContain('A opener chunk');
        expect(out).toContain('B opener chunk');
        expect(out).not.toContain('A middle chunk');
        expect(out).not.toContain('B middle chunk');
    });
});

/**
 * SearchFilesTool: match-line length cap.
 *
 * Live incident 2026-07-08 (meeting-summary): searching `\^block-\d+`
 * over an ASR transcript whose "lines" run to ~13,000 chars returned
 * 115,666 chars for 23 matches, because each match echoed the WHOLE
 * line. That blew past the 2,000-char externalize threshold, so the
 * result was written to a temp file and re-read in 50k chunks -- several
 * wasted turns per search. Match lines must be clamped to a context
 * window around the hit so a single giant line can never dump the file.
 */

import { describe, it, expect } from 'vitest';
import { SearchFilesTool } from '../SearchFilesTool';
import type { ToolCallbacks, ToolExecutionContext } from '../../types';
import type ObsidianAgentPlugin from '../../../../main';

function makeTool(files: Array<{ path: string; name: string; content: string }>): SearchFilesTool {
    const tfiles = files.map((f) => ({ path: f.path, name: f.name }));
    const contentByPath = new Map(files.map((f) => [f.path, f.content]));
    const plugin = {
        app: {
            vault: {
                getFiles: () => tfiles,
                cachedRead: (f: { path: string }) => Promise.resolve(contentByPath.get(f.path) ?? ''),
            },
        },
        ignoreService: { isIgnored: (_p: string) => false },
    } as unknown as ObsidianAgentPlugin;
    return new SearchFilesTool(plugin);
}

function makeCapturedContext(): { context: ToolExecutionContext; results: string[] } {
    const results: string[] = [];
    const callbacks: ToolCallbacks = {
        pushToolResult(content) {
            results.push(typeof content === 'string' ? content : JSON.stringify(content));
        },
        handleError() { /* ignore */ },
        log() { /* ignore */ },
    };
    return { context: { taskId: 't', mode: 'agent', callbacks }, results };
}

describe('SearchFilesTool match-line clamp', () => {
    it('clamps a giant match line to a context window instead of echoing the whole line', async () => {
        // One 8,000-char line with the needle in the middle.
        const filler = 'wort '.repeat(1600); // 8000 chars
        const line = `${filler}NEEDLE_TOKEN ${filler}`;
        const tool = makeTool([{ path: 'Inbox/T.md', name: 'T.md', content: line }]);
        const { context, results } = makeCapturedContext();

        await tool.execute({ path: '/', pattern: 'NEEDLE_TOKEN' }, context);

        expect(results).toHaveLength(1);
        // The match is found and its immediate context is shown...
        expect(results[0]).toContain('NEEDLE_TOKEN');
        // ...but the whole 16k-char line is NOT dumped. Result stays well
        // under the 2,000-char externalize threshold for a single hit.
        expect(results[0].length).toBeLessThan(2000);
    });

    it('leaves short match lines intact (only long lines are clamped)', async () => {
        const tool = makeTool([
            { path: 'Inbox/T.md', name: 'T.md', content: 'first line\n^block-7 short anchor line\nthird line' },
        ]);
        const { context, results } = makeCapturedContext();

        await tool.execute({ path: '/', pattern: '\\^block-\\d+' }, context);

        expect(results[0]).toContain('^block-7 short anchor line');
        expect(results[0]).not.toContain('…');
    });

    it('clamps every match line so many giant-line hits cannot blow up the result', async () => {
        // 20 giant lines, each with an anchor -- the meeting-summary case.
        const bigLine = (n: number) => `${'text '.repeat(2000)}^block-${n}`; // ~10k chars each
        const content = Array.from({ length: 20 }, (_, i) => bigLine(i + 1)).join('\n');
        const tool = makeTool([{ path: 'Inbox/T.md', name: 'T.md', content }]);
        const { context, results } = makeCapturedContext();

        await tool.execute({ path: '/', pattern: '\\^block-\\d+' }, context);

        // Without the clamp this was ~115k chars; with it, 20 hits stay small.
        expect(results[0].length).toBeLessThan(20 * 400);
        expect(results[0]).toContain('^block-1');
        expect(results[0]).toContain('^block-20');
    });
});

/**
 * IMP-01-04-03 (Lever C): update_frontmatter echoes the actual re-read
 * frontmatter block so the model has the authoritative post-write frontmatter
 * (and the file's top structure) without re-reading the whole file. Combined
 * with the qualified "read before edit (once)" prompt rule, this removes the
 * redundant full re-read after a write.
 */

import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { UpdateFrontmatterTool } from '../UpdateFrontmatterTool';
import type { ToolCallbacks, ToolExecutionContext } from '../../types';
import type ObsidianAgentPlugin from '../../../../main';

/**
 * FEAT-44-10: the tool no longer writes through `processFrontMatter` (which
 * cannot preview what it is about to do). It resolves the new content itself and
 * writes it via `vault.modify`, so the stub mirrors that. The echo below is now
 * built from the resolved content, i.e. by construction it IS what landed on
 * disk -- which is strictly stronger than the old re-read.
 */
function makeTool(initial: string): { tool: UpdateFrontmatterTool; captured: { content: string } } {
    const file = Object.assign(new TFile(), { path: 'Inbox/M.md', extension: 'md' });
    const captured = { content: initial };
    const plugin = {
        app: {
            vault: {
                getAbstractFileByPath: (_p: string) => file,
                read: (_f: TFile) => Promise.resolve(captured.content),
                modify: (_f: TFile, c: string) => { captured.content = c; return Promise.resolve(); },
            },
            workspace: { getLeavesOfType: () => [] },
        },
    } as unknown as ObsidianAgentPlugin;
    return { tool: new UpdateFrontmatterTool(plugin), captured };
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

describe('UpdateFrontmatterTool echo (Lever C)', () => {
    it('echoes the re-read frontmatter block so the model need not re-read the file', async () => {
        const { tool } = makeTool('---\ntitle: Old\n---\n\n### Transkript\n\nbody');
        const { context, results } = makeCtx();

        await tool.execute({ path: 'Inbox/M.md', updates: { title: 'New Title' } }, context);

        expect(results).toHaveLength(1);
        const out = results[0];
        expect(out).toContain('Updated frontmatter');
        // The authoritative post-write frontmatter block is echoed...
        expect(out).toContain('title: New Title');
        expect(out).toContain('no need to re-read');
        // ...wrapped as vault (untrusted) content.
        expect(out).toContain('untrusted-content');
    });
});

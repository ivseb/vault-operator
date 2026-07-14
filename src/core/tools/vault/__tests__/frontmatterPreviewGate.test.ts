/**
 * FEAT-44-10 (Nachzug): update_frontmatter is approved on its diff.
 *
 * The invariant that matters: `previewEdit()` (what the user sees and approves)
 * and `execute()` (what lands on disk) must produce byte-identical content. They
 * now share `resolveFrontmatterUpdate`, and these tests keep them that way. If
 * they ever drift, the approval gate silently starts lying about what it is
 * writing, which is the exact failure this whole epic exists to remove.
 */

import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { UpdateFrontmatterTool } from '../UpdateFrontmatterTool';
import { splitFrontmatter, resolveFrontmatterUpdate } from '../frontmatterEdit';
import type { ToolCallbacks, ToolExecutionContext } from '../../types';
import type ObsidianAgentPlugin from '../../../../main';

function makeTool(initial: string) {
    const file = Object.assign(new TFile(), { path: 'Inbox/M.md', extension: 'md' });
    const written: string[] = [];
    const plugin = {
        app: {
            vault: {
                getAbstractFileByPath: () => file,
                read: () => Promise.resolve(initial),
                modify: (_f: TFile, c: string) => { written.push(c); return Promise.resolve(); },
            },
            workspace: { getLeavesOfType: () => [] },
        },
    } as unknown as ObsidianAgentPlugin;
    return { tool: new UpdateFrontmatterTool(plugin), written };
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

const WITH_FM = '---\ntitle: Old\ntags:\n  - a\n---\n\n### Transkript\n\nbody';
const EMPTY_FM = '---\n---\n\n### Transkript\n\nbody';   // the OKF scaffold shape
const NO_FM = '### Transkript\n\nbody';

describe('FEAT-44-10: update_frontmatter preview matches what execute writes', () => {
    const cases: Array<[string, string, Record<string, unknown>]> = [
        ['existing frontmatter, set a field', WITH_FM, { path: 'Inbox/M.md', updates: { title: 'New' } }],
        ['existing frontmatter, add a list', WITH_FM, { path: 'Inbox/M.md', updates: { moc: ['[[Acme Cowork]]', '[[Agentic AI]]'] } }],
        ['empty frontmatter block', EMPTY_FM, { path: 'Inbox/M.md', updates: { title: 'New', type: 'interview' } }],
        ['no frontmatter at all', NO_FM, { path: 'Inbox/M.md', updates: { title: 'New' } }],
        ['remove a key', WITH_FM, { path: 'Inbox/M.md', updates: {}, remove: ['title'] }],
    ];

    it.each(cases)('%s', async (_name, initial, input) => {
        const preview = await makeTool(initial).tool.previewEdit(input);
        expect(preview).not.toBeNull();

        const { tool, written } = makeTool(initial);
        const { context } = makeCtx();
        await tool.execute(input, context);

        expect(written).toHaveLength(1);
        expect(preview!.after).toBe(written[0]);
        expect(preview!.before).toBe(initial);
    });

    it('previewEdit never writes', async () => {
        const { tool, written } = makeTool(WITH_FM);
        await tool.previewEdit({ path: 'Inbox/M.md', updates: { title: 'New' } });
        expect(written).toHaveLength(0);
    });

    it('preserves the body untouched, including the empty-frontmatter scaffold', async () => {
        const { tool, written } = makeTool(EMPTY_FM);
        const { context } = makeCtx();
        await tool.execute({ path: 'Inbox/M.md', updates: { title: 'T' } }, context);
        expect(written[0]).toContain('\n### Transkript\n\nbody');
        expect(written[0].startsWith('---\n')).toBe(true);
    });

    it('still echoes the authoritative frontmatter block to the model', async () => {
        const { tool } = makeTool(WITH_FM);
        const { context, results } = makeCtx();
        await tool.execute({ path: 'Inbox/M.md', updates: { title: 'New Title' } }, context);
        expect(results[0]).toContain('Updated frontmatter');
        expect(results[0]).toContain('title: New Title');
        expect(results[0]).toContain('no need to re-read');
        expect(results[0]).toContain('untrusted-content');
    });

    it('refuses to overwrite a frontmatter that is already broken YAML', async () => {
        const broken = '---\ntitle: Old\nthis is prose, not yaml at all\n---\n\nbody';
        const { tool, written } = makeTool(broken);
        const { context, results } = makeCtx();
        await tool.execute({ path: 'Inbox/M.md', updates: { title: 'New' } }, context);
        expect(written).toHaveLength(0);
        expect(results[0]).toMatch(/not valid YAML/i);
    });
});

describe('FIX-44-42: CRLF and BOM notes keep exactly one frontmatter block', () => {
    const CRLF_FM = '---\r\ntitle: Old\r\ntags:\r\n  - a\r\n---\r\n\r\n### Transkript\r\n\r\nbody\r\n';
    const BOM_FM = '\uFEFF---\ntitle: Old\n---\n\nbody\n';

    /** Fence lines in the note, CRLF/BOM-tolerant on purpose: the bug under test IS the intolerance. */
    function countFences(note: string): number {
        return note
            .replace(/^\uFEFF/, '')
            .split('\n')
            .filter((l) => l === '---' || l === '---\r').length;
    }

    it('update_frontmatter on a CRLF note updates the block instead of prepending a second one', async () => {
        const { tool, written } = makeTool(CRLF_FM);
        const { context } = makeCtx();
        await tool.execute({ path: 'Inbox/M.md', updates: { title: 'New' } }, context);

        expect(written).toHaveLength(1);
        const out = written[0];
        expect(countFences(out)).toBe(2);            // ONE block, not two
        expect(out).toContain('title: New');
        expect(out).not.toContain('title: Old');     // the old block was replaced, not buried
    });

    it('preserves the CRLF line-ending style of the note (no silent LF conversion)', async () => {
        const { tool, written } = makeTool(CRLF_FM);
        const { context } = makeCtx();
        await tool.execute({ path: 'Inbox/M.md', updates: { title: 'New' } }, context);

        const out = written[0];
        // The rebuilt frontmatter block uses the file's own style ...
        expect(out.startsWith('---\r\ntitle: New\r\ntags:\r\n  - a\r\n---\r\n')).toBe(true);
        // ... and the body is byte-identical to what was there before.
        expect(out.endsWith('\r\n### Transkript\r\n\r\nbody\r\n')).toBe(true);
        // No stray lone-LF lines were introduced anywhere.
        expect(out.replace(/\r\n/g, '')).not.toContain('\n');
    });

    it('CRLF preview matches what execute writes (the gate must not lie on Windows notes)', async () => {
        const input = { path: 'Inbox/M.md', updates: { title: 'New' } };
        const preview = await makeTool(CRLF_FM).tool.previewEdit(input);
        expect(preview).not.toBeNull();

        const { tool, written } = makeTool(CRLF_FM);
        const { context } = makeCtx();
        await tool.execute(input, context);
        expect(preview!.after).toBe(written[0]);
    });

    it('a leading BOM does not hide the existing block, and survives the write', async () => {
        const { tool, written } = makeTool(BOM_FM);
        const { context } = makeCtx();
        await tool.execute({ path: 'Inbox/M.md', updates: { title: 'New' } }, context);

        expect(written).toHaveLength(1);
        const out = written[0];
        expect(out.startsWith('\uFEFF---\n')).toBe(true);
        expect(countFences(out)).toBe(2);
        expect(out).toContain('title: New');
        expect(out).not.toContain('title: Old');
    });
});

describe('splitFrontmatter', () => {
    it('handles the empty block that the regex form silently misses', () => {
        // /^---\n[\s\S]*?\n---/ does NOT match "---\n---", which is exactly the
        // shape the OKF scaffolds ship with.
        expect(splitFrontmatter(EMPTY_FM)).toEqual({ fmText: '', body: '\n### Transkript\n\nbody' });
    });

    it('treats an unterminated block as no frontmatter rather than swallowing the file', () => {
        expect(splitFrontmatter('---\ntitle: x\n\nbody').fmText).toBeNull();
    });
});

describe('resolveFrontmatterUpdate', () => {
    it('keeps fields it was not asked to touch', () => {
        const { newContent } = resolveFrontmatterUpdate(WITH_FM, { title: 'New' });
        expect(newContent).toContain('tags:');
        expect(newContent).toContain('- a');
        expect(newContent).toContain('title: New');
    });

    it('emits bare fences when every key is removed, not "{}"', () => {
        const { newContent } = resolveFrontmatterUpdate(WITH_FM, {}, ['title', 'tags']);
        expect(newContent.startsWith('---\n---\n')).toBe(true);
        expect(newContent).not.toContain('{}');
    });
});

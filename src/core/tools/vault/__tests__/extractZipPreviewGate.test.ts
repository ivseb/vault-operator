/**
 * FIX-44-13b: extract_zip shows its planned file list BEFORE extracting.
 *
 * The target list of an archive is fully computable up front (dry-run over
 * the same code path as the real extraction), so the blind "extract_zip"
 * name card becomes an honest scope card: exact target paths, what is new,
 * what would be overwritten, what is skipped.
 *
 * Invariant pinned here: the preview's entry set equals the file set a real
 * run writes for the same input -- the plan and the run share one code path
 * (extractZip dryRun).
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { ExtractZipTool } from '../ExtractZipTool';
import type { ToolCallbacks, ToolExecutionContext } from '../../types';

async function buildZip(entries: Record<string, string>): Promise<ArrayBuffer> {
    const zip = new JSZip();
    for (const [name, content] of Object.entries(entries)) zip.file(name, content);
    return await zip.generateAsync({ type: 'arraybuffer' });
}

function makeAdapter(seed: Record<string, ArrayBuffer | string>) {
    const files = new Map<string, ArrayBuffer | string>(Object.entries(seed));
    const folders = new Set<string>();
    return {
        files,
        folders,
        exists: (p: string) => Promise.resolve(files.has(p) || folders.has(p)),
        mkdir: (p: string) => { folders.add(p); return Promise.resolve(); },
        writeBinary: (p: string, data: ArrayBuffer) => { files.set(p, data); return Promise.resolve(); },
        readBinary: (p: string) => {
            const value = files.get(p);
            if (value === undefined) return Promise.reject(new Error(`not found: ${p}`));
            if (typeof value === 'string') {
                const enc = new TextEncoder().encode(value);
                return Promise.resolve(enc.buffer.slice(enc.byteOffset, enc.byteOffset + enc.byteLength));
            }
            return Promise.resolve(value);
        },
    };
}

function makeTool(seed: Record<string, ArrayBuffer | string>) {
    const adapter = makeAdapter(seed);
    const plugin = { app: { vault: { adapter } } };
    const tool = new ExtractZipTool(plugin as never);
    return { tool, adapter };
}

function makeCtx(approvedBatchPaths?: ReadonlySet<string>): { context: ToolExecutionContext; results: string[] } {
    const results: string[] = [];
    const callbacks: ToolCallbacks = {
        pushToolResult(c) { results.push(typeof c === 'string' ? c : JSON.stringify(c)); },
        handleError() { return Promise.resolve(); },
        log() { /* no-op */ },
    };
    return { context: { taskId: 't', mode: 'agent', callbacks, approvedBatchPaths }, results };
}

describe('FIX-44-13b: extract_zip batch preview', () => {
    it('enumerates the exact target paths as a scope-only batch', async () => {
        const buffer = await buildZip({ 'SKILL.md': '# s', 'scripts/run.py': 'print(1)' });
        const { tool } = makeTool({ 'Inbox/skill.zip': buffer });

        const batch = await tool.previewBatch({ zip_path: 'Inbox/skill.zip', target_folder: 'Skills/new' });

        expect(batch).not.toBeNull();
        expect(batch!.scopeOnly).toBe(true);
        expect(batch!.entries.map((e) => e.path).sort()).toEqual([
            'Skills/new/SKILL.md',
            'Skills/new/scripts/run.py',
        ]);
        expect(batch!.entries.every((e) => e.isNew === true)).toBe(true);
        expect(batch!.summary.length).toBeGreaterThan(0);
    });

    it('marks existing files as overwrites, not new, when overwrite=true', async () => {
        const buffer = await buildZip({ 'a.txt': 'A', 'b.txt': 'B' });
        const { tool } = makeTool({ 'Inbox/skill.zip': buffer, 'out/a.txt': 'old' });

        const batch = await tool.previewBatch({ zip_path: 'Inbox/skill.zip', target_folder: 'out', overwrite: true });

        const a = batch!.entries.find((e) => e.path === 'out/a.txt');
        const b = batch!.entries.find((e) => e.path === 'out/b.txt');
        expect(a?.isNew).toBe(false);
        expect(b?.isNew).toBe(true);
    });

    it('omits existing files from the scope when overwrite is off (they are skipped)', async () => {
        const buffer = await buildZip({ 'a.txt': 'A', 'b.txt': 'B' });
        const { tool } = makeTool({ 'Inbox/skill.zip': buffer, 'out/a.txt': 'old' });

        const batch = await tool.previewBatch({ zip_path: 'Inbox/skill.zip', target_folder: 'out' });

        expect(batch!.entries.map((e) => e.path)).toEqual(['out/b.txt']);
    });

    it('returns null on invalid input or unreadable archive (card fallback)', async () => {
        const { tool } = makeTool({ 'Inbox/corrupt.zip': 'not a zip' });

        expect(await tool.previewBatch({ target_folder: 'out' })).toBeNull();
        expect(await tool.previewBatch({ zip_path: 'Inbox/corrupt.zip', target_folder: 'out' })).toBeNull();
    });

    it('preview equals execution: the planned set is exactly what a real run writes', async () => {
        const buffer = await buildZip({ 'a.txt': 'A', 'sub/b.txt': 'B' });
        const seed = { 'Inbox/skill.zip': buffer, 'out/a.txt': 'old' };

        const { tool: previewTool } = makeTool(seed);
        const batch = await previewTool.previewBatch({ zip_path: 'Inbox/skill.zip', target_folder: 'out' });

        const { tool: execTool, adapter } = makeTool(seed);
        const before = new Set(adapter.files.keys());
        const { context } = makeCtx();
        await execTool.execute({ zip_path: 'Inbox/skill.zip', target_folder: 'out' }, context);
        const writtenAbs = [...adapter.files.keys()].filter((p) => !before.has(p)).sort();

        expect(batch!.entries.map((e) => e.path).sort()).toEqual(writtenAbs);
    });

    it('honours the approved batch subset: skipped entries are not extracted', async () => {
        const buffer = await buildZip({ 'a.txt': 'A', 'b.txt': 'B' });
        const { tool, adapter } = makeTool({ 'Inbox/skill.zip': buffer });

        const { context, results } = makeCtx(new Set(['out/a.txt']));
        await tool.execute({ zip_path: 'Inbox/skill.zip', target_folder: 'out' }, context);

        expect(adapter.files.has('out/a.txt')).toBe(true);
        expect(adapter.files.has('out/b.txt')).toBe(false);
        expect(results.join('\n')).toContain('b.txt');
    });
});

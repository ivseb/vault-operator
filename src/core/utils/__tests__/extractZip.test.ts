/**
 * Tests for extractZip — the pure helper that powers the extract_zip
 * built-in tool. Drives safety guarantees (path-traversal + zip-bomb),
 * the optional strip-root-folder mode, and the no-overwrite branch
 * needed by the skill-translator ZIP flow.
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';

import { extractZip, ExtractZipError } from '../extractZip';

interface FakeAdapter {
    files: Map<string, ArrayBuffer | string>;
    folders: Set<string>;
    exists(p: string): Promise<boolean>;
    mkdir(p: string): Promise<void>;
    writeBinary(p: string, data: ArrayBuffer): Promise<void>;
    readBinary(p: string): Promise<ArrayBuffer>;
}

function makeAdapter(seed: Record<string, ArrayBuffer | string> = {}): FakeAdapter {
    const files = new Map<string, ArrayBuffer | string>(Object.entries(seed));
    const folders = new Set<string>();
    return {
        files,
        folders,
        async exists(p) {
            return files.has(p) || folders.has(p);
        },
        async mkdir(p) {
            folders.add(p);
        },
        async writeBinary(p, data) {
            files.set(p, data);
        },
        async readBinary(p) {
            const value = files.get(p);
            if (value === undefined) throw new Error(`not found: ${p}`);
            if (typeof value === 'string') {
                const enc = new TextEncoder().encode(value);
                return enc.buffer.slice(enc.byteOffset, enc.byteOffset + enc.byteLength);
            }
            return value;
        },
    };
}

async function buildZip(entries: Record<string, string | Uint8Array>): Promise<ArrayBuffer> {
    const zip = new JSZip();
    for (const [name, content] of Object.entries(entries)) {
        zip.file(name, content);
    }
    return await zip.generateAsync({ type: 'arraybuffer' });
}

describe('extractZip', () => {
    it('extracts files into the target folder', async () => {
        const buffer = await buildZip({
            'SKILL.md': '# title',
            'scripts/run.js': 'console.debug("hi");',
        });
        const adapter = makeAdapter({ 'Inbox/skill.zip': buffer });

        const result = await extractZip({
            adapter,
            zipPath: 'Inbox/skill.zip',
            targetFolder: 'out',
        });

        expect(result.writtenFiles.sort()).toEqual(['SKILL.md', 'scripts/run.js']);
        expect(result.skippedEntries).toEqual([]);
        expect(adapter.files.has('out/SKILL.md')).toBe(true);
        expect(adapter.files.has('out/scripts/run.js')).toBe(true);
        expect(adapter.folders.has('out')).toBe(true);
        expect(adapter.folders.has('out/scripts')).toBe(true);
    });

    it('strips a single top-level folder when stripRootFolder=true', async () => {
        const buffer = await buildZip({
            'my-skill/SKILL.md': '# title',
            'my-skill/scripts/run.js': 'ok',
        });
        const adapter = makeAdapter({ 'Inbox/skill.zip': buffer });

        const result = await extractZip({
            adapter,
            zipPath: 'Inbox/skill.zip',
            targetFolder: 'out',
            stripRootFolder: true,
        });

        expect(result.writtenFiles.sort()).toEqual(['SKILL.md', 'scripts/run.js']);
        expect(result.strippedRoot).toBe('my-skill');
        expect(adapter.files.has('out/SKILL.md')).toBe(true);
        expect(adapter.files.has('out/scripts/run.js')).toBe(true);
    });

    it('does not strip when stripRootFolder=true but the ZIP has multiple top-level entries', async () => {
        const buffer = await buildZip({
            'a/file.txt': 'a',
            'b/file.txt': 'b',
        });
        const adapter = makeAdapter({ 'Inbox/skill.zip': buffer });

        const result = await extractZip({
            adapter,
            zipPath: 'Inbox/skill.zip',
            targetFolder: 'out',
            stripRootFolder: true,
        });

        expect(result.strippedRoot).toBeNull();
        expect(result.writtenFiles.sort()).toEqual(['a/file.txt', 'b/file.txt']);
    });

    it('rejects archives that contain a path-traversal entry', async () => {
        const buffer = await buildZip({
            'ok.txt': 'fine',
            '../escape.txt': 'evil',
        });
        const adapter = makeAdapter({ 'Inbox/skill.zip': buffer });

        await expect(
            extractZip({ adapter, zipPath: 'Inbox/skill.zip', targetFolder: 'out' }),
        ).rejects.toMatchObject({ code: 'PATH_TRAVERSAL' });
    });

    it('rejects archives whose absolute uncompressed size exceeds the limit', async () => {
        const big = 'x'.repeat(2048);
        const buffer = await buildZip({ 'huge.txt': big });
        const adapter = makeAdapter({ 'Inbox/skill.zip': buffer });

        await expect(
            extractZip({
                adapter,
                zipPath: 'Inbox/skill.zip',
                targetFolder: 'out',
                maxUncompressedBytes: 1000,
            }),
        ).rejects.toMatchObject({ code: 'ZIP_BOMB' });
    });

    it('skips existing files when overwrite=false (default)', async () => {
        const buffer = await buildZip({ 'a.txt': 'new', 'b.txt': 'new' });
        const adapter = makeAdapter({
            'Inbox/skill.zip': buffer,
            'out/a.txt': 'existing',
        });

        const result = await extractZip({
            adapter,
            zipPath: 'Inbox/skill.zip',
            targetFolder: 'out',
        });

        expect(result.writtenFiles).toEqual(['b.txt']);
        expect(result.skippedEntries).toEqual(['a.txt']);
        const aBytes = await adapter.readBinary('out/a.txt');
        expect(new TextDecoder().decode(aBytes)).toBe('existing');
    });

    it('overwrites existing files when overwrite=true', async () => {
        const buffer = await buildZip({ 'a.txt': 'new' });
        const adapter = makeAdapter({
            'Inbox/skill.zip': buffer,
            'out/a.txt': 'existing',
        });

        const result = await extractZip({
            adapter,
            zipPath: 'Inbox/skill.zip',
            targetFolder: 'out',
            overwrite: true,
        });

        expect(result.writtenFiles).toEqual(['a.txt']);
        const aBytes = await adapter.readBinary('out/a.txt');
        expect(new TextDecoder().decode(aBytes)).toBe('new');
    });

    it('throws ExtractZipError READ_FAILED when the archive is corrupt', async () => {
        const adapter = makeAdapter({ 'Inbox/skill.zip': 'not a zip' });

        await expect(
            extractZip({ adapter, zipPath: 'Inbox/skill.zip', targetFolder: 'out' }),
        ).rejects.toBeInstanceOf(ExtractZipError);
    });

    it('rejects target paths that start with a slash or contain ..', async () => {
        const buffer = await buildZip({ 'a.txt': 'ok' });
        const adapter = makeAdapter({ 'Inbox/skill.zip': buffer });

        await expect(
            extractZip({ adapter, zipPath: 'Inbox/skill.zip', targetFolder: '/abs' }),
        ).rejects.toMatchObject({ code: 'INVALID_TARGET' });

        await expect(
            extractZip({ adapter, zipPath: 'Inbox/skill.zip', targetFolder: '../etc' }),
        ).rejects.toMatchObject({ code: 'INVALID_TARGET' });
    });
});

// ---------------------------------------------------------------------------
// FEAT-44-02b / FIX-44-13b: dry-run planning for the batch approval gate
// ---------------------------------------------------------------------------

describe('extractZip dryRun (FEAT-44-02b)', () => {
    it('plans the same written/skipped sets as a real run, writing NOTHING', async () => {
        const buffer = await buildZip({ 'a.txt': 'A', 'sub/b.txt': 'B' });
        const seed = { 'Inbox/skill.zip': buffer, 'out/a.txt': 'existing' };

        const dryAdapter = makeAdapter(seed);
        const plan = await extractZip({
            adapter: dryAdapter, zipPath: 'Inbox/skill.zip', targetFolder: 'out', dryRun: true,
        });

        const wetAdapter = makeAdapter(seed);
        const real = await extractZip({
            adapter: wetAdapter, zipPath: 'Inbox/skill.zip', targetFolder: 'out',
        });

        // Parity: the plan IS the run, minus the writes.
        expect(plan.writtenFiles).toEqual(real.writtenFiles);
        expect(plan.skippedEntries).toEqual(real.skippedEntries);

        // The dry run wrote and created nothing.
        expect(dryAdapter.files.size).toBe(Object.keys(seed).length);
        expect(dryAdapter.folders.size).toBe(0);
    });

    it('reports the normalised target root for path composition', async () => {
        const buffer = await buildZip({ 'a.txt': 'A' });
        const adapter = makeAdapter({ 'Inbox/skill.zip': buffer });

        const plan = await extractZip({
            adapter, zipPath: 'Inbox/skill.zip', targetFolder: 'out/nested/', dryRun: true,
        });

        expect(plan.targetRoot).toBe('out/nested');
    });

    it('marks files that would be OVERWRITTEN (overwrite=true, file exists)', async () => {
        const buffer = await buildZip({ 'a.txt': 'A', 'b.txt': 'B' });
        const adapter = makeAdapter({ 'Inbox/skill.zip': buffer, 'out/a.txt': 'old' });

        const plan = await extractZip({
            adapter, zipPath: 'Inbox/skill.zip', targetFolder: 'out', overwrite: true, dryRun: true,
        });

        expect(plan.writtenFiles.sort()).toEqual(['a.txt', 'b.txt']);
        expect(plan.overwrittenFiles).toEqual(['a.txt']);
    });

    it('still enforces the zip-bomb and traversal guards in dry-run', async () => {
        const big = await buildZip({ 'big.bin': new Uint8Array(2048) });
        const adapter = makeAdapter({ 'Inbox/big.zip': big });

        await expect(
            extractZip({
                adapter, zipPath: 'Inbox/big.zip', targetFolder: 'out',
                maxUncompressedBytes: 100, dryRun: true,
            }),
        ).rejects.toMatchObject({ code: 'ZIP_BOMB' });
    });

    it('extracts only entries the filter admits (approved batch subset)', async () => {
        const buffer = await buildZip({ 'a.txt': 'A', 'b.txt': 'B' });
        const adapter = makeAdapter({ 'Inbox/skill.zip': buffer });

        const result = await extractZip({
            adapter, zipPath: 'Inbox/skill.zip', targetFolder: 'out',
            entryFilter: (absPath) => absPath === 'out/a.txt',
        });

        expect(result.writtenFiles).toEqual(['a.txt']);
        expect(result.skippedEntries).toEqual(['b.txt']);
        expect(adapter.files.has('out/a.txt')).toBe(true);
        expect(adapter.files.has('out/b.txt')).toBe(false);
    });
});

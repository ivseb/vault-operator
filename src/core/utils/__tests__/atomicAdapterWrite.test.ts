import { describe, it, expect } from 'vitest';
import type { DataAdapter } from 'obsidian';
import { atomicAdapterWrite } from '../atomicAdapterWrite';

/**
 * Regression tests for AUDIT 2026-07-07 ATW-1 / ATW-2.
 *
 * ATW-1 (Medium, CWE-362/367): fixed `.vo-tmp` temp name + unconditional
 * remove-then-rename fallback meant two concurrent writers to the same
 * target could end with the target DELETED (writer B's rename fails because
 * its temp is gone, the fallback removes the freshly written target, the
 * second rename throws again).
 *
 * ATW-2 (Low, CWE-367/459): the remove-then-rename fallback window plus
 * orphaned temp files that were never cleaned up.
 */

interface FakeFile { content: string; mtime: number; }

class FakeAdapter {
    files = new Map<string, FakeFile>();
    /** Paths for which rename(anything, path) throws (simulates platforms
     *  refusing rename onto an existing target, iCloud locks, AV scanners). */
    failRenameOnto = new Set<string>();
    /** One-shot: the next rename fails AND the source temp vanishes first
     *  (simulates losing the race against a concurrent writer). */
    stealTmpOnNextRename = false;
    /** Count of rename attempts, to assert fallback behaviour. */
    renameCalls: Array<[string, string]> = [];
    stagedTmpPaths: string[] = [];
    /** Real epoch: the orphan sweep compares mtimes against Date.now(). */
    now = Date.now();

    async write(path: string, content: string): Promise<void> {
        if (path.includes('.vo-tmp')) this.stagedTmpPaths.push(path);
        this.files.set(path, { content, mtime: this.now });
    }
    async read(path: string): Promise<string> {
        const f = this.files.get(path);
        if (!f) throw new Error(`ENOENT: ${path}`);
        return f.content;
    }
    async exists(path: string): Promise<boolean> {
        return this.files.has(path);
    }
    async remove(path: string): Promise<void> {
        if (!this.files.delete(path)) throw new Error(`ENOENT: ${path}`);
    }
    async rename(from: string, to: string): Promise<void> {
        this.renameCalls.push([from, to]);
        if (this.stealTmpOnNextRename) {
            this.stealTmpOnNextRename = false;
            this.files.delete(from); // concurrent writer took our temp
            throw new Error(`EEXIST: ${to}`);
        }
        const f = this.files.get(from);
        if (!f) throw new Error(`ENOENT: ${from}`);
        if (this.failRenameOnto.has(to)) throw new Error(`EPERM: rename onto ${to}`);
        if (this.files.has(to)) throw new Error(`EEXIST: ${to}`);
        this.files.delete(from);
        this.files.set(to, f);
    }
    async stat(path: string): Promise<{ mtime: number } | null> {
        const f = this.files.get(path);
        return f ? { mtime: f.mtime } : null;
    }
    async list(folder: string): Promise<{ files: string[]; folders: string[] }> {
        const prefix = folder === '/' || folder === '' ? '' : `${folder}/`;
        const files = [...this.files.keys()].filter(p =>
            p.startsWith(prefix) && !p.slice(prefix.length).includes('/'));
        return { files, folders: [] };
    }
    asAdapter(): DataAdapter {
        return this as unknown as DataAdapter;
    }
}

describe('atomicAdapterWrite (ATW-1 / ATW-2)', () => {
    it('writes the target and leaves no temp file on the happy path', async () => {
        const fa = new FakeAdapter();
        await atomicAdapterWrite(fa.asAdapter(), 'dir/data.json', 'v1');
        expect(fa.files.get('dir/data.json')?.content).toBe('v1');
        expect([...fa.files.keys()].filter(p => p.includes('.vo-tmp'))).toEqual([]);
    });

    it('overwrites via the fallback when rename onto an existing target is refused', async () => {
        const fa = new FakeAdapter();
        fa.files.set('dir/data.json', { content: 'old', mtime: fa.now });
        // First rename attempt hits EEXIST (target present); fallback removes
        // the target, after which rename succeeds.
        await atomicAdapterWrite(fa.asAdapter(), 'dir/data.json', 'new');
        expect(fa.files.get('dir/data.json')?.content).toBe('new');
        expect([...fa.files.keys()].filter(p => p.includes('.vo-tmp'))).toEqual([]);
    });

    it('ATW-1: uses a unique temp name per write so concurrent writers cannot stage over each other', async () => {
        const fa = new FakeAdapter();
        await atomicAdapterWrite(fa.asAdapter(), 'dir/data.json', 'a');
        await atomicAdapterWrite(fa.asAdapter(), 'dir/data.json', 'b');
        expect(fa.stagedTmpPaths).toHaveLength(2);
        expect(fa.stagedTmpPaths[0]).not.toBe(fa.stagedTmpPaths[1]);
    });

    it('ATW-1: never deletes the target when the temp file is already gone (lost race)', async () => {
        const fa = new FakeAdapter();
        fa.files.set('dir/data.json', { content: 'winner', mtime: fa.now });
        // Simulate the losing writer: its rename fails AND its temp file has
        // been consumed by the concurrent winner before the fallback runs.
        fa.stealTmpOnNextRename = true;
        await expect(atomicAdapterWrite(fa.asAdapter(), 'dir/data.json', 'loser'))
            .rejects.toThrow();
        // The freshly written target of the winning writer must survive.
        expect(fa.files.get('dir/data.json')?.content).toBe('winner');
    });

    it('ATW-2: never leaves the target deleted when both rename attempts fail', async () => {
        const fa = new FakeAdapter();
        fa.files.set('dir/data.json', { content: 'old', mtime: fa.now });
        fa.failRenameOnto.add('dir/data.json'); // every rename onto the target throws
        await atomicAdapterWrite(fa.asAdapter(), 'dir/data.json', 'new');
        // Last-resort direct stage must have written the new content; the
        // file must never end up missing.
        expect(fa.files.get('dir/data.json')?.content).toBe('new');
        expect([...fa.files.keys()].filter(p => p.includes('.vo-tmp'))).toEqual([]);
    });

    it('ATW-2: sweeps stale orphaned temp files of the same target after a successful write', async () => {
        const fa = new FakeAdapter();
        // Orphan from a crashed earlier write, older than the sweep threshold.
        fa.files.set('dir/data.json.abc123.vo-tmp', { content: 'orphan', mtime: fa.now - 10 * 60_000 });
        await atomicAdapterWrite(fa.asAdapter(), 'dir/data.json', 'v1');
        expect(fa.files.has('dir/data.json.abc123.vo-tmp')).toBe(false);
        expect(fa.files.get('dir/data.json')?.content).toBe('v1');
    });

    it('ATW-2: does not sweep fresh temp files (concurrent writer still staging)', async () => {
        const fa = new FakeAdapter();
        // Fresh sibling temp: a concurrent writer staged it moments ago.
        fa.files.set('dir/data.json.zzz.vo-tmp', { content: 'in-flight', mtime: fa.now });
        await atomicAdapterWrite(fa.asAdapter(), 'dir/data.json', 'v1');
        expect(fa.files.has('dir/data.json.zzz.vo-tmp')).toBe(true);
    });
});

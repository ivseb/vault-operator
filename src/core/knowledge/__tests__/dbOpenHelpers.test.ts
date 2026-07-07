import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSqlModule, resetSqlModuleCache, dbSizeWarning, DB_SIZE_WARN_BYTES } from '../dbOpenHelpers';

describe('getSqlModule (issue #32: shared sql.js compile)', () => {
    beforeEach(() => resetSqlModuleCache());

    it('compiles the WASM module only once across many callers', async () => {
        const fakeModule = { Database: class {} };
        const initSqlJs = vi.fn(async () => fakeModule);
        const loadWasm = vi.fn(async () => new ArrayBuffer(8));

        const a = await getSqlModule(initSqlJs, loadWasm);
        const b = await getSqlModule(initSqlJs, loadWasm);
        const c = await getSqlModule(initSqlJs, loadWasm);

        expect(a).toBe(fakeModule);
        expect(b).toBe(fakeModule);
        expect(c).toBe(fakeModule);
        // The whole point: one compile, one base64 decode, shared by all three DBs.
        expect(initSqlJs).toHaveBeenCalledTimes(1);
        expect(loadWasm).toHaveBeenCalledTimes(1);
    });

    it('shares one in-flight compile between concurrent callers', async () => {
        const fakeModule = { Database: class {} };
        const initSqlJs = vi.fn(async () => { await new Promise((r) => setTimeout(r, 5)); return fakeModule; });
        const loadWasm = vi.fn(async () => new ArrayBuffer(8));

        const p1 = getSqlModule(initSqlJs, loadWasm);
        const p2 = getSqlModule(initSqlJs, loadWasm); // synchronous second caller, before p1 settles
        expect(p1).toBe(p2); // both share the same in-flight promise

        expect(await p1).toBe(fakeModule);
        expect(await p2).toBe(fakeModule);
        expect(initSqlJs).toHaveBeenCalledTimes(1);
        expect(loadWasm).toHaveBeenCalledTimes(1);
    });

    it('clears the cache on failure so a later call can retry', async () => {
        const failing = vi.fn(async () => { throw new Error('wasm compile failed'); });
        const loadWasm = vi.fn(async () => new ArrayBuffer(8));
        await expect(getSqlModule(failing, loadWasm)).rejects.toThrow('wasm compile failed');

        const fakeModule = { Database: class {} };
        const ok = vi.fn(async () => fakeModule);
        expect(await getSqlModule(ok, loadWasm)).toBe(fakeModule);
        expect(ok).toHaveBeenCalledTimes(1);
    });
});

describe('dbSizeWarning (issue #32: large knowledge.db)', () => {
    it('returns null within the threshold', () => {
        expect(dbSizeWarning(100, 'knowledge.db', 300)).toBeNull();
        expect(dbSizeWarning(300, 'knowledge.db', 300)).toBeNull();
    });

    it('warns above the threshold and names the file + sizes', () => {
        const msg = dbSizeWarning(400 * 1024 * 1024, 'knowledge.db', 300 * 1024 * 1024);
        expect(msg).not.toBeNull();
        expect(msg).toContain('knowledge.db');
        expect(msg).toContain('400 MB');
        expect(msg).toContain('300 MB');
    });

    it('defaults the threshold to 300 MB', () => {
        expect(DB_SIZE_WARN_BYTES).toBe(300 * 1024 * 1024);
        expect(dbSizeWarning(299 * 1024 * 1024, 'knowledge.db')).toBeNull();
        expect(dbSizeWarning(301 * 1024 * 1024, 'knowledge.db')).not.toBeNull();
    });
});

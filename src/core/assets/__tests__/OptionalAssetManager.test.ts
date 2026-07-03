/**
 * Regression tests for OptionalAssetManager.install() hash verification.
 *
 * ISSUE-B-selfdev-hash-mismatch: the expected hash is compiled into the
 * plugin at build time from the local source tree, while install()
 * downloads the asset of the released version. A locally built plugin
 * therefore always hits the hash-mismatch branch. The error message must
 * point those users to the 'Install from file' fallback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Plugin } from 'obsidian';
import { OptionalAssetManager, buildSelfDevSourceSpec, buildLocaleSpec } from '../OptionalAssetManager';

const { requestUrlMock } = vi.hoisted(() => ({ requestUrlMock: vi.fn() }));

vi.mock('obsidian', () => ({
    requestUrl: requestUrlMock,
}));

function toArrayBuffer(text: string): ArrayBuffer {
    const bytes = new TextEncoder().encode(text);
    const out = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(out).set(bytes);
    return out;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

interface AdapterMock {
    exists: ReturnType<typeof vi.fn>;
    mkdir: ReturnType<typeof vi.fn>;
    writeBinary: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    read: ReturnType<typeof vi.fn>;
    readBinary: ReturnType<typeof vi.fn>;
    stat: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
}

function makeAdapter(): AdapterMock {
    return {
        exists: vi.fn().mockResolvedValue(true),
        mkdir: vi.fn().mockResolvedValue(undefined),
        writeBinary: vi.fn().mockResolvedValue(undefined),
        write: vi.fn().mockResolvedValue(undefined),
        read: vi.fn().mockResolvedValue(''),
        readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
        stat: vi.fn().mockResolvedValue({ mtime: 0 }),
        remove: vi.fn().mockResolvedValue(undefined),
    };
}

function makePlugin(adapter: AdapterMock): Plugin {
    return {
        app: { vault: { adapter } },
        manifest: { version: '2.13.7' },
    } as unknown as Plugin;
}

describe('OptionalAssetManager.install() hash verification', () => {
    beforeEach(() => {
        requestUrlMock.mockReset();
    });

    it('points locally built users to Install from file on hash mismatch', async () => {
        const released = toArrayBuffer('released bytes that differ from the local build');
        requestUrlMock.mockResolvedValue({ status: 200, arrayBuffer: released });

        const adapter = makeAdapter();
        const manager = new OptionalAssetManager(makePlugin(adapter));
        const spec = buildSelfDevSourceSpec('2.13.7', 'a'.repeat(64));

        const err = await manager.install(spec).then(
            () => null,
            (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(Error);
        const msg = (err as Error).message;
        expect(msg).toContain('Hash mismatch for self-development-source');
        expect(msg).toContain("'Install from file'");
        expect(msg).toContain('plugin-source.json');
        expect(msg).toContain('2.13.7');
        // Nothing must be persisted on mismatch.
        expect(adapter.writeBinary).not.toHaveBeenCalled();
        expect(adapter.write).not.toHaveBeenCalled();
    });

    it('persists asset and sidecar when the hash matches', async () => {
        const data = toArrayBuffer('matching bytes');
        const sha = await sha256Hex(data);
        requestUrlMock.mockResolvedValue({ status: 200, arrayBuffer: data });

        const adapter = makeAdapter();
        const manager = new OptionalAssetManager(makePlugin(adapter));
        const spec = buildSelfDevSourceSpec('2.13.7', sha);

        await expect(manager.install(spec)).resolves.toBeDefined();
        expect(adapter.writeBinary).toHaveBeenCalledWith(
            '.vault-operator/assets/plugin-source.json',
            data,
        );
        expect(adapter.write).toHaveBeenCalledWith(
            '.vault-operator/assets/plugin-source.json.sha256',
            sha,
        );
    });
});

describe('buildLocaleSpec (FEAT-42-05)', () => {
    it('derives filename and URL from the locale code', () => {
        const spec = buildLocaleSpec('2.15.0', 'zh-tw', 'Traditional Chinese', 'b'.repeat(64));
        expect(spec.id).toBe('language-pack');
        expect(spec.filename).toBe('locale-zh-tw.json');
        expect(spec.downloadUrl).toBe(
            'https://github.com/pssah4/vault-operator/releases/download/2.15.0-assets/locale-zh-tw.json',
        );
        expect(spec.label).toContain('Traditional Chinese');
    });
});

describe('OptionalAssetManager.loadJson (FEAT-42-05)', () => {
    it('parses an installed pack whose content hash matches', async () => {
        const packObj = { 'settings.group.providers': 'Anbieter' };
        const text = JSON.stringify(packObj);
        const sha = await sha256Hex(toArrayBuffer(text));

        const adapter = makeAdapter();
        // sidecar read then content read
        adapter.read = vi.fn()
            .mockResolvedValueOnce(sha)   // sidecar .sha256
            .mockResolvedValueOnce(text); // pack content
        const manager = new OptionalAssetManager(makePlugin(adapter));
        const spec = buildLocaleSpec('2.15.0', 'de', 'Deutsch', sha);

        const loaded = await manager.loadJson<Record<string, string>>(spec);
        expect(loaded).toEqual(packObj);
    });

    it('returns null when the content hash does not match the sidecar', async () => {
        const text = JSON.stringify({ a: 'b' });
        const wrongSha = 'c'.repeat(64);

        const adapter = makeAdapter();
        adapter.read = vi.fn()
            .mockResolvedValueOnce(wrongSha) // sidecar matches spec...
            .mockResolvedValueOnce(text);    // ...but content hashes to something else
        const manager = new OptionalAssetManager(makePlugin(adapter));
        const spec = buildLocaleSpec('2.15.0', 'de', 'Deutsch', wrongSha);

        expect(await manager.loadJson(spec)).toBeNull();
    });

    it('returns null when the pack is not installed', async () => {
        const adapter = makeAdapter();
        adapter.exists = vi.fn().mockResolvedValue(false);
        const manager = new OptionalAssetManager(makePlugin(adapter));
        const spec = buildLocaleSpec('2.15.0', 'de', 'Deutsch', 'd'.repeat(64));

        expect(await manager.loadJson(spec)).toBeNull();
    });
});

describe('OptionalAssetManager.load (binary, TOCTOU content re-hash)', () => {
    it('returns null when the binary content hash does not match despite a matching sidecar', async () => {
        // Sidecar equals the expected hash (cheap pre-filter passes), but the
        // actual bytes hash to something else: an attacker swapped the file.
        const expected = 'a'.repeat(64);
        const swapped = toArrayBuffer('malicious replacement bytes');
        const adapter = makeAdapter();
        adapter.read = vi.fn().mockResolvedValue(expected); // sidecar
        adapter.readBinary = vi.fn().mockResolvedValue(swapped);
        const manager = new OptionalAssetManager(makePlugin(adapter));
        const spec = buildSelfDevSourceSpec('2.13.7', expected);

        expect(await manager.load(spec)).toBeNull();
    });

    it('returns the buffer when the content hash matches', async () => {
        const data = toArrayBuffer('trusted bundle bytes');
        const sha = await sha256Hex(data);
        const adapter = makeAdapter();
        adapter.read = vi.fn().mockResolvedValue(sha);
        adapter.readBinary = vi.fn().mockResolvedValue(data);
        const manager = new OptionalAssetManager(makePlugin(adapter));
        const spec = buildSelfDevSourceSpec('2.13.7', sha);

        expect(await manager.load(spec)).toBe(data);
    });

    it('returns null when the file is not installed', async () => {
        const adapter = makeAdapter();
        adapter.exists = vi.fn().mockResolvedValue(false);
        const manager = new OptionalAssetManager(makePlugin(adapter));
        const spec = buildSelfDevSourceSpec('2.13.7', 'a'.repeat(64));

        expect(await manager.load(spec)).toBeNull();
    });
});

describe('OptionalAssetManager path-traversal defense (AUDIT-024 L-2)', () => {
    it('throws synchronously for a spec whose filename escapes the assets folder', async () => {
        const adapter = makeAdapter();
        const manager = new OptionalAssetManager(makePlugin(adapter));
        // buildLocaleSpec('../../../secret') yields filename 'locale-../../../secret.json'.
        const spec = buildLocaleSpec('2.15.0', '../../../secret', 'Evil', 'a'.repeat(64));

        await expect(manager.load(spec)).rejects.toThrow(/unsafe asset filename/);
        await expect(manager.loadJson(spec)).rejects.toThrow(/unsafe asset filename/);
        // Nothing was read or written outside the assets folder.
        expect(adapter.readBinary).not.toHaveBeenCalled();
        expect(adapter.writeBinary).not.toHaveBeenCalled();
    });

    it('accepts a legitimate hyphenated locale filename', () => {
        const spec = buildLocaleSpec('2.15.0', 'zh-tw', 'Traditional Chinese', 'b'.repeat(64));
        // Constructing the spec and resolving its path must not throw.
        expect(spec.filename).toBe('locale-zh-tw.json');
    });
});

describe('OptionalAssetManager.install error handling', () => {
    beforeEach(() => requestUrlMock.mockReset());

    it('gives a friendly message when requestUrl rejects with a 404 (real obsidian behavior)', async () => {
        // requestUrl throws on non-2xx by default; model that as a rejected
        // promise so the sidecar catch branch (regex /\b404\b/) is exercised.
        requestUrlMock.mockRejectedValueOnce(new Error('Request failed, status 404'));
        const adapter = makeAdapter();
        const manager = new OptionalAssetManager(makePlugin(adapter));
        const spec = buildLocaleSpec('2.13.7', 'de', 'Deutsch', 'a'.repeat(64));

        let caught: unknown;
        try { await manager.install(spec); } catch (e) { caught = e; }
        expect((caught as Error)?.message).toMatch(/not published in the 2.13.7 release yet/);
        expect(adapter.writeBinary).not.toHaveBeenCalled();
    });

    it('gives the same message when requestUrl resolves with status 404', async () => {
        requestUrlMock.mockResolvedValue({ status: 404, arrayBuffer: new ArrayBuffer(0) });
        const adapter = makeAdapter();
        const manager = new OptionalAssetManager(makePlugin(adapter));
        const spec = buildLocaleSpec('2.13.7', 'de', 'Deutsch', 'a'.repeat(64));

        await expect(manager.install(spec)).rejects.toThrow(/not published in the 2.13.7 release yet/);
        expect(adapter.writeBinary).not.toHaveBeenCalled();
    });

    it('reports a generic HTTP error for a non-404 failure', async () => {
        requestUrlMock.mockResolvedValue({ status: 500, arrayBuffer: new ArrayBuffer(0) });
        const adapter = makeAdapter();
        const manager = new OptionalAssetManager(makePlugin(adapter));
        const spec = buildLocaleSpec('2.13.7', 'de', 'Deutsch', 'a'.repeat(64));

        await expect(manager.install(spec)).rejects.toThrow(/Download failed: HTTP 500/);
        expect(adapter.writeBinary).not.toHaveBeenCalled();
    });
});

describe('OptionalAssetManager.loadJson size guard (audit I-1)', () => {
    it('returns null without reading when the file exceeds the size cap', async () => {
        const adapter = makeAdapter();
        adapter.read = vi.fn().mockResolvedValue('a'.repeat(64)); // sidecar only
        adapter.stat = vi.fn().mockResolvedValue({ mtime: 0, size: 60 * 1024 * 1024 }); // 60 MB > 50 MB cap
        const manager = new OptionalAssetManager(makePlugin(adapter));
        const spec = buildLocaleSpec('2.15.0', 'de', 'Deutsch', 'a'.repeat(64));

        expect(await manager.loadJson(spec)).toBeNull();
        // The oversized file content is never read into a string.
        expect(adapter.read).not.toHaveBeenCalledWith('.vault-operator/assets/locale-de.json');
    });
});

describe('OptionalAssetManager.loadJson invalid JSON', () => {
    it('returns null when a hash-valid pack is not parseable JSON', async () => {
        const text = 'this is not json {';
        const sha = await sha256Hex(toArrayBuffer(text));
        const adapter = makeAdapter();
        adapter.read = vi.fn()
            .mockResolvedValueOnce(sha)   // sidecar
            .mockResolvedValueOnce(text); // content hashes correctly but is not JSON
        const manager = new OptionalAssetManager(makePlugin(adapter));
        const spec = buildLocaleSpec('2.13.7', 'de', 'Deutsch', sha);

        expect(await manager.loadJson(spec)).toBeNull();
    });
});

describe('OptionalAssetManager.installFromBuffer', () => {
    it('persists on a hash match without any network call', async () => {
        const data = toArrayBuffer('local pack bytes');
        const sha = await sha256Hex(data);
        const adapter = makeAdapter();
        const manager = new OptionalAssetManager(makePlugin(adapter));
        const spec = buildLocaleSpec('2.13.7', 'de', 'Deutsch', sha);

        requestUrlMock.mockClear();
        await manager.installFromBuffer(spec, data);
        expect(adapter.writeBinary).toHaveBeenCalledWith('.vault-operator/assets/locale-de.json', data);
        expect(adapter.write).toHaveBeenCalledWith('.vault-operator/assets/locale-de.json.sha256', sha);
        expect(requestUrlMock).not.toHaveBeenCalled();
    });

    it('rejects a mismatched file with the version-specific message and persists nothing', async () => {
        const data = toArrayBuffer('wrong file');
        const adapter = makeAdapter();
        const manager = new OptionalAssetManager(makePlugin(adapter));
        const spec = buildLocaleSpec('2.13.7', 'de', 'Deutsch', 'a'.repeat(64));

        await expect(manager.installFromBuffer(spec, data)).rejects.toThrow(/matching this plugin version \(2.13.7\)/);
        expect(adapter.writeBinary).not.toHaveBeenCalled();
    });
});

describe('OptionalAssetManager.snapshot', () => {
    it('reports not-installed when the file is missing', async () => {
        const adapter = makeAdapter();
        adapter.exists = vi.fn().mockResolvedValue(false);
        const manager = new OptionalAssetManager(makePlugin(adapter));
        const spec = buildLocaleSpec('2.13.7', 'de', 'Deutsch', 'a'.repeat(64));

        expect((await manager.snapshot(spec)).status).toBe('not-installed');
    });

    it('reports installed when the sidecar matches the expected hash', async () => {
        const adapter = makeAdapter();
        adapter.read = vi.fn().mockResolvedValue('a'.repeat(64));
        adapter.stat = vi.fn().mockResolvedValue({ mtime: 1_700_000_000_000 });
        const manager = new OptionalAssetManager(makePlugin(adapter));
        const spec = buildLocaleSpec('2.13.7', 'de', 'Deutsch', 'a'.repeat(64));

        const snap = await manager.snapshot(spec);
        expect(snap.status).toBe('installed');
        expect(snap.installedAt).toBeDefined();
    });

    it('reports outdated when the sidecar hash differs (plugin updated)', async () => {
        const adapter = makeAdapter();
        adapter.read = vi.fn().mockResolvedValue('b'.repeat(64));
        const manager = new OptionalAssetManager(makePlugin(adapter));
        const spec = buildLocaleSpec('2.13.7', 'de', 'Deutsch', 'a'.repeat(64));

        expect((await manager.snapshot(spec)).status).toBe('outdated');
    });
});

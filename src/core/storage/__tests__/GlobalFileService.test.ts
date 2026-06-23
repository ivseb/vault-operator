import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GlobalFileService } from '../GlobalFileService';
import * as safeFs from '../../security/safeFs';
import pathModule from 'path';
import * as os from 'os';
import * as realFs from 'fs';

describe('GlobalFileService', () => {
    describe('constructor', () => {
        it('should use vault parent directory when vaultBasePath provided', () => {
            const service = new GlobalFileService('/Users/test/Documents/MyVault');
            expect(service.getRoot()).toBe(
                pathModule.join('/Users/test/Documents', 'vault-operator-shared'),
            );
        });

        it('should use home directory when no vaultBasePath', () => {
            const service = new GlobalFileService();
            // Constructor probes for legacy folder names in the home dir and stays put if any exists;
            // otherwise it falls back to the fresh-install name. Accept all three so the test works
            // regardless of the developer's local home-dir state.
            const root = service.getRoot();
            const hasAcceptableName = ['vault-operator-shared', 'obsilo-shared', '.obsidian-agent']
                .some((name) => root.endsWith(name));
            expect(hasAcceptableName).toBe(true);
        });
    });

    describe('resolvePath', () => {
        it('should resolve relative paths within root', () => {
            const service = new GlobalFileService('/Users/test/Vault');
            const resolved = service.resolvePath('memory/user-profile.md');
            expect(resolved).toBe(
                pathModule.join('/Users/test', 'vault-operator-shared', 'memory', 'user-profile.md'),
            );
        });

        it('should block path traversal with ../', () => {
            const service = new GlobalFileService('/Users/test/Vault');
            expect(() => service.resolvePath('../../etc/passwd')).toThrow('Path traversal blocked');
        });

        it('should block path traversal with absolute paths', () => {
            const service = new GlobalFileService('/Users/test/Vault');
            // Path.join normalizes this, but if the result escapes root, it should throw
            expect(() => service.resolvePath('../../../tmp/evil')).toThrow('Path traversal blocked');
        });

        it('should allow resolving root itself', () => {
            const service = new GlobalFileService('/Users/test/Vault');
            // Empty path resolves to root — but path.join('root', '') = 'root'
            // which equals this.root, so it should NOT throw
            const resolved = service.resolvePath('');
            expect(resolved).toBe(pathModule.join('/Users/test', 'vault-operator-shared'));
        });
    });

    describe('getLegacyRoot', () => {
        it('should return a path containing .obsidian-agent in home dir', () => {
            const legacyRoot = GlobalFileService.getLegacyRoot();
            expect(legacyRoot).toContain('.obsidian-agent');
        });
    });

    // M-6 (AUDIT-034): files written by GlobalFileService must be owner-only
    // on POSIX so secrets, history, and memory facts are not world-readable.
    // Windows ignores POSIX modes and is skipped at runtime by the production
    // code; the test is also POSIX-only.
    describe('owner-only file mode (M-6)', () => {
        const isWindows = process.platform === 'win32';
        let tempBase: string;
        let vaultRoot: string;
        let service: GlobalFileService;

        beforeEach(() => {
            tempBase = realFs.mkdtempSync(pathModule.join(os.tmpdir(), 'gfs-mode-test-'));
            vaultRoot = pathModule.join(tempBase, 'vault');
            realFs.mkdirSync(vaultRoot, { recursive: true });

            safeFs.resetForTest();
            safeFs.initialize({
                vaultRoot,
                pluginDataDir: pathModule.join(vaultRoot, '.obsidian', 'plugins', 'vault-operator'),
                agentConfigDir: pathModule.join(vaultRoot, '.obsidian-agent'),
                systemTempDir: os.tmpdir(),
                desktopConfigDirs: [],
                extraRoots: [tempBase],
            });

            service = new GlobalFileService(vaultRoot);
        });

        afterEach(() => {
            safeFs.resetForTest();
            try {
                realFs.rmSync(tempBase, { recursive: true, force: true });
            } catch {
                // best-effort cleanup
            }
        });

        it.skipIf(isWindows)('write() clamps the file mode to 0o600', async () => {
            await service.write('secrets.json', '{"apiKey":"x"}');
            const stat = realFs.statSync(pathModule.join(service.getRoot(), 'secrets.json'));
            // Mask off the type bits, only the permission bits matter.
            expect(stat.mode & 0o777).toBe(0o600);
        });

        it.skipIf(isWindows)('writeBinary() clamps the file mode to 0o600', async () => {
            await service.writeBinary('memory.db', new Uint8Array([1, 2, 3]));
            const stat = realFs.statSync(pathModule.join(service.getRoot(), 'memory.db'));
            expect(stat.mode & 0o777).toBe(0o600);
        });

        it.skipIf(isWindows)('append() clamps the file mode to 0o600 on existing files', async () => {
            // Seed the file with a wider mode to confirm append re-clamps it.
            const abs = pathModule.join(service.getRoot(), 'history.jsonl');
            realFs.mkdirSync(service.getRoot(), { recursive: true });
            realFs.writeFileSync(abs, 'seed\n', { mode: 0o644 });
            // Verify the pre-condition (file is world-readable before append).
            expect(realFs.statSync(abs).mode & 0o777).toBe(0o644);

            await service.append('history.jsonl', 'next\n');
            expect(realFs.statSync(abs).mode & 0o777).toBe(0o600);
        });

        it.skipIf(isWindows)('write() re-clamps the mode on overwrite', async () => {
            // First write creates with 0o600. Manually widen it, then overwrite,
            // and verify the chmod-after-write path restores 0o600.
            await service.write('settings.json', '{}');
            const abs = pathModule.join(service.getRoot(), 'settings.json');
            realFs.chmodSync(abs, 0o644);
            expect(realFs.statSync(abs).mode & 0o777).toBe(0o644);

            await service.write('settings.json', '{"v":2}');
            expect(realFs.statSync(abs).mode & 0o777).toBe(0o600);
        });
    });
});

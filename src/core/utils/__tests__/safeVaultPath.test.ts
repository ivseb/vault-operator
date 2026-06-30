import { describe, it, expect } from 'vitest';
import { isDangerousVaultPath, validateVaultRelativePath } from '../safeVaultPath';

describe('safeVaultPath', () => {
    describe('isDangerousVaultPath', () => {
        it('rejects empty string', () => {
            expect(isDangerousVaultPath('')).toBe(true);
        });
        it('rejects null byte', () => {
            expect(isDangerousVaultPath('a/b\0c')).toBe(true);
        });
        it('rejects posix absolute', () => {
            expect(isDangerousVaultPath('/etc/passwd')).toBe(true);
        });
        it('rejects Windows drive letter', () => {
            expect(isDangerousVaultPath('C:\\Users\\evil')).toBe(true);
            expect(isDangerousVaultPath('D:/foo')).toBe(true);
        });
        it('rejects UNC path', () => {
            expect(isDangerousVaultPath('\\\\server\\share')).toBe(true);
        });
        it('rejects parent-dir segment', () => {
            expect(isDangerousVaultPath('a/../b')).toBe(true);
            expect(isDangerousVaultPath('../etc/passwd')).toBe(true);
            expect(isDangerousVaultPath('a/b/..')).toBe(true);
        });
        it('rejects backslash parent-dir on Windows-shaped input', () => {
            expect(isDangerousVaultPath('a\\..\\b')).toBe(true);
        });
        it('accepts plain vault-relative path', () => {
            expect(isDangerousVaultPath('Notes/foo.md')).toBe(false);
            expect(isDangerousVaultPath('Skills/my-skill/SKILL.md')).toBe(false);
        });
        it('accepts a file at vault root', () => {
            expect(isDangerousVaultPath('README.md')).toBe(false);
        });
    });

    describe('validateVaultRelativePath with expectedPrefix', () => {
        it('rejects when path is outside the prefix', () => {
            const r = validateVaultRelativePath('OtherCategory/file.md', { expectedPrefix: 'BackupCat' });
            expect(r.ok).toBe(false);
            expect(r.reason).toBe('outside-prefix');
        });

        it('rejects a prefix-prefix attack (BackupCat-other vs BackupCat/)', () => {
            const r = validateVaultRelativePath('BackupCat-evil/file.md', { expectedPrefix: 'BackupCat' });
            expect(r.ok).toBe(false);
            expect(r.reason).toBe('outside-prefix');
        });

        it('accepts a path inside the prefix', () => {
            const r = validateVaultRelativePath('BackupCat/sub/file.md', { expectedPrefix: 'BackupCat' });
            expect(r.ok).toBe(true);
        });

        it('accepts a path equal to the prefix (single-file category root)', () => {
            const r = validateVaultRelativePath('BackupCat', { expectedPrefix: 'BackupCat' });
            expect(r.ok).toBe(true);
        });

        it('still rejects traversal even when prefix would otherwise match', () => {
            const r = validateVaultRelativePath('BackupCat/../etc/passwd', { expectedPrefix: 'BackupCat' });
            expect(r.ok).toBe(false);
            expect(r.reason).toBe('parent-segment');
        });

        it('treats empty prefix as no confinement', () => {
            const r = validateVaultRelativePath('Anywhere/in/vault.md', { expectedPrefix: '' });
            expect(r.ok).toBe(true);
        });

        it('normalises trailing slashes in the prefix', () => {
            const r = validateVaultRelativePath('BackupCat/file.md', { expectedPrefix: 'BackupCat/' });
            expect(r.ok).toBe(true);
        });

        it('AUDIT-040 H-1 canonical exploit: backup ZIP fileEntry ../../evil', () => {
            // The Zip-Slip primitive from AUDIT-040: a backup manifest
            // file entry with parent segments must be rejected before
            // it reaches vault.adapter.writeBinary.
            const r = validateVaultRelativePath('../../../etc/passwd', { expectedPrefix: 'Backups' });
            expect(r.ok).toBe(false);
            expect(r.reason).toBe('parent-segment');
        });

        it('AUDIT-040 H-1 canonical exploit: absolute path slips through manifest', () => {
            const r = validateVaultRelativePath('/etc/passwd', { expectedPrefix: 'Backups' });
            expect(r.ok).toBe(false);
            expect(r.reason).toBe('absolute-posix');
        });
    });
});

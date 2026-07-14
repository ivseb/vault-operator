/**
 * REF-11: regression tests for IgnoreService.
 *
 * The service is the central path-allowlist gate; it had no tests at all
 * which the stability audit flagged. These pin the documented behaviour:
 *   - fail-closed before load()
 *   - always-blocked paths (.git, configDir/workspace, configDir/cache)
 *   - always-protected governance files
 *   - gitignore-style pattern matching (basename, slash-rooted, **)
 *   - safe normalisation of leading slashes and backslashes
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Vault } from 'obsidian';
import { IgnoreService } from '../IgnoreService';

interface AdapterStub {
    read: (p: string) => Promise<string>;
}

function makeVault(
    files: Record<string, string> = {},
    configDir = '.obsidian',
): Vault {
    const adapter: AdapterStub = {
        read: async (p: string) => {
            const content = files[p];
            if (content === undefined) throw new Error('ENOENT');
            return content;
        },
    };
    return {
        configDir,
        adapter,
        getAbstractFileByPath: (p: string) => (files[p] !== undefined ? { path: p } : null),
    } as unknown as Vault;
}

describe('IgnoreService', () => {
    describe('fail-closed', () => {
        it('blocks everything before load() is called', () => {
            const svc = new IgnoreService(makeVault());
            expect(svc.isIgnored('Notes/foo.md')).toBe(true);
            expect(svc.isProtected('Notes/foo.md')).toBe(true);
        });
    });

    describe('FIX-44-24: agent config-zone protection', () => {
        let svc: IgnoreService;
        beforeEach(async () => {
            svc = new IgnoreService(makeVault({}), '.vault-operator');
            await svc.load();
        });

        it('write-protects the global settings file', () => {
            expect(svc.isProtected('.vault-operator/data/settings.json')).toBe(true);
        });

        it('write-protects the provenance manifest and mcp config', () => {
            expect(svc.isProtected('.vault-operator/data/skill-provenance.json')).toBe(true);
            expect(svc.isProtected('.vault-operator/data/mcp-servers.json')).toBe(true);
        });

        it('leaves the skill workspace writable (skills/ and skill-data/)', () => {
            expect(svc.isProtected('.vault-operator/data/skills/mine/SKILL.md')).toBe(false);
            expect(svc.isProtected('.vault-operator/data/skill-data/mine/state.json')).toBe(false);
        });

        it('does nothing when no agent root is configured', () => {
            const bare = new IgnoreService(makeVault({}));
            return bare.load().then(() => {
                expect(bare.isProtected('.vault-operator/data/settings.json')).toBe(false);
            });
        });

        // AUDIT 2026-07-14 H-2: the config zone must also be READ-blocked, not
        // just write-protected. A remote MCP client or read_file could otherwise
        // exfiltrate settings.json (provider apiKeys, MCP auth headers).
        it('read-blocks (isIgnored) the settings/data/provenance zone', () => {
            expect(svc.isIgnored('.vault-operator/data/settings.json')).toBe(true);
            expect(svc.isIgnored('.vault-operator/data/skill-provenance.json')).toBe(true);
            expect(svc.isIgnored('.vault-operator/data/mcp-servers.json')).toBe(true);
        });

        it('keeps the skill workspace and tmp results readable', () => {
            expect(svc.isIgnored('.vault-operator/data/skills/mine/SKILL.md')).toBe(false);
            expect(svc.isIgnored('.vault-operator/data/skill-data/mine/state.json')).toBe(false);
            // Externalised tool results (BUG-020) must stay readable.
            expect(svc.isIgnored('.vault-operator/tmp/task-42/result.md')).toBe(false);
        });

        // H-3: `.Vault-Operator/...` resolves to the same file on case-insensitive
        // filesystems, so the secret-zone deny must be case-insensitive.
        it('read-blocks the config zone case-insensitively (provenance forge, cred leak)', () => {
            expect(svc.isIgnored('.Vault-Operator/data/settings.json')).toBe(true);
            expect(svc.isIgnored('.VAULT-OPERATOR/data/skill-provenance.json')).toBe(true);
        });
    });

    describe('always-blocked paths', () => {
        let svc: IgnoreService;
        beforeEach(async () => {
            svc = new IgnoreService(makeVault({}));
            await svc.load();
        });

        it('blocks .git/ and children', () => {
            expect(svc.isIgnored('.git/HEAD')).toBe(true);
            expect(svc.isIgnored('.git/refs/heads/main')).toBe(true);
        });

        it('blocks Obsidian workspace + cache', () => {
            expect(svc.isIgnored('.obsidian/workspace')).toBe(true);
            expect(svc.isIgnored('.obsidian/workspace.json')).toBe(true);
            expect(svc.isIgnored('.obsidian/cache')).toBe(true);
        });

        // AUDIT 2026-07-14 H-1/H-2: configDir is a full read+write deny-zone.
        // The prior behaviour (plugin folder readable "so the agent can read its
        // own plugin") let a write reach `.obsidian/plugins/<x>/main.js` (RCE on
        // reload) and let read_file/MCP exfiltrate any plugin's data.json.
        it('blocks the entire configDir tree read+write (main.js RCE, data.json creds)', () => {
            expect(svc.isIgnored('.obsidian/plugins/vault-operator/main.js')).toBe(true);
            expect(svc.isIgnored('.obsidian/plugins/vault-operator/data.json')).toBe(true);
            expect(svc.isIgnored('.obsidian/plugins/other-plugin/data.json')).toBe(true);
            expect(svc.isIgnored('.obsidian/community-plugins.json')).toBe(true);
        });

        // H-3: case-insensitive so a `.Obsidian/...` variant cannot slip past on
        // macOS/APFS, Windows/NTFS or iOS.
        it('blocks configDir case-insensitively', () => {
            expect(svc.isIgnored('.Obsidian/plugins/vault-operator/data.json')).toBe(true);
            expect(svc.isIgnored('.OBSIDIAN/community-plugins.json')).toBe(true);
        });

        it('allows normal vault paths', () => {
            expect(svc.isIgnored('Notes/Subject.md')).toBe(false);
            expect(svc.isIgnored('Inbox/something.md')).toBe(false);
        });
    });

    describe('always-protected governance files', () => {
        it('protects .obsidian-agentignore and .obsidian-agentprotected', async () => {
            const svc = new IgnoreService(makeVault({}));
            await svc.load();
            expect(svc.isProtected('.obsidian-agentignore')).toBe(true);
            expect(svc.isProtected('.obsidian-agentprotected')).toBe(true);
        });
    });

    describe('gitignore-style patterns', () => {
        it('basename pattern matches anywhere in the tree', async () => {
            const svc = new IgnoreService(makeVault({
                '.obsidian-agentignore': 'secret.md',
            }));
            await svc.load();
            expect(svc.isIgnored('secret.md')).toBe(true);
            expect(svc.isIgnored('Notes/secret.md')).toBe(true);
            expect(svc.isIgnored('Notes/Sub/secret.md')).toBe(true);
        });

        it('directory pattern (trailing slash) matches the folder and children', async () => {
            const svc = new IgnoreService(makeVault({
                '.obsidian-agentignore': 'Private/',
            }));
            await svc.load();
            expect(svc.isIgnored('Private')).toBe(true);
            expect(svc.isIgnored('Private/a.md')).toBe(true);
            expect(svc.isIgnored('Private/deep/sub.md')).toBe(true);
            expect(svc.isIgnored('Notes/Private/a.md')).toBe(false);
        });

        it('* matches anything except /', async () => {
            const svc = new IgnoreService(makeVault({
                '.obsidian-agentignore': '*.tmp',
            }));
            await svc.load();
            expect(svc.isIgnored('Notes/scratch.tmp')).toBe(true);
            expect(svc.isIgnored('temp.tmp')).toBe(true);
        });

        it('** matches across directory boundaries', async () => {
            const svc = new IgnoreService(makeVault({
                '.obsidian-agentignore': 'archive/**',
            }));
            await svc.load();
            expect(svc.isIgnored('archive/2024/old.md')).toBe(true);
            expect(svc.isIgnored('archive/x.md')).toBe(true);
        });

        it('skips negation patterns (! prefix) -- documented limitation', async () => {
            const svc = new IgnoreService(makeVault({
                '.obsidian-agentignore': '*.md\n!important.md',
            }));
            await svc.load();
            // negation is silently skipped -- important.md stays blocked
            expect(svc.isIgnored('important.md')).toBe(true);
        });

        it('skips comment lines and blanks', async () => {
            const svc = new IgnoreService(makeVault({
                '.obsidian-agentignore': '# comment\n\nsecret.md\n',
            }));
            await svc.load();
            expect(svc.isIgnored('secret.md')).toBe(true);
            expect(svc.isIgnored('comment')).toBe(false);
        });

        it('rejects pathologically long patterns (ReDoS guard)', async () => {
            const longPattern = '*'.repeat(250);
            const svc = new IgnoreService(makeVault({
                '.obsidian-agentignore': longPattern,
            }));
            await svc.load();
            expect(svc.isIgnored('whatever.md')).toBe(false);
        });
    });

    describe('path normalisation', () => {
        it('strips leading slashes and normalises backslashes', async () => {
            const svc = new IgnoreService(makeVault({
                '.obsidian-agentignore': 'Private/',
            }));
            await svc.load();
            expect(svc.isIgnored('/Private/x.md')).toBe(true);
            expect(svc.isIgnored('Private\\x.md')).toBe(true);
        });
    });

    describe('getDenialReason', () => {
        it('returns the protected reason first, then ignored', async () => {
            const svc = new IgnoreService(makeVault({
                '.obsidian-agentignore': '*.tmp',
                '.obsidian-agentprotected': 'locked.md',
            }));
            await svc.load();
            expect(svc.getDenialReason('locked.md')).toMatch(/protected/);
            expect(svc.getDenialReason('foo.tmp')).toMatch(/excluded/);
            // .git/HEAD is always-blocked, so it surfaces as "excluded" too.
            expect(svc.getDenialReason('.git/HEAD')).toMatch(/excluded/);
        });
    });
});

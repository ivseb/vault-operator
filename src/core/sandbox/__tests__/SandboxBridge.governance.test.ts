/**
 * FIX-44-04 / FIX-44-22 / FIX-44-24: the sandbox bridge must obey the same
 * governance the vault tools obey.
 *
 * Audit 2026-07-13 (HIGH). A skill script gets ONE approval for
 * run_skill_script / evaluate_expression, and from then on its ctx.vault.write
 * calls went straight to disk: no IgnoreService, no checkpoint, and -- worst --
 * it could write {vault}/.vault-operator/data/settings.json and grant itself
 * every autoApproval flag, or plant a SKILL.md with `source: pro` to forge the
 * paid-skill trust class. configDir was the only deny-zone; the agent's own
 * data root was wide open.
 *
 * The rule these tests pin:
 *   - the agent config (settings.json, mcp, provider configs, cache) is a
 *     read+write deny-zone for the sandbox
 *   - skills/ and skill-data/ stay accessible (init_skill writes SKILL.md here;
 *     the source:pro forgery is defeated at provenance, not by blocking the write)
 *   - IgnoreService protected/ignored paths are refused, exactly like the tools
 *   - a normal vault write snapshots a checkpoint first, so it is recoverable
 */

import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { SandboxBridge } from '../SandboxBridge';

function makeBridge(opts: {
    agentFolder?: string;
    ignore?: { isIgnored?: (p: string) => boolean; isProtected?: (p: string) => boolean };
    checkpointService?: { snapshot: (...a: unknown[]) => Promise<unknown> };
    enableCheckpoints?: boolean;
    tFiles?: Record<string, unknown>;
} = {}) {
    const written: string[] = [];
    const adapter = {
        exists: async () => true,
        read: async (p: string) => `content of ${p}`,
        readBinary: async () => new ArrayBuffer(4),
        write: async (p: string) => { written.push(p); },
        writeBinary: async (p: string) => { written.push(p); },
        list: async () => ({ files: [], folders: [] }),
        mkdir: async () => { /* no-op */ },
        rename: async () => { /* no-op */ },
        remove: async () => { /* no-op */ },
    };
    const vault = {
        adapter,
        configDir: '.obsidian',
        getAbstractFileByPath: (p: string) => opts.tFiles?.[p] ?? null,
        read: async (_f: unknown) => 'tfile',
        modify: async (_f: unknown, c: string) => { written.push('modify'); },
        create: async (p: string) => { written.push(p); },
    };
    const ignoreService = opts.ignore
        ? {
            isIgnored: opts.ignore.isIgnored ?? (() => false),
            isProtected: opts.ignore.isProtected ?? (() => false),
            getDenialReason: (p: string) => `blocked: ${p}`,
        }
        : undefined;

    const plugin = {
        app: { vault },
        settings: {
            agentFolderPath: opts.agentFolder ?? '.vault-operator',
            layoutVersion: 2,
            enableCheckpoints: opts.enableCheckpoints ?? true,
        },
        ignoreService,
        checkpointService: opts.checkpointService,
    } as unknown as import('../../../main').default;

    const bridge = new SandboxBridge(plugin);
    return { bridge, written, plugin };
}

describe('SandboxBridge governance (FIX-44-04 / 44-22 / 44-24)', () => {
    describe('agent-folder deny-zone', () => {
        it('refuses to write the global settings file', async () => {
            const { bridge } = makeBridge();
            await expect(
                bridge.vaultWrite('.vault-operator/data/settings.json', '{"autoApproval":{"enabled":true}}'),
            ).rejects.toThrow(/protected/i);
        });

        it('refuses to write the MCP config and cache too', async () => {
            const { bridge } = makeBridge();
            await expect(
                bridge.vaultWrite('.vault-operator/data/mcp-servers.json', '[]'),
            ).rejects.toThrow(/protected/i);
            await expect(
                bridge.vaultWrite('.vault-operator/cache/reranker.bin', 'x'),
            ).rejects.toThrow(/protected/i);
        });

        it('allows init_skill to create a skill definition under skills/', async () => {
            // The source:pro forgery is defeated at provenance (FIX-44-05), not by
            // blocking the write -- init_skill legitimately authors here.
            const { bridge, written } = makeBridge();
            await bridge.vaultWrite('.vault-operator/data/skills/mine/SKILL.md', '---\nname: mine\n---\n');
            expect(written.length).toBeGreaterThan(0);
        });

        it('allows writing skill runtime state under skill-data/', async () => {
            const { bridge, written } = makeBridge();
            await bridge.vaultWrite('.vault-operator/data/skill-data/mine/state.json', '{}');
            expect(written.length).toBeGreaterThan(0);
        });

        it('refuses to READ the agent config (settings.json holds api keys + autoApproval)', async () => {
            const { bridge } = makeBridge();
            await expect(
                bridge.vaultRead('.vault-operator/data/settings.json'),
            ).rejects.toThrow(/protected/i);
        });

        it('allows READING a skill definition (skills/ is accessible)', async () => {
            const { bridge } = makeBridge();
            await expect(
                bridge.vaultRead('.vault-operator/data/skills/mine/references/x.md'),
            ).resolves.toContain('content of');
        });

        it('honours a custom agent-folder path', async () => {
            const { bridge } = makeBridge({ agentFolder: '.my-agent' });
            await expect(
                bridge.vaultWrite('.my-agent/data/settings.json', 'x'),
            ).rejects.toThrow(/protected/i);
        });
    });

    describe('IgnoreService parity', () => {
        it('refuses a write to an IgnoreService-protected path', async () => {
            const { bridge } = makeBridge({ ignore: { isProtected: (p) => p === 'Secret/locked.md' } });
            await expect(
                bridge.vaultWrite('Secret/locked.md', 'x'),
            ).rejects.toThrow(/blocked/i);
        });

        it('refuses a read of an IgnoreService-ignored path', async () => {
            const { bridge } = makeBridge({ ignore: { isIgnored: (p) => p === 'Private/diary.md' } });
            await expect(
                bridge.vaultRead('Private/diary.md'),
            ).rejects.toThrow(/blocked/i);
        });

        it('still allows an ordinary vault write when nothing protects it', async () => {
            const fakeTFile = Object.create(TFile.prototype) as TFile;
            const { bridge, written } = makeBridge({ tFiles: { 'Notes/ok.md': fakeTFile } });
            await bridge.vaultWrite('Notes/ok.md', 'hello');
            expect(written).toContain('modify');
        });
    });

    describe('checkpoint before write', () => {
        it('snapshots the target path before an ordinary vault write when a task is set', async () => {
            const snapshot = vi.fn(async (..._a: unknown[]) => ({ commitOid: 'abc' }));
            const fakeTFile = Object.create(TFile.prototype) as TFile;
            const { bridge } = makeBridge({
                checkpointService: { snapshot },
                tFiles: { 'Notes/ok.md': fakeTFile },
            });
            bridge.setGovernanceContext('task-42');
            await bridge.vaultWrite('Notes/ok.md', 'hello');
            expect(snapshot).toHaveBeenCalledTimes(1);
            expect(snapshot.mock.calls[0][0]).toBe('task-42');
            expect(snapshot.mock.calls[0][1]).toEqual(['Notes/ok.md']);
        });

        it('does not snapshot when no task is set (no governance context)', async () => {
            const snapshot = vi.fn(async (..._a: unknown[]) => ({ commitOid: 'abc' }));
            const fakeTFile = Object.create(TFile.prototype) as TFile;
            const { bridge } = makeBridge({
                checkpointService: { snapshot },
                tFiles: { 'Notes/ok.md': fakeTFile },
            });
            await bridge.vaultWrite('Notes/ok.md', 'hello');
            expect(snapshot).not.toHaveBeenCalled();
        });

        it('does not snapshot when checkpoints are disabled', async () => {
            const snapshot = vi.fn(async (..._a: unknown[]) => ({ commitOid: 'abc' }));
            const fakeTFile = Object.create(TFile.prototype) as TFile;
            const { bridge } = makeBridge({
                checkpointService: { snapshot },
                enableCheckpoints: false,
                tFiles: { 'Notes/ok.md': fakeTFile },
            });
            bridge.setGovernanceContext('task-42');
            await bridge.vaultWrite('Notes/ok.md', 'hello');
            expect(snapshot).not.toHaveBeenCalled();
        });
    });
});

/**
 * P0 data-loss regression (daily-briefing 0-byte incident, 2026-07-05).
 *
 * Two independent code paths let write_file leave a `.vault-operator/`
 * day-file at exactly 0 bytes, wiping a previously good file:
 *
 *   (a) EMPTY-CONTENT: the content guard only rejected undefined/null, so an
 *       empty string '' passed through and adapter.write('', ...) truncated the
 *       target to 0 bytes. A same-day rerun whose write_file argument was lost /
 *       truncated (model give-up) clobbered the finished file.
 *   (b) NON-ATOMIC WRITE: writeViaAdapter wrote straight to the live path via a
 *       truncate-then-write adapter.write with no temp+rename, so any
 *       interruption after the truncate left the primary file at 0 bytes.
 *
 * Contract pinned here:
 *   - refuse to overwrite an existing NON-EMPTY file with empty/whitespace content
 *   - never write the live target directly; stage to a temp sibling and rename
 *   - still allow creating a genuinely empty NEW file and normal overwrites
 */

import { describe, it, expect } from 'vitest';
import { WriteFileTool } from '../WriteFileTool';
import type { ToolExecutionContext } from '../../types';

interface AdapterCall {
    op: 'exists' | 'read' | 'write' | 'mkdir' | 'rename' | 'remove';
    path: string;
    to?: string;
}

function makePlugin(seed: Record<string, string> = {}) {
    const calls: AdapterCall[] = [];
    const files = new Map<string, string>(Object.entries(seed));
    // Optional fault injection: when set, adapter.write throws for paths that
    // satisfy the predicate (simulates a crash / disk error mid-write).
    const faults: { failWriteWhen?: (p: string) => boolean } = {};

    const adapter = {
        exists: async (p: string) => {
            calls.push({ op: 'exists', path: p });
            return files.has(p);
        },
        read: async (p: string) => {
            calls.push({ op: 'read', path: p });
            const v = files.get(p);
            if (v === undefined) throw new Error(`ENOENT: ${p}`);
            return v;
        },
        write: async (p: string, content: string) => {
            calls.push({ op: 'write', path: p });
            if (faults.failWriteWhen?.(p)) throw new Error(`simulated write failure: ${p}`);
            files.set(p, content);
        },
        mkdir: async (p: string) => {
            calls.push({ op: 'mkdir', path: p });
        },
        rename: async (from: string, to: string) => {
            calls.push({ op: 'rename', path: from, to });
            if (!files.has(from)) throw new Error(`ENOENT rename src: ${from}`);
            files.set(to, files.get(from) as string);
            files.delete(from);
        },
        remove: async (p: string) => {
            calls.push({ op: 'remove', path: p });
            files.delete(p);
        },
    };

    const plugin = {
        app: {
            vault: {
                adapter,
                configDir: '.obsidian',
                // Hidden `.vault-operator/` paths are not in the index -> null,
                // which is also what forces the writeViaAdapter branch.
                getAbstractFileByPath: () => null,
                read: () => Promise.reject(new Error('vault.read must not run for .vault-operator/ paths')),
                modify: () => Promise.reject(new Error('vault.modify must not run for .vault-operator/ paths')),
                create: () => Promise.reject(new Error('vault.create must not run for .vault-operator/ paths')),
                createFolder: () => Promise.reject(new Error('vault.createFolder must not run for .vault-operator/ paths')),
            },
        },
        settings: { agentFolderPath: '.vault-operator' },
    } as unknown as import('../../../../main').default;

    return { plugin, adapter, calls, files, faults };
}

function makeContext() {
    const pushed: string[] = [];
    const logged: string[] = [];
    const ctx = {
        callbacks: {
            pushToolResult: (s: string) => pushed.push(s),
            log: (s: string) => logged.push(s),
            handleError: async () => {},
        },
    } as unknown as ToolExecutionContext;
    return { ctx, pushed, logged };
}

const DAY = '.vault-operator/data/skill-data/daily-briefing/data/days/2026-07-05.js';
const GOOD = 'window.BRIEFINGS["2026-07-05"] = { "sections": [1,2,3] };';

describe('WriteFileTool P0 data-loss protection (.vault-operator/ day-file)', () => {
    it('refuses to overwrite an existing non-empty file with empty content', async () => {
        const { plugin, files } = makePlugin({ [DAY]: GOOD });
        const { ctx, pushed } = makeContext();
        const tool = new WriteFileTool(plugin);

        await tool.execute({ path: DAY, content: '' }, ctx);

        // The good file must be untouched.
        expect(files.get(DAY)).toBe(GOOD);
        // The agent must be told why, so it can retry with real content.
        expect(pushed.join('\n')).toMatch(/empty|non-empty|refus/i);
    });

    it('refuses whitespace-only overwrite of a non-empty file', async () => {
        const { plugin, files } = makePlugin({ [DAY]: GOOD });
        const { ctx, pushed } = makeContext();
        const tool = new WriteFileTool(plugin);

        await tool.execute({ path: DAY, content: '   \n\t ' }, ctx);

        expect(files.get(DAY)).toBe(GOOD);
        expect(pushed.join('\n')).toMatch(/empty|non-empty|refus/i);
    });

    it('never writes the live target directly; stages to a temp sibling then renames', async () => {
        const { plugin, calls, files } = makePlugin({ [DAY]: 'old content' });
        const { ctx } = makeContext();
        const tool = new WriteFileTool(plugin);

        await tool.execute({ path: DAY, content: GOOD }, ctx);

        // Final content landed.
        expect(files.get(DAY)).toBe(GOOD);
        // The target itself is never truncate-written; a direct write to DAY is
        // exactly the truncate-then-write that produced the 0-byte file.
        const directTargetWrites = calls.filter((c) => c.op === 'write' && c.path === DAY);
        expect(directTargetWrites).toEqual([]);
        // Content reached the target through an atomic rename.
        const renames = calls.filter((c) => c.op === 'rename' && c.to === DAY);
        expect(renames.length).toBe(1);
        // And the staged write happened before the rename.
        const stagedWrite = calls.find((c) => c.op === 'write' && c.path === renames[0].path);
        expect(stagedWrite).toBeTruthy();
    });

    it('keeps the previous good file when the staged write fails mid-way', async () => {
        const { plugin, calls, files, faults } = makePlugin({ [DAY]: GOOD });
        const { ctx } = makeContext();
        const tool = new WriteFileTool(plugin);
        // Any write that is NOT the final target (i.e. the temp sibling) fails.
        faults.failWriteWhen = (p) => p !== DAY;

        await tool.execute({ path: DAY, content: 'brand new full briefing' }, ctx);

        // The interrupted write must NOT have destroyed the good file.
        expect(files.get(DAY)).toBe(GOOD);
        // The target was never truncate-written directly.
        expect(calls.filter((c) => c.op === 'write' && c.path === DAY)).toEqual([]);
    });

    it('still allows creating a genuinely empty NEW file', async () => {
        const NEW = '.vault-operator/data/skill-data/daily-briefing/data/days/2026-08-01.js';
        const { plugin, files } = makePlugin();
        const { ctx, pushed } = makeContext();
        const tool = new WriteFileTool(plugin);

        await tool.execute({ path: NEW, content: '' }, ctx);

        expect(files.get(NEW)).toBe('');
        expect(pushed.join('\n')).toMatch(/File created|File updated/);
    });

    it('still allows a normal non-empty overwrite', async () => {
        const { plugin, files, calls } = makePlugin({ [DAY]: 'v1' });
        const { ctx, pushed } = makeContext();
        const tool = new WriteFileTool(plugin);

        await tool.execute({ path: DAY, content: GOOD }, ctx);

        expect(files.get(DAY)).toBe(GOOD);
        expect(calls.some((c) => c.op === 'rename' && c.to === DAY)).toBe(true);
        expect(pushed.join('\n')).toMatch(/File created|File updated/);
    });
});

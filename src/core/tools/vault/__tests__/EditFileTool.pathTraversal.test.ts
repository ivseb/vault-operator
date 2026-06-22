/**
 * AUDIT-034 H-1 / SAST-1-02 regression coverage.
 *
 * Before the fix, EditFileTool routed any path whose first segment started
 * with a dot through vault.adapter.read / vault.adapter.write without
 * rejecting `..` segments. `.foo/../../etc/passwd` matched the
 * `isHidden = startsWith('.')` gate and gave the agent arbitrary
 * read+write outside the vault on desktop (FileSystemAdapter joins via
 * Node which collapses `..`).
 *
 * The fix inserts `validateVaultRelativePath(path)` at the top of execute
 * and uses the returned cleanPath for every adapter / Vault call. These
 * tests pin the behaviour so a future refactor cannot silently regress.
 */

import { describe, it, expect, vi } from 'vitest';
import { EditFileTool } from '../EditFileTool';
import type { ToolExecutionContext } from '../../types';
import type ObsidianAgentPlugin from '../../../../main';

interface AdapterCallLog {
    exists: string[];
    read: string[];
    write: string[];
}

function makePlugin(): { plugin: ObsidianAgentPlugin; calls: AdapterCallLog } {
    const calls: AdapterCallLog = { exists: [], read: [], write: [] };
    const adapter = {
        exists: vi.fn(async (p: string) => {
            calls.exists.push(p);
            return false;
        }),
        read: vi.fn(async (p: string) => {
            calls.read.push(p);
            return '';
        }),
        write: vi.fn(async (p: string, _content: string) => {
            calls.write.push(p);
        }),
    };
    const plugin = {
        app: {
            vault: {
                adapter,
                getAbstractFileByPath: () => null,
                read: () => Promise.reject(new Error('vault.read should not be called for traversal paths')),
                modify: () => Promise.reject(new Error('vault.modify should not be called for traversal paths')),
            },
        },
    } as unknown as ObsidianAgentPlugin;
    return { plugin, calls };
}

function makeContext() {
    const pushed: string[] = [];
    const ctx = {
        callbacks: {
            pushToolResult: (s: string) => pushed.push(s),
            log: (_: string) => {},
            handleError: async (_tool: string, _e: unknown) => {},
        },
    } as unknown as ToolExecutionContext;
    return { ctx, pushed };
}

describe('EditFileTool path traversal rejection (AUDIT-034 H-1)', () => {
    it('rejects `.foo/../../etc/passwd` before touching the adapter', async () => {
        const { plugin, calls } = makePlugin();
        const { ctx, pushed } = makeContext();
        const tool = new EditFileTool(plugin);

        await tool.execute({
            path: '.foo/../../etc/passwd',
            old_str: 'root',
            new_str: 'pwned',
        }, ctx);

        // Validator must short-circuit BEFORE any adapter call.
        expect(calls.exists).toHaveLength(0);
        expect(calls.read).toHaveLength(0);
        expect(calls.write).toHaveLength(0);

        const out = pushed.join('\n');
        expect(out).toMatch(/Invalid file path/i);
    });

    it('rejects plain parent-traversal `../outside.md`', async () => {
        const { plugin, calls } = makePlugin();
        const { ctx, pushed } = makeContext();
        const tool = new EditFileTool(plugin);

        await tool.execute({
            path: '../outside.md',
            old_str: 'a',
            new_str: 'b',
        }, ctx);

        expect(calls.exists).toHaveLength(0);
        expect(calls.read).toHaveLength(0);
        expect(calls.write).toHaveLength(0);
        expect(pushed.join('\n')).toMatch(/Invalid file path/i);
    });

    it('rejects NUL byte in path', async () => {
        const { plugin, calls } = makePlugin();
        const { ctx, pushed } = makeContext();
        const tool = new EditFileTool(plugin);

        await tool.execute({
            path: 'notes/evil\0.md',
            old_str: 'a',
            new_str: 'b',
        }, ctx);

        expect(calls.exists).toHaveLength(0);
        expect(calls.read).toHaveLength(0);
        expect(calls.write).toHaveLength(0);
        expect(pushed.join('\n')).toMatch(/Invalid file path/i);
    });

    it('rejects url-encoded traversal `%2e%2e/secrets`', async () => {
        const { plugin, calls } = makePlugin();
        const { ctx, pushed } = makeContext();
        const tool = new EditFileTool(plugin);

        await tool.execute({
            path: '%2e%2e/secrets',
            old_str: 'a',
            new_str: 'b',
        }, ctx);

        expect(calls.exists).toHaveLength(0);
        expect(calls.read).toHaveLength(0);
        expect(calls.write).toHaveLength(0);
        expect(pushed.join('\n')).toMatch(/Invalid file path/i);
    });
});

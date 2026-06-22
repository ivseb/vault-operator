/**
 * AUDIT-034 M-1 regression test.
 *
 * Without `validateVaultRelativePath` at the WriteFileTool boundary,
 * `path = '.obsidian/../../tmp/pwned.md'` satisfied the prefix check
 * (`path.startsWith('.obsidian/')`) and was handed verbatim to
 * `vault.adapter.write`. Obsidian's FileSystemAdapter resolves the
 * adapter path relative to the vault basePath via Node's `path.resolve`,
 * which collapses `..`, so the file landed OUTSIDE the vault.
 *
 * This test pins the contract: any path containing a `..` segment must
 * be rejected before ever touching adapter.write or adapter.mkdir.
 */

import { describe, it, expect } from 'vitest';
import { WriteFileTool } from '../WriteFileTool';
import type { ToolExecutionContext } from '../../types';

interface AdapterCall {
    op: 'exists' | 'read' | 'write' | 'mkdir';
    path: string;
}

interface MockAdapter {
    exists: (p: string) => Promise<boolean>;
    read: (p: string) => Promise<string>;
    write: (p: string, content: string) => Promise<void>;
    mkdir: (p: string) => Promise<void>;
}

function makePlugin() {
    const calls: AdapterCall[] = [];
    const files = new Map<string, string>();

    const adapter: MockAdapter = {
        exists: async (p) => {
            calls.push({ op: 'exists', path: p });
            return files.has(p);
        },
        read: async (p) => {
            calls.push({ op: 'read', path: p });
            const v = files.get(p);
            if (v === undefined) throw new Error(`ENOENT: ${p}`);
            return v;
        },
        write: async (p, content) => {
            calls.push({ op: 'write', path: p });
            files.set(p, content);
        },
        mkdir: async (p) => {
            calls.push({ op: 'mkdir', path: p });
        },
    };

    const plugin = {
        app: {
            vault: {
                adapter,
                configDir: '.obsidian',
                getAbstractFileByPath: () => null,
                read: () => Promise.reject(new Error('vault.read should not be invoked for rejected paths')),
                modify: () => Promise.reject(new Error('vault.modify should not be invoked for rejected paths')),
                create: () => Promise.reject(new Error('vault.create should not be invoked for rejected paths')),
                createFolder: () => Promise.reject(new Error('vault.createFolder should not be invoked for rejected paths')),
            },
        },
        // getAgentFolderPath reads from plugin.settings; supply a stable folder.
        settings: { agentFolderPath: '.vault-operator' },
    } as unknown as import('../../../../main').default;

    return { plugin, adapter, calls, files };
}

function makeContext() {
    const pushed: string[] = [];
    const handled: { tool: string; err: unknown }[] = [];
    const ctx = {
        callbacks: {
            pushToolResult: (s: string) => pushed.push(s),
            log: (_: string) => {},
            handleError: async (tool: string, err: unknown) => {
                handled.push({ tool, err });
            },
        },
    } as unknown as ToolExecutionContext;
    return { ctx, pushed, handled };
}

describe('WriteFileTool path-traversal rejection (AUDIT-034 M-1)', () => {
    it('rejects `.obsidian/../../tmp/pwned.md` without writing via adapter', async () => {
        const { plugin, calls } = makePlugin();
        const { ctx, pushed } = makeContext();
        const tool = new WriteFileTool(plugin);

        await tool.execute(
            { path: '.obsidian/../../tmp/pwned.md', content: 'pwned' },
            ctx,
        );

        // No adapter operation must run for a traversal path.
        expect(calls).toEqual([]);
        // The error result must surface to the agent.
        expect(pushed.join('\n')).toMatch(/Invalid path/);
    });

    it('rejects `..` segment in vault-relative paths', async () => {
        const { plugin, calls } = makePlugin();
        const { ctx, pushed } = makeContext();
        const tool = new WriteFileTool(plugin);

        await tool.execute(
            { path: 'Notes/../../escape.md', content: 'x' },
            ctx,
        );

        expect(calls).toEqual([]);
        expect(pushed.join('\n')).toMatch(/Invalid path/);
    });

    it('rejects URL-encoded traversal patterns', async () => {
        const { plugin, calls } = makePlugin();
        const { ctx, pushed } = makeContext();
        const tool = new WriteFileTool(plugin);

        await tool.execute(
            { path: '.obsidian/%2e%2e/escape.md', content: 'x' },
            ctx,
        );

        expect(calls).toEqual([]);
        expect(pushed.join('\n')).toMatch(/Invalid path/);
    });

    it('rejects paths containing NUL bytes', async () => {
        const { plugin, calls } = makePlugin();
        const { ctx, pushed } = makeContext();
        const tool = new WriteFileTool(plugin);

        // Build the path with String.fromCharCode so the NUL is unambiguous
        // and resists editor / tool mangling.
        const nulPath = '.obsidian/poison' + String.fromCharCode(0) + '.md';

        await tool.execute(
            { path: nulPath, content: 'x' },
            ctx,
        );

        expect(calls).toEqual([]);
        expect(pushed.join('\n')).toMatch(/Invalid path/);
    });

    it('accepts a legitimate `.obsidian/` config-dir path through the adapter', async () => {
        const { plugin, calls, files } = makePlugin();
        const { ctx, pushed } = makeContext();
        const tool = new WriteFileTool(plugin);

        await tool.execute(
            { path: '.obsidian/plugins/vault-operator/data.json', content: '{}' },
            ctx,
        );

        // Adapter sink received the normalized vault-relative path.
        expect(files.get('.obsidian/plugins/vault-operator/data.json')).toBe('{}');
        // exists() was called for the file; write() ran on the safe path.
        expect(calls.some((c) => c.op === 'write' && c.path === '.obsidian/plugins/vault-operator/data.json')).toBe(true);
        expect(pushed.join('\n')).toMatch(/File created|File updated/);
    });
});

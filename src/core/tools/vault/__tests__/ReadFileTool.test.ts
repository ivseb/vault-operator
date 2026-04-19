/**
 * BUG-020 unit test -- externalised tmp path retry.
 *
 * Only tests the pure helper. Exercising the full ReadFileTool would
 * need a mock plugin with a vault adapter; the helper carries the
 * security-relevant logic (strict prefix, traversal guard) so testing
 * it in isolation is enough to lock the contract.
 */

import { describe, it, expect, vi } from 'vitest';
import { ReadFileTool, looksLikeExternalisedTmpPath } from '../ReadFileTool';
import type { ToolExecutionContext } from '../../types';

describe('looksLikeExternalisedTmpPath', () => {
    it('matches the externaliser pattern', () => {
        expect(looksLikeExternalisedTmpPath('tmp/task-abc123/result.md')).toBe(true);
        expect(looksLikeExternalisedTmpPath('tmp/task-xyz/search_files-0.md')).toBe(true);
    });

    it('rejects unrelated tmp paths', () => {
        expect(looksLikeExternalisedTmpPath('tmp.md')).toBe(false);
        expect(looksLikeExternalisedTmpPath('tmp/foo.md')).toBe(false);
        expect(looksLikeExternalisedTmpPath('tmp/task/file.md')).toBe(false); // missing -<id>
        expect(looksLikeExternalisedTmpPath('other/tmp/task-abc/x.md')).toBe(false);
    });

    it('rejects path traversal segments', () => {
        expect(looksLikeExternalisedTmpPath('tmp/task-abc/../secret.md')).toBe(false);
        expect(looksLikeExternalisedTmpPath('tmp/../task-abc/result.md')).toBe(false);
    });

    it('rejects paths with null bytes', () => {
        expect(looksLikeExternalisedTmpPath('tmp/task-abc/\u0000poisoned.md')).toBe(false);
    });

    it('requires at least tmp/task-<id>/<filename>', () => {
        expect(looksLikeExternalisedTmpPath('tmp/task-abc')).toBe(false);
        expect(looksLikeExternalisedTmpPath('tmp/task-abc/')).toBe(true); // trailing slash -> 3 segments
    });
});

/**
 * BUG-020 integration: prove end-to-end that ReadFileTool.execute()
 * resolves a stripped `tmp/task-*` path against the agent-folder-prefixed
 * file on disk. This is what the LLM-driven end-to-end BRAT test cannot
 * reliably exercise, because smarter LLMs "correct" the stripped path
 * back to its full form and never actually invoke the tool with the
 * broken shape that made Nick hit the bug.
 */

interface FakeAdapter {
    exists: (p: string) => Promise<boolean>;
    read: (p: string) => Promise<string>;
}

function makePlugin(opts: {
    agentFolderPath: string;
    vaultAdapterFiles: Record<string, string>;
}): { plugin: import('../../../../main').default; pushed: string[] } {
    const pushed: string[] = [];

    const adapter: FakeAdapter = {
        exists: (p) => Promise.resolve(p in opts.vaultAdapterFiles),
        read: (p) => {
            const content = opts.vaultAdapterFiles[p];
            if (content === undefined) return Promise.reject(new Error('not found'));
            return Promise.resolve(content);
        },
    };

    const plugin = {
        app: {
            vault: {
                adapter,
                getAbstractFileByPath: () => null, // force fallback path
            },
        },
        settings: { agentFolderPath: opts.agentFolderPath },
    } as unknown as import('../../../../main').default;

    return { plugin, pushed };
}

function makeContext(capturedResults: string[]): ToolExecutionContext {
    return {
        callbacks: {
            pushToolResult: (msg: string) => { capturedResults.push(msg); },
            log: vi.fn(),
            handleError: vi.fn().mockResolvedValue(undefined),
        },
    } as unknown as ToolExecutionContext;
}

describe('ReadFileTool integration -- BUG-020 tmp retry', () => {
    it('resolves stripped tmp/task-* paths against the agent folder prefix', async () => {
        const { plugin } = makePlugin({
            agentFolderPath: '.obsidian-agent',
            vaultAdapterFiles: {
                '.obsidian-agent/tmp/task-xyz/result.md': '# externalised result\nbody line',
            },
        });
        const tool = new ReadFileTool(plugin);
        const pushed: string[] = [];

        await tool.execute({ path: 'tmp/task-xyz/result.md' }, makeContext(pushed));

        expect(pushed).toHaveLength(1);
        expect(pushed[0]).toContain('externalised result');
        expect(pushed[0]).toContain('body line');
    });

    it('respects a custom agentFolderPath setting', async () => {
        const { plugin } = makePlugin({
            agentFolderPath: 'custom/agent',
            vaultAdapterFiles: {
                'custom/agent/tmp/task-abc/search_files-0.md': 'custom root content',
            },
        });
        const tool = new ReadFileTool(plugin);
        const pushed: string[] = [];

        await tool.execute({ path: 'tmp/task-abc/search_files-0.md' }, makeContext(pushed));

        expect(pushed[0]).toContain('custom root content');
    });

    it('still reports not-found when neither direct nor prefixed path exists', async () => {
        const { plugin } = makePlugin({
            agentFolderPath: '.obsidian-agent',
            vaultAdapterFiles: {}, // nothing on disk
        });
        const tool = new ReadFileTool(plugin);
        const pushed: string[] = [];

        await tool.execute({ path: 'tmp/task-missing/ghost.md' }, makeContext(pushed));

        expect(pushed).toHaveLength(1);
        expect(pushed[0]).toContain('File not found');
    });

    it('does not rewrite unrelated paths -- tmp.md stays tmp.md', async () => {
        const { plugin } = makePlugin({
            agentFolderPath: '.obsidian-agent',
            vaultAdapterFiles: {
                // The externaliser-style path exists, but the agent asked for
                // a flat 'tmp.md' which must NOT be redirected.
                '.obsidian-agent/tmp/task-xyz/tmp.md': 'should not match',
            },
        });
        const tool = new ReadFileTool(plugin);
        const pushed: string[] = [];

        await tool.execute({ path: 'tmp.md' }, makeContext(pushed));

        expect(pushed[0]).toContain('File not found');
    });
});

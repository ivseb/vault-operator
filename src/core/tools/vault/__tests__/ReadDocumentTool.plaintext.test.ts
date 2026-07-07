/**
 * FIX-PERF-46: read_document called on a plain-text file (.md/.txt/...)
 * used to hard-error with "Unsupported format" and cost the agent a full
 * turn. The skill/LLM routing cannot be fully prevented, so the tool now
 * degrades gracefully: plain-text vault files are read as text (with the
 * same 50k chunking hint as read_file) instead of erroring.
 */

import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { ReadDocumentTool } from '../ReadDocumentTool';
import type { ToolExecutionContext } from '../../types';

function makeMarkdownFile(path: string, content: string): { file: TFile; content: string } {
    const file = new TFile() as TFile & { path: string; stat: { size: number } };
    file.path = path;
    file.stat = { size: content.length } as TFile['stat'];
    return { file, content };
}

function makePlugin(files: Record<string, { file: TFile; content: string }>) {
    return {
        app: {
            vault: {
                getAbstractFileByPath: (p: string) => files[p]?.file ?? null,
                read: (f: TFile) => {
                    const entry = Object.values(files).find((e) => e.file === f);
                    return entry
                        ? Promise.resolve(entry.content)
                        : Promise.reject(new Error('not found'));
                },
            },
        },
        settings: {},
    } as unknown as import('../../../../main').default;
}

function makeContext(captured: string[]): ToolExecutionContext {
    return {
        callbacks: {
            pushToolResult: (msg: string) => { captured.push(msg); },
            log: vi.fn(),
            handleError: vi.fn().mockResolvedValue(undefined),
        },
    } as unknown as ToolExecutionContext;
}

describe('ReadDocumentTool plain-text fallback -- FIX-PERF-46', () => {
    it('reads a .md file as plain text instead of erroring', async () => {
        const files = {
            'Inbox/transcript.md': makeMarkdownFile('Inbox/transcript.md', '# Meeting\nline one\nline two'),
        };
        const tool = new ReadDocumentTool(makePlugin(files));
        const pushed: string[] = [];

        await tool.execute({ path: 'Inbox/transcript.md' }, makeContext(pushed));

        expect(pushed).toHaveLength(1);
        expect(pushed[0]).not.toContain('Unsupported format');
        expect(pushed[0]).toContain('line one');
        // Tells the model the right tool for next time
        expect(pushed[0]).toContain('read_file');
        // AUDIT-2026-07-07 M-1: vault content must carry the untrusted boundary
        expect(pushed[0]).toContain('<untrusted-content source="vault"');
    });

    it('caps plain-text fallback at 50k chars with a continue hint', async () => {
        const big = 'x'.repeat(60_000);
        const files = { 'Inbox/big.md': makeMarkdownFile('Inbox/big.md', big) };
        const tool = new ReadDocumentTool(makePlugin(files));
        const pushed: string[] = [];

        await tool.execute({ path: 'Inbox/big.md' }, makeContext(pushed));

        expect(pushed).toHaveLength(1);
        expect(pushed[0]).toContain('offset=50000');
        expect(pushed[0].length).toBeLessThan(52_000);
    });

    it('still rejects genuinely unsupported binary formats', async () => {
        const files = { 'img/photo.png': makeMarkdownFile('img/photo.png', 'binarydata') };
        const tool = new ReadDocumentTool(makePlugin(files));
        const pushed: string[] = [];

        await tool.execute({ path: 'img/photo.png' }, makeContext(pushed));

        expect(pushed).toHaveLength(1);
        expect(pushed[0]).toContain('Unsupported format');
    });
});

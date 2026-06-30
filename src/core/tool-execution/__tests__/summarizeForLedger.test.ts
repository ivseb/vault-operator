import { describe, it, expect } from 'vitest';
import { summarizeForLedger } from '../summarizeForLedger';

/**
 * FIX-COMPACT-08: per-tool result summaries that survive the 200-char
 * cap with more information than a blind prefix. The summarizer prompt
 * sees these strings and decides whether the agent already covered an
 * approach -- a tighter signal means fewer redundant retries after a
 * condense pass.
 */
describe('summarizeForLedger (FIX-COMPACT-08)', () => {
    it('read_file: reports line range and path', () => {
        const result = 'line1\nline2\nline3\nline4\nline5\n';
        const out = summarizeForLedger(
            'read_file',
            { path: 'src/foo.ts' },
            result,
        );
        expect(out).toMatch(/L1-L\d+ of src\/foo\.ts/);
    });

    it('search_files: reports hit count and first paths', () => {
        const result = [
            'path/a.md:42 hit',
            'path/b.md:13 hit',
            'path/c.md:7 hit',
        ].join('\n');
        const out = summarizeForLedger(
            'search_files',
            { query: 'foo' },
            result,
        );
        expect(out).toMatch(/3 hit/);
        expect(out).toContain('foo');
    });

    it('write_vault: reports path and byte count', () => {
        const out = summarizeForLedger(
            'write_vault',
            { path: 'inbox/note.md' },
            'wrote 512 bytes',
        );
        expect(out).toContain('inbox/note.md');
        expect(out).toMatch(/\d+ ?b(yte)?s/i);
    });

    it('unknown tool: falls back to 200-char prefix (backwards compatible)', () => {
        const long = 'x'.repeat(500);
        const out = summarizeForLedger('totally_unknown_tool', {}, long);
        expect(out.length).toBeLessThanOrEqual(200);
        expect(out.startsWith('xxxxx')).toBe(true);
    });

    it('handles array content (multimodal tool_result blocks)', () => {
        const result = [
            { type: 'text' as const, text: 'L1-L42\nimport foo;\n' },
        ];
        const out = summarizeForLedger('read_file', { path: 'a.ts' }, result);
        expect(out).toContain('a.ts');
    });

    it('is robust against missing input', () => {
        const out = summarizeForLedger('read_file', {}, 'some content');
        expect(typeof out).toBe('string');
        expect(out.length).toBeGreaterThan(0);
    });

    it('error results keep their original short message', () => {
        const out = summarizeForLedger(
            'write_vault',
            { path: 'x.md' },
            '<error>permission denied</error>',
        );
        // Should not pretend to have "wrote 0 bytes" when the tool failed
        expect(out).toMatch(/error|permission denied|x\.md/i);
    });
});

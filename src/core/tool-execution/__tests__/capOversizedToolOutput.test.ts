import { describe, it, expect } from 'vitest';
import { capOversizedToolOutput, readAwareOutputCap, HARD_TOOL_OUTPUT_CAP_CHARS } from '../ToolExecutionPipeline';

describe('capOversizedToolOutput (FEAT-24-03)', () => {
    it('leaves a within-budget string untouched', () => {
        const r = capOversizedToolOutput('hello world', false);
        expect(r.capped).toBe(false);
        expect(r.content).toBe('hello world');
    });

    it('leaves an error result untouched even when oversized', () => {
        const big = 'x'.repeat(HARD_TOOL_OUTPUT_CAP_CHARS + 5000);
        const r = capOversizedToolOutput(big, true);
        expect(r.capped).toBe(false);
        expect(r.content).toBe(big);
    });

    it('leaves multimodal content untouched', () => {
        const blocks = [{ type: 'text' as const, text: 'x'.repeat(HARD_TOOL_OUTPUT_CAP_CHARS + 5000) }];
        const r = capOversizedToolOutput(blocks, false);
        expect(r.capped).toBe(false);
        expect(r.content).toBe(blocks);
    });

    it('caps an oversized string and appends a how-to-fetch-the-rest notice', () => {
        const big = 'line of content\n'.repeat(8000); // ~128k chars, lots of newlines
        const r = capOversizedToolOutput(big, false);
        expect(r.capped).toBe(true);
        expect(r.originalLength).toBe(big.length);
        const out = r.content as string;
        expect(out.length).toBeLessThan(HARD_TOOL_OUTPUT_CAP_CHARS + 500);
        expect(out).toContain('Output truncated');
        expect(out).toContain(String(big.length));
        // Cut on a newline boundary -> no dangling half-line right before the notice.
        expect(out.split('\n\n[Output truncated')[0].endsWith('line of content')).toBe(true);
    });

    it('falls back to a hard slice when there is no newline near the cap', () => {
        const big = 'x'.repeat(HARD_TOOL_OUTPUT_CAP_CHARS + 10_000); // no newlines at all
        const r = capOversizedToolOutput(big, false);
        expect(r.capped).toBe(true);
        const out = r.content as string;
        expect(out.startsWith('x'.repeat(HARD_TOOL_OUTPUT_CAP_CHARS))).toBe(true);
        expect(out).toContain('Output truncated');
    });

    it('honours a custom cap', () => {
        const r = capOversizedToolOutput('y'.repeat(2000), false, 500);
        expect(r.capped).toBe(true);
        expect((r.content as string).startsWith('y'.repeat(500))).toBe(true);
    });
});

describe('readAwareOutputCap (IMP-01-04-03)', () => {
    it('keeps the flat 60k floor for non-read tools', () => {
        expect(readAwareOutputCap('search_files', 1_000_000)).toBe(HARD_TOOL_OUTPUT_CAP_CHARS);
        expect(readAwareOutputCap('use_mcp_tool', 1_000_000)).toBe(HARD_TOOL_OUTPUT_CAP_CHARS);
    });

    it('raises the floor for read_file on a 1M model so a one-call read survives', () => {
        const cap = readAwareOutputCap('read_file', 1_000_000);
        expect(cap).toBeGreaterThanOrEqual(400_000);
        // A 400k read result (plus wrapper) must pass through uncapped.
        const bigRead = 'x'.repeat(400_500);
        expect(capOversizedToolOutput(bigRead, false, cap).capped).toBe(false);
    });

    it('read_document gets the same treatment as read_file', () => {
        expect(readAwareOutputCap('read_document', 1_000_000)).toBe(readAwareOutputCap('read_file', 1_000_000));
    });

    it('stays at the 60k floor for small windows and unknown models', () => {
        expect(readAwareOutputCap('read_file', 128_000)).toBe(HARD_TOOL_OUTPUT_CAP_CHARS);
        expect(readAwareOutputCap('read_file', undefined)).toBe(HARD_TOOL_OUTPUT_CAP_CHARS);
    });
});

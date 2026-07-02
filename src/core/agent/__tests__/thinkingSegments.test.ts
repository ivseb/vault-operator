import { describe, it, expect } from 'vitest';
import { ThinkingSegmentCollector } from '../thinkingSegments';

/**
 * IMP-41-01-05: signed-thinking segments.
 *
 * Anthropic streams thinking as blocks, each sealed by a signature at
 * content_block_stop. Signed segments must be persisted VERBATIM (the
 * signature validates the exact text; capping a signed block would 400 on
 * passback), while unsigned segments (OpenAI reasoners) keep the legacy
 * 50k cap. Multiple blocks per turn (interleaved thinking) stay separate
 * blocks — joining them under one signature would be invalid.
 */

describe('ThinkingSegmentCollector', () => {
    it('collects a single unsigned segment (OpenAI reasoner path)', () => {
        const c = new ThinkingSegmentCollector();
        c.push('part one ');
        c.push('part two');
        const blocks = c.finalize(50_000);
        expect(blocks).toEqual([{ type: 'thinking', text: 'part one part two' }]);
    });

    it('seals a signed segment and keeps it verbatim', () => {
        const c = new ThinkingSegmentCollector();
        c.push('signed reasoning');
        c.seal('sig-abc');
        const blocks = c.finalize(50_000);
        expect(blocks).toEqual([{ type: 'thinking', text: 'signed reasoning', signature: 'sig-abc' }]);
    });

    it('keeps multiple sealed segments as separate blocks', () => {
        const c = new ThinkingSegmentCollector();
        c.push('block one');
        c.seal('sig-1');
        c.push('block two');
        c.seal('sig-2');
        const blocks = c.finalize(50_000);
        expect(blocks).toHaveLength(2);
        expect(blocks[0]).toMatchObject({ text: 'block one', signature: 'sig-1' });
        expect(blocks[1]).toMatchObject({ text: 'block two', signature: 'sig-2' });
    });

    it('caps only unsigned segments', () => {
        const c = new ThinkingSegmentCollector();
        c.push('x'.repeat(200));
        c.seal('sig-long');
        c.push('y'.repeat(200));
        const blocks = c.finalize(100);
        expect(blocks[0].text).toBe('x'.repeat(200)); // signed: verbatim
        expect(blocks[0].signature).toBe('sig-long');
        expect(blocks[1].text.length).toBeLessThan(200); // unsigned: capped
        expect(blocks[1].text).toContain('[thinking truncated');
        expect(blocks[1].signature).toBeUndefined();
    });

    it('returns empty for no content and ignores empty seals', () => {
        const c = new ThinkingSegmentCollector();
        c.seal('sig-without-text');
        expect(c.finalize(100)).toEqual([]);
        expect(c.hasContent()).toBe(false);
    });

    it('reports content presence', () => {
        const c = new ThinkingSegmentCollector();
        expect(c.hasContent()).toBe(false);
        c.push('t');
        expect(c.hasContent()).toBe(true);
    });
});

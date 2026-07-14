/**
 * FIX-44-42: contract of the shared, CRLF/BOM-tolerant frontmatter splitter.
 *
 * Two consumers depend on every detail here: `resolveFrontmatterUpdate`
 * (update_frontmatter's one resolver for preview AND write) and
 * `checkFrontmatterIntegrity` (the FIX-44-09 guard behind edit_file,
 * write_file, safeNoteWrite and the post-task review). Before this module,
 * both compared lines against the exact string '---' after split('\n'), so a
 * '---\r' fence (CRLF note) or a '\uFEFF---' first line (BOM) made the whole
 * block invisible -- update_frontmatter then prepended a second block and the
 * guard waved the corruption through.
 */

import { describe, it, expect } from 'vitest';
import { splitNoteFrontmatter, renderFrontmatterBlock, detectLineEnding } from '../frontmatterSplit';

describe('splitNoteFrontmatter', () => {
    it('splits a plain LF note', () => {
        const s = splitNoteFrontmatter('---\ntitle: T\n---\n\nbody\n');
        expect(s).toEqual({
            bom: '',
            lineEnding: '\n',
            opensWithFence: true,
            fmText: 'title: T',
            body: '\nbody\n',
        });
    });

    it('splits a CRLF note and keeps the body bytes untouched', () => {
        const s = splitNoteFrontmatter('---\r\ntitle: T\r\n---\r\n\r\nbody\r\n');
        expect(s.lineEnding).toBe('\r\n');
        expect(s.opensWithFence).toBe(true);
        expect(s.fmText).toBe('title: T');          // LF-normalized for parseYaml
        expect(s.body).toBe('\r\nbody\r\n');         // original bytes, CR intact
    });

    it('strips and reports a leading BOM', () => {
        const s = splitNoteFrontmatter('\uFEFF---\ntitle: T\n---\nbody');
        expect(s.bom).toBe('\uFEFF');
        expect(s.opensWithFence).toBe(true);
        expect(s.fmText).toBe('title: T');
        expect(s.body).toBe('body');
    });

    it('handles the empty block that the regex form silently misses', () => {
        // /^---\n[\s\S]*?\n---/ does NOT match "---\n---" -- the OKF scaffold shape.
        const s = splitNoteFrontmatter('---\n---\n\nbody');
        expect(s.fmText).toBe('');
        expect(s.body).toBe('\nbody');
    });

    it('handles an empty CRLF block', () => {
        const s = splitNoteFrontmatter('---\r\n---\r\nbody\r\n');
        expect(s.fmText).toBe('');
        expect(s.body).toBe('body\r\n');
    });

    it('reports an unterminated block as fence-open-but-blockless', () => {
        const s = splitNoteFrontmatter('---\ntitle: x\n\nbody');
        expect(s.opensWithFence).toBe(true);
        expect(s.fmText).toBeNull();
        expect(s.body).toBe('---\ntitle: x\n\nbody');
    });

    it('treats a note without frontmatter as pure body', () => {
        const s = splitNoteFrontmatter('# Heading\n\ntext');
        expect(s.opensWithFence).toBe(false);
        expect(s.fmText).toBeNull();
        expect(s.body).toBe('# Heading\n\ntext');
    });

    it('does not mistake a horizontal rule with trailing spaces for a fence', () => {
        // '--- ' is a thematic break in markdown but NOT a frontmatter fence.
        const s = splitNoteFrontmatter('--- \ntext');
        expect(s.opensWithFence).toBe(false);
    });
});

describe('detectLineEnding', () => {
    it('defaults to LF for LF-only and ending-free text', () => {
        expect(detectLineEnding('a\nb\n')).toBe('\n');
        expect(detectLineEnding('no endings at all')).toBe('\n');
    });

    it('detects CRLF and sides with the majority in mixed files', () => {
        expect(detectLineEnding('a\r\nb\r\n')).toBe('\r\n');
        expect(detectLineEnding('a\r\nb\r\nc\n')).toBe('\r\n');
        expect(detectLineEnding('a\r\nb\nc\nd\n')).toBe('\n');
    });
});

describe('renderFrontmatterBlock', () => {
    it('renders LF yaml in the requested line-ending style', () => {
        expect(renderFrontmatterBlock('title: T\n', '\n')).toBe('---\ntitle: T\n---');
        expect(renderFrontmatterBlock('title: T\ntags:\n  - a\n', '\r\n'))
            .toBe('---\r\ntitle: T\r\ntags:\r\n  - a\r\n---');
    });

    it('renders the bare empty block', () => {
        expect(renderFrontmatterBlock('', '\n')).toBe('---\n---');
        expect(renderFrontmatterBlock('', '\r\n')).toBe('---\r\n---');
    });
});

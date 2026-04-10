import { describe, it, expect } from 'vitest';
import { parseMarkdownSections } from '../markdownSections';

describe('parseMarkdownSections', () => {
    it('should return empty array for empty text', () => {
        expect(parseMarkdownSections('')).toEqual([]);
    });

    it('should detect frontmatter', () => {
        const text = '---\ntitle: Test\ndate: 2024-01-01\n---\nSome content';
        const sections = parseMarkdownSections(text);
        expect(sections[0]).toMatchObject({
            type: 'frontmatter',
            label: 'Frontmatter',
            startLine: 0,
            endLine: 3,
        });
    });

    it('should detect heading-scoped sections', () => {
        const text = '# Title\nSome content\n## Section A\nMore content\n## Section B\nFinal content';
        const sections = parseMarkdownSections(text);
        expect(sections).toHaveLength(3);
        expect(sections[0]).toMatchObject({ type: 'heading', label: '# Title' });
        expect(sections[1]).toMatchObject({ type: 'heading', label: '## Section A' });
        expect(sections[2]).toMatchObject({ type: 'heading', label: '## Section B' });
    });

    it('should handle nested headings (lower level stays within parent)', () => {
        const text = '# Title\n## Sub\nContent\n# Next';
        const sections = parseMarkdownSections(text);
        // # Title spans from 0 to 2 (includes ## Sub + Content)
        expect(sections[0]).toMatchObject({
            type: 'heading',
            label: '# Title',
            startLine: 0,
            endLine: 2,
        });
        expect(sections[1]).toMatchObject({
            type: 'heading',
            label: '## Sub',
            startLine: 1,
            endLine: 2,
        });
        expect(sections[2]).toMatchObject({
            type: 'heading',
            label: '# Next',
            startLine: 3,
        });
    });

    it('should detect code blocks when no headings present', () => {
        const text = '```python\nprint("hello")\n```';
        const sections = parseMarkdownSections(text);
        expect(sections[0]).toMatchObject({
            type: 'code-block',
            label: 'Code block',
            startLine: 0,
            endLine: 2,
        });
    });

    it('should detect lists when no headings present', () => {
        const text = '- Item 1\n- Item 2\n- Item 3';
        const sections = parseMarkdownSections(text);
        expect(sections[0]).toMatchObject({
            type: 'list',
            startLine: 0,
            endLine: 2,
        });
    });

    it('should detect tables when no headings present', () => {
        const text = '| A | B |\n|---|---|\n| 1 | 2 |';
        const sections = parseMarkdownSections(text);
        expect(sections[0]).toMatchObject({
            type: 'table',
            startLine: 0,
            endLine: 2,
        });
    });

    it('should detect callouts when no headings present', () => {
        const text = '> [!note]\n> This is a callout\n> with multiple lines';
        const sections = parseMarkdownSections(text);
        expect(sections[0]).toMatchObject({
            type: 'callout',
            startLine: 0,
            endLine: 2,
        });
    });

    it('should detect paragraphs when no headings present', () => {
        const text = 'Just a plain paragraph\nwith two lines';
        const sections = parseMarkdownSections(text);
        expect(sections[0]).toMatchObject({
            type: 'paragraph',
            startLine: 0,
            endLine: 1,
        });
    });

    it('should handle frontmatter + headings together', () => {
        const text = '---\ntitle: Test\n---\n# Heading\nContent';
        const sections = parseMarkdownSections(text);
        expect(sections[0].type).toBe('frontmatter');
        expect(sections[1].type).toBe('heading');
    });

    it('should skip blank lines in block-level grouping', () => {
        const text = '\n\nSome content\n\n- List item';
        const sections = parseMarkdownSections(text);
        // Should have paragraph and list, not blank line sections
        expect(sections.every(s => s.type !== 'frontmatter')).toBe(true);
        expect(sections.length).toBe(2);
    });
});

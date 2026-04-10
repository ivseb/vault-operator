import { describe, it, expect } from 'vitest';
import { diffLines, getDiffStats } from '../diffLines';

describe('diffLines', () => {
    it('should return unchanged lines for identical texts', () => {
        const result = diffLines('hello\nworld', 'hello\nworld');
        expect(result).toEqual([
            { type: 'unchanged', content: 'hello' },
            { type: 'unchanged', content: 'world' },
        ]);
    });

    it('should detect added lines', () => {
        const result = diffLines('hello', 'hello\nworld');
        const added = result.filter(l => l.type === 'added');
        expect(added.length).toBeGreaterThan(0);
        expect(added.some(l => l.content === 'world')).toBe(true);
    });

    it('should detect removed lines', () => {
        const result = diffLines('hello\nworld', 'hello');
        const removed = result.filter(l => l.type === 'removed');
        expect(removed.length).toBeGreaterThan(0);
        expect(removed.some(l => l.content === 'world')).toBe(true);
    });

    it('should handle empty old text', () => {
        const result = diffLines('', 'new content');
        expect(result.some(l => l.type === 'added' && l.content === 'new content')).toBe(true);
    });

    it('should handle empty new text', () => {
        const result = diffLines('old content', '');
        expect(result.some(l => l.type === 'removed' && l.content === 'old content')).toBe(true);
    });

    it('should handle both empty', () => {
        const result = diffLines('', '');
        // Empty-to-empty produces a single unchanged empty line
        expect(result.every(l => l.type === 'unchanged')).toBe(true);
    });

    it('should handle multiline changes', () => {
        const result = diffLines('a\nb\nc', 'a\nx\nc');
        expect(result.some(l => l.type === 'removed' && l.content === 'b')).toBe(true);
        expect(result.some(l => l.type === 'added' && l.content === 'x')).toBe(true);
    });
});

describe('getDiffStats', () => {
    it('should count added and removed lines', () => {
        const stats = getDiffStats([
            { type: 'added', content: 'a' },
            { type: 'removed', content: 'b' },
            { type: 'unchanged', content: 'c' },
            { type: 'added', content: 'd' },
        ]);
        expect(stats).toEqual({ added: 2, removed: 1 });
    });

    it('should return zeros for no changes', () => {
        const stats = getDiffStats([
            { type: 'unchanged', content: 'a' },
            { type: 'unchanged', content: 'b' },
        ]);
        expect(stats).toEqual({ added: 0, removed: 0 });
    });

    it('should handle empty array', () => {
        expect(getDiffStats([])).toEqual({ added: 0, removed: 0 });
    });
});

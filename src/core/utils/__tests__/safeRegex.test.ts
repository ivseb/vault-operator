import { describe, it, expect } from 'vitest';
import { safeRegex } from '../safeRegex';

describe('safeRegex', () => {
    it('should create a valid regex from a normal pattern', () => {
        const re = safeRegex('hello.*world', 'i');
        expect(re).toBeInstanceOf(RegExp);
        expect(re.test('hello beautiful world')).toBe(true);
        expect(re.flags).toBe('i');
    });

    it('should handle simple patterns correctly', () => {
        const re = safeRegex('test\\d+');
        expect(re.test('test123')).toBe(true);
        expect(re.test('nope')).toBe(false);
    });

    it('should fall back to literal match for ReDoS-prone patterns', () => {
        // Nested quantifiers: (a+)+ is classic ReDoS
        const re = safeRegex('(a+)+');
        // Should match the literal string "(a+)+" not the regex pattern
        expect(re.test('(a+)+')).toBe(true);
        expect(re.test('aaaaaa')).toBe(false);
    });

    it('should fall back for patterns exceeding max length', () => {
        const longPattern = 'a'.repeat(501);
        const re = safeRegex(longPattern);
        expect(re).toBeInstanceOf(RegExp);
        // Should match the literal long string
        expect(re.test(longPattern)).toBe(true);
    });

    it('should fall back for patterns with lookahead', () => {
        const re = safeRegex('(?=something)');
        // Lookahead triggers complexity check
        expect(re.test('(?=something)')).toBe(true);
    });

    it('should fall back for invalid regex syntax', () => {
        const re = safeRegex('[unclosed');
        // Invalid syntax -> literal escape fallback
        expect(re).toBeInstanceOf(RegExp);
        expect(re.test('[unclosed')).toBe(true);
    });

    it('should fall back for high repetition counts', () => {
        const re = safeRegex('a{1000}');
        expect(re.test('a{1000}')).toBe(true);
    });

    it('should handle empty pattern', () => {
        const re = safeRegex('');
        expect(re).toBeInstanceOf(RegExp);
    });
});

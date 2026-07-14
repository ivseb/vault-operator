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

    // AUDIT 2026-07-14 (Codex) M-6: a bounded outer repetition over an ambiguous
    // alternation group is exponential (`(a|aa){1,32}` froze V8 for ~1.3s at 34
    // chars) but slipped past REDOS_PATTERNS (only `+`/`*` on groups) and the
    // 3-digit repetition-count check.
    it('should fall back to literal for bounded repetition over an alternation group', () => {
        const re = safeRegex('(a|aa){1,32}$');
        expect(re.test('(a|aa){1,32}$')).toBe(true);
        expect(re.test('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
    });

    it('should fall back to literal for + / * over an alternation group', () => {
        expect(safeRegex('(a|aa)+').test('(a|aa)+')).toBe(true);
        expect(safeRegex('(a|aa)+').test('aaaa')).toBe(false);
        expect(safeRegex('(x|xx)*').test('(x|xx)*')).toBe(true);
    });

    it('still compiles benign bounded quantifiers on a single atom', () => {
        const re = safeRegex('a{1,32}');
        expect(re.test('aaaa')).toBe(true);
        // Real regex, not literal-escaped (literal would be 'a\\{1,32\\}').
        expect(re.source).toBe('a{1,32}');
    });

    // AUDIT 2026-07-14 (Codex review): the old [^()] clause matched only a flat
    // alternation group; one extra paren layer bypassed it and froze exec().
    it('falls back to literal for NESTED alternation groups under a quantifier', () => {
        expect(safeRegex('((a|aa)){1,25}$').test('((a|aa)){1,25}$')).toBe(true);
        expect(safeRegex('((a|aa)){1,25}$').test('aaaaaaaaaa')).toBe(false);
        expect(safeRegex('((a)|(aa)){1,20}$').test('((a)|(aa)){1,20}$')).toBe(true);
    });

    it('still compiles alternations that are NOT under a quantifier', () => {
        expect(safeRegex('(foo|bar)').test('foo')).toBe(true);
        expect(safeRegex('(foo|bar)').test('bar')).toBe(true);
        expect(safeRegex('(foo|bar)').source).toBe('(foo|bar)');
    });

    // AUDIT 2026-07-14 (Codex re-review): nested quantifiers `(a+){12}` froze a
    // single exec() for 40+ s and carry no `|`, so the alternation guard missed
    // them. They must be literalized.
    it('falls back to literal for nested quantifiers without alternation', () => {
        for (const p of ['(a+){12}$', '(a*){12}$', '([a-z]+){12}$', '(\\w+){12}$', '(a{1,12}){1,12}$', '(a?){30}a{30}']) {
            const re = safeRegex(p);
            expect(re.test(p)).toBe(true);           // matches the literal string
            expect(re.test('aaaaaaaaaaaa')).toBe(false); // NOT the pathological regex
        }
    });

    // AUDIT 2026-07-14 (Codex re-review 2): grouping-free sequential quantifiers
    // (a*a*a*...) froze exec() for 2-3 MINUTES; a wildcard group (.*a){20} too.
    it('falls back to literal for sequential same-atom quantifiers', () => {
        for (const p of ['a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*!', '.*.*.*x', '\\d*\\d*\\d*!', '(.*a){20}$']) {
            const re = safeRegex(p);
            // Literalized: matches its own source string, not the pathological regex.
            expect(re.test('bbbbbbbbbbbbbbbbbb')).toBe(false);
        }
    });

    it('does NOT over-reject common linear patterns with separated quantifiers', () => {
        // A mandatory literal between quantifiers keeps them linear.
        expect(safeRegex('\\w+@\\w+\\.\\w+').source).toBe('\\w+@\\w+\\.\\w+');
        expect(safeRegex('.*foo.*bar').source).toBe('.*foo.*bar');
        expect(safeRegex('hello.*world').source).toBe('hello.*world');
    });

    it('does NOT over-reject a plain non-nested bounded group', () => {
        // No inner quantifier before ')' and no alternation, so `(abc){2}` stays
        // a real regex (the NESTED_QUANTIFIER / alternation detectors don't fire).
        // Note: `(abc)+` is literalized by the pre-existing `(\(.*\))[+*]` rule,
        // independent of this change.
        expect(safeRegex('(abc){2}').source).toBe('(abc){2}');
        expect(safeRegex('(abc){2}').test('abcabc')).toBe(true);
    });
});

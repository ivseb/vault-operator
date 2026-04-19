/**
 * BUG-024 regression: the FastPath planner must recover from LLM
 * responses that wrap JSON in prose preambles, markdown fences, or add
 * trailing commentary.
 */

import { describe, it, expect } from 'vitest';
import { extractFirstJsonDocument } from '../FastPathExecutor';

describe('extractFirstJsonDocument', () => {
    it('returns the document verbatim for clean input', () => {
        expect(extractFirstJsonDocument('[{"tool":"read_file"}]'))
            .toBe('[{"tool":"read_file"}]');
    });

    it('strips ```json fences', () => {
        const raw = '```json\n[{"tool":"x"}]\n```';
        expect(extractFirstJsonDocument(raw)).toBe('[{"tool":"x"}]');
    });

    it('strips plain ``` fences without language tag', () => {
        const raw = '```\n[{"tool":"x"}]\n```';
        expect(extractFirstJsonDocument(raw)).toBe('[{"tool":"x"}]');
    });

    it('skips a prose preamble before the array', () => {
        const raw = 'Sure thing! Here is the plan:\n[{"tool":"x"}]';
        expect(extractFirstJsonDocument(raw)).toBe('[{"tool":"x"}]');
    });

    it('cuts off trailing commentary after the closing bracket', () => {
        const raw = '[{"tool":"x"}]\n\nExplanation: this reads the file first.';
        expect(extractFirstJsonDocument(raw)).toBe('[{"tool":"x"}]');
    });

    it('handles nested braces inside the array', () => {
        const raw = '[{"tool":"x","input":{"path":"a/b.md","nested":{"k":1}}}]';
        expect(extractFirstJsonDocument(raw)).toBe(raw);
    });

    it('does not misbalance on braces inside string literals', () => {
        const raw = '[{"tool":"x","input":{"path":"a }malicious{ b"}}]';
        expect(extractFirstJsonDocument(raw)).toBe(raw);
    });

    it('handles escaped quotes inside strings', () => {
        const raw = '[{"tool":"x","input":{"path":"a \\"quoted\\" b"}}]';
        expect(extractFirstJsonDocument(raw)).toBe(raw);
    });

    it('returns null when nothing balances', () => {
        expect(extractFirstJsonDocument('[{"tool":"x"')).toBeNull();
        expect(extractFirstJsonDocument('just prose, no json')).toBeNull();
        expect(extractFirstJsonDocument('')).toBeNull();
    });

    it('picks the first document when an object precedes an array', () => {
        // The planner only cares about arrays, but the extractor itself is
        // format-agnostic; the caller rejects non-arrays after parse.
        const raw = '{"note":"hi"} [{"tool":"x"}]';
        expect(extractFirstJsonDocument(raw)).toBe('{"note":"hi"}');
    });
});

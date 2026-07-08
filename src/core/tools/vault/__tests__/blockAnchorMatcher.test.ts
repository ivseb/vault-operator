/**
 * IMP-01-09-01: unit coverage for the pure block-anchor matcher.
 *
 * The matcher replaces the meeting-summary skill's fragile
 * `evaluate_expression(text.indexOf(find))` debug loop: it takes
 * `[{find, id}]` and appends `^block-<id>` at the end of each matched
 * paragraph, robust against ASR word-garble ("Cobork" vs "Cowork"),
 * double spaces and punctuation drift, and returns a deterministic
 * `{set, missed, ambiguous}` recovery signal so the model never has to
 * hunt in the sandbox.
 *
 * These tests pin the load-bearing invariants: no transcript word is
 * ever changed (only whitespace between blocks is normalised), anchors
 * are idempotent, offsets stay intact under right-to-left insertion,
 * and a mis-quote is reported (missed/ambiguous) rather than silently
 * anchored to the wrong paragraph.
 */

import { describe, it, expect } from 'vitest';

import { applyAnchors, MAX_FIND_CHARS } from '../blockAnchorMatcher';

/** Strip anchors + collapse whitespace runs, for the non-corruption invariant. */
function words(s: string): string {
    return s.replace(/\s*\^block-[\w-]+/g, '').replace(/\s+/g, ' ').trim();
}

describe('blockAnchorMatcher.applyAnchors', () => {
    it('1. exact single match: appends the anchor at paragraph end followed by a blank line', () => {
        const text = 'Wir liefern das Feature bis November.';
        const r = applyAnchors(text, [{ find: 'Wir liefern das Feature bis November.', id: 1 }]);

        expect(r.set).toEqual([1]);
        expect(r.missed).toEqual([]);
        expect(r.ambiguous).toEqual([]);
        expect(r.text).toBe('Wir liefern das Feature bis November. ^block-1\n');
    });

    it('2. fuzzy word substitution ("Cowork" find vs "Cobork" transcript): matches with 0.75 < confidence < 1', () => {
        const text = 'Wir haben 900 Millionen Euro in Cobork zu liefern.';
        const r = applyAnchors(text, [{ find: 'Wir haben 900 Millionen Euro in Cowork zu liefern.', id: 5 }]);

        expect(r.set).toEqual([5]);
        expect(r.missed).toEqual([]);
        expect(r.text).toContain('zu liefern. ^block-5');
        const detail = r.details.find((d) => d.id === 5);
        expect(detail?.status).toBe('fuzzy');
        expect(detail?.confidence).toBeGreaterThan(0.75);
        expect(detail?.confidence).toBeLessThan(1);
    });

    it('3. whitespace + punctuation drift matches via normalization (confidence 1)', () => {
        const text = 'Das  Prinzip,  von dem du sprichst, ist MCP First.';
        const r = applyAnchors(text, [{ find: 'Das Prinzip von dem du sprichst ist MCP First.', id: 9 }]);

        expect(r.set).toEqual([9]);
        expect(r.text).toContain('MCP First. ^block-9');
        const detail = r.details.find((d) => d.id === 9);
        expect(detail?.status).toBe('normalized');
        expect(detail?.confidence).toBe(1);
    });

    it('4. ambiguous find (matches two paragraphs within margin): reported, not written', () => {
        const text = 'Das ist wichtig fuer uns.\n\nSpaeter noch mal: Das ist wichtig fuer uns.';
        const r = applyAnchors(text, [{ find: 'Das ist wichtig fuer uns.', id: 2 }]);

        expect(r.ambiguous).toEqual([2]);
        expect(r.set).toEqual([]);
        expect(r.text).toBe(text); // unchanged
    });

    it('5. missed (best score below threshold): reported, text unchanged', () => {
        const text = 'Voellig anderer Inhalt ueber ein anderes Thema.';
        const r = applyAnchors(text, [{ find: 'Wir sprechen ueber Budget und Ressourcenplanung im Detail.', id: 7 }]);

        expect(r.missed).toEqual([7]);
        expect(r.set).toEqual([]);
        expect(r.text).toBe(text);
    });

    it('6. single-paragraph split: three finds get three distinct anchors, each followed by a blank line, words preserved', () => {
        const text = 'Erste Aussage hier. Zweite Aussage folgt. Dritte Aussage zum Schluss.';
        const r = applyAnchors(text, [
            { find: 'Erste Aussage hier.', id: 1 },
            { find: 'Zweite Aussage folgt.', id: 2 },
            { find: 'Dritte Aussage zum Schluss.', id: 3 },
        ]);

        expect(r.set).toEqual([1, 2, 3]);
        expect(r.text).toBe(
            'Erste Aussage hier. ^block-1\n\n' +
            'Zweite Aussage folgt. ^block-2\n\n' +
            'Dritte Aussage zum Schluss. ^block-3\n',
        );
        // Every anchor is followed by a blank line or EOF
        for (const id of [1, 2, 3]) {
            expect(r.text).toMatch(new RegExp(`\\^block-${id}(\\n\\n|\\n$)`));
        }
    });

    it('7. idempotent: an id already present at the target stays as-is, no duplicate', () => {
        const text = 'Der Satz ist schon verankert. ^block-2\n';
        const r = applyAnchors(text, [{ find: 'Der Satz ist schon verankert.', id: 2 }]);

        expect(r.set).toEqual([2]);
        expect(r.text).toBe(text); // byte-identical
        expect((r.text.match(/\^block-2/g) ?? []).length).toBe(1);
    });

    it('8. right-to-left insertion keeps earlier offsets byte-intact', () => {
        const text = 'Anfang bleibt exakt so stehen. Und danach kommt noch ein Satz.';
        const r = applyAnchors(text, [
            { find: 'Anfang bleibt exakt so stehen.', id: 10 },
            { find: 'Und danach kommt noch ein Satz.', id: 11 },
        ]);

        expect(r.set).toEqual([10, 11]);
        // The first sentence and its anchor are intact regardless of the later insertion
        expect(r.text.startsWith('Anfang bleibt exakt so stehen. ^block-10\n\n')).toBe(true);
        expect(r.text).toContain('Und danach kommt noch ein Satz. ^block-11');
    });

    it('9. non-corruption invariant: stripping anchors + collapsing blanks yields the original words', () => {
        const text = 'Ein langer Absatz ohne Leerzeilen. Mit mehreren Aussagen drin. Und einer dritten.';
        const r = applyAnchors(text, [
            { find: 'Ein langer Absatz ohne Leerzeilen.', id: 1 },
            { find: 'Mit mehreren Aussagen drin.', id: 2 },
            { find: 'Und einer dritten.', id: 3 },
        ]);

        expect(words(r.text)).toBe(words(text));
    });

    it('10. a match inside a code fence is not anchored (block-ids do not resolve there)', () => {
        const text = '```\nWir liefern das Feature bis November.\n```\n';
        const r = applyAnchors(text, [{ find: 'Wir liefern das Feature bis November.', id: 4 }]);

        expect(r.missed).toEqual([4]);
        expect(r.set).toEqual([]);
        expect(r.text).toBe(text);
    });

    it('12. an oversized find is reported missed WITHOUT entering the fuzzy DP (CWE-400 guard)', () => {
        // A garbled/huge find must not drive the O(n^2) alignment; it is
        // short-circuited to missed before resolveAnchor runs.
        const text = 'Ein normaler Absatz mit etwas Inhalt zum Ankern.';
        const hugeFind = 'x '.repeat(MAX_FIND_CHARS); // well over the cap
        const start = Date.now();
        const r = applyAnchors(text, [{ find: hugeFind, id: 1 }]);
        const elapsed = Date.now() - start;

        expect(r.missed).toEqual([1]);
        expect(r.set).toEqual([]);
        expect(r.text).toBe(text);
        expect(elapsed).toBeLessThan(200); // did not run the expensive alignment
    });

    it('11. an id containing whitespace or anchor-syntax is rejected, not written', () => {
        const text = 'Ein ganz normaler Satz hier.';
        const r = applyAnchors(text, [{ find: 'Ein ganz normaler Satz hier.', id: 'bad id' }]);

        expect(r.set).toEqual([]);
        expect(r.missed).toContain('bad id');
        expect(r.text).toBe(text);
    });
});

/**
 * FEAT-44-15: word-level diff INSIDE a changed line.
 *
 * A German markdown paragraph is one single long line. A line-level diff can only
 * say "this paragraph is gone, this paragraph is new", which carries no
 * information at all -- it is GitLab's own diagnosis of intraline highlighting
 * (gitlab#285464: line diffs are "worst for markdown, where lines are
 * paragraphs"). Code survives line-level. Prose does not.
 *
 * The rules that keep it readable rather than confetti:
 *  - tokenize on WORDS, not characters (diff-match-patch documents that the
 *    optimal character diff is unreadable: "mouse" vs "sofas" becomes
 *    [-m][+s][=o][-u][+fa][=s][-e]).
 *  - treat markdown atoms as single tokens, or [[Ziel|Alias]] gets shredded.
 *  - refine to characters ONLY inside a 1:1 token swap that is mostly the same
 *    word. That is the German inflection case (Modell -> Modelle) and it is the
 *    common case in this vault.
 *  - suppress entirely when the result would be noise, and mark the whole line
 *    instead. Never show a half-broken intraline diff.
 */

import { describe, it, expect } from 'vitest';
import { intralineDiff, tokenize } from '../intralineDiff';

/** Concatenating the ops of one side must reproduce that side exactly. */
function lossless(ops: { text: string }[]): string {
    return ops.map((o) => o.text).join('');
}

describe('tokenize: markdown atoms survive', () => {
    it('keeps a wikilink with an alias as ONE token', () => {
        expect(tokenize('siehe [[Ziel|Alias]] hier')).toContain('[[Ziel|Alias]]');
    });

    it('keeps a block anchor as one token', () => {
        expect(tokenize('Text ^block-nps-8-reasoning')).toContain('^block-nps-8-reasoning');
    });

    it('keeps a markdown link as one token', () => {
        expect(tokenize('[Text](https://x.de/a?b=1)')).toContain('[Text](https://x.de/a?b=1)');
    });

    it('keeps German words with umlauts whole', () => {
        expect(tokenize('Präsentationsanspruch schätzt')).toEqual(
            expect.arrayContaining(['Präsentationsanspruch', 'schätzt']),
        );
    });

    it('is lossless', () => {
        const s = 'Sie nutzt [[Acme Cowork]] täglich ^block-frequency-daily.';
        expect(tokenize(s).join('')).toBe(s);
    });
});

describe('intralineDiff: the common prose edit', () => {
    it('marks only the words that actually changed', () => {
        const d = intralineDiff(
            'Theresa nutzt Cowork täglich als Sparringspartner.',
            'Theresa nutzt Cowork wöchentlich als Sparringspartner.',
        )!;
        expect(d).not.toBeNull();

        const del = d.left.filter((o) => o.type === 'del').map((o) => o.text).join('');
        const ins = d.right.filter((o) => o.type === 'ins').map((o) => o.text).join('');
        expect(del).toBe('täglich');
        expect(ins).toBe('wöchentlich');

        // and nothing is lost on either side
        expect(lossless(d.left)).toBe('Theresa nutzt Cowork täglich als Sparringspartner.');
        expect(lossless(d.right)).toBe('Theresa nutzt Cowork wöchentlich als Sparringspartner.');
    });

    it('refines a German inflection to the changed characters, not the whole word', () => {
        // Modell -> Modelle: the interesting part is the "e", not the word.
        const d = intralineDiff('Das Modell ist gut.', 'Das Modelle ist gut.')!;
        const ins = d.right.filter((o) => o.type === 'ins').map((o) => o.text).join('');
        expect(ins).toBe('e');
        // "Modell" itself stays equal on both sides
        expect(d.right.some((o) => o.type === 'equal' && o.text.includes('Modell'))).toBe(true);
    });

    it('does NOT character-refine two unrelated words (that is how you get confetti)', () => {
        const d = intralineDiff('Die Maus ist da.', 'Die Sofas ist da.')!;
        const del = d.left.filter((o) => o.type === 'del').map((o) => o.text).join('');
        const ins = d.right.filter((o) => o.type === 'ins').map((o) => o.text).join('');
        expect(del).toBe('Maus');
        expect(ins).toBe('Sofas');
    });

    it('handles an added wikilink without shredding it', () => {
        const d = intralineDiff('Sie nutzt Cowork.', 'Sie nutzt [[Acme Cowork]].')!;
        const ins = d.right.filter((o) => o.type === 'ins').map((o) => o.text).join('');
        expect(ins).toContain('[[Acme Cowork]]');
    });
});

describe('intralineDiff: suppression (never show a half-broken diff)', () => {
    it('suppresses when the two lines are not really related', () => {
        expect(intralineDiff(
            'Theresa nutzt Cowork täglich als Sparringspartner für Präsentationen.',
            'Der Agent hat das Frontmatter geschrieben, bevor er gefragt hat.',
        )).toBeNull();
    });

    it('suppresses an absurdly long line rather than tokenizing 3000+ chars', () => {
        const long = 'wort '.repeat(1200);            // 6000 chars
        expect(intralineDiff(long, long + 'x')).toBeNull();
    });

    it('suppresses when everything changed (a full rewrite is not an intraline edit)', () => {
        expect(intralineDiff('aaa bbb ccc', 'xxx yyy zzz')).toBeNull();
    });

    it('returns null when the two sides are identical (nothing to highlight)', () => {
        expect(intralineDiff('gleich', 'gleich')).toBeNull();
    });
});

describe('intralineDiff: losslessness holds for every result', () => {
    const pairs: Array<[string, string]> = [
        ['Sie nutzt Cowork täglich.', 'Sie nutzt Cowork wöchentlich.'],
        ['- **Sparring** funktioniert.', '- **Sparring** funktioniert hervorragend.'],
        ['NPS 8', 'NPS 10'],
        ['Text ^block-a', 'Text ^block-b'],
    ];
    it.each(pairs)('%s -> %s', (a, b) => {
        const d = intralineDiff(a, b);
        if (d === null) return;   // suppressed is a valid outcome
        expect(lossless(d.left)).toBe(a);
        expect(lossless(d.right)).toBe(b);
    });
});

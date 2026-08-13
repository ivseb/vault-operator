import { describe, expect, it } from 'vitest';

import { compare, deriveAssertions, gradeRecord, resolvePath, runAssertion } from '../golden_records.js';

const ART = {
    summe_eur: 12400,
    geprueft: true,
    positionen: [{ artikelnummer: 'A-1' }, { artikelnummer: 'A-2' }],
    bericht: 'Zwei Positionen weichen ab, die Bauzeit fehlt.',
    quelle: '/Users/x/y.pdf',
    erstellt: '2026-07-14T10:00:00Z',
};

describe('resolvePath', () => {
    it('reads a scalar', () => expect(resolvePath(ART, 'summe_eur')).toBe(12400));
    it('flattens a list field', () => expect(resolvePath(ART, 'positionen[*].artikelnummer')).toEqual(['A-1', 'A-2']));
    it('counts a whole list', () => expect(resolvePath(ART, 'positionen[*]').length).toBe(2));
});

describe('runAssertion ops', () => {
    const cases = [
        [{ op: 'equals', path: 'summe_eur', value: 12400 }, true],
        [{ op: 'equals', path: 'summe_eur', value: 1 }, false],
        [{ op: 'count', path: 'positionen[*]', value: 2 }, true],
        [{ op: 'has_keys', value: ['summe_eur', 'positionen'] }, true],
        [{ op: 'has_keys', value: ['nope'] }, false],
        [{ op: 'absent', path: 'nichts' }, true],
        [{ op: 'equals', path: 'nichts', value: 1 }, false],
    ];
    for (const [spec, want] of cases) {
        it(`${spec.op} ${spec.path ?? ''} -> ${want}`, () => {
            expect(runAssertion(ART, { check: 'code', ...spec }, undefined).passed).toBe(want);
        });
    }

    it('same is a multiset by default', () => {
        const expected = { positionen: [{ artikelnummer: 'A-2' }, { artikelnummer: 'A-1' }] };
        expect(runAssertion(ART, { check: 'code', op: 'same', path: 'positionen[*].artikelnummer' }, expected).passed).toBe(true);
    });
    it('same ordered fails on a reordered list', () => {
        const expected = { positionen: [{ artikelnummer: 'A-2' }, { artikelnummer: 'A-1' }] };
        expect(runAssertion(ART, { check: 'code', op: 'same', path: 'positionen[*].artikelnummer', ordered: true }, expected).passed).toBe(false);
    });
    it('a rubric assertion never has a verdict', () => {
        expect(runAssertion(ART, { check: 'rubric', text: 'sachlich' }, undefined).passed).toBe(null);
    });
});

describe('deriveAssertions', () => {
    const { code, rubric } = deriveAssertions(ART);
    const paths = code.map((a) => a.path);
    it('promotes a number', () => expect(paths).toContain('summe_eur'));
    it('promotes a boolean', () => expect(paths).toContain('geprueft'));
    it('counts a list', () => expect(code.find((a) => a.path === 'positionen[*]').op).toBe('count'));
    it('drops a path-shaped value', () => expect(paths).not.toContain('quelle'));
    it('drops a timestamp', () => expect(paths).not.toContain('erstellt'));
    it('sends prose to the rubric, not to code', () => {
        expect(paths).not.toContain('bericht');
        expect(rubric.some((r) => r.path === 'bericht')).toBe(true);
    });
});

describe('gradeRecord and compare', () => {
    it('PASS when all code assertions hold', () => {
        const rec = { id: 'gr-1', assertions: [{ check: 'code', op: 'equals', path: 'summe_eur', value: 12400 }] };
        expect(gradeRecord(rec, ART, undefined).status).toBe('PASS');
    });
    it('FAIL when one fails', () => {
        const rec = { id: 'gr-1', assertions: [{ check: 'code', op: 'equals', path: 'summe_eur', value: 1 }] };
        expect(gradeRecord(rec, ART, undefined).status).toBe('FAIL');
    });
    it('INCONCLUSIVE when a seam run produced nothing', () => {
        const rec = { id: 'gr-1', seam_absent: true, started: true, assertions: [] };
        expect(gradeRecord(rec, null, undefined).status).toBe('INCONCLUSIVE');
    });
    it('compare reports a regression and blocks on inconclusive', () => {
        const base = { model: 'a', records: [{ id: 'gr-1', status: 'PASS' }, { id: 'gr-2', status: 'PASS' }] };
        const cur = { model: 'b', records: [{ id: 'gr-1', status: 'FAIL' }, { id: 'gr-2', status: 'PASS' }] };
        expect(compare(base, cur).verdict).toBe('DEGRADED');
        const curInc = { model: 'b', records: [{ id: 'gr-1', status: 'INCONCLUSIVE' }, { id: 'gr-2', status: 'FAIL' }] };
        expect(compare(base, curInc).verdict).toBe('INCONCLUSIVE');
    });
});

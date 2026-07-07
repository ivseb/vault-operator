import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, OKF_DEFAULTS } from '../settings';

/**
 * FIX-42-01-01: graph-expansion property defaults follow the OKF frontmatter
 * standard (vault schema), not the UI language. German legacy defaults only
 * survive in persisted user settings, never as fresh-install defaults.
 */
describe('OKF_DEFAULTS', () => {
    it('uses the OKF property vocabulary', () => {
        expect(OKF_DEFAULTS.categoryProperty).toBe('type');
        expect(OKF_DEFAULTS.summaryProperty).toBe('description');
        expect(OKF_DEFAULTS.backlinksProperty).toBe('related');
        expect(OKF_DEFAULTS.mocPropertyNames).toEqual(['moc']);
        expect(OKF_DEFAULTS.sourceNamingConvention).toBe('Author-Year_Title');
    });

    it('is the single source of truth for DEFAULT_SETTINGS', () => {
        expect(DEFAULT_SETTINGS.categoryProperty).toBe(OKF_DEFAULTS.categoryProperty);
        expect(DEFAULT_SETTINGS.summaryProperty).toBe(OKF_DEFAULTS.summaryProperty);
        expect(DEFAULT_SETTINGS.backlinksProperty).toBe(OKF_DEFAULTS.backlinksProperty);
        expect(DEFAULT_SETTINGS.mocPropertyNames).toEqual([...OKF_DEFAULTS.mocPropertyNames]);
        expect(DEFAULT_SETTINGS.sourceNamingConvention).toBe(OKF_DEFAULTS.sourceNamingConvention);
    });

    it('carries no German legacy defaults', () => {
        const values = [
            DEFAULT_SETTINGS.categoryProperty,
            DEFAULT_SETTINGS.summaryProperty,
            DEFAULT_SETTINGS.backlinksProperty,
            DEFAULT_SETTINGS.sourceNamingConvention,
            ...DEFAULT_SETTINGS.mocPropertyNames,
        ];
        for (const german of ['Kategorie', 'Zusammenfassung', 'Notizen', 'Autor-Jahr_Titel', 'Themen']) {
            expect(values).not.toContain(german);
        }
    });
});

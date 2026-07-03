import { afterEach, describe, expect, it } from 'vitest';
import {
    applyLocalePack,
    getActiveLocale,
    initI18n,
    localePackFilename,
    needsLocalePack,
    resolveLocale,
    SUPPORTED_LOCALES,
    t,
    __setActiveTranslationsForTest,
} from '../index';
import { en } from '../locales/en';

afterEach(() => {
    __setActiveTranslationsForTest(null);
});

describe('resolveLocale', () => {
    it('returns exact matches for every supported locale', () => {
        for (const locale of SUPPORTED_LOCALES) {
            expect(resolveLocale(locale)).toBe(locale);
        }
    });

    it('resolves regional variants to their base language', () => {
        expect(resolveLocale('zh-HK')).toBe('zh');
        expect(resolveLocale('de-AT')).toBe('de');
        expect(resolveLocale('en-GB')).toBe('en');
    });

    it('keeps zh-TW as its own locale instead of collapsing to zh', () => {
        expect(resolveLocale('zh-TW')).toBe('zh-TW');
    });

    it('falls back to en for unsupported locales', () => {
        expect(resolveLocale('pt-BR')).toBe('en');
        expect(resolveLocale('th')).toBe('en');
        expect(resolveLocale('')).toBe('en');
        expect(resolveLocale('nan-TW')).toBe('en');
    });
});

describe('t lookup chain', () => {
    it('prefers the active locale table', () => {
        __setActiveTranslationsForTest({ 'settings.group.providers': 'Anbieter' });
        expect(t('settings.group.providers')).toBe('Anbieter');
    });

    it('falls back to en when the active table misses the key', () => {
        __setActiveTranslationsForTest({ 'some.other.key': 'x' });
        expect(t('settings.group.providers')).toBe(en['settings.group.providers']);
    });

    it('falls back to the raw key when no table has it', () => {
        __setActiveTranslationsForTest({});
        expect(t('does.not.exist')).toBe('does.not.exist');
    });

    it('resolves to en without an explicit init (default active table)', () => {
        expect(t('settings.group.providers')).toBe(en['settings.group.providers']);
    });

    it('initI18n is idempotent and safe with the test stub', () => {
        initI18n();
        initI18n();
        expect(t('settings.group.providers')).toBe(en['settings.group.providers']);
    });
});

describe('language pack loading', () => {
    it('stub app language (en) needs no pack', () => {
        initI18n();
        expect(getActiveLocale()).toBe('en');
        expect(needsLocalePack()).toBe(false);
    });

    it('applyLocalePack merges onto en so missing keys still resolve', () => {
        applyLocalePack({ 'settings.group.providers': 'Anbieter' });
        // Overridden key comes from the pack.
        expect(t('settings.group.providers')).toBe('Anbieter');
        // A key the pack omits still resolves via the en fallback.
        const anyEnKey = Object.keys(en).find((k) => k !== 'settings.group.providers')!;
        expect(t(anyEnKey)).toBe((en as Record<string, string>)[anyEnKey]);
    });

    it('derives the pack filename from the locale code (lowercased)', () => {
        expect(localePackFilename('de')).toBe('locale-de.json');
        expect(localePackFilename('zh-TW')).toBe('locale-zh-tw.json');
    });
});

describe('t interpolation', () => {
    it('replaces {{var}} placeholders', () => {
        __setActiveTranslationsForTest({ greet: 'Hello {{name}}' });
        expect(t('greet', { name: 'World' })).toBe('Hello World');
    });

    it('replaces every occurrence of the same placeholder', () => {
        __setActiveTranslationsForTest({ twice: '{{x}} and {{x}}' });
        expect(t('twice', { x: 'a' })).toBe('a and a');
    });

    it('accepts numbers as values', () => {
        __setActiveTranslationsForTest({ count: '{{n}} files' });
        expect(t('count', { n: 5 })).toBe('5 files');
    });

    it('does not interpret $-patterns in replacement values', () => {
        __setActiveTranslationsForTest({ file: 'Saved {{name}}' });
        expect(t('file', { name: "$& $' $` $$ file" })).toBe("Saved $& $' $` $$ file");
    });

    it('leaves unknown placeholders untouched', () => {
        __setActiveTranslationsForTest({ partial: '{{known}} {{unknown}}' });
        expect(t('partial', { known: 'v' })).toBe('v {{unknown}}');
    });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * FEAT-42-05 boot-trigger coupling: initI18n() reads getLanguage() and the
 * on-demand pack download hangs on needsLocalePack() being true for a
 * non-English app language. The shared 'en' stub can only exercise the
 * false branch, so this file mocks getLanguage() to cover the true branch
 * and the throw-safety path.
 */

const { getLanguageMock } = vi.hoisted(() => ({ getLanguageMock: vi.fn(() => 'en') }));
vi.mock('obsidian', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, getLanguage: getLanguageMock };
});

import { initI18n, getActiveLocale, needsLocalePack, applyLocalePack, t } from '../index';
import { en } from '../locales/en';

afterEach(() => {
    getLanguageMock.mockReturnValue('en');
    initI18n();
});

describe('initI18n locale coupling', () => {
    it('resolves a non-English app language and flags a pack as needed', () => {
        getLanguageMock.mockReturnValue('de');
        initI18n();
        expect(getActiveLocale()).toBe('de');
        expect(needsLocalePack()).toBe(true);
    });

    it('collapses a regional variant to its base language', () => {
        getLanguageMock.mockReturnValue('zh-HK');
        initI18n();
        expect(getActiveLocale()).toBe('zh');
        expect(needsLocalePack()).toBe(true);
    });

    it('keeps zh-TW as its own locale', () => {
        getLanguageMock.mockReturnValue('zh-TW');
        initI18n();
        expect(getActiveLocale()).toBe('zh-TW');
    });

    it('falls back to en (no pack) for an unsupported language', () => {
        getLanguageMock.mockReturnValue('pt-BR');
        initI18n();
        expect(getActiveLocale()).toBe('en');
        expect(needsLocalePack()).toBe(false);
    });

    it('does not throw and stays en when getLanguage() throws', () => {
        getLanguageMock.mockImplementation(() => { throw new Error('obsidian not ready'); });
        expect(() => initI18n()).not.toThrow();
        expect(getActiveLocale()).toBe('en');
        getLanguageMock.mockReturnValue('en');
    });

    it('re-running initI18n after applyLocalePack resets the active table to en', () => {
        getLanguageMock.mockReturnValue('de');
        initI18n();
        applyLocalePack({ 'settings.group.providers': 'Anbieter' });
        expect(t('settings.group.providers')).toBe('Anbieter');
        // Contract: initI18n() unconditionally resets active to en, so it must
        // run before a pack is applied and never again after.
        initI18n();
        expect(t('settings.group.providers')).toBe(en['settings.group.providers']);
    });
});

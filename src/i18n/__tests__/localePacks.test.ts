import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Plugin } from 'obsidian';

/**
 * FEAT-42-05 integration glue between the i18n layer and the
 * OptionalAssetManager. The generated hash table and getLanguage() are
 * mocked so the test is self-contained (no build artifact needed, no real
 * app language). loadJson is spied on the prototype so no vault I/O runs.
 */

// Mock the generated hash table (gitignored build artifact, absent in a
// fresh test checkout). Two locales pinned; en deliberately absent.
vi.mock('../../_generated/locale-hashes', () => ({
    LOCALE_PACK_SHA256: {
        de: 'a'.repeat(64),
        'zh-tw': 'b'.repeat(64),
    },
}));

// Control the app language per test.
const { getLanguageMock } = vi.hoisted(() => ({ getLanguageMock: vi.fn(() => 'en') }));
vi.mock('obsidian', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, getLanguage: getLanguageMock };
});

import { initI18n, applyLocalePack, t, __setActiveTranslationsForTest } from '../index';
import { activeLocaleSpec, loadInstalledLocalePack } from '../localePacks';
import { OptionalAssetManager } from '../../core/assets/OptionalAssetManager';
import { en } from '../locales/en';

function makePlugin(): Plugin {
    return {
        app: { vault: { adapter: {} } },
        manifest: { version: '2.15.0' },
    } as unknown as Plugin;
}

function setLocale(code: string): void {
    getLanguageMock.mockReturnValue(code);
    initI18n();
}

afterEach(() => {
    __setActiveTranslationsForTest(null);
    getLanguageMock.mockReturnValue('en');
    initI18n();
    vi.restoreAllMocks();
});

describe('activeLocaleSpec', () => {
    it('returns null for English (no pack needed)', () => {
        setLocale('en');
        expect(activeLocaleSpec(makePlugin())).toBeNull();
    });

    it('builds a spec for zh-TW with the lowercase pack code and native label', () => {
        setLocale('zh-TW');
        const spec = activeLocaleSpec(makePlugin());
        expect(spec).not.toBeNull();
        expect(spec!.filename).toBe('locale-zh-tw.json');
        expect(spec!.expectedSha256).toBe('b'.repeat(64));
        expect(spec!.label).toContain('繁體中文');
        expect(spec!.downloadUrl).toContain('2.15.0-assets');
    });

    it('builds a spec for de with the German label and its pinned hash', () => {
        setLocale('de');
        const spec = activeLocaleSpec(makePlugin());
        expect(spec!.filename).toBe('locale-de.json');
        expect(spec!.expectedSha256).toBe('a'.repeat(64));
        expect(spec!.label).toContain('Deutsch');
    });

    it('returns null when the active locale has no pinned hash', () => {
        // 'ja' resolves as a supported locale but is not in the mocked hash table.
        setLocale('ja');
        expect(activeLocaleSpec(makePlugin())).toBeNull();
    });
});

describe('loadInstalledLocalePack', () => {
    it('short-circuits for English without touching the asset manager', async () => {
        setLocale('en');
        const spy = vi.spyOn(OptionalAssetManager.prototype, 'loadJson');
        const result = await loadInstalledLocalePack(makePlugin());
        expect(result).toEqual({ needed: false, applied: false, spec: null });
        expect(spy).not.toHaveBeenCalled();
    });

    it('applies an installed pack so t() returns the translated value', async () => {
        setLocale('de');
        vi.spyOn(OptionalAssetManager.prototype, 'loadJson').mockResolvedValue({
            'settings.group.providers': 'Anbieter',
        });
        const result = await loadInstalledLocalePack(makePlugin());
        expect(result.needed).toBe(true);
        expect(result.applied).toBe(true);
        expect(result.spec).not.toBeNull();
        // Observable side effect: the pack is now the active table.
        expect(t('settings.group.providers')).toBe('Anbieter');
    });

    it('leaves English active and reports the spec when the pack is missing', async () => {
        setLocale('de');
        vi.spyOn(OptionalAssetManager.prototype, 'loadJson').mockResolvedValue(null);
        const result = await loadInstalledLocalePack(makePlugin());
        expect(result.needed).toBe(true);
        expect(result.applied).toBe(false);
        expect(result.spec).not.toBeNull();
        // Untranslated: t() still returns the en fallback.
        expect(t('settings.group.providers')).toBe(en['settings.group.providers']);
    });

    it('does not apply an empty/invalid pack', async () => {
        setLocale('de');
        applyLocalePack({ 'settings.group.providers': 'STALE' });
        vi.spyOn(OptionalAssetManager.prototype, 'loadJson').mockResolvedValue(null);
        const result = await loadInstalledLocalePack(makePlugin());
        expect(result.applied).toBe(false);
        // The prior table is untouched (applyLocalePack was not called with null).
        expect(t('settings.group.providers')).toBe('STALE');
    });
});

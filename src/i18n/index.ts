/**
 * Lightweight string module for Obsidian Agent.
 *
 * The active locale follows the Obsidian app language (getLanguage) with no
 * plugin-side language setting. English is bundled into main.js and is the
 * lookup fallback. The eight non-English locales ship as on-demand language
 * packs (JSON assets, FEAT-42-05) so they never inflate main.js; they are
 * fetched into the vault on first use, hash-verified, and applied at boot
 * before the UI renders via applyLocalePack().
 *
 * Lookup chain: active locale table -> en -> raw key.
 */

import { getLanguage } from 'obsidian';
import type { Translations } from './types';
import { en } from './locales/en';

export const SUPPORTED_LOCALES = ['en', 'de', 'zh', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'ru'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Map an Obsidian language code to a shipped locale: exact match first
 * ('zh-TW'), then base language ('zh-HK' -> 'zh'), otherwise 'en'.
 */
export function resolveLocale(obsidianLang: string): SupportedLocale {
    if ((SUPPORTED_LOCALES as readonly string[]).includes(obsidianLang)) {
        return obsidianLang as SupportedLocale;
    }
    const base = obsidianLang.split('-')[0];
    if ((SUPPORTED_LOCALES as readonly string[]).includes(base)) {
        return base as SupportedLocale;
    }
    return 'en';
}

/** Filename of the language pack asset for a non-English locale. */
export function localePackFilename(locale: SupportedLocale): string {
    return `locale-${locale.toLowerCase()}.json`;
}

let active: Translations = en;
let activeLocale: SupportedLocale = 'en';

/**
 * Resolve the active locale from the Obsidian app language. English resolves
 * synchronously to the bundled table; a non-English locale keeps the English
 * fallback active until applyLocalePack() installs the downloaded pack. Called
 * early in onload(); t() also self-initializes for module-level strings/tests.
 */
export function initI18n(): void {
    let lang = 'en';
    try {
        lang = getLanguage();
    } catch {
        // Test stubs or very early load paths without a full obsidian module.
    }
    activeLocale = resolveLocale(lang);
    active = en;
}

/**
 * The resolved UI locale. Lets engine-layer modules (which must not import
 * 'obsidian' directly, ADR-080) branch on the app language.
 */
export function getActiveLocale(): SupportedLocale {
    return activeLocale;
}

/** True when the app runs in a non-English locale that needs a language pack. */
export function needsLocalePack(): boolean {
    return activeLocale !== 'en';
}

/**
 * Install a downloaded language pack as the active table. Merged onto en so
 * any key the pack is missing still resolves (defense-in-depth on top of the
 * build-time parity check). Called from the host layer after the pack is read
 * from the vault and hash-verified.
 */
export function applyLocalePack(table: Translations): void {
    active = { ...en, ...table };
}

/** Test hook: force a specific table (null resets to the en fallback). */
export function __setActiveTranslationsForTest(table: Translations | null): void {
    active = table ?? en;
}

/**
 * Look up a UI string by key. Returns the string, falling back to en and
 * finally to the raw key.
 *
 * Supports simple interpolation: `t('key', { count: 5 })` replaces `{{count}}`.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
    let text = active[key] ?? (en as Translations)[key] ?? key;
    if (vars) {
        for (const [k, v] of Object.entries(vars)) {
            // Replacer function so '$&'-style patterns in values stay literal.
            text = text.replaceAll(`{{${k}}}`, () => String(v));
        }
    }
    return text;
}

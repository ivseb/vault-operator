/**
 * Lightweight string module for Obsidian Agent.
 *
 * The active locale follows the Obsidian app language (getLanguage) with no
 * plugin-side language setting. Lookup chain: active locale -> en -> raw key.
 * Obsidian reloads the app on language change, so resolving once per plugin
 * load is sufficient.
 */

import { getLanguage } from 'obsidian';
import type { Translations } from './types';
import { en } from './locales/en';

export const SUPPORTED_LOCALES = ['en', 'de', 'zh', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'ru'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * All shipped locale tables. Locales land here as they are translated
 * (FEAT-42-05); until then the resolver falls back to en for them.
 * Exported for the parity test suite.
 */
export const localeTables: Partial<Record<SupportedLocale, Translations>> = { en };

let active: Translations | null = null;

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

/**
 * Resolve the active locale table from the Obsidian app language. Called
 * early in onload(); t() also self-initializes so module-level strings and
 * tests work before the plugin entry point runs.
 */
export function initI18n(): void {
    let lang = 'en';
    try {
        lang = getLanguage();
    } catch {
        // Test stubs or very early load paths without a full obsidian module.
    }
    active = localeTables[resolveLocale(lang)] ?? en;
}

/** Test hook: force a specific table (null resets to lazy re-init). */
export function __setActiveTranslationsForTest(table: Translations | null): void {
    active = table;
}

/**
 * Look up a UI string by key. Returns the string, falling back to en and
 * finally to the raw key.
 *
 * Supports simple interpolation: `t('key', { count: 5 })` replaces `{{count}}`.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
    if (active === null) initI18n();
    let text = active?.[key] ?? (en as Translations)[key] ?? key;
    if (vars) {
        for (const [k, v] of Object.entries(vars)) {
            // Replacer function so '$&'-style patterns in values stay literal.
            text = text.replaceAll(`{{${k}}}`, () => String(v));
        }
    }
    return text;
}

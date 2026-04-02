/**
 * i18n Type Definitions
 */

export type Language = 'en' | 'de';

/** Flat key-value translation map */
export type Translations = Record<string, string>;

/** Language metadata for the settings dropdown */
export const LANGUAGES: Record<Language, string> = {
    en: 'English',
    de: 'Deutsch',
};

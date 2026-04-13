/**
 * Lightweight string module for Obsidian Agent.
 *
 * English-only. The t() function provides key-based string lookup
 * with simple interpolation ({{var}}).
 */

import { en } from './locales/en';

/**
 * Look up a UI string by key. Returns the string, falling back to the raw key
 * if nothing is found.
 *
 * Supports simple interpolation: `t('key', { count: 5 })` replaces `{{count}}`.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
    let text = en[key] ?? key;
    if (vars) {
        for (const [k, v] of Object.entries(vars)) {
            text = text.replaceAll(`{{${k}}}`, String(v));
        }
    }
    return text;
}

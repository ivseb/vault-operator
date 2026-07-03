import { describe, expect, it } from 'vitest';
import { localeTables } from '../index';
import { en } from '../locales/en';

/**
 * Style and parity gate for every shipped locale, including en itself.
 *
 * - Key parity: every locale carries exactly the keys of en. This is also
 *   enforced at compile time (Record<TranslationKey, string>), the runtime
 *   check catches casts and generated files.
 * - Placeholders: the {{var}} multiset per key must match en, otherwise
 *   interpolation silently drops values in one language.
 * - Style: no em/en-dashes, no emoji, no empty values (project UI rules).
 */

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;
const FORBIDDEN_DASH_RE = /[–—]/;
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

function placeholderMultiset(value: string): string {
    const names: string[] = [];
    for (const m of value.matchAll(PLACEHOLDER_RE)) {
        names.push(m[1]);
    }
    return names.sort().join(',');
}

const enKeys = Object.keys(en).sort();

describe.each(Object.entries(localeTables))('locale %s', (locale, table) => {
    it('has exactly the same keys as en', () => {
        const keys = Object.keys(table).sort();
        const missing = enKeys.filter((k) => !(k in table));
        const extra = keys.filter((k) => !(k in en));
        expect(missing, `keys missing in ${locale}`).toEqual([]);
        expect(extra, `keys not present in en`).toEqual([]);
    });

    it('preserves every {{var}} placeholder', () => {
        const broken: string[] = [];
        for (const [key, enValue] of Object.entries(en)) {
            const localized = (table as Record<string, string>)[key];
            if (typeof localized !== 'string') continue; // covered by parity test
            if (placeholderMultiset(localized) !== placeholderMultiset(enValue)) {
                broken.push(key);
            }
        }
        expect(broken, `placeholder mismatch in ${locale}`).toEqual([]);
    });

    it('contains no em/en-dashes, no emoji, and no empty values', () => {
        const dashes: string[] = [];
        const emoji: string[] = [];
        const empty: string[] = [];
        for (const [key, value] of Object.entries(table as Record<string, string>)) {
            if (FORBIDDEN_DASH_RE.test(value)) dashes.push(key);
            if (EMOJI_RE.test(value)) emoji.push(key);
            if (value.trim() === '') empty.push(key);
        }
        expect(dashes, `em/en-dash in ${locale}`).toEqual([]);
        expect(emoji, `emoji in ${locale}`).toEqual([]);
        expect(empty, `empty value in ${locale}`).toEqual([]);
    });
});

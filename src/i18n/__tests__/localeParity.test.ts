import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { en } from '../locales/en';
import { SUPPORTED_LOCALES } from '../index';

/**
 * Style and parity gate for every shipped language pack (FEAT-42-05).
 *
 * The eight non-English locales ship as JSON packs under locales/packs/ and
 * are loaded on demand, so parity is verified against those source files
 * (not against bundled tables, which no longer exist).
 *
 * - Key parity: every pack carries exactly the keys of en.
 * - Placeholders: the {{var}} multiset per key must match en, otherwise
 *   interpolation silently drops values in one language.
 * - Style: no em/en-dashes, no emoji, no empty values (project UI rules).
 */

const PACK_DIR = path.resolve(__dirname, '..', 'locales', 'packs');
const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;
const FORBIDDEN_DASH_RE = /[–—]/;
// Emoji ranges checked individually to avoid a combined-character class.
const EMOJI_RES = [
    /[\u{1F000}-\u{1FAFF}]/u,   // pictographs, symbols, emoticons
    /[\u{2600}-\u{27BF}]/u,     // misc symbols, dingbats
    /\u{FE0F}/u,                // variation selector-16
    /[\u{1F1E6}-\u{1F1FF}]/u,   // regional indicators (flags)
];

function placeholderMultiset(value: string): string {
    const names: string[] = [];
    for (const m of value.matchAll(PLACEHOLDER_RE)) {
        names.push(m[1]);
    }
    return names.sort().join(',');
}

function loadPack(locale: string): Record<string, string> {
    const file = path.join(PACK_DIR, `${locale.toLowerCase()}.json`);
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, string>;
}

const enKeys = Object.keys(en).sort();
const nonEnglishLocales = SUPPORTED_LOCALES.filter((l) => l !== 'en');

it('ships a pack file for every non-English supported locale', () => {
    for (const locale of nonEnglishLocales) {
        const file = path.join(PACK_DIR, `${locale.toLowerCase()}.json`);
        expect(fs.existsSync(file), `missing pack ${file}`).toBe(true);
    }
});

describe('en.ts style guard (bundled fallback table)', () => {
    // en is the universal fallback shown for any untranslated key in every
    // locale, so the style rules that localeParity enforces on packs must
    // hold on en itself. localeParity's per-pack block filters en out.
    const entries = Object.entries(en);

    it('has no em/en-dashes', () => {
        const bad = entries.filter(([, v]) => FORBIDDEN_DASH_RE.test(v)).map(([k]) => k);
        expect(bad).toEqual([]);
    });

    it('has no emoji or variation selectors', () => {
        const bad = entries.filter(([, v]) => EMOJI_RES.some((re) => re.test(v))).map(([k]) => k);
        expect(bad).toEqual([]);
    });

    it('has no empty or whitespace-only values', () => {
        // t() uses ?? so an empty en value is "present" and never falls back
        // to the key: a blank string would ship a silently empty label.
        const bad = entries.filter(([, v]) => v.trim() === '').map(([k]) => k);
        expect(bad).toEqual([]);
    });

    it('has no whole-value double-quote wrapping (string-sweep artifact)', () => {
        // A sweep extraction that kept its surrounding quotes renders literal
        // quotes in the UI. Values that quote a placeholder inside are fine.
        const bad = entries.filter(([, v]) => /^\s*"[^"]*"\s*$/.test(v)).map(([k]) => k);
        expect(bad).toEqual([]);
    });
});

describe.each(nonEnglishLocales)('language pack %s', (locale) => {
    const table = loadPack(locale);

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
            const localized = table[key];
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
        for (const [key, value] of Object.entries(table)) {
            if (FORBIDDEN_DASH_RE.test(value)) dashes.push(key);
            if (EMOJI_RES.some((re) => re.test(value))) emoji.push(key);
            if (value.trim() === '') empty.push(key);
        }
        expect(dashes, `em/en-dash in ${locale}`).toEqual([]);
        expect(emoji, `emoji in ${locale}`).toEqual([]);
        expect(empty, `empty value in ${locale}`).toEqual([]);
    });
});

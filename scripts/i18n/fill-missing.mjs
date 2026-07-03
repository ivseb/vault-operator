#!/usr/bin/env node
/**
 * Fill missing keys in a locale file with the English value plus a
 * TODO(i18n) marker (FEAT-42-05). Keeps the TS build green while new
 * en.ts keys await translation; open items stay greppable via TODO(i18n).
 *
 * Usage: node scripts/i18n/fill-missing.mjs <locale> (e.g. de, zh, zh-tw)
 */

import fs from 'node:fs';

const locale = process.argv[2];
if (!locale) {
    console.error('usage: node scripts/i18n/fill-missing.mjs <locale>');
    process.exit(2);
}
const localePath = `src/i18n/locales/${locale}.ts`;

function parseKeys(src) {
    const map = new Map();
    for (const m of src.matchAll(/^\s*'((?:[^'\\]|\\.)*)':\s*'((?:[^'\\]|\\.)*)',?.*$/gm)) {
        map.set(m[1].replace(/\\'/g, "'"), m[2]);
    }
    return map;
}

const enSrc = fs.readFileSync('src/i18n/locales/en.ts', 'utf-8');
const enKeys = parseKeys(enSrc);
let localeSrc = fs.readFileSync(localePath, 'utf-8');
const haveKeys = parseKeys(localeSrc);

const missing = [...enKeys.entries()].filter(([k]) => !haveKeys.has(k));
if (missing.length === 0) {
    console.log(`${locale}: no missing keys`);
    process.exit(0);
}

const block =
    `\n    // TODO(i18n): untranslated fallbacks, replace in the next translation pass\n` +
    missing.map(([k, v]) => `    '${k.replace(/'/g, "\\'")}': '${v}', // TODO(i18n)`).join('\n') + '\n';

const anchorRe = /\};\s*$/;
if (!anchorRe.test(localeSrc)) {
    console.error(`anchor '};' not found in ${localePath}`);
    process.exit(2);
}
localeSrc = localeSrc.replace(anchorRe, block + '};\n');
fs.writeFileSync(localePath, localeSrc);
console.log(`${locale}: filled ${missing.length} keys with English fallbacks (TODO-marked)`);

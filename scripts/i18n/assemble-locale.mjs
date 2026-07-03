#!/usr/bin/env node
/**
 * Assemble a locale .ts file from translated chunk JSONs (FEAT-42-05).
 *
 * Reads every chunk-*.json in the given directory, validates exact key
 * parity against en.ts (order follows en.ts), and writes
 * src/i18n/locales/<file>.ts typed as Record<TranslationKey, string>
 * so parity stays a compile-time guarantee.
 *
 * Usage: node scripts/i18n/assemble-locale.mjs <exportName> <fileBase> <chunkDir> <languageLabel>
 *   e.g. node scripts/i18n/assemble-locale.mjs zhTW zh-tw /tmp/i18n-out/zh-tw "Chinese (Traditional)"
 */

import fs from 'node:fs';
import path from 'node:path';

const [exportName, fileBase, chunkDir, languageLabel] = process.argv.slice(2);
if (!exportName || !fileBase || !chunkDir) {
    console.error('usage: assemble-locale.mjs <exportName> <fileBase> <chunkDir> <languageLabel>');
    process.exit(2);
}

function parseEnKeys(src) {
    const keys = [];
    for (const m of src.matchAll(/^\s*'((?:[^'\\]|\\.)*)':\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"),?.*$/gm)) {
        keys.push(m[1].replace(/\\'/g, "'"));
    }
    return keys;
}

const enKeys = parseEnKeys(fs.readFileSync('src/i18n/locales/en.ts', 'utf-8'));

const map = new Map();
const files = fs.readdirSync(chunkDir).filter((f) => f.startsWith('chunk-') && f.endsWith('.json')).sort();
for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(chunkDir, f), 'utf-8'));
    for (const [k, v] of Object.entries(data)) map.set(k, v);
}

const missing = enKeys.filter((k) => !map.has(k));
const extra = [...map.keys()].filter((k) => !enKeys.includes(k));
if (missing.length || extra.length) {
    console.error(`${fileBase}: parity mismatch. missing=${missing.length} extra=${extra.length}`);
    for (const k of missing.slice(0, 10)) console.error('  missing', k);
    for (const k of extra.slice(0, 10)) console.error('  extra', k);
    process.exit(1);
}

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n');
const body = enKeys.map((k) => `    '${esc(k)}': '${esc(String(map.get(k)))}',`).join('\n');

const out = `/**
 * ${languageLabel ?? exportName} locale (FEAT-42-05). Key parity with en.ts is
 * enforced at compile time via Record<TranslationKey, string> and at test
 * time via localeParity.test.ts. For new keys run:
 *   node scripts/i18n/export-chunks.mjs --diff ${fileBase}
 * then translate the delta and re-assemble.
 */

import type { TranslationKey } from '../types';

export const ${exportName}: Record<TranslationKey, string> = {
${body}
};
`;

fs.writeFileSync(`src/i18n/locales/${fileBase}.ts`, out);
console.log(`${fileBase}: ${map.size} keys written from ${files.length} chunks`);

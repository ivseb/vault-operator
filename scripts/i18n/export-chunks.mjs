#!/usr/bin/env node
/**
 * Export en.ts translation keys as JSON chunks for LLM translation
 * (FEAT-42-05).
 *
 * Modes:
 *   node scripts/i18n/export-chunks.mjs                 -> all keys, chunked
 *   node scripts/i18n/export-chunks.mjs --diff <locale> -> only keys missing
 *        or TODO-marked in src/i18n/locales/<locale>.ts
 *   --chunk-size N (default 120)
 *
 * Output: JSON array of chunks on stdout: [{ index, keys: {k: v} }]
 */

import fs from 'node:fs';

function parseLocaleFile(path) {
    const src = fs.readFileSync(path, 'utf-8');
    const map = new Map();
    for (const m of src.matchAll(/^\s*'((?:[^'\\]|\\.)*)':\s*'((?:[^'\\]|\\.)*)',?(\s*\/\/\s*TODO\(i18n\))?\s*$/gm)) {
        map.set(m[1].replace(/\\'/g, "'"), {
            value: m[2].replace(/\\'/g, "'").replace(/\\n/g, '\n').replace(/\\\\/g, '\\'),
            todo: Boolean(m[3]),
        });
    }
    return map;
}

const en = parseLocaleFile('src/i18n/locales/en.ts');
const chunkSizeIdx = process.argv.indexOf('--chunk-size');
const chunkSize = chunkSizeIdx > -1 ? parseInt(process.argv[chunkSizeIdx + 1], 10) : 120;
const diffIdx = process.argv.indexOf('--diff');

let keys = [...en.entries()].map(([k, v]) => [k, v.value]);
if (diffIdx > -1) {
    const locale = process.argv[diffIdx + 1];
    const localePath = `src/i18n/locales/${locale}.ts`;
    if (fs.existsSync(localePath)) {
        const target = parseLocaleFile(localePath);
        keys = keys.filter(([k]) => !target.has(k) || target.get(k).todo);
    }
}

const chunks = [];
for (let i = 0; i < keys.length; i += chunkSize) {
    chunks.push({ index: chunks.length, keys: Object.fromEntries(keys.slice(i, i + chunkSize)) });
}
console.log(JSON.stringify({ total: keys.length, chunkCount: chunks.length, chunks }, null, 1));

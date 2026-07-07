#!/usr/bin/env node
/**
 * Merge new translation keys into src/i18n/locales/en.ts (FEAT-42-04).
 *
 * Input: JSON file with a flat { "key": "English text" } map (the sweep
 * workflow output). Keys that already exist with the same value are
 * skipped; keys that exist with a DIFFERENT value are reported and NOT
 * overwritten. New keys are appended as one sorted block before the
 * closing brace.
 *
 * Usage: node scripts/i18n/merge-keys.mjs <keys.json> [--section "Comment"]
 */

import fs from 'node:fs';

const EN_PATH = 'src/i18n/locales/en.ts';
const input = process.argv[2];
if (!input) {
    console.error('usage: node scripts/i18n/merge-keys.mjs <keys.json> [--section "Comment"]');
    process.exit(2);
}
const sectionIdx = process.argv.indexOf('--section');
const section = sectionIdx > -1 ? process.argv[sectionIdx + 1] : 'String sweep additions';

const newKeys = JSON.parse(fs.readFileSync(input, 'utf-8'));
let en = fs.readFileSync(EN_PATH, 'utf-8');

const existing = new Map();
for (const m of en.matchAll(/^\s*'((?:[^'\\]|\\.)*)':\s*'((?:[^'\\]|\\.)*)',?\s*$/gm)) {
    existing.set(m[1].replace(/\\'/g, "'"), m[2]);
}

const toAdd = [];
const conflicts = [];
let skippedSame = 0;
for (const [key, value] of Object.entries(newKeys).sort(([a], [b]) => a.localeCompare(b))) {
    if (existing.has(key)) {
        const existingRaw = existing.get(key).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
        if (existingRaw === value) skippedSame++;
        else conflicts.push({ key, existing: existingRaw, incoming: value });
        continue;
    }
    toAdd.push([key, value]);
}

if (toAdd.length > 0) {
    const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    const block =
        `\n    // =========================================================================\n` +
        `    // ${section}\n` +
        `    // =========================================================================\n` +
        toAdd.map(([k, v]) => `    '${esc(k)}': '${esc(v)}',`).join('\n') + '\n';
    const anchor = '} satisfies Translations;';
    if (!en.includes(anchor)) {
        console.error('anchor not found in en.ts');
        process.exit(2);
    }
    en = en.replace(anchor, block + anchor);
    fs.writeFileSync(EN_PATH, en);
}

console.log(`added: ${toAdd.length}, skipped (identical): ${skippedSame}, conflicts: ${conflicts.length}`);
for (const c of conflicts) {
    console.log(`CONFLICT ${c.key}\n  existing: ${c.existing}\n  incoming: ${c.incoming}`);
}
process.exit(conflicts.length > 0 ? 1 : 0);

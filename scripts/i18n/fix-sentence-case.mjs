#!/usr/bin/env node
/**
 * Apply the sentence-case rule's own canonical suggestion to every flagged
 * value in en.ts, using the exact options from eslint.config.mjs
 * (FEAT-42-04 cleanup helper). Lines whose suggestion would change a
 * {{var}} placeholder are skipped and reported.
 *
 * Usage: node scripts/i18n/fix-sentence-case.mjs [--dry]
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { sentenceCaseSuggestion } from 'eslint-plugin-obsidianmd/dist/lib/rules/ui/sentenceCaseUtil.js';
import config from '../../eslint.config.mjs';

const EN = 'src/i18n/locales/en.ts';
const dry = process.argv.includes('--dry');

const ruleEntry = config
    .flatMap((c) => (c.rules ? [c.rules['obsidianmd/ui/sentence-case-locale-module']] : []))
    .find((r) => Array.isArray(r) && typeof r[1] === 'object');
if (!ruleEntry) {
    console.error('rule options not found in eslint.config.mjs');
    process.exit(2);
}
const opts = ruleEntry[1];

let report;
try {
    report = execSync(`npx eslint ${EN} -f json`, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
    report = e.stdout; // eslint exits 1 on errors, output is still valid JSON
}
const messages = JSON.parse(report)[0]?.messages ?? [];
const flaggedLines = [...new Set(messages.map((m) => m.line))];

const lines = fs.readFileSync(EN, 'utf-8').split('\n');
const LINE_RE = /^(\s*'(?:[^'\\]|\\.)*':\s*')((?:[^'\\]|\\.)*)(',?\s*(?:\/\/.*)?)$/;
const placeholders = (s) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',');

let fixed = 0;
const skipped = [];
for (const ln of flaggedLines) {
    const raw = lines[ln - 1];
    const m = raw.match(LINE_RE);
    if (!m) { skipped.push(`${ln}: unparseable line`); continue; }
    const value = m[2].replace(/\\'/g, "'");
    const suggestion = sentenceCaseSuggestion(value, opts);
    if (suggestion === value) { skipped.push(`${ln}: no suggestion (${value.slice(0, 60)})`); continue; }
    if (placeholders(suggestion) !== placeholders(value)) { skipped.push(`${ln}: placeholder change`); continue; }
    lines[ln - 1] = m[1] + suggestion.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + m[3];
    fixed++;
}

if (!dry) fs.writeFileSync(EN, lines.join('\n'));
console.log(`fixed: ${fixed}, skipped: ${skipped.length}${dry ? ' (dry run)' : ''}`);
for (const s of skipped) console.log('  skip', s);

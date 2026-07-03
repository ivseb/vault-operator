#!/usr/bin/env node
/**
 * i18n string inventory (FEAT-42-04).
 *
 * Scans src/ for hardcoded UI string literals that should go through t().
 * LLM-facing paths (core/prompts, core/tools descriptions) and tests are
 * excluded. Prints a per-file summary plus a detail list; exits 1 when
 * candidates remain so it can serve as a CI gate after the sweep.
 *
 * Usage: node scripts/i18n/inventory.mjs [--details] [--json]
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'src');

// LLM-facing and wire-level paths stay English by design:
// - core/prompts, core/tools: system prompt and tool descriptions steer the model
// - mcp: MCP wire responses stay neutral (no localization of protocol payloads)
// - api: provider-layer errors and wire fixtures
// - document-parsers, sandbox, governance: log/diagnostic strings
// - AgentTask.ts: conversation-summary wire markers
const EXCLUDE_DIRS = [
    `src${path.sep}core${path.sep}prompts`,
    `src${path.sep}core${path.sep}tools`,
    `src${path.sep}core${path.sep}document-parsers`,
    `src${path.sep}core${path.sep}sandbox`,
    `src${path.sep}core${path.sep}governance`,
    `src${path.sep}core${path.sep}AgentTask.ts`,
    `src${path.sep}mcp`,
    `src${path.sep}api`,
    `src${path.sep}_generated`,
    '__tests__',
];

// Call sites whose first string argument is user-visible text.
const PATTERNS = [
    { name: 'notice', re: /new Notice\(\s*(['"`])/g },
    { name: 'setName', re: /\.setName\(\s*(['"])/g },
    { name: 'setDesc', re: /\.setDesc\(\s*(['"])/g },
    { name: 'setPlaceholder', re: /\.setPlaceholder\(\s*(['"])/g },
    { name: 'setButtonText', re: /\.setButtonText\(\s*(['"])/g },
    { name: 'setTooltip', re: /\.setTooltip\(\s*(['"])/g },
    { name: 'setText', re: /\.setText\(\s*(['"`])/g },
    { name: 'setTitle', re: /\.setTitle\(\s*(['"])/g },
    { name: 'textProp', re: /[{,]\s*text:\s*(['"`])/g },
    { name: 'placeholderProp', re: /[{,]\s*placeholder:\s*(['"])/g },
    { name: 'ariaLabel', re: /aria-label['"]?\s*[:,]\s*(['"])/g },
];

// A literal counts as UI text when it contains a word of 3+ letters and a
// space OR an uppercase start; skips icon ids, css classes, punctuation-only.
function looksLikeUiText(literal, kind) {
    if (!literal || literal.length < 3) return false;
    if (/^[a-z0-9-_.:/\\]+$/.test(literal)) return false; // ids, classes, paths
    if (/^</.test(literal)) return false; // XML wire markers (LLM-facing)
    // Text OUTSIDE ${...} interpolations decides; pure compositions like
    // `${a} (${b})` carry no translatable words.
    const outside = literal.replace(/\$\{[^}]*\}/g, '');
    if (!/[A-Za-zÀ-ž]{3}/.test(outside)) return false;
    // Placeholder examples that are single tokens or paths are VALUES the
    // user would type (folder names, property names), not UI text.
    if (kind === 'setPlaceholder' || kind === 'placeholderProp') {
        if (!/\s/.test(literal) || /[/\\]/.test(literal)) return false;
    }
    return /\s/.test(outside) || /^[A-Z]/.test(outside);
}

function extractLiteral(src, quotePos, quoteChar) {
    let out = '';
    for (let i = quotePos + 1; i < src.length; i++) {
        const c = src[i];
        if (c === '\\') { out += src[i + 1] ?? ''; i++; continue; }
        if (c === quoteChar) return out;
        out += c;
    }
    return out;
}

function* walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (EXCLUDE_DIRS.some((ex) => full.includes(ex))) continue;
        if (entry.isDirectory()) yield* walk(full);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) yield full;
    }
}

const details = [];
for (const file of walk(ROOT)) {
    const src = fs.readFileSync(file, 'utf-8');
    for (const { name, re } of PATTERNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(src)) !== null) {
            const quoteChar = m[1];
            const quotePos = m.index + m[0].length - 1;
            const literal = extractLiteral(src, quotePos, quoteChar);
            const line = src.slice(0, quotePos).split('\n').length;
            // Template literals with only ${t(...)} interpolation are fine.
            if (quoteChar === '`' && /^\s*\$\{t\(/.test(literal)) continue;
            // Deliberate exceptions carry an i18n-ignore marker on the line
            // (brand wordmarks, values that must stay literal).
            const lineText = src.split('\n')[line - 1] ?? '';
            if (lineText.includes('i18n-ignore')) continue;
            if (!looksLikeUiText(literal, name)) continue;
            details.push({ file: path.relative(process.cwd(), file), line, kind: name, text: literal.slice(0, 90) });
        }
    }
}

const byFile = new Map();
for (const d of details) byFile.set(d.file, (byFile.get(d.file) ?? 0) + 1);

if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ total: details.length, files: Object.fromEntries(byFile), details }, null, 1));
} else {
    const sorted = [...byFile.entries()].sort((a, b) => b[1] - a[1]);
    for (const [file, count] of sorted) console.log(String(count).padStart(4), file);
    console.log('---');
    console.log('files:', byFile.size, 'candidates:', details.length);
    if (process.argv.includes('--details')) {
        for (const d of details) console.log(`${d.file}:${d.line} [${d.kind}] ${d.text}`);
    }
}
process.exit(details.length > 0 ? 1 : 0);

#!/usr/bin/env node
/**
 * Generates docs/reference/tools.md from src/core/tools/toolMetadata.ts.
 * Do not edit the output by hand. Regenerate via:
 *   node scripts/generate-tools-reference.mjs
 */

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'src/core/tools/toolMetadata.ts');
const OUT = resolve(ROOT, 'docs/reference/tools.md');

const GROUP_ORDER = ['read', 'vault', 'edit', 'web', 'agent', 'mcp', 'skill'];
const GROUP_HEADINGS = {
    read: 'Read',
    vault: 'Vault',
    edit: 'Edit',
    web: 'Web',
    agent: 'Agent',
    mcp: 'MCP',
    skill: 'Skill',
};

/**
 * Parse a TypeScript string literal at position `i` in `src` where
 * `src[i]` is a quote character (', ", or `). Returns { value, end }
 * where `end` is the index AFTER the closing quote.
 */
function parseStringLiteral(src, i) {
    const quote = src[i];
    if (quote !== "'" && quote !== '"' && quote !== '`') {
        throw new Error(`Not a string literal at index ${i}: ${src.slice(i, i + 20)}`);
    }
    let j = i + 1;
    let out = '';
    while (j < src.length) {
        const ch = src[j];
        if (ch === '\\') {
            const next = src[j + 1];
            if (next === 'n') out += '\n';
            else if (next === 't') out += '\t';
            else if (next === 'r') out += '\r';
            else if (next === '\\') out += '\\';
            else if (next === "'") out += "'";
            else if (next === '"') out += '"';
            else if (next === '`') out += '`';
            else out += next;
            j += 2;
            continue;
        }
        if (ch === quote) {
            return { value: out, end: j + 1 };
        }
        out += ch;
        j++;
    }
    throw new Error(`Unterminated string starting at ${i}`);
}

/**
 * Skip whitespace and line comments.
 */
function skipWs(src, i) {
    while (i < src.length) {
        const ch = src[i];
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
            i++;
            continue;
        }
        if (ch === '/' && src[i + 1] === '/') {
            while (i < src.length && src[i] !== '\n') i++;
            continue;
        }
        if (ch === '/' && src[i + 1] === '*') {
            i += 2;
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
            i += 2;
            continue;
        }
        break;
    }
    return i;
}

/**
 * Parse the entries of an object literal whose opening "{" starts at `start`.
 * Returns an array of { key, raw } where `raw` is the source text of the entry
 * value. Stops at the matching "}".
 */
function parseObjectEntries(src, start) {
    if (src[start] !== '{') throw new Error(`Expected { at ${start}`);
    let i = start + 1;
    const entries = [];

    while (i < src.length) {
        i = skipWs(src, i);
        if (src[i] === '}') return { entries, end: i + 1 };

        // Parse key: identifier or string literal
        let key;
        if (src[i] === "'" || src[i] === '"' || src[i] === '`') {
            const r = parseStringLiteral(src, i);
            key = r.value;
            i = r.end;
        } else {
            const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
            if (!m) {
                // Unknown - skip a character to avoid infinite loop
                i++;
                continue;
            }
            key = m[0];
            i += m[0].length;
        }

        i = skipWs(src, i);
        if (src[i] !== ':') {
            // Skip until comma at top level
            i = skipToNextEntry(src, i);
            continue;
        }
        i++; // consume :
        i = skipWs(src, i);

        // Parse value: track brace/bracket/paren depth, respect strings
        const valStart = i;
        let depth = 0;
        while (i < src.length) {
            const ch = src[i];
            if (ch === "'" || ch === '"' || ch === '`') {
                const r = parseStringLiteral(src, i);
                i = r.end;
                continue;
            }
            if (ch === '/' && src[i + 1] === '/') {
                while (i < src.length && src[i] !== '\n') i++;
                continue;
            }
            if (ch === '/' && src[i + 1] === '*') {
                i += 2;
                while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
                i += 2;
                continue;
            }
            if (ch === '{' || ch === '[' || ch === '(') depth++;
            else if (ch === '}' || ch === ']' || ch === ')') {
                if (depth === 0) break;
                depth--;
            } else if (ch === ',' && depth === 0) {
                break;
            }
            i++;
        }
        const raw = src.slice(valStart, i).trim();
        entries.push({ key, raw });

        // Consume trailing comma if present
        if (src[i] === ',') i++;
    }

    throw new Error('Unterminated object literal');
}

function skipToNextEntry(src, i) {
    let depth = 0;
    while (i < src.length) {
        const ch = src[i];
        if (ch === "'" || ch === '"' || ch === '`') {
            const r = parseStringLiteral(src, i);
            i = r.end;
            continue;
        }
        if (ch === '{' || ch === '[' || ch === '(') depth++;
        else if (ch === '}' || ch === ']' || ch === ')') {
            if (depth === 0) return i;
            depth--;
        } else if (ch === ',' && depth === 0) {
            return i + 1;
        }
        i++;
    }
    return i;
}

/**
 * Extract the value of a single field from the raw text of a ToolMeta object literal.
 * Returns string or undefined.
 */
function extractField(rawObject, fieldName) {
    // rawObject starts with '{' and ends with '}'
    const inner = rawObject.trim();
    if (!inner.startsWith('{')) return undefined;
    let i = 1;
    while (i < inner.length) {
        i = skipWs(inner, i);
        if (inner[i] === '}') return undefined;

        let key;
        if (inner[i] === "'" || inner[i] === '"' || inner[i] === '`') {
            const r = parseStringLiteral(inner, i);
            key = r.value;
            i = r.end;
        } else {
            const m = /^[A-Za-z_$][\w$]*/.exec(inner.slice(i));
            if (!m) { i++; continue; }
            key = m[0];
            i += m[0].length;
        }

        i = skipWs(inner, i);
        if (inner[i] !== ':') {
            i = skipToNextEntry(inner, i);
            continue;
        }
        i++;
        i = skipWs(inner, i);

        // Read value as string literal if applicable; else read until top-level comma/brace
        if (inner[i] === "'" || inner[i] === '"' || inner[i] === '`') {
            const r = parseStringLiteral(inner, i);
            if (key === fieldName) return r.value;
            i = r.end;
        } else {
            const valStart = i;
            let depth = 0;
            while (i < inner.length) {
                const ch = inner[i];
                if (ch === "'" || ch === '"' || ch === '`') {
                    const r = parseStringLiteral(inner, i);
                    i = r.end;
                    continue;
                }
                if (ch === '{' || ch === '[' || ch === '(') depth++;
                else if (ch === '}' || ch === ']' || ch === ')') {
                    if (depth === 0) break;
                    depth--;
                } else if (ch === ',' && depth === 0) {
                    break;
                }
                i++;
            }
            if (key === fieldName) return inner.slice(valStart, i).trim();
        }

        if (inner[i] === ',') i++;
    }
    return undefined;
}

/**
 * Escape pipe and newline characters for Markdown tables.
 */
function escapeCell(s) {
    if (!s) return '';
    return s
        .replace(/\|/g, '\\|')
        .replace(/\r?\n/g, ' ')
        .replace(/\s+/g, ' ')
        // Style: no em-dashes or en-dashes in docs output.
        .replace(/\s*[—–]\s*/g, '. ')
        .replace(/\s+\./g, '.')
        .trim();
}

function inlineCode(s) {
    if (!s) return '';
    return '`' + s.replace(/`/g, "'") + '`';
}

function main() {
    const src = readFileSync(SRC, 'utf8');

    // Find: export const TOOL_METADATA: Record<string, ToolMeta> = {
    const startMatch = /export\s+const\s+TOOL_METADATA[^=]*=\s*{/.exec(src);
    if (!startMatch) {
        throw new Error('Could not locate TOOL_METADATA declaration');
    }
    const objStart = startMatch.index + startMatch[0].length - 1; // position of '{'
    const { entries } = parseObjectEntries(src, objStart);

    // Build tools list
    const tools = entries.map(({ key, raw }) => {
        return {
            name: key,
            group: extractField(raw, 'group'),
            label: extractField(raw, 'label'),
            description: extractField(raw, 'description'),
            signature: extractField(raw, 'signature'),
            example: extractField(raw, 'example'),
            whenToUse: extractField(raw, 'whenToUse'),
        };
    }).filter(t => t.group && t.signature);

    // Group by group
    const grouped = {};
    for (const g of GROUP_ORDER) grouped[g] = [];
    for (const t of tools) {
        if (!grouped[t.group]) grouped[t.group] = [];
        grouped[t.group].push(t);
    }
    for (const g of Object.keys(grouped)) {
        grouped[g].sort((a, b) => a.name.localeCompare(b.name));
    }

    const total = tools.length;
    const groupCounts = Object.fromEntries(GROUP_ORDER.map(g => [g, grouped[g].length]));

    // Emit markdown
    const lines = [];
    lines.push('---');
    lines.push('title: Tools reference');
    lines.push('outline: deep');
    lines.push('---');
    lines.push('');
    lines.push('# Tools reference');
    lines.push('');
    lines.push('Generated from src/core/tools/toolMetadata.ts. Do not edit by hand. Regenerate with:');
    lines.push('');
    lines.push('```bash');
    lines.push('node scripts/generate-tools-reference.mjs');
    lines.push('```');
    lines.push('');
    lines.push(`Total: ${total} tools across seven groups.`);
    lines.push('');

    for (const g of GROUP_ORDER) {
        const items = grouped[g];
        lines.push(`## ${GROUP_HEADINGS[g]}`);
        lines.push('');
        if (items.length === 0) {
            lines.push('_No tools in this group._');
            lines.push('');
            continue;
        }
        lines.push('| Tool | Signature | Description | When to use |');
        lines.push('| --- | --- | --- | --- |');
        for (const t of items) {
            let desc = escapeCell(t.description || '');
            if (t.example) {
                desc += `<br>Example: ${inlineCode(t.example)}`;
            }
            const row = [
                inlineCode(t.name),
                inlineCode(t.signature || ''),
                desc,
                escapeCell(t.whenToUse || ''),
            ];
            lines.push(`| ${row.join(' | ')} |`);
        }
        lines.push('');
    }

    const output = lines.join('\n');
    writeFileSync(OUT, output, 'utf8');

    const size = statSync(OUT).size;
    process.stdout.write(`Wrote ${OUT}\n`);
    process.stdout.write(`Total tools: ${total}\n`);
    for (const g of GROUP_ORDER) {
        process.stdout.write(`  ${g}: ${groupCounts[g]}\n`);
    }
    process.stdout.write(`File size: ${size} bytes\n`);
}

main();

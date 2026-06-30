#!/usr/bin/env node
/**
 * benchmark-vault.mjs
 *
 * MEAS-03: generate a deterministic benchmark vault for performance
 * baselines and CI-regression checks.
 *
 * Output (default: benchmark-vault/):
 *   - 5,000 markdown notes in 50 subfolders (avoid flat-dir slowdown).
 *     Sizes vary 100-50,000 chars (long-tail Zipf-like via PRNG).
 *     Each note has frontmatter, 1-15 wikilinks, 0-5 tags.
 *   - 1,000 conversation fixtures under .vault-operator/data/conversations/
 *     Each is a minimal ConversationStore-compatible JSON snapshot.
 *   - README.md explaining how to attach the vault to the test harness
 *     and how to let Vault Operator build the 300 MB knowledge.db.
 *
 * Determinism: a seeded Mulberry32 PRNG. Same arguments produce byte-
 * identical output. Use the same seed across runs for comparable
 * baselines.
 *
 * Usage:
 *   node scripts/benchmark-vault.mjs [outDir] [--notes=N] [--conv=N] [--seed=N]
 *
 * Examples:
 *   node scripts/benchmark-vault.mjs
 *   node scripts/benchmark-vault.mjs ./bench --notes=10000 --conv=2000 --seed=42
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let outDir = 'benchmark-vault';
let numNotes = 5000;
let numConversations = 1000;
let seed = 1337;

for (const a of args) {
    if (a.startsWith('--notes=')) numNotes = parseInt(a.slice(8), 10);
    else if (a.startsWith('--conv=')) numConversations = parseInt(a.slice(7), 10);
    else if (a.startsWith('--seed=')) seed = parseInt(a.slice(7), 10);
    else if (!a.startsWith('--')) outDir = a;
}

if (!Number.isFinite(numNotes) || numNotes < 1) {
    console.error('Invalid --notes value');
    process.exit(1);
}
if (!Number.isFinite(numConversations) || numConversations < 1) {
    console.error('Invalid --conv value');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (Mulberry32)
// ---------------------------------------------------------------------------

function makeRng(s) {
    let state = s >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const rng = makeRng(seed);
const randInt = (min, max) => Math.floor(rng() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

// ---------------------------------------------------------------------------
// Fixture vocabulary
// ---------------------------------------------------------------------------

const TOPICS = [
    'architecture', 'roadmap', 'release', 'incident', 'review',
    'meeting', 'spike', 'rfc', 'experiment', 'analysis',
    'design', 'planning', 'standup', 'retrospective', 'demo',
    'onboarding', 'handover', 'audit', 'security', 'performance',
];

const TAGS = [
    'inbox', 'todo', 'project', 'idea', 'research',
    'reference', 'archive', 'draft', 'review', 'wip',
];

const WORDS = [
    'system', 'agent', 'context', 'memory', 'plugin', 'tool', 'service',
    'cache', 'index', 'query', 'graph', 'embedding', 'reranker', 'router',
    'pipeline', 'snapshot', 'restore', 'commit', 'merge', 'rebase',
    'feature', 'fix', 'audit', 'patch', 'release', 'rollback',
    'baseline', 'budget', 'latency', 'throughput', 'token', 'turn',
    'session', 'workspace', 'leaf', 'vault', 'note', 'frontmatter',
    'wikilink', 'backlink', 'metadata', 'alias', 'tag', 'folder',
];

function makeSentence(n) {
    const parts = [];
    for (let i = 0; i < n; i++) parts.push(pick(WORDS));
    return parts.join(' ') + '.';
}

function makeParagraph(targetChars) {
    let out = '';
    while (out.length < targetChars) {
        out += makeSentence(randInt(6, 15)) + ' ';
    }
    return out.trim();
}

function makeNote(idx, totalNotes) {
    const topic = pick(TOPICS);
    const titleNum = String(idx).padStart(5, '0');
    const title = `${topic} ${titleNum}`;
    const fileName = `${topic}-${titleNum}.md`;

    // Long-tail size distribution. ~70% short notes (100-500 chars),
    // ~25% medium (500-5000 chars), ~5% long (5000-50000 chars).
    const r = rng();
    let size;
    if (r < 0.70) size = randInt(100, 500);
    else if (r < 0.95) size = randInt(500, 5000);
    else size = randInt(5000, 50000);

    const tags = [];
    const numTags = randInt(0, 5);
    for (let i = 0; i < numTags; i++) tags.push(pick(TAGS));

    const linkCount = randInt(1, 15);
    const links = [];
    for (let i = 0; i < linkCount; i++) {
        const target = randInt(0, totalNotes - 1);
        const targetTopic = pick(TOPICS);
        const targetNum = String(target).padStart(5, '0');
        links.push(`[[${targetTopic}-${targetNum}|${targetTopic} ${targetNum}]]`);
    }

    const frontmatter = [
        '---',
        `title: "${title}"`,
        `created: 2026-${String(randInt(1, 6)).padStart(2, '0')}-${String(randInt(1, 28)).padStart(2, '0')}`,
        `tags: [${[...new Set(tags)].join(', ')}]`,
        '---',
        '',
    ].join('\n');

    const body = [
        `# ${title}`,
        '',
        makeParagraph(size),
        '',
        '## Related',
        '',
        links.map((l) => `- ${l}`).join('\n'),
        '',
    ].join('\n');

    const folder = `${pick(TOPICS)}-${randInt(0, 49)}`;
    return { folder, fileName, content: frontmatter + body };
}

function makeConversation(idx) {
    const topic = pick(TOPICS);
    const id = `bench-${String(idx).padStart(5, '0')}`;
    const turnCount = randInt(2, 30);
    const messages = [];
    for (let i = 0; i < turnCount; i++) {
        messages.push({
            role: i % 2 === 0 ? 'user' : 'assistant',
            text: makeParagraph(randInt(50, 400)),
            ts: `2026-${String(randInt(1, 6)).padStart(2, '0')}-${String(randInt(1, 28)).padStart(2, '0')}T${String(randInt(0, 23)).padStart(2, '0')}:${String(randInt(0, 59)).padStart(2, '0')}:00.000Z`,
        });
    }
    return {
        id,
        title: `${topic} session ${idx}`,
        mode: pick(['default', 'analyst', 'planner']),
        modelKey: 'anthropic/claude-opus-4-7',
        created: messages[0].ts,
        updated: messages[messages.length - 1].ts,
        messages,
    };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    const start = Date.now();
    console.log(`benchmark-vault: outDir=${outDir} notes=${numNotes} conv=${numConversations} seed=${seed}`);

    if (existsSync(outDir)) {
        console.log(`Warning: ${outDir} exists. Files will be overwritten where names collide.`);
    }

    // Notes
    const notesRoot = path.join(outDir, 'notes');
    const writtenFolders = new Set();
    for (let i = 0; i < numNotes; i++) {
        const { folder, fileName, content } = makeNote(i, numNotes);
        const dir = path.join(notesRoot, folder);
        if (!writtenFolders.has(dir)) {
            await mkdir(dir, { recursive: true });
            writtenFolders.add(dir);
        }
        await writeFile(path.join(dir, fileName), content, 'utf8');
        if ((i + 1) % 500 === 0) console.log(`  notes: ${i + 1}/${numNotes}`);
    }
    console.log(`  notes: ${numNotes}/${numNotes} done (${writtenFolders.size} folders)`);

    // Conversations
    const convRoot = path.join(outDir, '.vault-operator', 'data', 'conversations');
    await mkdir(convRoot, { recursive: true });
    for (let i = 0; i < numConversations; i++) {
        const conv = makeConversation(i);
        await writeFile(path.join(convRoot, `${conv.id}.json`), JSON.stringify(conv, null, 2), 'utf8');
        if ((i + 1) % 200 === 0) console.log(`  conversations: ${i + 1}/${numConversations}`);
    }
    console.log(`  conversations: ${numConversations}/${numConversations} done`);

    // README
    const readme = [
        '# Benchmark Vault (generated)',
        '',
        `Generated by \`scripts/benchmark-vault.mjs\` with seed=${seed}, notes=${numNotes}, conv=${numConversations}.`,
        '',
        'Same arguments produce byte-identical output.',
        '',
        '## Use as a test vault',
        '',
        '1. Open Obsidian, create a new vault pointing at this directory.',
        '2. Install Vault Operator into the vault.',
        '3. Trigger a full index run via Settings -> Knowledge -> Rebuild index.',
        `4. Wait until \`.vault-operator/cache/knowledge.db\` is fully built.`,
        '   On the canonical baseline vault this produces a ~300 MB DB.',
        '',
        '## Use for cold-start benchmarks (CI)',
        '',
        'The CI workflow uses this script to produce a fixture, then',
        'measures plugin.boot, sidebar.onOpen, send.firstTurn.host and',
        'send.firstTurn.provider durations via the PerformanceMarks',
        'service exported from `src/core/observability/PerformanceMarks.ts`.',
        '',
        '## Resetting',
        '',
        '```sh',
        `rm -rf ${outDir}`,
        `node scripts/benchmark-vault.mjs ${outDir} --seed=${seed}`,
        '```',
        '',
    ].join('\n');
    await writeFile(path.join(outDir, 'README.md'), readme, 'utf8');

    const dur = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`benchmark-vault: done in ${dur}s`);
}

main().catch((err) => {
    console.error('benchmark-vault failed:', err);
    process.exit(1);
});

/**
 * FIX-01-07-04 regression: the post-task review zeroed `.vault-operator/`
 * files (daily-briefing 0-byte incident #2, 2026-07-05 21:23).
 *
 * Causal chain pinned here:
 *   - showPostTaskReview read the after-state via vault.getFileByPath, which
 *     returns null for dot-paths outside the vault index -> after = ''
 *   - the review modal showed the file as fully emptied; decisions default to
 *     skipped=false, so Apply wrote finalContent='' back
 *   - the apply loop used a raw adapter.write, bypassing both the
 *     empty-overwrite guard and the atomic temp+rename from WriteFileTool
 *
 * Contract:
 *   - readCurrentContent falls back to the adapter for non-indexed paths
 *   - decisions identical to the reviewed after-state are never rewritten
 *   - empty/whitespace overwrites of a non-empty file are refused (guarded)
 *   - non-indexed writes go through the atomic temp+rename path
 */

import { describe, it, expect } from 'vitest';
import { TFile, type App } from 'obsidian';
import { readCurrentContent, applyReviewDecisions } from '../postTaskReviewIO';

interface AdapterCall {
    op: 'exists' | 'read' | 'write' | 'rename' | 'remove';
    path: string;
    to?: string;
}

const DAY = '.vault-operator/data/skill-data/daily-briefing/data/days/2026-07-05.js';
const GOOD = 'window.BRIEFINGS["2026-07-05"] = { "sections": [1,2,3] };';

function makeApp(opts: {
    adapterSeed?: Record<string, string>;
    indexedSeed?: Record<string, string>;
} = {}) {
    const calls: AdapterCall[] = [];
    const files = new Map<string, string>(Object.entries(opts.adapterSeed ?? {}));
    const indexed = new Map<string, string>(Object.entries(opts.indexedSeed ?? {}));
    const tfiles = new Map<string, TFile>();
    for (const p of indexed.keys()) {
        const f = new TFile();
        (f as unknown as { path: string }).path = p;
        tfiles.set(p, f);
    }
    const modified: Array<{ path: string; content: string }> = [];

    const adapter = {
        exists: async (p: string) => {
            calls.push({ op: 'exists', path: p });
            return files.has(p);
        },
        read: async (p: string) => {
            calls.push({ op: 'read', path: p });
            const v = files.get(p);
            if (v === undefined) throw new Error(`ENOENT: ${p}`);
            return v;
        },
        write: async (p: string, content: string) => {
            calls.push({ op: 'write', path: p });
            files.set(p, content);
        },
        rename: async (from: string, to: string) => {
            calls.push({ op: 'rename', path: from, to });
            if (!files.has(from)) throw new Error(`ENOENT rename src: ${from}`);
            files.set(to, files.get(from) as string);
            files.delete(from);
        },
        remove: async (p: string) => {
            calls.push({ op: 'remove', path: p });
            files.delete(p);
        },
    };

    const app = {
        vault: {
            adapter,
            getFileByPath: (p: string) => tfiles.get(p) ?? null,
            read: async (f: TFile) => {
                const p = (f as unknown as { path: string }).path;
                const v = indexed.get(p);
                if (v === undefined) throw new Error(`ENOENT indexed: ${p}`);
                return v;
            },
            modify: async (f: TFile, content: string) => {
                const p = (f as unknown as { path: string }).path;
                indexed.set(p, content);
                modified.push({ path: p, content });
            },
        },
        workspace: {
            getLeavesOfType: () => [],
        },
    } as unknown as App;

    return { app, calls, files, indexed, modified };
}

describe('readCurrentContent (FIX-01-07-04)', () => {
    it('reads dot-path files via the adapter when the vault index has no entry', async () => {
        const { app } = makeApp({ adapterSeed: { [DAY]: GOOD } });
        // Regression: this returned '' (treated as missing) before the fix.
        expect(await readCurrentContent(app, DAY)).toBe(GOOD);
    });

    it('reads indexed files via vault.read', async () => {
        const { app, calls } = makeApp({ indexedSeed: { 'Notes/a.md': 'hello' } });
        expect(await readCurrentContent(app, 'Notes/a.md')).toBe('hello');
        // No adapter round-trip needed for indexed files.
        expect(calls).toEqual([]);
    });

    it('returns null for a genuinely missing file', async () => {
        const { app } = makeApp();
        expect(await readCurrentContent(app, 'Notes/missing.md')).toBeNull();
    });
});

describe('applyReviewDecisions (FIX-01-07-04)', () => {
    it('never rewrites a decision identical to the reviewed after-state', async () => {
        const { app, calls, files } = makeApp({ adapterSeed: { [DAY]: GOOD } });

        const outcome = await applyReviewDecisions(
            app,
            [{ path: DAY, finalContent: GOOD, skipped: false }],
            new Map([[DAY, GOOD]]),
        );

        expect(files.get(DAY)).toBe(GOOD);
        expect(calls.filter((c) => c.op === 'write' || c.op === 'rename')).toEqual([]);
        expect(outcome.written).toEqual([]);
        expect(outcome.skippedUnchanged).toEqual([DAY]);
    });

    it('incident replay: a lost after-state can no longer zero the file', async () => {
        // The 2026-07-05 21:23 shape: reviewedAfter carried '' (misread), the
        // decision came back with finalContent '' -> before the fix this was
        // adapter.write(path, '') and the day-file went to 0 bytes.
        const { app, files } = makeApp({ adapterSeed: { [DAY]: GOOD } });

        const outcome = await applyReviewDecisions(
            app,
            [{ path: DAY, finalContent: '', skipped: false }],
            new Map([[DAY, '']]),
        );

        expect(files.get(DAY)).toBe(GOOD);
        expect(outcome.written).toEqual([]);
    });

    it('guards an explicit empty overwrite of a non-empty file', async () => {
        const { app, files } = makeApp({ adapterSeed: { [DAY]: GOOD } });

        // reviewedAfter differs from finalContent, so this is a "real" user
        // decision -- the guard still refuses to destroy non-empty content.
        const outcome = await applyReviewDecisions(
            app,
            [{ path: DAY, finalContent: '   \n', skipped: false }],
            new Map([[DAY, GOOD]]),
        );

        expect(files.get(DAY)).toBe(GOOD);
        expect(outcome.guarded).toEqual([DAY]);
        expect(outcome.written).toEqual([]);
    });

    it('writes a changed non-indexed file atomically (temp sibling + rename)', async () => {
        const { app, calls, files } = makeApp({ adapterSeed: { [DAY]: GOOD } });
        const EDITED = GOOD.replace('[1,2,3]', '[1,2,3,4]');

        const outcome = await applyReviewDecisions(
            app,
            [{ path: DAY, finalContent: EDITED, skipped: false }],
            new Map([[DAY, GOOD]]),
        );

        expect(files.get(DAY)).toBe(EDITED);
        expect(outcome.written).toEqual([DAY]);
        // Raw truncate-write on the live target is exactly the old bug.
        expect(calls.filter((c) => c.op === 'write' && c.path === DAY)).toEqual([]);
        expect(calls.some((c) => c.op === 'rename' && c.to === DAY)).toBe(true);
    });

    it('writes a changed indexed file via vault.modify', async () => {
        const { app, modified } = makeApp({ indexedSeed: { 'Notes/a.md': 'v1' } });

        const outcome = await applyReviewDecisions(
            app,
            [{ path: 'Notes/a.md', finalContent: 'v2', skipped: false }],
            new Map([['Notes/a.md', 'v1']]),
        );

        expect(modified).toEqual([{ path: 'Notes/a.md', content: 'v2' }]);
        expect(outcome.written).toEqual(['Notes/a.md']);
    });

    it('leaves skipped decisions untouched', async () => {
        const { app, calls, files } = makeApp({ adapterSeed: { [DAY]: GOOD } });

        const outcome = await applyReviewDecisions(
            app,
            [{ path: DAY, finalContent: 'something else', skipped: true }],
            new Map([[DAY, GOOD]]),
        );

        expect(files.get(DAY)).toBe(GOOD);
        expect(calls.filter((c) => c.op === 'write' || c.op === 'rename')).toEqual([]);
        expect(outcome.written).toEqual([]);
    });
});

describe('adapter-sink path revalidation (AUDIT 2026-07-07 PTR-1)', () => {
    // The adapter sink is the security-relevant boundary (AUDIT-034 M-1
    // convention): every caller-supplied path gets revalidated here so a
    // future caller cannot hand a traversal-laden string to adapter IO.
    it('applyReviewDecisions refuses traversal paths and reports them as failed', async () => {
        const { app, calls } = makeApp();
        const outcome = await applyReviewDecisions(
            app,
            [{ path: '../outside/secret.md', finalContent: 'x', skipped: false }],
            new Map(),
        );
        expect(outcome.failed).toEqual(['../outside/secret.md']);
        expect(outcome.written).toEqual([]);
        expect(calls.filter((c) => c.op === 'write' || c.op === 'rename' || c.op === 'remove')).toEqual([]);
    });

    it('readCurrentContent refuses traversal paths without touching the adapter', async () => {
        const { app, calls } = makeApp({ adapterSeed: { 'x.md': 'v' } });
        expect(await readCurrentContent(app, '..\\..\\evil.md')).toBeNull();
        expect(calls).toEqual([]);
    });
});

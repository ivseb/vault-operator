/**
 * FEAT-44-02b / FIX-44-13b: vault_health_check announces its repair scope
 * BEFORE mutating anything.
 *
 * The three mass-repair actions (fix_backlinks, cleanup, fix_categories)
 * write frontmatter across many notes inside one tool call. The approval
 * gate needs the planned target list up front. `planRepairTargets` computes
 * it WITHOUT writing, through the same target-selection code the repair
 * itself uses -- pinned here by parity tests: the plan's path set equals the
 * set of files the repair actually touches.
 */

import { describe, it, expect } from 'vitest';
import initSqlJs from 'sql.js';
import { TFile } from 'obsidian';
import { VaultHealthService } from '../VaultHealthService';
import type { KnowledgeDB } from '../KnowledgeDB';
import type { App } from 'obsidian';

type SqlJsDb = {
    run(sql: string, params?: unknown[]): unknown;
    exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: unknown[][] }>;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS edges (id INTEGER PRIMARY KEY AUTOINCREMENT, source_path TEXT NOT NULL, target_path TEXT NOT NULL, link_type TEXT NOT NULL, property_name TEXT, confidence REAL NOT NULL DEFAULT 1.0, UNIQUE(source_path, target_path, link_type, property_name));
CREATE TABLE IF NOT EXISTS dismissed_health_findings (check_type TEXT NOT NULL, path TEXT NOT NULL, dismissed_at TEXT NOT NULL, PRIMARY KEY (check_type, path));
`;

interface FakeNote {
    path: string;
    frontmatter?: Record<string, unknown>;
    body?: string;
}

/**
 * Vault shim: markdown notes with frontmatter, recording every mutation so
 * the parity assertions can compare "what the plan said" with "what the
 * repair did".
 */
function makeWorld(notes: FakeNote[]) {
    const byPath = new Map<string, { file: TFile; note: FakeNote }>();
    for (const note of notes) {
        const parts = note.path.split('/');
        const name = parts[parts.length - 1].replace(/\.md$/, '');
        const file = Object.assign(new TFile(), {
            path: note.path,
            extension: 'md',
            basename: name,
            parent: { path: parts.slice(0, -1).join('/') },
        });
        byPath.set(note.path, { file, note });
    }
    const touched = new Set<string>();
    const created = new Set<string>();

    const app = {
        vault: {
            getMarkdownFiles: () => [...byPath.values()].map((e) => e.file),
            getAbstractFileByPath: (p: string) => byPath.get(p)?.file ?? (created.has(p) ? new TFile() : null),
            read: (f: TFile) => Promise.resolve(byPath.get(f.path)?.note.body ?? ''),
            modify: (f: TFile, _c: string) => { touched.add(f.path); return Promise.resolve(); },
            create: (p: string, _c: string) => { created.add(p); touched.add(p); return Promise.resolve(new TFile()); },
            createFolder: () => Promise.resolve(),
        },
        metadataCache: {
            getFileCache: (f: TFile) => {
                const note = byPath.get(f.path)?.note;
                return note?.frontmatter ? { frontmatter: note.frontmatter } : null;
            },
            getFirstLinkpathDest: (linkpath: string) => {
                const direct = byPath.get(linkpath.endsWith('.md') ? linkpath : `${linkpath}.md`);
                if (direct) return direct.file;
                for (const { file } of byPath.values()) {
                    if (file.basename === linkpath) return file;
                }
                return null;
            },
        },
        fileManager: {
            processFrontMatter: (f: TFile, fn: (fm: Record<string, unknown>) => void) => {
                const note = byPath.get(f.path)?.note;
                if (!note) return Promise.reject(new Error(`no note: ${f.path}`));
                touched.add(f.path);
                note.frontmatter = note.frontmatter ?? {};
                fn(note.frontmatter);
                return Promise.resolve();
            },
        },
    };
    return { app: app as unknown as App, touched, created };
}

async function makeService(app: App): Promise<{ svc: VaultHealthService; db: SqlJsDb }> {
    const SQL = await initSqlJs();
    const db = new SQL.Database() as unknown as SqlJsDb;
    db.run(SCHEMA);
    const kdb = { isOpen: () => true, getDB: () => db as never, markDirty: () => { /* no-op */ } } as unknown as KnowledgeDB;
    return { svc: new VaultHealthService(app, kdb), db };
}

function edge(db: SqlJsDb, source: string, target: string, prop: string) {
    db.run(
        `INSERT OR IGNORE INTO edges (source_path, target_path, link_type, property_name) VALUES (?, ?, 'frontmatter', ?)`,
        [source, target, prop],
    );
}

describe('planRepairTargets: fix_backlinks', () => {
    async function world() {
        const w = makeWorld([
            { path: 'Notes/S1.md', frontmatter: { Notizen: ['[[P]]'] } },
            { path: 'Notes/P.md', frontmatter: { Kategorie: 'Person' }, body: 'p' },
            { path: 'Notes/T.md', frontmatter: { Kategorie: 'Thema' }, body: 't' },
            { path: 'Notes/S2.md', frontmatter: { Notizen: ['[[T]]'] } },
        ]);
        const { svc, db } = await makeService(w.app);
        // One-sided Notizen edges: P and T never link back.
        edge(db, 'Notes/S1.md', 'Notes/P.md', 'Notizen');
        edge(db, 'Notes/S2.md', 'Notes/T.md', 'Notizen');
        return { ...w, svc, db };
    }

    it('lists the frontmatter target AND the derived .base path for hub notes', async () => {
        const { svc } = await world();
        const plan = svc.planRepairTargets('fix_backlinks', 'Notizen', 'Kategorie');
        expect(plan.sort()).toEqual([
            'Notes/P.md',
            'Notes/T-Backlinks.base',
            'Notes/T.md',
        ]);
    });

    it('parity: the repair touches exactly the planned paths', async () => {
        const { svc, touched } = await world();
        const plan = svc.planRepairTargets('fix_backlinks', 'Notizen', 'Kategorie');
        await svc.fixMissingBacklinks('Notizen', 'Kategorie');
        expect([...touched].sort()).toEqual(plan.sort());
    });

    it('the plan writes NOTHING', async () => {
        const { svc, touched } = await world();
        svc.planRepairTargets('fix_backlinks', 'Notizen', 'Kategorie');
        expect(touched.size).toBe(0);
    });
});

describe('planRepairTargets: cleanup', () => {
    async function world() {
        const w = makeWorld([
            // Broken link (no such target) -> would be cleaned.
            { path: 'Notes/C.md', frontmatter: { Notizen: ['[[Missing]]'] } },
            // Valid link -> untouched.
            { path: 'Notes/OK.md', frontmatter: { Notizen: ['[[P]]'] } },
            { path: 'Notes/P.md', frontmatter: { Kategorie: 'Person' } },
            // Thema with a populated Notizen -> property gets cleared.
            { path: 'Notes/T.md', frontmatter: { Kategorie: 'Thema', Notizen: ['[[P]]'] } },
        ]);
        const { svc } = await makeService(w.app);
        return { ...w, svc };
    }

    it('lists exactly the notes the cleanup would rewrite', async () => {
        const { svc } = await world();
        const plan = svc.planRepairTargets('cleanup', 'Notizen', 'Kategorie');
        expect(plan.sort()).toEqual(['Notes/C.md', 'Notes/T.md']);
    });

    it('parity: the cleanup touches exactly the planned paths', async () => {
        const { svc, touched } = await world();
        const plan = svc.planRepairTargets('cleanup', 'Notizen', 'Kategorie');
        await svc.cleanupInvalidBacklinks('Notizen', 'Kategorie');
        expect([...touched].sort()).toEqual(plan.sort());
    });
});

describe('FIX-44-56: targetFilter pins the repair to the approved plan', () => {
    // The parity tests above hold for IDENTICAL vault state. While the
    // approval card is open the state can drift (user edits, metadata cache
    // refresh, a concurrent task); these tests simulate that drift and pin
    // that the repair still writes only what the card showed.

    it('fix_backlinks skips targets that appeared after the plan was approved', async () => {
        const w = makeWorld([
            { path: 'Notes/S1.md', frontmatter: { Notizen: ['[[P]]'] } },
            { path: 'Notes/P.md', frontmatter: { Kategorie: 'Person' }, body: 'p' },
            { path: 'Notes/T.md', frontmatter: { Kategorie: 'Thema' }, body: 't' },
            { path: 'Notes/S2.md', frontmatter: { Notizen: ['[[T]]'] } },
        ]);
        const { svc, db } = await makeService(w.app);
        edge(db, 'Notes/S1.md', 'Notes/P.md', 'Notizen');

        const plan = svc.planRepairTargets('fix_backlinks', 'Notizen', 'Kategorie');
        expect(plan).toEqual(['Notes/P.md']);

        // Drift while the card is open: a new one-sided edge appears.
        edge(db, 'Notes/S2.md', 'Notes/T.md', 'Notizen');

        await svc.fixMissingBacklinks('Notizen', 'Kategorie', new Set(plan));
        expect([...w.touched].sort()).toEqual(['Notes/P.md']);
    });

    it('fix_backlinks skips a target whose branch drifted to an unplanned Base file', async () => {
        const sources: FakeNote[] = Array.from({ length: 12 }, (_, i) => ({
            path: `Notes/S${i}.md`, frontmatter: { Notizen: ['[[P]]'] },
        }));
        const w = makeWorld([
            ...sources,
            { path: 'Notes/P.md', frontmatter: { Kategorie: 'Person' }, body: 'p' },
        ]);
        const { svc, db } = await makeService(w.app);
        edge(db, 'Notes/S0.md', 'Notes/P.md', 'Notizen');

        // Planned: ONE source -> frontmatter branch, no .base in the plan.
        const plan = svc.planRepairTargets('fix_backlinks', 'Notizen', 'Kategorie');
        expect(plan).toEqual(['Notes/P.md']);

        // Drift: eleven more sources appear, the repair would now create a
        // sibling Base the user never saw on the card. It must not.
        for (let i = 1; i < 12; i++) edge(db, `Notes/S${i}.md`, 'Notes/P.md', 'Notizen');

        await svc.fixMissingBacklinks('Notizen', 'Kategorie', new Set(plan));
        expect(w.created.size).toBe(0);
        expect(w.touched.size).toBe(0);
    });

    it('cleanup skips notes that turned invalid after the plan was approved', async () => {
        const w = makeWorld([
            { path: 'Notes/C.md', frontmatter: { Notizen: ['[[Missing]]'] } },
            { path: 'Notes/OK.md', frontmatter: { Notizen: ['[[P]]'] } },
            { path: 'Notes/P.md', frontmatter: { Kategorie: 'Person' } },
        ]);
        const { svc } = await makeService(w.app);

        const plan = svc.planRepairTargets('cleanup', 'Notizen', 'Kategorie');
        expect(plan).toEqual(['Notes/C.md']);

        // Drift: OK.md gains a broken link while the card is open.
        const okFile = w.app.vault.getAbstractFileByPath('Notes/OK.md');
        const okCache = w.app.metadataCache.getFileCache(okFile as never);
        (okCache!.frontmatter as Record<string, unknown>).Notizen = ['[[P]]', '[[AlsoMissing]]'];

        await svc.cleanupInvalidBacklinks('Notizen', 'Kategorie', new Set(plan));
        expect([...w.touched].sort()).toEqual(['Notes/C.md']);
    });

    it('fix_categories skips source notes that drifted into the selection', async () => {
        const w = makeWorld([
            { path: 'Notes/Src.md', frontmatter: { Konzepte: ['[[Th]]'] } },
            { path: 'Notes/Th.md', frontmatter: { Kategorie: 'Thema' } },
            { path: 'Notes/Src2.md', frontmatter: { Themen: ['[[Th]]'] } },
        ]);
        const { svc, db } = await makeService(w.app);
        edge(db, 'Notes/Src.md', 'Notes/Th.md', 'Konzepte');
        edge(db, 'Notes/Src2.md', 'Notes/Th.md', 'Themen');

        const plan = svc.planRepairTargets('fix_categories', 'Notizen', 'Kategorie');
        expect(plan).toEqual(['Notes/Src.md']);

        // Drift: Src2 misfiles the Thema while the card is open.
        edge(db, 'Notes/Src2.md', 'Notes/Th.md', 'Konzepte');
        const srcFile = w.app.vault.getAbstractFileByPath('Notes/Src2.md');
        const srcCache = w.app.metadataCache.getFileCache(srcFile as never);
        (srcCache!.frontmatter as Record<string, unknown>).Konzepte = ['[[Th]]'];

        await svc.fixCategoryMismatches(new Set(plan));
        expect([...w.touched].sort()).toEqual(['Notes/Src.md']);
    });

    it('without a filter the repair keeps its full selection (modal callers unchanged)', async () => {
        const w = makeWorld([
            { path: 'Notes/C.md', frontmatter: { Notizen: ['[[Missing]]'] } },
            { path: 'Notes/C2.md', frontmatter: { Notizen: ['[[AlsoMissing]]'] } },
        ]);
        const { svc } = await makeService(w.app);
        await svc.cleanupInvalidBacklinks('Notizen', 'Kategorie');
        expect([...w.touched].sort()).toEqual(['Notes/C.md', 'Notes/C2.md']);
    });
});

describe('planRepairTargets: fix_categories', () => {
    async function world() {
        const w = makeWorld([
            // Src lists a Thema under Konzepte -> value moves to Themen.
            { path: 'Notes/Src.md', frontmatter: { Konzepte: ['[[Th]]'] } },
            { path: 'Notes/Th.md', frontmatter: { Kategorie: 'Thema' } },
            // Correctly filed -> untouched.
            { path: 'Notes/Src2.md', frontmatter: { Themen: ['[[Th]]'] } },
        ]);
        const { svc, db } = await makeService(w.app);
        edge(db, 'Notes/Src.md', 'Notes/Th.md', 'Konzepte');
        edge(db, 'Notes/Src2.md', 'Notes/Th.md', 'Themen');
        return { ...w, svc };
    }

    it('lists exactly the source notes whose properties move', async () => {
        const { svc } = await world();
        const plan = svc.planRepairTargets('fix_categories', 'Notizen', 'Kategorie');
        expect(plan).toEqual(['Notes/Src.md']);
    });

    it('parity: the repair touches exactly the planned paths', async () => {
        const { svc, touched } = await world();
        const plan = svc.planRepairTargets('fix_categories', 'Notizen', 'Kategorie');
        await svc.fixCategoryMismatches();
        expect([...touched].sort()).toEqual(plan.sort());
    });
});

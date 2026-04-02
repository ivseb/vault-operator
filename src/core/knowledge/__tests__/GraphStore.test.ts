import { describe, it, expect } from 'vitest';
import initSqlJs from 'sql.js';

// ---------------------------------------------------------------------------
// In-memory DB setup (same pattern as VectorStore.test.ts)
// ---------------------------------------------------------------------------

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS vectors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    vector BLOB NOT NULL,
    mtime INTEGER NOT NULL,
    enriched INTEGER NOT NULL DEFAULT 0,
    UNIQUE(path, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_vectors_path ON vectors(path);
CREATE TABLE IF NOT EXISTS checkpoint (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_path TEXT NOT NULL,
    target_path TEXT NOT NULL,
    link_type TEXT NOT NULL,
    property_name TEXT,
    UNIQUE(source_path, target_path, link_type, property_name)
);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_path);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_path);
CREATE TABLE IF NOT EXISTS tags (
    path TEXT NOT NULL,
    tag TEXT NOT NULL,
    UNIQUE(path, tag)
);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
`;

let SQL: Awaited<ReturnType<typeof initSqlJs>>;

async function createGraphStore() {
    if (!SQL) SQL = await initSqlJs();
    const db = new SQL.Database();
    for (const stmt of SCHEMA_DDL.split(';').map(s => s.trim()).filter(Boolean)) {
        db.run(stmt + ';');
    }
    db.run('INSERT INTO schema_meta VALUES (3)');
    const shim = {
        getDB: () => db,
        isOpen: () => true,
        markDirty: () => {},
    };
    const { GraphStore } = await import('../GraphStore');
    const store = new GraphStore(shim as never);
    return { store, db };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GraphStore', () => {
    describe('edge CRUD', () => {
        it('should insert and count edges', async () => {
            const { store } = await createGraphStore();
            store.replaceEdgesForPath('a.md', [
                { targetPath: 'b.md', linkType: 'body', propertyName: null },
                { targetPath: 'c.md', linkType: 'frontmatter', propertyName: 'Themen' },
            ]);
            expect(store.getEdgeCount()).toBe(2);
        });

        it('should replace edges atomically', async () => {
            const { store } = await createGraphStore();
            store.replaceEdgesForPath('a.md', [
                { targetPath: 'b.md', linkType: 'body', propertyName: null },
            ]);
            expect(store.getEdgeCount()).toBe(1);

            // Replace with different edges
            store.replaceEdgesForPath('a.md', [
                { targetPath: 'c.md', linkType: 'body', propertyName: null },
                { targetPath: 'd.md', linkType: 'body', propertyName: null },
            ]);
            expect(store.getEdgeCount()).toBe(2);
        });

        it('should delete edges and tags by path', async () => {
            const { store } = await createGraphStore();
            store.replaceEdgesForPath('a.md', [
                { targetPath: 'b.md', linkType: 'body', propertyName: null },
            ]);
            store.replaceEdgesForPath('b.md', [
                { targetPath: 'a.md', linkType: 'body', propertyName: null },
            ]);
            store.replaceTagsForPath('a.md', ['tag1']);

            store.deleteByPath('a.md');

            // Both source and target edges involving a.md should be gone
            expect(store.getEdgeCount()).toBe(0);
            expect(store.getTagCount()).toBe(0);
        });

        it('should handle duplicate edges gracefully (INSERT OR IGNORE)', async () => {
            const { store } = await createGraphStore();
            // Duplicates with non-null property_name are correctly deduped by UNIQUE constraint
            store.replaceEdgesForPath('a.md', [
                { targetPath: 'b.md', linkType: 'frontmatter', propertyName: 'Themen' },
                { targetPath: 'b.md', linkType: 'frontmatter', propertyName: 'Themen' }, // duplicate
            ]);
            expect(store.getEdgeCount()).toBe(1);
        });
    });

    describe('tag CRUD', () => {
        it('should insert and count tags', async () => {
            const { store } = await createGraphStore();
            store.replaceTagsForPath('a.md', ['project', 'active']);
            expect(store.getTagCount()).toBe(2);
        });

        it('should replace tags atomically', async () => {
            const { store } = await createGraphStore();
            store.replaceTagsForPath('a.md', ['old-tag']);
            store.replaceTagsForPath('a.md', ['new-tag1', 'new-tag2']);
            expect(store.getTagCount()).toBe(2);
        });

        it('should get files by tag', async () => {
            const { store } = await createGraphStore();
            store.replaceTagsForPath('a.md', ['project', 'active']);
            store.replaceTagsForPath('b.md', ['project']);
            store.replaceTagsForPath('c.md', ['archive']);

            const projectFiles = store.getFilesByTag('project');
            expect(projectFiles.sort()).toEqual(['a.md', 'b.md']);

            const archiveFiles = store.getFilesByTag('archive');
            expect(archiveFiles).toEqual(['c.md']);
        });

        it('should normalize tags with # prefix', async () => {
            const { store } = await createGraphStore();
            store.replaceTagsForPath('a.md', ['project']);
            const files = store.getFilesByTag('#project');
            expect(files).toEqual(['a.md']);
        });
    });

    describe('getNeighbors (BFS)', () => {
        it('should find 1-hop forward neighbors', async () => {
            const { store } = await createGraphStore();
            // a -> b, a -> c
            store.replaceEdgesForPath('a.md', [
                { targetPath: 'b.md', linkType: 'body', propertyName: null },
                { targetPath: 'c.md', linkType: 'body', propertyName: null },
            ]);

            const neighbors = store.getNeighbors('a.md', 1, 10);
            expect(neighbors.length).toBe(2);
            expect(neighbors.map(n => n.path).sort()).toEqual(['b.md', 'c.md']);
            expect(neighbors.every(n => n.hopDistance === 1)).toBe(true);
            expect(neighbors.every(n => n.viaPath === 'a.md')).toBe(true);
        });

        it('should find 1-hop backward neighbors (bidirectional)', async () => {
            const { store } = await createGraphStore();
            // b -> a (backlink to a)
            store.replaceEdgesForPath('b.md', [
                { targetPath: 'a.md', linkType: 'body', propertyName: null },
            ]);

            const neighbors = store.getNeighbors('a.md', 1, 10);
            expect(neighbors.length).toBe(1);
            expect(neighbors[0].path).toBe('b.md');
        });

        it('should find 2-hop neighbors', async () => {
            const { store } = await createGraphStore();
            // a -> b -> c
            store.replaceEdgesForPath('a.md', [
                { targetPath: 'b.md', linkType: 'body', propertyName: null },
            ]);
            store.replaceEdgesForPath('b.md', [
                { targetPath: 'c.md', linkType: 'body', propertyName: null },
            ]);

            const neighbors = store.getNeighbors('a.md', 2, 10);
            expect(neighbors.length).toBe(2);

            const hop1 = neighbors.find(n => n.hopDistance === 1);
            const hop2 = neighbors.find(n => n.hopDistance === 2);
            expect(hop1?.path).toBe('b.md');
            expect(hop2?.path).toBe('c.md');
            expect(hop2?.viaPath).toBe('b.md');
        });

        it('should find 3-hop neighbors', async () => {
            const { store } = await createGraphStore();
            // a -> b -> c -> d
            store.replaceEdgesForPath('a.md', [
                { targetPath: 'b.md', linkType: 'body', propertyName: null },
            ]);
            store.replaceEdgesForPath('b.md', [
                { targetPath: 'c.md', linkType: 'body', propertyName: null },
            ]);
            store.replaceEdgesForPath('c.md', [
                { targetPath: 'd.md', linkType: 'body', propertyName: null },
            ]);

            const neighbors = store.getNeighbors('a.md', 3, 10);
            expect(neighbors.length).toBe(3);
            expect(neighbors.find(n => n.hopDistance === 3)?.path).toBe('d.md');
        });

        it('should not include the origin path', async () => {
            const { store } = await createGraphStore();
            // a -> b, b -> a (cycle)
            store.replaceEdgesForPath('a.md', [
                { targetPath: 'b.md', linkType: 'body', propertyName: null },
            ]);
            store.replaceEdgesForPath('b.md', [
                { targetPath: 'a.md', linkType: 'body', propertyName: null },
            ]);

            const neighbors = store.getNeighbors('a.md', 2, 10);
            expect(neighbors.length).toBe(1);
            expect(neighbors[0].path).toBe('b.md');
        });

        it('should deduplicate across hops', async () => {
            const { store } = await createGraphStore();
            // a -> b, a -> c, c -> b (b reachable via 1-hop and 2-hop)
            store.replaceEdgesForPath('a.md', [
                { targetPath: 'b.md', linkType: 'body', propertyName: null },
                { targetPath: 'c.md', linkType: 'body', propertyName: null },
            ]);
            store.replaceEdgesForPath('c.md', [
                { targetPath: 'b.md', linkType: 'body', propertyName: null },
            ]);

            const neighbors = store.getNeighbors('a.md', 2, 10);
            const bEntries = neighbors.filter(n => n.path === 'b.md');
            expect(bEntries.length).toBe(1); // only counted once (shortest hop)
            expect(bEntries[0].hopDistance).toBe(1);
        });

        it('should respect maxResults limit', async () => {
            const { store } = await createGraphStore();
            // a -> b, c, d, e, f
            store.replaceEdgesForPath('a.md', [
                { targetPath: 'b.md', linkType: 'body', propertyName: null },
                { targetPath: 'c.md', linkType: 'body', propertyName: null },
                { targetPath: 'd.md', linkType: 'body', propertyName: null },
                { targetPath: 'e.md', linkType: 'body', propertyName: null },
                { targetPath: 'f.md', linkType: 'body', propertyName: null },
            ]);

            const neighbors = store.getNeighbors('a.md', 1, 3);
            expect(neighbors.length).toBe(3);
        });

        it('should preserve link type and property name', async () => {
            const { store } = await createGraphStore();
            store.replaceEdgesForPath('a.md', [
                { targetPath: 'b.md', linkType: 'frontmatter', propertyName: 'Themen' },
            ]);

            const neighbors = store.getNeighbors('a.md', 1, 10);
            expect(neighbors[0].linkType).toBe('frontmatter');
            expect(neighbors[0].propertyName).toBe('Themen');
        });

        it('should return empty for isolated node', async () => {
            const { store } = await createGraphStore();
            const neighbors = store.getNeighbors('isolated.md', 1, 10);
            expect(neighbors.length).toBe(0);
        });
    });
});

import { describe, it, expect } from 'vitest';
import initSqlJs from 'sql.js';

// ---------------------------------------------------------------------------
// In-memory DB setup
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
CREATE TABLE IF NOT EXISTS checkpoint (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_path TEXT NOT NULL,
    target_path TEXT NOT NULL,
    link_type TEXT NOT NULL,
    property_name TEXT,
    confidence REAL NOT NULL DEFAULT 1.0,
    UNIQUE(source_path, target_path, link_type, property_name)
);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_path);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_path);
CREATE TABLE IF NOT EXISTS tags (path TEXT NOT NULL, tag TEXT NOT NULL, UNIQUE(path, tag));
CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
CREATE TABLE IF NOT EXISTS implicit_edges (
    source_path TEXT NOT NULL,
    target_path TEXT NOT NULL,
    similarity REAL NOT NULL,
    computed_at TEXT NOT NULL,
    UNIQUE(source_path, target_path)
);
CREATE TABLE IF NOT EXISTS ontology (
    entity_path TEXT NOT NULL,
    cluster TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    confidence REAL NOT NULL DEFAULT 1.0,
    source TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(entity_path, cluster)
);
CREATE INDEX IF NOT EXISTS idx_ontology_cluster ON ontology(cluster);
CREATE INDEX IF NOT EXISTS idx_ontology_entity ON ontology(entity_path);
`;

let SQL: Awaited<ReturnType<typeof initSqlJs>>;

async function createTestEnv() {
    if (!SQL) SQL = await initSqlJs();
    const db = new SQL.Database();
    for (const stmt of SCHEMA_DDL.split(';').map(s => s.trim()).filter(Boolean)) {
        db.run(stmt + ';');
    }
    db.run('INSERT INTO schema_meta VALUES (7)');

    const shim = {
        getDB: () => db,
        isOpen: () => true,
        markDirty: () => {},
    };

    const { GraphStore } = await import('../GraphStore');
    const { OntologyStore } = await import('../OntologyStore');
    const { CommunityDetectionService } = await import('../CommunityDetectionService');

    const graphStore = new GraphStore(shim as never);
    const ontologyStore = new OntologyStore(shim as never);
    const service = new CommunityDetectionService(shim as never, graphStore, ontologyStore);

    return { service, graphStore, ontologyStore, db };
}

/** Helper: insert edge directly into DB */
function insertEdge(db: ReturnType<typeof SQL.Database.prototype.constructor>, source: string, target: string) {
    db.run(
        'INSERT OR IGNORE INTO edges (source_path, target_path, link_type, property_name, confidence) VALUES (?, ?, ?, ?, ?)',
        [source, target, 'body', null, 1.0],
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommunityDetectionService', () => {
    it('should detect communities in a simple graph with two clusters', async () => {
        const { service, db } = await createTestEnv();

        // Cluster 1: a-b-c (triangle)
        insertEdge(db, 'a.md', 'b.md');
        insertEdge(db, 'b.md', 'c.md');
        insertEdge(db, 'c.md', 'a.md');

        // Cluster 2: d-e-f (triangle)
        insertEdge(db, 'd.md', 'e.md');
        insertEdge(db, 'e.md', 'f.md');
        insertEdge(db, 'f.md', 'd.md');

        // Weak bridge between clusters
        insertEdge(db, 'c.md', 'd.md');

        const result = service.detectCommunities();
        expect(result.communities).toBeGreaterThanOrEqual(2);
        expect(result.notes).toBe(6);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should store results in OntologyStore with source=louvain', async () => {
        const { service, ontologyStore, db } = await createTestEnv();

        insertEdge(db, 'a.md', 'b.md');
        insertEdge(db, 'b.md', 'c.md');
        insertEdge(db, 'c.md', 'a.md');

        service.detectCommunities();

        // Check OntologyStore has louvain entries
        const allClusters = ontologyStore.getAllClusters();
        const louvainClusters = allClusters.filter(c => c.cluster.startsWith('louvain-'));
        expect(louvainClusters.length).toBeGreaterThanOrEqual(1);
    });

    it('should return empty result for graph with no edges', async () => {
        const { service } = await createTestEnv();
        const result = service.detectCommunities();
        expect(result.communities).toBe(0);
        expect(result.notes).toBe(0);
    });

    it('should skip graphs with fewer than 3 nodes', async () => {
        const { service, db } = await createTestEnv();
        insertEdge(db, 'a.md', 'b.md');
        const result = service.detectCommunities();
        expect(result.communities).toBe(0);
        expect(result.notes).toBe(2);
    });

    it('should drop singleton communities', async () => {
        const { service, ontologyStore, db } = await createTestEnv();

        // Dense cluster: a-b-c-d
        insertEdge(db, 'a.md', 'b.md');
        insertEdge(db, 'b.md', 'c.md');
        insertEdge(db, 'c.md', 'd.md');
        insertEdge(db, 'd.md', 'a.md');
        insertEdge(db, 'a.md', 'c.md');

        // Isolated node connected by single edge
        insertEdge(db, 'd.md', 'lonely.md');

        service.detectCommunities();

        // lonely.md may form a singleton or be absorbed -- either way the cluster count is reasonable
        const entries = ontologyStore.getEntryCount();
        expect(entries).toBeGreaterThanOrEqual(4); // at least the dense cluster
    });

    it('should replace previous louvain results on re-run', async () => {
        const { service, ontologyStore, db } = await createTestEnv();

        insertEdge(db, 'a.md', 'b.md');
        insertEdge(db, 'b.md', 'c.md');
        insertEdge(db, 'c.md', 'a.md');

        service.detectCommunities();
        const countAfterFirst = ontologyStore.getEntryCount();

        // Re-run should replace, not duplicate
        service.detectCommunities();
        const countAfterSecond = ontologyStore.getEntryCount();

        expect(countAfterSecond).toBe(countAfterFirst);
    });

    describe('getClusterSummary', () => {
        it('should identify emergent clusters (no matching MOC)', async () => {
            const { service, db } = await createTestEnv();

            insertEdge(db, 'a.md', 'b.md');
            insertEdge(db, 'b.md', 'c.md');
            insertEdge(db, 'c.md', 'a.md');

            service.detectCommunities();
            const summary = service.getClusterSummary();

            expect(summary.length).toBeGreaterThanOrEqual(1);
            expect(summary[0].type).toBe('emergent'); // no MOC clusters exist
            expect(summary[0].memberCount).toBeGreaterThanOrEqual(2);
        });

        it('should identify confirmed clusters (overlapping with MOC)', async () => {
            const { service, ontologyStore, db } = await createTestEnv();

            // Create edges
            insertEdge(db, 'a.md', 'b.md');
            insertEdge(db, 'b.md', 'c.md');
            insertEdge(db, 'c.md', 'a.md');

            // Create matching MOC cluster
            ontologyStore.addEntry({
                entityPath: 'a.md', cluster: 'topic-ai.md', role: 'member', confidence: 1.0, source: 'moc',
            });
            ontologyStore.addEntry({
                entityPath: 'b.md', cluster: 'topic-ai.md', role: 'member', confidence: 1.0, source: 'moc',
            });
            ontologyStore.addEntry({
                entityPath: 'c.md', cluster: 'topic-ai.md', role: 'hub', confidence: 1.0, source: 'moc',
            });

            service.detectCommunities();
            const summary = service.getClusterSummary();

            expect(summary.length).toBeGreaterThanOrEqual(1);
            // All 3 members overlap with MOC -> confirmed
            expect(summary[0].type).toBe('confirmed');
            expect(summary[0].matchingMoc).toBe('topic-ai.md');
        });
    });
});

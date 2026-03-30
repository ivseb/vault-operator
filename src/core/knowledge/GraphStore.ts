/**
 * GraphStore -- Graph CRUD and BFS expansion on the Knowledge DB.
 *
 * Stores Wikilinks (body + frontmatter MOC-Properties) in the edges table
 * and tags in the tags table. Provides BFS-based neighbor expansion for
 * graph-augmented retrieval (ADR-051 Stufe 2).
 *
 * ADR-050: SQLite Knowledge DB (Schema v3)
 * FEATURE-1502: Graph Data Extraction & Expansion
 */

import type { KnowledgeDB, SqlJsDatabase } from './KnowledgeDB';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Edge {
    targetPath: string;
    linkType: 'body' | 'frontmatter';
    propertyName: string | null;
}

export interface GraphNeighbor {
    path: string;
    hopDistance: number;
    viaPath: string;
    linkType: string;
    propertyName: string | null;
}

// ---------------------------------------------------------------------------
// GraphStore
// ---------------------------------------------------------------------------

export class GraphStore {
    private knowledgeDB: KnowledgeDB;

    constructor(knowledgeDB: KnowledgeDB) {
        this.knowledgeDB = knowledgeDB;
    }

    // -----------------------------------------------------------------------
    // Write operations
    // -----------------------------------------------------------------------

    /**
     * Replace all outgoing edges for a source path.
     * Atomic: DELETE old + INSERT new.
     */
    replaceEdgesForPath(sourcePath: string, edges: Edge[]): void {
        const db = this.getDB();
        db.run('DELETE FROM edges WHERE source_path = ?', [sourcePath]);

        if (edges.length === 0) return;
        const stmt = db.prepare(
            'INSERT OR IGNORE INTO edges (source_path, target_path, link_type, property_name) VALUES (?, ?, ?, ?)',
        );
        for (const e of edges) {
            stmt.run([sourcePath, e.targetPath, e.linkType, e.propertyName]);
        }
        stmt.free();
        this.knowledgeDB.markDirty();
    }

    /** Replace all tags for a file path. */
    replaceTagsForPath(path: string, tags: string[]): void {
        const db = this.getDB();
        db.run('DELETE FROM tags WHERE path = ?', [path]);

        if (tags.length === 0) return;
        const stmt = db.prepare('INSERT OR IGNORE INTO tags (path, tag) VALUES (?, ?)');
        for (const tag of tags) {
            stmt.run([path, tag]);
        }
        stmt.free();
        this.knowledgeDB.markDirty();
    }

    /** Delete all edges and tags for a file path. */
    deleteByPath(path: string): void {
        const db = this.getDB();
        db.run('DELETE FROM edges WHERE source_path = ? OR target_path = ?', [path, path]);
        db.run('DELETE FROM tags WHERE path = ?', [path]);
        this.knowledgeDB.markDirty();
    }

    // -----------------------------------------------------------------------
    // Read operations
    // -----------------------------------------------------------------------

    /**
     * BFS neighbor expansion: find all notes reachable within N hops via edges.
     * Bidirectional: follows both outgoing and incoming edges.
     *
     * @param originPath - Starting note path
     * @param hops - Max hop distance (1-3)
     * @param maxResults - Max total neighbors to return
     */
    getNeighbors(originPath: string, hops = 1, maxResults = 10): GraphNeighbor[] {
        const db = this.getDB();
        const visited = new Set<string>([originPath]);
        const result: GraphNeighbor[] = [];

        // BFS frontier: paths to expand in current hop level
        let frontier = [originPath];

        for (let hop = 1; hop <= hops && frontier.length > 0; hop++) {
            const nextFrontier: string[] = [];

            for (const current of frontier) {
                if (result.length >= maxResults) break;

                // Bidirectional: outgoing + incoming edges
                const rows = db.exec(
                    `SELECT target_path AS path, link_type, property_name FROM edges WHERE source_path = ?
                     UNION
                     SELECT source_path AS path, link_type, property_name FROM edges WHERE target_path = ?`,
                    [current, current],
                );

                if (rows.length === 0) continue;
                for (const row of rows[0].values) {
                    const neighborPath = row[0] as string;
                    if (visited.has(neighborPath)) continue;
                    visited.add(neighborPath);

                    result.push({
                        path: neighborPath,
                        hopDistance: hop,
                        viaPath: current,
                        linkType: row[1] as string,
                        propertyName: row[2] as string | null,
                    });
                    nextFrontier.push(neighborPath);

                    if (result.length >= maxResults) break;
                }
            }

            frontier = nextFrontier;
        }

        return result;
    }

    /** Get all file paths that have a specific tag. */
    getFilesByTag(tag: string): string[] {
        const db = this.getDB();
        const normalized = tag.startsWith('#') ? tag.slice(1).toLowerCase() : tag.toLowerCase();
        const result = db.exec('SELECT path FROM tags WHERE tag = ?', [normalized]);
        if (result.length === 0) return [];
        return result[0].values.map(row => row[0] as string);
    }

    /** Total number of edges in the graph. */
    getEdgeCount(): number {
        const db = this.getDB();
        const result = db.exec('SELECT COUNT(*) FROM edges');
        if (result.length === 0 || result[0].values.length === 0) return 0;
        return result[0].values[0][0] as number;
    }

    /** Total number of unique tags. */
    getTagCount(): number {
        const db = this.getDB();
        const result = db.exec('SELECT COUNT(DISTINCT tag) FROM tags');
        if (result.length === 0 || result[0].values.length === 0) return 0;
        return result[0].values[0][0] as number;
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private getDB(): SqlJsDatabase {
        return this.knowledgeDB.getDB();
    }
}

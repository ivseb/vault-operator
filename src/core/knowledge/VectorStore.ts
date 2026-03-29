/**
 * VectorStore -- Vector CRUD and Cosine-Similarity search on the Knowledge DB.
 *
 * Stores embedding vectors as Float32Array BLOBs in SQLite.
 * Search uses bulk-loaded vectors with in-JS cosine similarity (10-50x faster
 * than SQL custom functions due to JS→WASM overhead per row).
 *
 * ADR-050: SQLite Knowledge DB
 * FEATURE-1500: SQLite Knowledge DB
 */

import type { KnowledgeDB, SqlJsDatabase } from './KnowledgeDB';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface VectorEntry {
    id: number;
    path: string;
    chunkIndex: number;
    text: string;
    vector: Float32Array;
    mtime: number;
}

export interface VectorSearchResult {
    path: string;
    text: string;
    chunkIndex: number;
    score: number;
}

// ---------------------------------------------------------------------------
// Cached vector data for fast search
// ---------------------------------------------------------------------------

interface CachedVector {
    id: number;
    path: string;
    chunkIndex: number;
    text: string;
    vector: Float32Array;
}

// ---------------------------------------------------------------------------
// VectorStore
// ---------------------------------------------------------------------------

export class VectorStore {
    private knowledgeDB: KnowledgeDB;
    private vectorCache: CachedVector[] | null = null;

    constructor(knowledgeDB: KnowledgeDB) {
        this.knowledgeDB = knowledgeDB;
    }

    // -----------------------------------------------------------------------
    // Write operations
    // -----------------------------------------------------------------------

    /**
     * Insert chunks for a file. Replaces any existing chunks for that path.
     * Vectors are stored as Float32Array BLOBs.
     */
    insertChunks(filePath: string, chunks: string[], vectors: Float32Array[], mtime: number): void {
        const db = this.getDB();

        // Delete existing chunks for this path
        db.run('DELETE FROM vectors WHERE path = ?', [filePath]);

        // Insert new chunks
        const stmt = db.prepare('INSERT INTO vectors (path, chunk_index, text, vector, mtime) VALUES (?, ?, ?, ?, ?)');
        for (let i = 0; i < chunks.length; i++) {
            const vecBytes = new Uint8Array(vectors[i].buffer, vectors[i].byteOffset, vectors[i].byteLength);
            stmt.run([filePath, i, chunks[i], vecBytes, mtime]);
        }
        stmt.free();

        this.invalidateCache();
        this.knowledgeDB.markDirty();
    }

    /** Delete all chunks for a file path. */
    deleteByPath(filePath: string): void {
        const db = this.getDB();
        db.run('DELETE FROM vectors WHERE path = ?', [filePath]);
        this.invalidateCache();
        this.knowledgeDB.markDirty();
    }

    /** Delete all vectors (full reset). */
    deleteAll(): void {
        const db = this.getDB();
        db.run('DELETE FROM vectors');
        this.invalidateCache();
        this.knowledgeDB.markDirty();
    }

    // -----------------------------------------------------------------------
    // Read operations
    // -----------------------------------------------------------------------

    /** Get all unique file paths with their max mtime. Used for checkpoint/delta logic. */
    getPathMtimes(): Map<string, number> {
        const db = this.getDB();
        const result = db.exec('SELECT path, MAX(mtime) as mtime FROM vectors GROUP BY path');
        const map = new Map<string, number>();
        if (result.length > 0) {
            for (const row of result[0].values) {
                map.set(row[0] as string, row[1] as number);
            }
        }
        return map;
    }

    /** Get total number of unique indexed files. */
    getFileCount(): number {
        const db = this.getDB();
        const result = db.exec('SELECT COUNT(DISTINCT path) FROM vectors');
        if (result.length === 0 || result[0].values.length === 0) return 0;
        return result[0].values[0][0] as number;
    }

    /** Get total number of vectors. */
    getVectorCount(): number {
        const db = this.getDB();
        const result = db.exec('SELECT COUNT(*) FROM vectors');
        if (result.length === 0 || result[0].values.length === 0) return 0;
        return result[0].values[0][0] as number;
    }

    /** Check if a file path has any chunks in the index. */
    hasFile(filePath: string): boolean {
        const db = this.getDB();
        const result = db.exec('SELECT 1 FROM vectors WHERE path = ? LIMIT 1', [filePath]);
        return result.length > 0 && result[0].values.length > 0;
    }

    // -----------------------------------------------------------------------
    // Vector search
    // -----------------------------------------------------------------------

    /**
     * Search for the top-K most similar chunks to the query vector.
     * Uses bulk-loaded cached vectors + JS cosine similarity.
     *
     * @param pathPrefix - Optional path prefix filter (e.g. 'session:' for session vectors)
     */
    search(queryVector: Float32Array, topK = 5, pathPrefix?: string): VectorSearchResult[] {
        const cache = this.ensureCache();

        // Filter by prefix if needed (e.g. 'session:', 'episode:')
        const candidates = pathPrefix
            ? cache.filter(c => c.path.startsWith(pathPrefix))
            : cache.filter(c => !c.path.startsWith('session:') && !c.path.startsWith('episode:'));

        if (candidates.length === 0) return [];

        // Compute cosine similarity for all candidates
        const scored = candidates.map(c => ({
            path: c.path,
            text: c.text,
            chunkIndex: c.chunkIndex,
            score: cosineSimilarity(queryVector, c.vector),
        }));

        // Sort by score descending and return top-K
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, topK);
    }

    /**
     * Search with per-file deduplication: returns the best chunk per unique file.
     * This matches the behavior of the old vectra-based search.
     */
    searchUniqueFiles(queryVector: Float32Array, topK = 5, pathPrefix?: string): VectorSearchResult[] {
        // Request more candidates to ensure enough unique files after dedup
        const rawResults = this.search(queryVector, topK * 3, pathPrefix);

        const byPath = new Map<string, VectorSearchResult>();
        for (const r of rawResults) {
            if (!byPath.has(r.path)) {
                byPath.set(r.path, r);
                if (byPath.size >= topK) break;
            }
        }
        return Array.from(byPath.values());
    }

    // -----------------------------------------------------------------------
    // Cache management
    // -----------------------------------------------------------------------

    /** Invalidate the in-memory vector cache. Next search() will reload from DB. */
    invalidateCache(): void {
        this.vectorCache = null;
    }

    private ensureCache(): CachedVector[] {
        if (this.vectorCache) return this.vectorCache;

        const db = this.getDB();
        const result = db.exec('SELECT id, path, chunk_index, text, vector FROM vectors');

        if (result.length === 0) {
            this.vectorCache = [];
            return this.vectorCache;
        }

        this.vectorCache = result[0].values.map(row => {
            const vecBlob = row[4] as Uint8Array;
            return {
                id: row[0] as number,
                path: row[1] as string,
                chunkIndex: row[2] as number,
                text: row[3] as string,
                vector: new Float32Array(vecBlob.buffer, vecBlob.byteOffset, vecBlob.byteLength / 4),
            };
        });

        console.debug(`[VectorStore] Loaded ${this.vectorCache.length} vectors into cache`);
        return this.vectorCache;
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private getDB(): SqlJsDatabase {
        return this.knowledgeDB.getDB();
    }
}

// ---------------------------------------------------------------------------
// Cosine similarity (optimized for Float32Array)
// ---------------------------------------------------------------------------

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

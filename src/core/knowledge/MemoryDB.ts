/**
 * MemoryDB -- SQLite storage for agent memory data (sessions, episodes, recipes, patterns).
 *
 * Separate from KnowledgeDB (which stores vectors/graph/implicit edges).
 * ADR-050 Zwei-DB-Strategie:
 *   - knowledge.db: global (~/.obsidian-agent/), per-device cache, not synced
 *   - memory.db: local ({vault}/.obsidian-agent/), synced via vault sync
 *
 * FEATURE-1505: Knowledge Data Consolidation
 */

import type { Vault } from 'obsidian';
import { KnowledgeDB } from './KnowledgeDB';
import type { SqlJsDatabase } from './KnowledgeDB';

// ---------------------------------------------------------------------------
// Memory-specific schema (separate from knowledge.db schema)
// ---------------------------------------------------------------------------

const MEMORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT,
    summary TEXT,
    source TEXT DEFAULT 'human',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY,
    user_message TEXT,
    mode TEXT,
    tool_sequence TEXT,
    tool_ledger TEXT,
    success INTEGER NOT NULL,
    result_summary TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    trigger_keywords TEXT,
    steps TEXT NOT NULL,
    source TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    success_count INTEGER DEFAULT 0,
    last_used TEXT,
    modes TEXT
);

CREATE TABLE IF NOT EXISTS patterns (
    pattern_key TEXT PRIMARY KEY,
    tool_sequence TEXT NOT NULL,
    episodes TEXT NOT NULL,
    success_count INTEGER DEFAULT 0
);
`;

// ---------------------------------------------------------------------------
// MemoryDB
// ---------------------------------------------------------------------------

export class MemoryDB {
    private knowledgeDB: KnowledgeDB;
    private initialized = false;

    constructor(vault: Vault, pluginDir: string) {
        // Use 'local' storage: {vault}/.obsidian-agent/memory.db — synced via vault sync
        this.knowledgeDB = new KnowledgeDB(vault, pluginDir, 'local', 'memory.db');
    }

    /** Open the DB and initialize the memory schema. */
    async open(): Promise<void> {
        await this.knowledgeDB.open();
        this.initMemorySchema();
        this.initialized = true;
    }

    /** Get the raw sql.js Database for direct queries. */
    getDB(): SqlJsDatabase {
        return this.knowledgeDB.getDB();
    }

    /** Check if the DB is open. */
    isOpen(): boolean {
        return this.initialized && this.knowledgeDB.isOpen();
    }

    /** Mark as dirty (triggers debounced save). */
    markDirty(): void {
        this.knowledgeDB.markDirty();
    }

    /** Persist to disk immediately. */
    async save(): Promise<void> {
        await this.knowledgeDB.save();
    }

    /** Close and persist final state. */
    async close(): Promise<void> {
        await this.knowledgeDB.close();
        this.initialized = false;
    }

    // -----------------------------------------------------------------------
    // Private: Schema initialization
    // -----------------------------------------------------------------------

    private initMemorySchema(): void {
        const db = this.knowledgeDB.getDB();
        for (const stmt of MEMORY_SCHEMA.split(';').map(s => s.trim()).filter(Boolean)) {
            db.run(stmt + ';');
        }
        console.debug('[MemoryDB] Schema initialized');
    }
}

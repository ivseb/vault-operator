/**
 * KnowledgeDB -- SQLite wrapper for the Unified Knowledge Layer.
 *
 * Replaces vectra's single-JSON-file approach with sql.js (WASM SQLite).
 * Supports three storage locations with a fallback persistence chain:
 *   - global:        ~/.obsidian-agent/knowledge.db   (fs.promises, Desktop-only)
 *   - local:         {vault}/.obsidian-agent/knowledge.db  (vault.adapter)
 *   - obsidian-sync: {vault}/{pluginDir}/knowledge.db      (vault.adapter)
 *
 * ADR-050: SQLite Knowledge DB
 * FEATURE-1500: SQLite Knowledge DB
 */

import type { Vault } from 'obsidian';
import * as path from 'path';
import * as fs from 'fs';

// sql.js types -- we import the factory function at runtime
type SqlJsStatic = {
    Database: new (data?: ArrayLike<number>) => SqlJsDatabase;
};
type SqlJsDatabase = {
    run(sql: string, params?: unknown[]): SqlJsDatabase;
    exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: unknown[][] }>;
    prepare(sql: string): SqlJsStatement;
    export(): Uint8Array;
    close(): void;
};
type SqlJsStatement = {
    bind(params?: unknown[]): boolean;
    step(): boolean;
    getAsObject(params?: Record<string, unknown>): Record<string, unknown>;
    get(params?: unknown[]): unknown[];
    free(): void;
    run(params?: unknown[]): void;
    reset(): void;
};

export type { SqlJsDatabase, SqlJsStatement };

const SCHEMA_VERSION = 5;

// ---------------------------------------------------------------------------
// Schema DDL
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

CREATE TABLE IF NOT EXISTS implicit_edges (
    source_path TEXT NOT NULL,
    target_path TEXT NOT NULL,
    similarity REAL NOT NULL,
    computed_at TEXT NOT NULL,
    UNIQUE(source_path, target_path)
);
CREATE INDEX IF NOT EXISTS idx_implicit_source ON implicit_edges(source_path);
CREATE INDEX IF NOT EXISTS idx_implicit_target ON implicit_edges(target_path);

CREATE TABLE IF NOT EXISTS dismissed_pairs (
    path_a TEXT NOT NULL,
    path_b TEXT NOT NULL,
    dismissed_at TEXT NOT NULL,
    UNIQUE(path_a, path_b)
);
`;

// ---------------------------------------------------------------------------
// KnowledgeDB
// ---------------------------------------------------------------------------

export class KnowledgeDB {
    private db: SqlJsDatabase | null = null;
    private SQL: SqlJsStatic | null = null;
    private vault: Vault;
    private storageLocation: 'global' | 'local' | 'obsidian-sync';
    private absolutePath: string;       // Absolute FS path (for global: fs.promises)
    private vaultRelativePath: string;  // Vault-relative path (for local/sync: vault.adapter)
    private dirty = false;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private saving = false;

    constructor(
        vault: Vault,
        pluginDir: string,
        storageLocation: 'global' | 'local' | 'obsidian-sync' = 'global',
        dbName = 'knowledge.db',
        /** Override the global root directory (default: {vault-parent}/.obsidian-agent/). */
        globalRoot?: string,
    ) {
        this.vault = vault;
        this.storageLocation = storageLocation;

        const basePath = (vault.adapter as unknown as { getBasePath?(): string }).getBasePath?.() ?? '';

        if (storageLocation === 'global') {
            const root = globalRoot ?? path.join(path.dirname(basePath), '.obsidian-agent');
            this.absolutePath = path.join(root, dbName);
            this.vaultRelativePath = ''; // not used for global
        } else if (storageLocation === 'local') {
            this.vaultRelativePath = `.obsidian-agent/${dbName}`;
            this.absolutePath = path.join(basePath, this.vaultRelativePath);
        } else {
            this.vaultRelativePath = `${pluginDir}/${dbName}`;
            this.absolutePath = path.join(basePath, this.vaultRelativePath);
        }
    }

    /** Initialize sql.js WASM and open/create the database. */
    async open(): Promise<void> {
        if (this.db) return; // already open

        // eslint-disable-next-line @typescript-eslint/no-require-imports -- sql.js WASM init needs require for Electron compatibility
        const initSqlJs = require('sql.js') as (config?: { wasmBinary?: ArrayBuffer }) => Promise<SqlJsStatic>;

        // Obsidian's app:// protocol can't serve WASM files via fetch().
        // Load the binary directly from disk and pass it to sql.js.
        const pluginBasePath = (this.vault.adapter as unknown as { getBasePath?(): string }).getBasePath?.() ?? '';
        // eslint-disable-next-line obsidianmd/hardcoded-config-path -- fallback only, vault.configDir used when available
        const configDir = (this.vault as unknown as { configDir?: string }).configDir ?? '.obsidian';
        const pluginMainDir = path.join(pluginBasePath, configDir, 'plugins', 'obsilo-agent');

        // Try browser variant first (what esbuild bundles), then fallback
        let wasmBinary: Buffer;
        const browserWasm = path.join(pluginMainDir, 'sql-wasm-browser.wasm');
        const nodeWasm = path.join(pluginMainDir, 'sql-wasm.wasm');
        try {
            wasmBinary = fs.readFileSync(browserWasm);
        } catch {
            wasmBinary = fs.readFileSync(nodeWasm);
        }

        this.SQL = await initSqlJs({ wasmBinary: wasmBinary.buffer });

        // Try to load existing DB
        const data = await this.readDB();
        if (data) {
            this.db = new this.SQL.Database(data);
            this.migrateSchema();
        } else {
            this.db = new this.SQL.Database();
            this.initSchema();
        }
    }

    /** Get the raw sql.js Database instance for direct queries. */
    getDB(): SqlJsDatabase {
        if (!this.db) throw new Error('KnowledgeDB not opened. Call open() first.');
        return this.db;
    }

    /** Check if the DB is open and ready. */
    isOpen(): boolean {
        return this.db !== null;
    }

    /** Mark the DB as dirty (needs saving). Triggers debounced save. */
    markDirty(): void {
        this.dirty = true;
        this.scheduleSave();
    }

    /** Persist DB to disk immediately. */
    async save(): Promise<void> {
        if (!this.db || !this.dirty || this.saving) return;
        this.saving = true;
        try {
            const data = this.db.export();
            await this.writeDB(data);
            this.dirty = false;
        } catch (e) {
            console.warn('[KnowledgeDB] Save failed:', e);
        } finally {
            this.saving = false;
        }
    }

    /** Close the DB and persist final state. Call on plugin unload. */
    async close(): Promise<void> {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        await this.save();
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }

    /** Delete the DB file from disk and reset in-memory state. */
    async deleteDB(): Promise<void> {
        await this.close();
        try {
            if (this.storageLocation === 'global') {
                await fs.promises.unlink(this.absolutePath).catch(() => { /* non-fatal */ });
            } else {
                const exists = await this.vault.adapter.exists(this.vaultRelativePath);
                if (exists) await this.vault.adapter.remove(this.vaultRelativePath);
            }
        } catch { /* non-fatal */ }
    }

    // -----------------------------------------------------------------------
    // Checkpoint helpers (key-value in checkpoint table)
    // -----------------------------------------------------------------------

    getCheckpointValue(key: string): string | null {
        if (!this.db) return null;
        const result = this.db.exec('SELECT value FROM checkpoint WHERE key = ?', [key]);
        if (result.length === 0 || result[0].values.length === 0) return null;
        return result[0].values[0][0] as string;
    }

    setCheckpointValue(key: string, value: string): void {
        if (!this.db) return;
        this.db.run('INSERT OR REPLACE INTO checkpoint (key, value) VALUES (?, ?)', [key, value]);
        this.markDirty();
    }

    // -----------------------------------------------------------------------
    // Private: Schema
    // -----------------------------------------------------------------------

    private initSchema(): void {
        if (!this.db) return;
        // Execute DDL statements one by one (sql.js doesn't support multi-statement exec well)
        for (const stmt of SCHEMA_DDL.split(';').map(s => s.trim()).filter(Boolean)) {
            this.db.run(stmt + ';');
        }
        // Set initial version
        const existing = this.db.exec('SELECT version FROM schema_meta');
        if (existing.length === 0 || existing[0].values.length === 0) {
            this.db.run('INSERT INTO schema_meta VALUES (?)', [SCHEMA_VERSION]);
        }
        this.markDirty();
    }

    private migrateSchema(): void {
        if (!this.db) return;
        const result = this.db.exec('SELECT version FROM schema_meta');
        const currentVersion = (result.length > 0 && result[0].values.length > 0)
            ? result[0].values[0][0] as number
            : 0;

        if (currentVersion < SCHEMA_VERSION) {
            // v1 -> v2: Add enriched column for two-pass contextual enrichment
            if (currentVersion < 2) {
                try {
                    this.db.run('ALTER TABLE vectors ADD COLUMN enriched INTEGER NOT NULL DEFAULT 0');
                } catch {
                    // Column may already exist if schema was partially migrated
                }
            }

            // v2 -> v3: Add edges + tags tables for graph extraction (FEATURE-1502)
            // v3 -> v4: Add implicit_edges table (FEATURE-1503)
            // v4 -> v5: Add dismissed_pairs table (FEATURE-1506)
            // All CREATE TABLE IF NOT EXISTS — idempotent, handled by initSchema() below

            // Re-run DDL (CREATE IF NOT EXISTS is idempotent)
            this.initSchema();
            this.db.run('UPDATE schema_meta SET version = ?', [SCHEMA_VERSION]);
            this.markDirty();
            console.debug(`[KnowledgeDB] Migrated schema from v${currentVersion} to v${SCHEMA_VERSION}`);
        }
    }

    // -----------------------------------------------------------------------
    // Private: Persistence (Fallback chain)
    // -----------------------------------------------------------------------

    private async readDB(): Promise<Uint8Array | null> {
        try {
            if (this.storageLocation === 'global') {
                const exists = await fs.promises.access(this.absolutePath).then(() => true).catch(() => false);
                if (!exists) return null;
                const buf = await fs.promises.readFile(this.absolutePath);
                return new Uint8Array(buf);
            } else {
                const exists = await this.vault.adapter.exists(this.vaultRelativePath);
                if (!exists) return null;
                const buf = await this.vault.adapter.readBinary(this.vaultRelativePath);
                return new Uint8Array(buf);
            }
        } catch (e) {
            console.warn('[KnowledgeDB] Failed to read DB:', e);
            return null;
        }
    }

    private async writeDB(data: Uint8Array): Promise<void> {
        if (this.storageLocation === 'global') {
            await fs.promises.mkdir(path.dirname(this.absolutePath), { recursive: true });
            await fs.promises.writeFile(this.absolutePath, data);
        } else {
            // Ensure parent directory exists
            const dir = this.vaultRelativePath.substring(0, this.vaultRelativePath.lastIndexOf('/'));
            if (dir) {
                const dirExists = await this.vault.adapter.exists(dir);
                if (!dirExists) await this.vault.adapter.mkdir(dir);
            }
            await this.vault.adapter.writeBinary(this.vaultRelativePath, data.buffer);
        }
    }

    private scheduleSave(): void {
        if (this.saveTimer) return; // already scheduled
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            void this.save();
        }, 2000); // 2s debounce
    }
}

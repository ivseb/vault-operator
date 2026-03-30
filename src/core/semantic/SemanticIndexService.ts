/**
 * SemanticIndexService v3 -- SQLite-backed (ADR-050, FEATURE-1500)
 *
 * Replaces vectra (single JSON file) with KnowledgeDB (sql.js WASM) +
 * VectorStore (Float32Array BLOBs + JS cosine similarity).
 *
 * Key features retained from v2:
 *  1. Batch embedding: N texts per API call
 *  2. Resumable indexing: checkpoint in DB (vectors.mtime + checkpoint table)
 *  3. Heading-aware chunking (2000 chars default)
 *  4. Cancel support: cancelBuild() flag
 *  5. Event-loop yielding between disk commits
 *
 * Storage: Managed by KnowledgeDB (global / local / obsidian-sync).
 */

import { requestUrl } from 'obsidian';
import type { Vault } from 'obsidian';
import type { CustomModel } from '../../types/settings';
import type { KnowledgeDB } from '../knowledge/KnowledgeDB';
import type { VectorStore } from '../knowledge/VectorStore';
import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface SemanticResult {
    path: string;
    excerpt: string;
    score: number;
}

export interface BuildResult {
    indexed: number;
    total: number;
    errors: number;
    cancelled: boolean;
    /** Sample of skipped file paths (max 10) for diagnostics */
    skippedFiles: string[];
    durationMs: number;
}

export interface SemanticIndexOptions {
    /** How many files to process before committing to disk. Default: 20 */
    batchSize?: number;
    /** How many texts to send per embedding API call. Default: 16 */
    embeddingBatchSize?: number;
    excludedFolders?: string[];
    /** Whether to also index PDF files. Default: false */
    indexPdfs?: boolean;
    /** Characters per chunk. Default: 2000. Changing this forces a full index rebuild. */
    chunkSize?: number;
}

const DEFAULT_CHUNK_SIZE = 2000;   // chars — larger chunks → fewer API calls
const DEFAULT_COMMIT_EVERY = 20;   // files between disk commits
const DEFAULT_EMBED_BATCH = 16;    // texts per API request

// ---------------------------------------------------------------------------
// SemanticIndexService
// ---------------------------------------------------------------------------

export class SemanticIndexService {
    private vault: Vault;
    private knowledgeDB: KnowledgeDB;
    private vectorStore: VectorStore;

    private isBuilding = false;
    private cancelled = false;
    private builtAt: Date | null = null;

    private embeddingModel: CustomModel | null = null;
    private batchSize: number;
    private embeddingBatchSize: number;
    private excludedFolders: string[];
    private indexPdfs: boolean;
    private chunkSize: number;

    // Auto-update queue: process one file at a time so concurrent vault events
    // don't spawn dozens of simultaneous embedding calls (which freezes Obsidian).
    private autoUpdateQueue = new Set<string>();
    private autoIndexRunning = false;
    /** Number of unique files indexed (updated live during build). */
    docCount = 0;
    /** Live progress for external polling (e.g. Settings UI). */
    progressIndexed = 0;
    progressTotal = 0;
    /** Last build diagnostics — available after buildIndex() completes. */
    lastBuildResult: BuildResult | null = null;

    constructor(vault: Vault, knowledgeDB: KnowledgeDB, vectorStore: VectorStore, options: SemanticIndexOptions = {}) {
        this.vault = vault;
        this.knowledgeDB = knowledgeDB;
        this.vectorStore = vectorStore;
        this.batchSize = options.batchSize ?? DEFAULT_COMMIT_EVERY;
        this.embeddingBatchSize = options.embeddingBatchSize ?? DEFAULT_EMBED_BATCH;
        this.excludedFolders = options.excludedFolders ?? [];
        this.indexPdfs = options.indexPdfs ?? false;
        this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    configure(options: SemanticIndexOptions): void {
        if (options.batchSize !== undefined) this.batchSize = options.batchSize;
        if (options.embeddingBatchSize !== undefined) this.embeddingBatchSize = options.embeddingBatchSize;
        if (options.excludedFolders !== undefined) this.excludedFolders = options.excludedFolders;
        if (options.indexPdfs !== undefined) this.indexPdfs = options.indexPdfs;
        if (options.chunkSize !== undefined) this.chunkSize = options.chunkSize;
    }

    get isIndexed(): boolean { return this.builtAt !== null; }
    get building(): boolean { return this.isBuilding; }
    get lastBuiltAt(): Date | null { return this.builtAt; }

    setEmbeddingModel(model: CustomModel | null): void {
        this.embeddingModel = model;
        if (model) console.debug(`[SemanticIndex] Using embedding model: ${model.name} (${model.provider})`);
    }

    /** Stop an in-progress buildIndex(). Partial progress is saved to checkpoint. */
    cancelBuild(): void {
        this.cancelled = true;
    }

    /** Restore state from checkpoint stored in the KnowledgeDB. */
    async initialize(): Promise<void> {
        try {
            if (!this.knowledgeDB.isOpen()) {
                await this.knowledgeDB.open();
            }
            const builtAt = this.knowledgeDB.getCheckpointValue('builtAt');
            const docCount = this.knowledgeDB.getCheckpointValue('docCount');
            if (builtAt) {
                this.builtAt = new Date(builtAt);
                this.docCount = docCount ? parseInt(docCount, 10) : this.vectorStore.getFileCount();
            }
        } catch { /* non-fatal */ }
    }

    /** Close the underlying KnowledgeDB. Call on plugin unload. */
    async close(): Promise<void> {
        await this.knowledgeDB.close();
    }

    /**
     * Build (or incrementally update) the index.
     *
     * @param onProgress  - Called with (indexed, total) after each file.
     * @param force       - Ignore checkpoint and rebuild from scratch.
     */
    async buildIndex(
        onProgress?: (indexed: number, total: number) => void,
        force = false,
    ): Promise<BuildResult> {
        if (this.isBuilding) return { indexed: 0, total: 0, errors: 0, cancelled: false, skippedFiles: [], durationMs: 0 };
        if (!this.embeddingModel) {
            throw new Error(
                'No embedding model configured. Go to Settings > Embeddings and add an ' +
                'embedding model (e.g. OpenAI text-embedding-3-small) before building the index.',
            );
        }
        this.isBuilding = true;
        this.cancelled = false;
        const startTime = Date.now();
        const skippedFiles: string[] = [];

        try {
            // ----------------------------------------------------------------
            // 1. Determine file list (Markdown + optionally PDFs)
            // ----------------------------------------------------------------
            const mdFiles = this.vault.getMarkdownFiles();
            const DOCUMENT_EXTENSIONS = new Set(['pdf', 'pptx', 'xlsx', 'docx']);
            const allFiles = this.indexPdfs
                ? [
                    ...mdFiles,
                    ...this.vault.getFiles().filter((f) => DOCUMENT_EXTENSIONS.has(f.extension)),
                ]
                : mdFiles;
            const files = this.excludedFolders.length > 0
                ? allFiles.filter((f) => !this.excludedFolders.some(
                    (folder) => f.path.startsWith(folder + '/'),
                ))
                : allFiles;
            const total = files.length;

            const modelKey = this.modelKey();

            // ----------------------------------------------------------------
            // 2. Load checkpoint from DB — detect model/chunkSize change
            // ----------------------------------------------------------------
            const cpModel = force ? null : this.knowledgeDB.getCheckpointValue('embeddingModel');
            const cpChunkSize = force ? null : this.knowledgeDB.getCheckpointValue('chunkSize');
            const hasCheckpoint = cpModel !== null;
            const isModelChange = hasCheckpoint && cpModel !== modelKey;
            const isChunkSizeChange = hasCheckpoint && cpChunkSize !== null && parseInt(cpChunkSize, 10) !== this.chunkSize;
            const isFullRebuild = force || isModelChange || isChunkSizeChange || !hasCheckpoint;

            // Diagnostic: log WHY a full rebuild is triggered
            if (isFullRebuild) {
                const reasons: string[] = [];
                if (force) reasons.push('force=true');
                if (!hasCheckpoint) reasons.push('no checkpoint in DB');
                if (isModelChange) reasons.push(`model changed: "${cpModel}" -> "${modelKey}"`);
                if (isChunkSizeChange) reasons.push(`chunk size changed: ${cpChunkSize} -> ${this.chunkSize}`);
                console.debug(`[SemanticIndex] Full rebuild triggered: ${reasons.join(', ')}`);
            } else {
                const fileCount = this.vectorStore.getFileCount();
                console.debug(`[SemanticIndex] Incremental update from checkpoint (${fileCount} files indexed, model: ${cpModel})`);
            }

            if (isFullRebuild) {
                this.vectorStore.deleteAll();
            }

            // ----------------------------------------------------------------
            // 3. Determine which files need (re)indexing
            // ----------------------------------------------------------------
            const pathMtimes = isFullRebuild ? new Map<string, number>() : this.vectorStore.getPathMtimes();
            const toIndex = files.filter((f) => {
                if (isFullRebuild) return true;
                const storedMtime = pathMtimes.get(f.path);
                return storedMtime === undefined || storedMtime < (f.stat?.mtime ?? 0);
            });

            let indexed = isFullRebuild ? 0 : (files.length - toIndex.length);
            let errors = 0;

            this.progressIndexed = indexed;
            this.progressTotal = total;
            onProgress?.(indexed, total);

            if (toIndex.length === 0) {
                console.debug('[SemanticIndex] Index up to date — nothing to index.');
                this.builtAt = new Date();
                const result: BuildResult = { indexed: total, total, errors: 0, cancelled: false, skippedFiles: [], durationMs: Date.now() - startTime };
                this.lastBuildResult = result;
                return result;
            }

            // ----------------------------------------------------------------
            // 4. Embed + insert new chunks
            // ----------------------------------------------------------------
            let uncommitted = 0;

            for (const file of toIndex) {
                if (this.cancelled) {
                    console.debug('[SemanticIndex] Build cancelled — saving partial checkpoint.');
                    break;
                }

                try {
                    const content = await this.readFileContent(file);
                    const chunks = this.splitIntoChunks(content, this.chunkSize);

                    if (chunks.length > 0) {
                        const vectors = await this.embedBatch(chunks);
                        this.vectorStore.insertChunks(file.path, chunks, vectors, file.stat?.mtime ?? 0);
                    }

                    indexed++;
                    uncommitted++;
                    this.docCount = indexed;
                    this.progressIndexed = indexed;
                    onProgress?.(indexed, total);

                    // Persist every N files: save DB to disk + yield UI
                    if (uncommitted >= this.batchSize) {
                        this.saveCheckpointToDB(modelKey, indexed);
                        await this.knowledgeDB.save();
                        uncommitted = 0;
                        await new Promise<void>((r) => setTimeout(r, 0)); // yield
                    }
                } catch (e) {
                    errors++;
                    if (skippedFiles.length < 10) skippedFiles.push(file.path);
                    console.warn(`[SemanticIndex] Skipping "${file.path}":`, e);
                }
            }

            // Prune stale vectors for files no longer in the vault
            if (!isFullRebuild && !this.cancelled) {
                const vaultPaths = new Set(files.map((f) => f.path));
                const indexedPaths = this.vectorStore.getPathMtimes();
                for (const [p] of indexedPaths) {
                    // Only prune vault files, not session:/episode: prefixed entries
                    if (!p.includes(':') && !vaultPaths.has(p)) {
                        this.vectorStore.deleteByPath(p);
                    }
                }
            }

            // Final checkpoint + save
            this.saveCheckpointToDB(modelKey, indexed);
            await this.knowledgeDB.save();

            const builtAtStr = this.knowledgeDB.getCheckpointValue('builtAt')!;
            this.builtAt = new Date(builtAtStr);
            this.docCount = indexed;

            if (!this.cancelled) {
                console.debug(`[SemanticIndex] Build complete: ${indexed}/${total} files, ${errors} skipped.`);
            }

            const result: BuildResult = { indexed, total, errors, cancelled: this.cancelled, skippedFiles, durationMs: Date.now() - startTime };
            this.lastBuildResult = result;
            return result;
        } catch (e) {
            console.error('[SemanticIndex] Build failed:', e);
            throw e;
        } finally {
            this.isBuilding = false;
        }
    }

    /**
     * Incrementally update a single file.
     * Removes its old chunks then re-embeds the current content.
     */
    async updateFile(filePath: string): Promise<void> {
        if (!this.knowledgeDB.isOpen()) return;
        try {
            const file = this.vault.getFileByPath(filePath);
            if (!file) return;

            const content = await this.readFileContent(file);
            const chunks = this.splitIntoChunks(content, this.chunkSize);
            if (chunks.length > 0) {
                const vectors = await this.embedBatch(chunks);
                // insertChunks does DELETE + INSERT internally
                this.vectorStore.insertChunks(filePath, chunks, vectors, file.stat?.mtime ?? 0);
            } else {
                this.vectorStore.deleteByPath(filePath);
            }
            this.knowledgeDB.markDirty();
        } catch (e) {
            console.warn(`[SemanticIndex] updateFile failed for ${filePath}:`, e);
        }
    }

    /**
     * Queue a file for auto-index. Safe to call on every vault event.
     * Deduplicates: if the same file is queued multiple times before it's
     * processed, only the latest version is indexed. All files are processed
     * sequentially (concurrency = 1) to prevent concurrent embedding calls
     * from freezing Obsidian's main thread.
     */
    queueAutoUpdate(filePath: string): void {
        this.autoUpdateQueue.add(filePath);
        if (!this.autoIndexRunning) {
            this.autoIndexRunning = true;
            void this.runAutoUpdateQueue();
        }
    }

    private async runAutoUpdateQueue(): Promise<void> {
        while (this.autoUpdateQueue.size > 0) {
            const paths = [...this.autoUpdateQueue];
            this.autoUpdateQueue.clear();
            for (const path of paths) {
                await this.updateFile(path).catch((e) =>
                    console.warn(`[SemanticIndex] Auto-update failed for ${path}:`, e)
                );
                // Pause between files so the Electron renderer can process user
                // input, paint frames, and run GC without freezing the UI.
                await this.sleep(2000);
            }
        }
        this.autoIndexRunning = false;
    }

    /**
     * Remove all chunks for a single file from the index.
     * Called on vault delete and rename (old path).
     */
    async removeFile(filePath: string): Promise<void> {
        if (!this.knowledgeDB.isOpen()) return;
        try {
            if (!this.vectorStore.hasFile(filePath)) return;
            this.vectorStore.deleteByPath(filePath);
            this.docCount = Math.max(0, this.docCount - 1);
            this.knowledgeDB.markDirty();
        } catch (e) {
            console.warn(`[SemanticIndex] removeFile failed for "${filePath}":`, e);
        }
    }

    // -----------------------------------------------------------------------
    // Keyword search helpers: stemming + tokenization
    // -----------------------------------------------------------------------

    /**
     * Lightweight suffix stemmer for search term normalization.
     * Handles common English and German inflectional suffixes.
     * No external dependencies — intentionally simple to avoid over-stemming.
     */
    private static stemWord(word: string): string {
        if (word.length < 3) return word;
        let w = word;
        // English suffixes (longest first to avoid partial matches)
        if (w.endsWith('ings') && w.length > 6) w = w.slice(0, -4);
        else if (w.endsWith('tion') && w.length > 6) w = w.slice(0, -4) + 't';
        else if (w.endsWith('ness') && w.length > 6) w = w.slice(0, -4);
        else if (w.endsWith('ment') && w.length > 6) w = w.slice(0, -4);
        else if (w.endsWith('able') && w.length > 6) w = w.slice(0, -4);
        else if (w.endsWith('keit') && w.length > 6) w = w.slice(0, -4);
        else if (w.endsWith('heit') && w.length > 6) w = w.slice(0, -4);
        else if (w.endsWith('lich') && w.length > 6) w = w.slice(0, -4);
        else if (w.endsWith('isch') && w.length > 6) w = w.slice(0, -4);
        else if (w.endsWith('ies') && w.length > 4) w = w.slice(0, -3) + 'y';
        else if (w.endsWith('ful') && w.length > 5) w = w.slice(0, -3);
        else if (w.endsWith('ung') && w.length > 5) w = w.slice(0, -3);
        else if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
        else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
        else if (w.endsWith('es') && w.length > 4) w = w.slice(0, -2);
        else if (w.endsWith('er') && w.length > 4) w = w.slice(0, -2);
        else if (w.endsWith('en') && w.length > 4) w = w.slice(0, -2);
        else if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) w = w.slice(0, -1);
        return w;
    }

    /**
     * Tokenize text into stemmed words.
     * Splits on word boundaries (whitespace, hyphens, underscores, punctuation)
     * to handle compound words like "Meeting-Notiz" → ["meeting", "notiz"].
     * Filters tokens shorter than 3 characters.
     */
    private static tokenize(text: string): string[] {
        return text
            .toLowerCase()
            .split(/[\s_/,.;:!?()[\]{}"'`|@#=+*<>~^-]+/)
            .filter((t) => t.length >= 3)
            .map((t) => SemanticIndexService.stemWord(t));
    }

    /**
     * Keyword search over indexed chunks using TF-IDF scoring with stemming.
     *
     * Improvements over the previous substring-counting approach:
     * - Stemming: "meetings" matches "Meeting-Notiz" (both stem to "meeting")
     * - Word boundaries: "cat" does NOT match "category" (tokenized separately)
     * - IDF weighting: rare terms score higher than common words (language-agnostic,
     *   no hardcoded stop-word list needed)
     * - Compound-word splitting: "Meeting-Notiz" → ["meeting", "notiz"]
     *
     * Used by hybrid search (RRF fusion) to catch exact names/tags the embedding misses.
     */
    async keywordSearch(query: string, topK = 8): Promise<SemanticResult[]> {
        if (!this.knowledgeDB.isOpen()) return [];
        try {
            // 1. Tokenize + stem query terms, deduplicate
            const queryTerms = [...new Set(SemanticIndexService.tokenize(query))];
            if (queryTerms.length === 0) return [];

            const allChunks = this.vectorStore.getAllChunks();
            const N = allChunks.length;
            if (N === 0) return [];

            // 2. Pre-compute IDF: log((N+1) / (df+1)) per query term
            //    IDF naturally downweights frequent words regardless of language.
            const docFreq = new Map<string, number>();
            const chunkTokensCache: Map<number, Set<string>> = new Map();
            for (let idx = 0; idx < allChunks.length; idx++) {
                const chunk = allChunks[idx].text;
                if (!chunk) continue;
                const tokenSet = new Set(SemanticIndexService.tokenize(chunk));
                chunkTokensCache.set(idx, tokenSet);
                for (const qt of queryTerms) {
                    if (tokenSet.has(qt)) docFreq.set(qt, (docFreq.get(qt) ?? 0) + 1);
                }
            }

            // 3. Score each chunk: sum(TF * IDF) per matching term, keep best chunk per file
            const byPath = new Map<string, { excerpt: string; score: number }>();
            for (let idx = 0; idx < allChunks.length; idx++) {
                const { path: filePath, text: chunk } = allChunks[idx];
                if (!chunk || !filePath) continue;

                const tokenSet = chunkTokensCache.get(idx);
                if (!tokenSet) continue;

                let score = 0;
                for (const qt of queryTerms) {
                    if (!tokenSet.has(qt)) continue;
                    const tokens = SemanticIndexService.tokenize(chunk);
                    const tf = tokens.filter((t) => t === qt).length;
                    const df = docFreq.get(qt) ?? 1;
                    const idf = Math.log((N + 1) / (df + 1));
                    score += tf * idf;
                }
                if (score === 0) continue;

                const existing = byPath.get(filePath);
                if (!existing || score > existing.score) {
                    byPath.set(filePath, { excerpt: chunk, score });
                }
            }

            // 4. Normalize scores 0-1, sort, return top-K
            const entries = Array.from(byPath.entries());
            const maxScore = entries.reduce((m, [, v]) => Math.max(m, v.score), 1);
            return entries
                .map(([filePath, v]) => ({ path: filePath, excerpt: v.excerpt, score: v.score / maxScore }))
                .sort((a, b) => b.score - a.score)
                .slice(0, topK);
        } catch {
            return [];
        }
    }

    /**
     * Return all indexed chunks for a specific file, sorted by chunk order.
     * Used by graph-augmented RAG to load linked-note context.
     */
    async getChunksByPath(filePath: string): Promise<string[]> {
        if (!this.knowledgeDB.isOpen()) return [];
        try {
            return this.vectorStore.getChunkTextsByPath(filePath);
        } catch {
            return [];
        }
    }

    /**
     * Search the index. Returns top-K most relevant chunks.
     * @param textForEmbedding - Optional override for what gets embedded (used by HyDE).
     *   When provided, this text is embedded instead of `query`.
     */
    async search(query: string, topK = 5, textForEmbedding?: string): Promise<SemanticResult[]> {
        if (!this.knowledgeDB.isOpen()) return [];
        try {
            const embedText = textForEmbedding ?? query;
            const [vector] = await this.embedBatch([embedText]);
            const results = this.vectorStore.searchUniqueFiles(vector, topK);
            return results.map((r) => ({
                path: r.path,
                excerpt: r.text,
                score: r.score,
            }));
        } catch (e) {
            console.error('[SemanticIndex] Search failed:', e);
            return [];
        }
    }

    /**
     * Index a session summary into the vector store.
     * Called after SessionExtractor saves a summary file.
     * Items are tagged with source='session' so they can be filtered separately.
     */
    async indexSessionSummary(sessionId: string, content: string): Promise<void> {
        if (!this.knowledgeDB.isOpen()) return;
        try {
            const chunks = this.splitIntoChunks(content, this.chunkSize);
            if (chunks.length === 0) return;

            const vectors = await this.embedBatch(chunks);
            this.vectorStore.insertChunks(`session:${sessionId}`, chunks, vectors, Date.now());
            this.knowledgeDB.markDirty();
            console.debug(`[SemanticIndex] Indexed session summary: ${sessionId} (${chunks.length} chunks)`);
        } catch (e) {
            console.warn(`[SemanticIndex] Failed to index session ${sessionId}:`, e);
        }
    }

    /**
     * Search only session summaries in the index.
     * Returns top-K results filtered to path prefix 'session:'.
     */
    async searchSessions(query: string, topK = 3): Promise<SemanticResult[]> {
        if (!this.knowledgeDB.isOpen()) return [];
        try {
            const [vector] = await this.embedBatch([query]);
            const results = this.vectorStore.searchUniqueFiles(vector, topK, 'session:');
            return results.map((r) => ({
                path: r.path,
                excerpt: r.text,
                score: r.score,
            }));
        } catch (e) {
            console.warn('[SemanticIndex] Session search failed:', e);
            return [];
        }
    }

    /**
     * Index a task episode for episodic memory retrieval (ADR-018).
     * Follows the same pattern as indexSessionSummary with source='episode'.
     */
    async indexEpisode(episodeId: string, content: string): Promise<void> {
        if (!this.knowledgeDB.isOpen()) return;
        try {
            const chunks = this.splitIntoChunks(content, this.chunkSize);
            if (chunks.length === 0) return;

            const vectors = await this.embedBatch(chunks);
            this.vectorStore.insertChunks(`episode:${episodeId}`, chunks, vectors, Date.now());
            this.knowledgeDB.markDirty();
        } catch (e) {
            console.warn(`[SemanticIndex] Failed to index episode ${episodeId}:`, e);
        }
    }

    /**
     * Search only task episodes in the index (ADR-018).
     * Returns top-K results filtered to path prefix 'episode:'.
     */
    async searchEpisodes(query: string, topK = 3): Promise<SemanticResult[]> {
        if (!this.knowledgeDB.isOpen()) return [];
        try {
            const [vector] = await this.embedBatch([query]);
            const results = this.vectorStore.searchUniqueFiles(vector, topK, 'episode:');
            return results.map((r) => ({
                path: r.path,
                excerpt: r.text,
                score: r.score,
            }));
        } catch (e) {
            console.warn('[SemanticIndex] Episode search failed:', e);
            return [];
        }
    }

    /** Delete the DB and reset state. */
    async deleteIndex(): Promise<void> {
        try {
            await this.knowledgeDB.deleteDB();
        } catch { /* non-fatal */ }
        this.builtAt = null;
        this.docCount = 0;
    }

    // -----------------------------------------------------------------------
    // Batch embedding
    // -----------------------------------------------------------------------

    /**
     * Embed an array of texts via the configured API embedding model.
     * Sends batches of `embeddingBatchSize` texts per request (10-50x fewer API calls).
     */
    private async embedBatch(texts: string[]): Promise<Float32Array[]> {
        if (texts.length === 0) return [];
        if (!this.embeddingModel) {
            throw new Error('No embedding model configured.');
        }

        const results: Float32Array[] = [];
        for (let i = 0; i < texts.length; i += this.embeddingBatchSize) {
            const batch = texts.slice(i, i + this.embeddingBatchSize);
            const vectors = await this.embedBatchViaApiWithRetry(batch, this.embeddingModel);
            results.push(...vectors);
            if (i + this.embeddingBatchSize < texts.length) {
                await this.sleep(50);
            }
        }
        return results;
    }

    private async embedBatchViaApiWithRetry(
        texts: string[],
        model: CustomModel,
        maxRetries = 4,
    ): Promise<Float32Array[]> {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await this.embedBatchViaApi(texts, model);
            } catch (e: unknown) {
                const err = e as Record<string, unknown> | null;
                const status = err?.status ?? err?.statusCode;
                const msg = String((err?.message as string) ?? e ?? '');
                const isRateLimit =
                    status === 429 ||
                    msg.includes('429') ||
                    msg.toLowerCase().includes('rate limit');
                if (isRateLimit && attempt < maxRetries - 1) {
                    const delay = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s, 8s
                    console.warn(`[SemanticIndex] Rate limited — retry in ${delay}ms`);
                    await this.sleep(delay);
                } else {
                    throw e;
                }
            }
        }
        throw new Error('[SemanticIndex] Max retries exceeded');
    }

    private async embedBatchViaApi(texts: string[], model: CustomModel): Promise<Float32Array[]> {
        let url: string;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        // OpenAI-compatible batch: input is an array of strings
        const body: Record<string, unknown> = { input: texts };

        if (model.provider === 'azure') {
            const base = (model.baseUrl ?? '').replace(/\/+$/, '');
            const apiVersion = model.apiVersion ?? '2024-10-21';
            url = `${base}/deployments/${model.name}/embeddings?api-version=${apiVersion}`;
            if (model.apiKey) headers['api-key'] = model.apiKey;
        } else if (model.provider === 'openai') {
            url = 'https://api.openai.com/v1/embeddings';
            body.model = model.name;
            if (model.apiKey) headers['Authorization'] = `Bearer ${model.apiKey}`;
        } else if (model.provider === 'openrouter') {
            url = 'https://openrouter.ai/api/v1/embeddings';
            body.model = model.name;
            if (model.apiKey) headers['Authorization'] = `Bearer ${model.apiKey}`;
        } else if (model.provider === 'ollama' || model.provider === 'lmstudio') {
            const base = (
                model.baseUrl ||
                (model.provider === 'lmstudio' ? 'http://localhost:1234' : 'http://localhost:11434')
            ).replace(/\/v1\/?$/, '').replace(/\/+$/, '');
            url = `${base}/v1/embeddings`;
            body.model = model.name;
            if (model.apiKey) headers['Authorization'] = `Bearer ${model.apiKey}`;
        } else {
            // custom provider
            const base = (model.baseUrl ?? '').replace(/\/+$/, '');
            url = `${base}/embeddings`;
            body.model = model.name;
            if (model.apiKey) headers['Authorization'] = `Bearer ${model.apiKey}`;
        }

        const TIMEOUT_MS = 30_000;
        const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`[SemanticIndex] API request timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS),
        );
        const res = await Promise.race([
            requestUrl({ url, method: 'POST', headers, body: JSON.stringify(body), throw: true }),
            timeoutPromise,
        ]);

        const data: Array<{ embedding: number[]; index: number }> = res.json?.data;
        if (!data || !Array.isArray(data)) {
            throw new Error(
                `[SemanticIndex] Invalid batch embedding response from ${model.provider}: ` +
                `missing data array`,
            );
        }
        // API returns items sorted by index — sort to be safe
        data.sort((a, b) => a.index - b.index);
        return data.map((d) => new Float32Array(d.embedding));
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // -----------------------------------------------------------------------
    // Checkpoint management (stored in KnowledgeDB checkpoint table)
    // -----------------------------------------------------------------------

    private saveCheckpointToDB(modelKey: string, docCount: number): void {
        this.knowledgeDB.setCheckpointValue('embeddingModel', modelKey);
        this.knowledgeDB.setCheckpointValue('chunkSize', String(this.chunkSize));
        this.knowledgeDB.setCheckpointValue('docCount', String(docCount));
        this.knowledgeDB.setCheckpointValue('builtAt', new Date().toISOString());
    }

    private modelKey(): string {
        if (!this.embeddingModel) return 'none';
        return `${this.embeddingModel.provider}:${this.embeddingModel.name}`;
    }

    // -----------------------------------------------------------------------
    // File reading (Markdown + PDF + Office documents)
    // -----------------------------------------------------------------------

    private static readonly BINARY_DOCUMENT_EXTENSIONS = new Set(['pdf', 'pptx', 'potx', 'xlsx', 'docx']);

    /**
     * Read a file's text content.
     * - Markdown/plaintext: uses vault.cachedRead (fast, cached)
     * - PDF/PPTX/XLSX/DOCX: extracts text via parseDocument (document-parsers module)
     */
    private async readFileContent(file: { path: string; extension: string }): Promise<string> {
        if (SemanticIndexService.BINARY_DOCUMENT_EXTENSIONS.has(file.extension)) {
            return this.extractDocumentText(file.path, file.extension);
        }
        // For all other types (md, txt, canvas, …) use the vault cache
        const vaultFile = this.vault.getFileByPath(file.path);
        if (!vaultFile) return '';
        return this.vault.cachedRead(vaultFile);
    }

    /**
     * Extract plain text from a binary document (PDF, PPTX, XLSX, DOCX).
     * Delegates to the shared parseDocument function (document-parsers module).
     * Returns empty string on parse errors (circuit breaker for PDF-specific failures).
     */
    private async extractDocumentText(filePath: string, extension: string): Promise<string> {
        try {
            const basePath = (this.vault.adapter as import('obsidian').FileSystemAdapter).getBasePath?.() ?? '';
            const absPath = path.join(basePath, filePath);
            const buffer = await fs.promises.readFile(absPath);

            const { parseDocument } = await import('../document-parsers/parseDocument');
            const result = await parseDocument(buffer.buffer, extension);
            return result.text;
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.includes('PasswordException') || msg.includes('InvalidPDFException')) {
                return '';
            }
            console.warn(`[SemanticIndex] Document extraction failed for ${filePath}:`, msg);
            return '';
        }
    }

    // -----------------------------------------------------------------------
    // Chunking
    // -----------------------------------------------------------------------

    /**
     * Split Markdown text into semantically meaningful chunks.
     *
     * Strategy (matches Obsidian Copilot's approach):
     *  1. Strip YAML frontmatter
     *  2. If whole note fits → single chunk (no splitting needed)
     *  3. Split at Markdown headings (##, ###, …)
     *  4. For oversized sections: split at paragraph boundaries (\n\n)
     *  5. For oversized paragraphs: hard split at maxChars
     */
    private splitIntoChunks(text: string, maxChars: number): string[] {
        // Extract YAML frontmatter content — keep the key:value lines so that
        // IDs, tags, and other frontmatter fields are searchable, but discard
        // the --- delimiters which carry no semantic meaning.
        let frontmatterContent = '';
        const bodyText = text.replace(/^---\n([\s\S]*?)\n---\n?/, (_, fm: string) => {
            frontmatterContent = fm.trim();
            return '';
        }).trim();

        // Prepend frontmatter (if any) to the body so IDs/tags appear in chunk 0
        const stripped = frontmatterContent ? `${frontmatterContent}\n\n${bodyText}` : bodyText;
        if (!stripped) return [];
        if (stripped.length <= maxChars) return [stripped];

        // Split at heading boundaries (keep heading with its content)
        const sections = stripped.split(/(?=^#{1,6} )/m);
        const result: string[] = [];

        for (const section of sections) {
            const trimmed = section.trim();
            if (!trimmed) continue;

            if (trimmed.length <= maxChars) {
                result.push(trimmed);
                continue;
            }

            // Section too large → split on paragraphs
            const paragraphs = trimmed.split(/\n\n+/);
            let current = '';
            for (const para of paragraphs) {
                if (!para.trim()) continue;
                if (current && current.length + para.length + 2 > maxChars) {
                    result.push(current.trim());
                    current = '';
                }
                if (para.length > maxChars) {
                    // Hard-split giant paragraph at word boundaries
                    if (current.trim()) result.push(current.trim());
                    current = '';
                    let i = 0;
                    while (i < para.length) {
                        let chunk = para.slice(i, i + maxChars);
                        if (i + maxChars < para.length) {
                            const b = Math.max(chunk.lastIndexOf(' '), chunk.lastIndexOf('\n'));
                            if (b > maxChars * 0.7) chunk = chunk.slice(0, b);
                        }
                        const t = chunk.trim();
                        if (t) result.push(t);
                        i += chunk.length || 1;
                    }
                } else {
                    current = current ? current + '\n\n' + para : para;
                }
            }
            if (current.trim()) result.push(current.trim());
        }

        const filtered = result.filter((c) => c.length > 0);

        // Add overlap: prepend the last 10% of the previous chunk to each
        // subsequent chunk so content at boundaries is not lost.
        const OVERLAP = Math.round(maxChars * 0.1);
        return filtered.map((chunk, i) => {
            if (i === 0) return chunk;
            const prev = filtered[i - 1];
            const tail = prev.slice(-OVERLAP).trim();
            if (!tail) return chunk;
            // Avoid duplicating content if the chunk already starts with the tail
            if (chunk.startsWith(tail)) return chunk;
            return `…${tail}\n\n${chunk}`;
        });
    }
}

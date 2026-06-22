/**
 * EmbeddingCache -- tiny LRU for selection-text embeddings (EPIC-33 Lookup-Enhancement).
 *
 * The inline magnifier is clicked repeatedly on the same selection
 * during exploration. Re-embedding identical text on every click
 * burns provider tokens. This LRU caches up to N selection
 * embeddings per panel session.
 *
 * Key is a stable hash of the trimmed selection text (FNV-1a, no
 * dependency on crypto). Values are number[] embeddings.
 *
 * Audit reference: vaultAudit gap "No caching of the selection
 * embedding -- clicking magnifier twice on the same selection
 * re-embeds. EmbeddingService offers a cache but the inline probe
 * goes directly to embedTexts which bypasses it."
 */

export interface EmbeddingCacheOptions {
    /** Maximum entries before LRU eviction. Default 16. */
    capacity?: number;
}

export class EmbeddingCache {
    private readonly capacity: number;
    private readonly map = new Map<string, number[]>();

    constructor(options: EmbeddingCacheOptions = {}) {
        this.capacity = Math.max(1, options.capacity ?? 16);
    }

    get(text: string): number[] | undefined {
        const key = hashText(text);
        const cached = this.map.get(key);
        if (cached === undefined) return undefined;
        // Re-insert to refresh LRU position.
        this.map.delete(key);
        this.map.set(key, cached);
        return cached;
    }

    set(text: string, embedding: number[]): void {
        if (embedding.length === 0) return;
        const key = hashText(text);
        if (this.map.has(key)) this.map.delete(key);
        this.map.set(key, embedding);
        while (this.map.size > this.capacity) {
            const oldestKey = this.map.keys().next().value;
            if (oldestKey === undefined) break;
            this.map.delete(oldestKey);
        }
    }

    clear(): void { this.map.clear(); }

    get size(): number { return this.map.size; }
}

function hashText(text: string): string {
    // FNV-1a 32-bit on the trimmed text. Sufficient for an in-session
    // cache; collisions are statistically irrelevant at N<=16.
    const trimmed = text.trim();
    let hash = 0x811c9dc5;
    for (let i = 0; i < trimmed.length; i += 1) {
        hash ^= trimmed.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0;
    }
    return `${trimmed.length}:${hash.toString(16)}`;
}

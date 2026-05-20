/**
 * RunSkillScriptCache -- in-memory LRU cache for compiled skill-script
 * bundles. Saves the cost of re-compiling the same JS source through
 * EsbuildWasm on every invocation. FEAT-29-06 Task B / ADR-126.
 *
 * Key derivation: a stable hash of (skill_name + '|' + script_name + '|'
 * + source-text). When the source-text changes the hash changes too, so
 * a stale cached bundle never resurfaces.
 *
 * LRU policy: JavaScript's Map preserves insertion order. On `get` of an
 * existing key we delete + re-set to move the entry to the most-recent
 * end. On `set` past the size cap we drop the first entry (oldest).
 *
 * Default capacity 20 -- typical vault has < 10 script-bundles in flight,
 * 20 leaves headroom for tail experiments without runaway memory.
 *
 * The hash function is FNV-1a over the source text. Cryptographic
 * strength is unnecessary; we only need a low-collision identity check.
 */

export interface RunSkillScriptCacheOptions {
    maxEntries?: number;
}

function fnv1aHash(input: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    // Force unsigned 32-bit, format as hex (8 chars).
    return (h >>> 0).toString(16).padStart(8, '0');
}

function makeKey(skillName: string, scriptName: string, sourceText: string): string {
    return `${skillName}|${scriptName}|${fnv1aHash(sourceText)}`;
}

export class RunSkillScriptCache {
    private readonly maxEntries: number;
    private readonly store: Map<string, string>;

    constructor(opts: RunSkillScriptCacheOptions = {}) {
        this.maxEntries = opts.maxEntries ?? 20;
        this.store = new Map<string, string>();
    }

    /** Lookup a previously compiled bundle. Returns null on miss or when
     *  the source-text hash no longer matches the stored entry. */
    get(skillName: string, scriptName: string, sourceText: string): string | null {
        const key = makeKey(skillName, scriptName, sourceText);
        const hit = this.store.get(key);
        if (hit === undefined) return null;
        // Move to most-recent end: delete + set with the same value.
        this.store.delete(key);
        this.store.set(key, hit);
        return hit;
    }

    /** Store a compiled bundle. Evicts the oldest entry when capacity is
     *  exceeded. Re-setting an existing key updates the value AND moves it
     *  to the most-recent end without growing the cache. */
    set(skillName: string, scriptName: string, sourceText: string, compiled: string): void {
        const key = makeKey(skillName, scriptName, sourceText);
        // Re-insertion pattern keeps LRU order tidy.
        if (this.store.has(key)) {
            this.store.delete(key);
        }
        this.store.set(key, compiled);
        // Drop the oldest if past cap.
        if (this.store.size > this.maxEntries) {
            const oldestKey = this.store.keys().next().value;
            if (oldestKey !== undefined) this.store.delete(oldestKey);
        }
    }

    /** Number of cached bundles. */
    size(): number {
        return this.store.size;
    }

    /** Drop everything. */
    clear(): void {
        this.store.clear();
    }
}

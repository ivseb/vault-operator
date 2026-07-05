/**
 * Learned model output caps (ADR-148 layer 3).
 *
 * When a provider rejects a request because max_tokens exceeds the model's
 * real output limit ("output-cap" 400), the loop learns that limit here
 * instead of failing the task. Caps persist in ONE JSON file in the GlobalFS
 * data root (same placement as inflight-tasks.json / price-catalog.json,
 * outside the vault, excluded from sync) and are injected into the model
 * registry via setLearnedOutputCaps — resolveOutputBudget then clamps every
 * later request, across tasks and plugin restarts. No deploy needed for new
 * models: the optimistic default (16k/32k) either works or is corrected once.
 *
 * Caps only ever get LOWER: a learned value reflects a provider rejection,
 * and raising it again would just re-trigger the 400.
 */

import { setLearnedOutputCaps, normalizeModelId } from '../../types/model-registry';

export const LEARNED_CAPS_FILE = 'learned-model-caps.json';

/** Never learn a cap below this — a smaller budget breaks tool-call turns. */
const MIN_LEARNED_CAP = 4_096;
/** INP-4: upper sanity bound — no real model output budget approaches this, so
 *  a larger persisted value means the file was tampered with; reject it. */
const MAX_LEARNED_CAP = 2_000_000;
/** INP-4: cap how many entries a persisted caps file may inject. */
const MAX_LEARNED_ENTRIES = 1_000;

interface LearnedCapsFile {
    caps: Record<string, number>;
}

export interface LearnedCapsFs {
    exists(path: string): Promise<boolean>;
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
}

/**
 * Module-level accessor so the loop can learn caps without threading the
 * store instance through the AgentTask constructor (same pattern as
 * setLivePriceCatalog). main.ts registers the instance at boot; when none is
 * registered (unit tests, early boot) learning is a silent no-op that still
 * returns the requested cap.
 */
let activeStore: LearnedCapsStore | null = null;

export function registerLearnedCapsStore(store: LearnedCapsStore | null): void {
    activeStore = store;
}

export async function learnOutputCap(modelId: string, cap: number): Promise<number> {
    if (!activeStore) return cap;
    return activeStore.learnCap(modelId, cap);
}

export class LearnedCapsStore {
    private caps: Record<string, number> = {};
    private loaded = false;

    constructor(private fs: LearnedCapsFs) {}

    /** Load persisted caps and inject them into the registry. Call at boot. */
    async load(): Promise<void> {
        try {
            if (await this.fs.exists(LEARNED_CAPS_FILE)) {
                const parsed = JSON.parse(await this.fs.read(LEARNED_CAPS_FILE)) as LearnedCapsFile;
                if (typeof parsed?.caps === 'object' && parsed.caps !== null) {
                    let count = 0;
                    for (const [id, cap] of Object.entries(parsed.caps)) {
                        // INP-3: never let a JSON key reach the prototype chain.
                        if (id === '__proto__' || id === 'constructor' || id === 'prototype') continue;
                        // INP-4: bound the entry count against an unbounded map.
                        if (++count > MAX_LEARNED_ENTRIES) break;
                        // INP-4: bound the value so a tampered file cannot inject
                        // an absurd cap (upper bound added to the existing lower).
                        if (typeof cap === 'number' && Number.isFinite(cap)
                            && cap >= MIN_LEARNED_CAP && cap <= MAX_LEARNED_CAP) {
                            this.caps[id] = Math.floor(cap);
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('[LearnedCaps] load failed (non-fatal):', e instanceof Error ? e.message : e);
        }
        this.loaded = true;
        setLearnedOutputCaps({ ...this.caps });
    }

    getCap(modelId: string): number | undefined {
        return this.caps[normalizeModelId(modelId)];
    }

    /**
     * Record a provider-confirmed output limit. Returns the effective cap.
     * Only lowers existing values; floors at MIN_LEARNED_CAP.
     */
    async learnCap(modelId: string, cap: number): Promise<number> {
        const id = normalizeModelId(modelId);
        const bounded = Math.max(MIN_LEARNED_CAP, Math.floor(cap));
        const existing = this.caps[id];
        const effective = existing !== undefined ? Math.min(existing, bounded) : bounded;
        if (effective !== existing) {
            this.caps[id] = effective;
            setLearnedOutputCaps({ ...this.caps });
            try {
                await this.fs.write(LEARNED_CAPS_FILE, JSON.stringify({ caps: this.caps } satisfies LearnedCapsFile));
            } catch (e) {
                console.warn('[LearnedCaps] persist failed (non-fatal):', e instanceof Error ? e.message : e);
            }
        }
        return effective;
    }
}

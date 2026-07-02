/**
 * In-flight task persistence (IMP-41-03-01, ADR-149).
 *
 * Running tasks used to exist only in memory: a plugin reload or Obsidian
 * crash mid-loop lost the entire turn (checkpoints cover files, not the
 * conversation). This store snapshots { loop state, history } at every turn
 * boundary into ONE JSON file in the GlobalFS data root (same placement as
 * price-catalog.json, outside the vault, excluded from sync). Clean task
 * ends clear their entry; the boot scan offers recovery for fresh entries
 * and sweeps stale ones.
 *
 * The snapshot never contains credentials; pending approvals are NOT
 * restored (fail-closed: they resume as rejected).
 */

import type { MessageParam } from '../../api/types';
import type { AgentLoopState } from './LoopState';

export const INFLIGHT_FILE = 'inflight-tasks.json';
const DEBOUNCE_MS = 2000;
export const INFLIGHT_MAX_AGE_MS = 24 * 3600 * 1000;

export interface InflightSnapshot {
    taskId: string;
    conversationId: string;
    mode: string;
    savedAt: number;
    state: AgentLoopState;
    history: MessageParam[];
}

interface InflightFile {
    tasks: Record<string, InflightSnapshot>;
}

export interface InflightFs {
    exists(path: string): Promise<boolean>;
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
}

export class InflightStore {
    private pending = new Map<string, InflightSnapshot>();
    private flushTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(private fs: InflightFs) {}

    /** Debounced snapshot write; the latest snapshot per task wins. */
    async saveSnapshot(snapshot: InflightSnapshot): Promise<void> {
        this.pending.set(snapshot.taskId, snapshot);
        if (this.flushTimer !== undefined) return;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = undefined;
            void this.flush();
        }, DEBOUNCE_MS);
    }

    /** Remove a task's snapshot (clean end, discard, resume consumed). */
    async clear(taskId: string): Promise<void> {
        this.pending.delete(taskId);
        const file = await this.load();
        if (!(taskId in file.tasks)) return;
        delete file.tasks[taskId];
        await this.persist(file);
    }

    /** Fresh-enough snapshots for the boot recovery banner; sweeps stale ones. */
    async listRecoverable(maxAgeMs: number = INFLIGHT_MAX_AGE_MS, now: number = Date.now()): Promise<InflightSnapshot[]> {
        const file = await this.load();
        const fresh: InflightSnapshot[] = [];
        let swept = false;
        for (const [taskId, snap] of Object.entries(file.tasks)) {
            if (now - snap.savedAt <= maxAgeMs) {
                fresh.push(snap);
            } else {
                delete file.tasks[taskId];
                swept = true;
            }
        }
        if (swept) await this.persist(file);
        return fresh.sort((a, b) => b.savedAt - a.savedAt);
    }

    private async flush(): Promise<void> {
        try {
            const file = await this.load();
            for (const [taskId, snap] of this.pending) {
                file.tasks[taskId] = snap;
            }
            this.pending.clear();
            await this.persist(file);
        } catch (e) {
            console.warn('[InflightStore] flush failed (non-fatal):', e instanceof Error ? e.message : e);
        }
    }

    private async load(): Promise<InflightFile> {
        try {
            if (!(await this.fs.exists(INFLIGHT_FILE))) return { tasks: {} };
            const parsed = JSON.parse(await this.fs.read(INFLIGHT_FILE)) as InflightFile;
            if (typeof parsed?.tasks !== 'object' || parsed.tasks === null) return { tasks: {} };
            return { tasks: parsed.tasks };
        } catch {
            return { tasks: {} };
        }
    }

    private async persist(file: InflightFile): Promise<void> {
        await this.fs.write(INFLIGHT_FILE, JSON.stringify(file));
    }
}

import { describe, it, expect } from 'vitest';
import { KnowledgeDB } from '../KnowledgeDB';

/**
 * Save-coalescing regression tests (2026-07-09 incident).
 *
 * Problem: index progress (756 -> 830 files) was lost on app reload.
 * Root Cause: save() silently no-ops while another save is in flight
 * (`this.saving` guard) and the debounced scheduleSave timer does not
 * re-arm. The in-flight save exported a snapshot taken BEFORE the
 * caller's writes, so `await knowledgeDB.save()` (e.g. buildIndex's
 * final checkpoint) returned without persisting anything.
 * Kette: markDirty -> Timer -> Save A laeuft (310 MB, Sekunden)
 *   -> zweiter save()-Aufruf waehrend A -> silent return
 *   -> dirty bleibt, kein Timer mehr -> Tail-Writes nur im RAM -> Reload -> weg.
 *
 * Contract under test: when save() resolves, every write made before
 * the call is on disk.
 */

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

interface KnowledgeDBPrivate {
    db: { export(): Uint8Array } | null;
    dirty: boolean;
    writeDB(data: Uint8Array): Promise<void>;
}

function makeTestDb(opts?: { failWrites?: boolean }) {
    const vault = { adapter: { getBasePath: () => '/tmp/kdb-save-test' } } as never;
    const kdb = new KnowledgeDB(vault, 'plugins/vault-operator', 'global', 'save-race-test.db', '/tmp/kdb-save-test-root');
    const priv = kdb as unknown as KnowledgeDBPrivate;

    // In-memory stand-in for the sql.js DB: export() snapshots `state`,
    // exactly like db.export() snapshots the in-memory database.
    let state = 0;
    const writes: number[] = [];
    priv.db = { export: () => new Uint8Array([state]) };
    priv.writeDB = async (data: Uint8Array) => {
        await sleep(30); // slow write, like the real 310 MB export + fs write
        if (opts?.failWrites) throw new Error('disk full');
        writes.push(data[0]);
    };

    return {
        kdb,
        /** Simulate a DB write: bump state + mark dirty (what markDirty does, sans timer). */
        write: (v: number) => { state = v; priv.dirty = true; },
        writes,
        priv,
    };
}

describe('KnowledgeDB save coalescing', () => {
    it('awaited save() persists writes that landed during an in-flight save', async () => {
        const { kdb, write, writes } = makeTestDb();

        write(1);
        const saveA = kdb.save();   // starts writing snapshot with state=1
        await sleep(5);             // saveA is mid-write
        write(2);                   // new data lands while saveA is writing
        await kdb.save();           // e.g. buildIndex's final `await save()`
        await saveA;

        // Contract: after the awaited save resolves, state=2 is durable.
        expect(writes[writes.length - 1]).toBe(2);
    });

    it('clears dirty only once the exported snapshot includes all writes', async () => {
        const { kdb, write, writes, priv } = makeTestDb();

        write(1);
        const saveA = kdb.save();
        await sleep(5);
        write(2);
        await Promise.all([kdb.save(), saveA]);

        expect(writes).toContain(2);
        expect(priv.dirty).toBe(false);
    });

    it('a failed write keeps dirty set so the next save retries', async () => {
        const { kdb, write, priv } = makeTestDb({ failWrites: true });

        write(1);
        await kdb.save();           // write throws; must not loop forever

        expect(priv.dirty).toBe(true);
    });

    it('no-ops when not dirty', async () => {
        const { kdb, writes } = makeTestDb();
        await kdb.save();
        expect(writes).toHaveLength(0);
    });
});

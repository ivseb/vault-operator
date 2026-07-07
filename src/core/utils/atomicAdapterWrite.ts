import type { DataAdapter } from 'obsidian';

/**
 * P0 (2026-07-05 data-loss). Atomic adapter write via a temp sibling + rename
 * so an interrupted write never leaves the primary file at 0 bytes.
 * adapter.write is a truncate-then-write (fs.writeFile, O_TRUNC) with no
 * temp+rename, so an interruption after the truncate zeroes the target. Uses
 * the Obsidian adapter (not raw fs) to stay mobile-compatible. On failure the
 * temp file is cleaned up and the existing target is left untouched.
 *
 * Shared by WriteFileTool (agent write_file) and the post-task review apply
 * path (FIX-01-07-04) -- every non-indexed (.obsidian/, agent folder) write
 * must go through here instead of a raw adapter.write.
 */
export async function atomicAdapterWrite(adapter: DataAdapter, safePath: string, content: string): Promise<void> {
    await atomicWriteWith(adapter, safePath, (tmpPath) => adapter.write(tmpPath, content));
}

/** Binary twin of atomicAdapterWrite; same temp sibling + rename contract. */
export async function atomicAdapterWriteBinary(adapter: DataAdapter, safePath: string, content: ArrayBuffer): Promise<void> {
    await atomicWriteWith(adapter, safePath, (tmpPath) => adapter.writeBinary(tmpPath, content));
}

async function atomicWriteWith(adapter: DataAdapter, safePath: string, stage: (tmpPath: string) => Promise<void>): Promise<void> {
    const tmpPath = `${safePath}.vo-tmp`;
    try {
        await stage(tmpPath);
    } catch (err) {
        // Staged write failed before it touched the target: drop the temp
        // file (best-effort) and surface the error; the target is intact.
        try { await adapter.remove(tmpPath); } catch { /* temp may not exist */ }
        throw err;
    }
    try {
        await adapter.rename(tmpPath, safePath);
    } catch {
        // Some platforms refuse rename onto an existing target. The full
        // content already lives in the temp file, so removing the stale
        // target first is safe: a crash in this narrow window leaves the
        // recoverable temp file, never a 0-byte primary.
        if (await adapter.exists(safePath)) {
            await adapter.remove(safePath);
        }
        await adapter.rename(tmpPath, safePath);
    }
}

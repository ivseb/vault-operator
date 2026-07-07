import { TFile, type App } from 'obsidian';
import { atomicAdapterWrite } from '../../core/utils/atomicAdapterWrite';
import { validateVaultRelativePath } from '../../core/tools/vault/pathValidation';

/**
 * FIX-01-07-04: index-independent read/write helpers for the post-task
 * review. The review previously read the after-state via vault.getFileByPath,
 * which returns null for dot-paths outside the vault index (.obsidian/, agent
 * folder). The modal then showed after='' and Apply wrote the empty string
 * back through a raw adapter.write -- zeroing a file the agent had just
 * written correctly (daily-briefing 0-byte incident #2, 2026-07-05).
 */

/**
 * Current on-disk content of a vault-relative path. Falls back to the
 * adapter for paths the vault index does not track. Returns null only when
 * the file does not exist at all.
 */
export async function readCurrentContent(app: App, filePath: string): Promise<string | null> {
    // AUDIT 2026-07-07 PTR-1: the adapter sink is the security-relevant
    // boundary (AUDIT-034 M-1 convention) -- revalidate here so no caller
    // can hand a traversal-laden string to adapter IO.
    const safePath = validateVaultRelativePath(filePath);
    if (!safePath) return null;
    const file = app.vault.getFileByPath(safePath);
    if (file) {
        return app.vault.read(file);
    }
    const adapter = app.vault.adapter;
    if (await adapter.exists(safePath)) {
        return adapter.read(safePath);
    }
    return null;
}

export interface ReviewDecisionInput {
    path: string;
    finalContent: string;
    skipped: boolean;
}

export interface ReviewApplyOutcome {
    /** Paths actually rewritten because the user changed the content. */
    written: string[];
    /** Decisions identical to the reviewed after-state; nothing to write. */
    skippedUnchanged: string[];
    /** Empty/whitespace overwrite of a non-empty file, refused. */
    guarded: string[];
    /** Paths whose write failed; error already logged. */
    failed: string[];
}

/**
 * Apply the user's review decisions. Only decisions that differ from the
 * reviewed after-state are written: an unchanged Apply must be a no-op, not
 * a rewrite (the rewrite is what turned a misread after-state into data
 * loss). Non-indexed paths go through the atomic temp+rename write; an
 * empty overwrite of a non-empty file is refused as defense-in-depth.
 */
export async function applyReviewDecisions(
    app: App,
    decisions: ReviewDecisionInput[],
    reviewedAfter: Map<string, string>,
): Promise<ReviewApplyOutcome> {
    const outcome: ReviewApplyOutcome = { written: [], skippedUnchanged: [], guarded: [], failed: [] };

    for (const d of decisions) {
        if (d.skipped === true) continue;
        if (reviewedAfter.get(d.path) === d.finalContent) {
            outcome.skippedUnchanged.push(d.path);
            continue;
        }
        // AUDIT 2026-07-07 PTR-1: revalidate at the sink (AUDIT-034 M-1
        // convention); a traversal-laden path must never reach adapter IO.
        const safePath = validateVaultRelativePath(d.path);
        if (!safePath) {
            console.error(`[PostTaskReview] Refusing decision with invalid path: ${d.path}`);
            outcome.failed.push(d.path);
            continue;
        }
        try {
            const current = await readCurrentContent(app, safePath);
            if (d.finalContent.trim() === '' && (current ?? '').trim() !== '') {
                console.warn(`[PostTaskReview] Refusing to overwrite non-empty file with empty content: ${safePath}`);
                outcome.guarded.push(d.path);
                continue;
            }

            const file = app.vault.getFileByPath(safePath);
            if (file instanceof TFile) {
                await app.vault.modify(file, d.finalContent);
                // Beat the CodeMirror stale-buffer cache that overwrites
                // vault.modify after the modal closes (FIX-01-07-03).
                const { refreshOpenMarkdownViewsFor } = await import('../../core/utils/refreshMarkdownView');
                await refreshOpenMarkdownViewsFor(app, file, d.finalContent);
            } else {
                await atomicAdapterWrite(app.vault.adapter, safePath, d.finalContent);
            }
            outcome.written.push(d.path);
        } catch (e) {
            console.error(`[PostTaskReview] Failed to apply decision for ${d.path}:`, e);
            outcome.failed.push(d.path);
        }
    }

    return outcome;
}

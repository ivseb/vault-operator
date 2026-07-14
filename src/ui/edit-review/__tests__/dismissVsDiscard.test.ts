/**
 * FIX-44-38: dismissing the post-task review must not equal "Revert all".
 *
 * Verified chain (adversarial review 2026-07-14): EditReviewModal.onClose
 * settled via opts.onDiscard on ANY dismissal (Esc, the X, the backdrop);
 * showEditReviewModal wired onDiscard to resolve({ decisions: null }); the
 * post-task review then treated decisions === null as "revert everything".
 * A user who merely closed the window lost the entire run's work.
 *
 * `decisions: null` was overloaded: for the PRE-write gate "dismiss = reject"
 * is correct (nothing gets written). For the POST-task review the same answer
 * is destructive. The result now carries the distinction explicitly:
 *
 *   outcome: 'applied' | 'discarded' | 'dismissed'
 *
 * The explicit discard button reports 'discarded'; any exit that never went
 * through a button reports 'dismissed'. Gate callers keep checking
 * `decisions` and stay fail-closed for both.
 */

import { describe, it, expect, vi } from 'vitest';

/** Captured hooks the modal hands to the panel. */
const hooks: { onApply?: (d: unknown[], meta?: { rememberForRun: boolean }) => void; onDiscard?: () => void } = {};

vi.mock('../EditReviewPanel', () => ({
    EditReviewPanel: class {
        constructor(opts: { onApply?: (d: unknown[]) => void; onDiscard?: () => void }) {
            hooks.onApply = opts.onApply;
            hooks.onDiscard = opts.onDiscard;
        }
        open() { return {}; }
        close() { /* no-op */ }
    },
}));

const ENTRY = { path: 'Notes/a.md', before: 'alt', after: 'neu' };
const DECISION = { path: 'Notes/a.md', finalContent: 'neu', skipped: false };

describe('FIX-44-38: dismissal is not a revert', () => {
    it('modal-level: onClose without a button answer calls onDismiss, never onDiscard', async () => {
        const { EditReviewModal } = await import('../EditReviewModal');
        const onDiscard = vi.fn();
        const onDismiss = vi.fn();

        const modal = new EditReviewModal({} as never, {
            entries: [ENTRY],
            mode: 'edit',
            onDiscard,
            onDismiss,
        });
        modal.open();
        modal.close(); // Esc / X / backdrop -- Obsidian's close path

        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(onDiscard).not.toHaveBeenCalled();
    });

    it('modal-level: the explicit discard button still reaches onDiscard, not onDismiss', async () => {
        const { EditReviewModal } = await import('../EditReviewModal');
        const onDiscard = vi.fn();
        const onDismiss = vi.fn();

        const modal = new EditReviewModal({} as never, {
            entries: [ENTRY],
            mode: 'edit',
            onDiscard,
            onDismiss,
        });
        modal.open();
        hooks.onDiscard?.(); // the panel's discard button

        expect(onDiscard).toHaveBeenCalledTimes(1);
        expect(onDismiss).not.toHaveBeenCalled();
    });

    it('modal-level: without onDismiss, onClose falls back to onDiscard (FIX-44-14 gate contract: a gate always answers)', async () => {
        const { EditReviewModal } = await import('../EditReviewModal');
        const onDiscard = vi.fn();

        const modal = new EditReviewModal({} as never, {
            entries: [ENTRY],
            mode: 'edit',
            onDiscard,
        });
        modal.open();
        modal.close();

        expect(onDiscard).toHaveBeenCalledTimes(1);
    });

    it("showEditReviewModal: the discard button resolves with outcome 'discarded' and decisions null", async () => {
        const { showEditReviewModal } = await import('../EditReviewModal');
        const p = showEditReviewModal({ app: {} as never, entries: [ENTRY] });
        hooks.onDiscard?.();
        const result = await p;
        expect(result.outcome).toBe('discarded');
        expect(result.decisions).toBeNull();
    });

    it("showEditReviewModal: apply resolves with outcome 'applied' and the decisions", async () => {
        const { showEditReviewModal } = await import('../EditReviewModal');
        const p = showEditReviewModal({ app: {} as never, entries: [ENTRY] });
        hooks.onApply?.([DECISION]);
        const result = await p;
        expect(result.outcome).toBe('applied');
        expect(result.decisions).toEqual([DECISION]);
    });

    it("showEditReviewModal: Esc / X / backdrop resolves with outcome 'dismissed' and decisions null", async () => {
        const obsidian = await import('obsidian');
        const openSpy = vi.spyOn(obsidian.Modal.prototype, 'open');
        const { showEditReviewModal } = await import('../EditReviewModal');

        const p = showEditReviewModal({ app: {} as never, entries: [ENTRY] });
        const instance = openSpy.mock.contexts.at(-1) as InstanceType<typeof obsidian.Modal>;
        instance.close(); // Obsidian's own close path, no button involved

        const result = await p;
        expect(result.outcome).toBe('dismissed');
        expect(result.decisions).toBeNull();
        openSpy.mockRestore();
    });
});

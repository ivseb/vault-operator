/**
 * FIX-44-14: closing the approval gate must never hang the agent loop.
 *
 * Since FEAT-44-10 the EditReviewModal IS the approval gate: the Pipeline awaits
 * its promise inside checkApproval, BEFORE the tool runs. `EditReviewModal.onClose`
 * called neither `onApply` nor `onDiscard`, and `showEditReviewModal` only ever
 * resolves from those two. So pressing Esc or clicking the X left the promise
 * pending forever -- and with it checkApproval, and with it the whole agent loop.
 *
 * The same defect existed before FEAT-44-10 but was survivable: the modal ran
 * post-task, so a never-resolving promise merely meant "no decisions applied".
 * Promoting it to the gate turned a leak into a deadlock.
 *
 * A gate that can be dismissed must always answer. Dismissal is a rejection.
 */

import { describe, it, expect, vi } from 'vitest';

/** Captured hooks the modal hands to the panel. */
const hooks: { onApply?: (d: unknown[]) => void; onDiscard?: () => void } = {};

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

const DECISION = { path: 'Notes/a.md', finalContent: 'neu', skipped: false };

describe('FIX-44-14: the approval gate always answers', () => {
    it('a dismissed modal (Esc / X) resolves as a rejection instead of hanging', async () => {
        const { EditReviewModal } = await import('../EditReviewModal');
        const settled: unknown[] = [];

        const modal = new EditReviewModal({} as never, {
            entries: [{ path: 'Notes/a.md', before: 'alt', after: 'neu' }],
            mode: 'edit',
            onApply: (d) => settled.push({ decisions: d }),
            onDiscard: () => settled.push({ decisions: null }),
        });

        modal.open();
        // Obsidian's own close path: Esc, the X, or clicking the backdrop. It
        // does NOT route through our buttons.
        modal.close();

        expect(settled).toEqual([{ decisions: null }]);
    });

    it('an apply wins, and the close it triggers does not turn it into a discard', async () => {
        const { EditReviewModal } = await import('../EditReviewModal');
        const settled: unknown[] = [];

        const modal = new EditReviewModal({} as never, {
            entries: [{ path: 'Notes/a.md', before: 'alt', after: 'neu' }],
            mode: 'edit',
            onApply: (d) => settled.push({ decisions: d }),
            onDiscard: () => settled.push({ decisions: null }),
        });

        modal.open();
        hooks.onApply?.([DECISION]);   // the panel's Apply button, which closes the modal

        expect(settled).toEqual([{ decisions: [DECISION] }]);
    });

    it('settles exactly once even if close is called repeatedly', async () => {
        const { EditReviewModal } = await import('../EditReviewModal');
        const settled: unknown[] = [];

        const modal = new EditReviewModal({} as never, {
            entries: [{ path: 'Notes/a.md', before: 'alt', after: 'neu' }],
            mode: 'edit',
            onApply: (d) => settled.push({ decisions: d }),
            onDiscard: () => settled.push({ decisions: null }),
        });

        modal.open();
        modal.close();
        modal.close();
        hooks.onDiscard?.();

        expect(settled).toHaveLength(1);
    });
});

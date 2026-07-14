/**
 * FEAT-44-02b: mapping from the batch gate's outcome (EditReviewModal
 * decisions) to the Pipeline's ApprovalResult, extracted pure so the
 * subset/reject edge cases are testable without the sidebar.
 *
 * Rules:
 * - discarded/dismissed (decisions null)   -> rejected
 * - every entry skipped                    -> rejected (nothing consented)
 * - all entries kept                       -> approved, NO approvedPaths
 *                                             (full planned scope)
 * - some skipped                           -> approved + approvedPaths subset
 * - scope buttons map to rememberForRun / rememberForSession as usual
 */

import { describe, it, expect } from 'vitest';
import { decideBatchApproval } from '../batchApprovalDecision';
import type { EditReviewResult } from '../EditReviewModal';

function applied(decisions: Array<{ path: string; skipped: boolean }>, extra: Partial<EditReviewResult> = {}): EditReviewResult {
    return {
        decisions: decisions.map((d) => ({ ...d, finalContent: '' })),
        outcome: 'applied',
        ...extra,
    };
}

describe('decideBatchApproval', () => {
    it('rejects when the gate was discarded or dismissed', () => {
        expect(decideBatchApproval({ decisions: null, outcome: 'discarded' }).decision).toBe('rejected');
        expect(decideBatchApproval({ decisions: null, outcome: 'dismissed' }).decision).toBe('rejected');
    });

    it('rejects when every entry was skipped', () => {
        const result = decideBatchApproval(applied([
            { path: 'a.md', skipped: true },
            { path: 'b.md', skipped: true },
        ]));
        expect(result.decision).toBe('rejected');
    });

    it('approves the full scope WITHOUT approvedPaths when nothing was skipped', () => {
        const result = decideBatchApproval(applied([
            { path: 'a.md', skipped: false },
            { path: 'b.md', skipped: false },
        ]));
        expect(result.decision).toBe('approved');
        expect(result.approvedPaths).toBeUndefined();
    });

    it('carries the un-skipped subset as approvedPaths', () => {
        const result = decideBatchApproval(applied([
            { path: 'a.md', skipped: false },
            { path: 'b.md', skipped: true },
            { path: 'c.md', skipped: false },
        ]));
        expect(result.decision).toBe('approved');
        expect(result.approvedPaths).toEqual(['a.md', 'c.md']);
    });

    it('maps the scope buttons onto the grant flags', () => {
        const run = decideBatchApproval(applied([{ path: 'a.md', skipped: false }], { rememberForRun: true }));
        expect(run.rememberForRun).toBe(true);
        const session = decideBatchApproval(applied([{ path: 'a.md', skipped: false }], { rememberForSession: true }));
        expect(session.rememberForSession).toBe(true);
    });

    it('never returns finalContent (the batch gate is read-only)', () => {
        const result = decideBatchApproval(applied([{ path: 'a.md', skipped: false }]));
        expect(result.finalContent).toBeUndefined();
    });
});

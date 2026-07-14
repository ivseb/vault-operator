/**
 * FIX-44-44 (review follow-up): the post-task review gate was ANDed with the
 * legacy six-tool write count (write_file/edit_file/append_to_file/
 * create_folder/delete_file/move_file). The tools that MOTIVATED FIX-44-44
 * (update_frontmatter, set_block_anchors, generate_canvas, create_base,
 * ingest_*, Office creators) are not in that list: a task whose only writes
 * came through them fired onUnreviewedWrite, created checkpoints, and still
 * never opened the review because taskWriteCount stayed 0.
 *
 * taskHadUnreviewedWrites already implies at least one successful write, so
 * the count conjunct was a strict narrowing that partially defeated the fix.
 * The undo bar keeps its legacy count-based behavior unchanged.
 */

import { describe, it, expect } from 'vitest';
import { decidePostTaskSurfaces } from '../postTaskReviewGate';

function state(overrides: Partial<Parameters<typeof decidePostTaskSurfaces>[0]> = {}) {
    return {
        taskWriteCount: 0,
        taskHadUnreviewedWrites: false,
        enableCheckpoints: true,
        hasRenderedCheckpoints: false,
        ...overrides,
    };
}

describe('decidePostTaskSurfaces: post-task review', () => {
    it('opens for unreviewed writes from tools OUTSIDE the legacy six-tool list (count 0)', () => {
        // e.g. a task whose only writes are auto-approved update_frontmatter
        // or set_block_anchors calls: onUnreviewedWrite fired, count stayed 0.
        const r = decidePostTaskSurfaces(state({ taskWriteCount: 0, taskHadUnreviewedWrites: true }));
        expect(r.showPostTaskReview).toBe(true);
    });

    it('opens for unreviewed writes from the classic CUD tools too', () => {
        const r = decidePostTaskSurfaces(state({ taskWriteCount: 3, taskHadUnreviewedWrites: true }));
        expect(r.showPostTaskReview).toBe(true);
    });

    it('stays closed when every write was individually diff-approved (FIX-44-16 lesson)', () => {
        const r = decidePostTaskSurfaces(state({ taskWriteCount: 3, taskHadUnreviewedWrites: false }));
        expect(r.showPostTaskReview).toBe(false);
    });

    it('stays closed for read-only tasks', () => {
        const r = decidePostTaskSurfaces(state());
        expect(r.showPostTaskReview).toBe(false);
    });

    it('stays closed when checkpoints are disabled (no undo data to review)', () => {
        const r = decidePostTaskSurfaces(state({ taskHadUnreviewedWrites: true, enableCheckpoints: false }));
        expect(r.showPostTaskReview).toBe(false);
    });
});

describe('decidePostTaskSurfaces: undo bar (legacy behavior unchanged)', () => {
    it('shows for counted writes when no inline markers rendered', () => {
        const r = decidePostTaskSurfaces(state({ taskWriteCount: 2 }));
        expect(r.showUndoBar).toBe(true);
    });

    it('hides once inline checkpoint markers rendered', () => {
        const r = decidePostTaskSurfaces(state({ taskWriteCount: 2, hasRenderedCheckpoints: true }));
        expect(r.showUndoBar).toBe(false);
    });

    it('stays count-based: unreviewed writes outside the six-tool list do not summon it', () => {
        const r = decidePostTaskSurfaces(state({ taskHadUnreviewedWrites: true }));
        expect(r.showUndoBar).toBe(false);
    });

    it('hides when checkpoints are disabled', () => {
        const r = decidePostTaskSurfaces(state({ taskWriteCount: 2, enableCheckpoints: false }));
        expect(r.showUndoBar).toBe(false);
    });
});

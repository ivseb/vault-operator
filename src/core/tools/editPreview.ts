/**
 * FEAT-44-10: the approval card for a note edit shows the real diff, BEFORE the
 * write.
 *
 * Until now the only diff the user ever saw was the post-task review, which
 * opens after every write has already landed. Its "reject" merely means "do not
 * apply my manual edits" -- the agent's version stays on disk. A UI that looks
 * like a gate but is not one is worse than no UI at all: it manufactures exactly
 * the false sense of control the approval system exists to provide for real.
 *
 * A tool that can say what it WOULD write, without writing, implements
 * {@link EditPreviewProvider}. The Pipeline hands that preview to the approval
 * callback, the sidebar renders it as a diff, and the write happens only if the
 * user says yes.
 */

/** What a tool would do, if approved. */
export interface EditPreview {
    /** Vault-relative path the tool would touch. */
    path: string;
    /** Current content on disk ('' when the file does not exist yet). */
    before: string;
    /** Content the tool would write ('' for a deletion). */
    after: string;
    /** True when the file does not exist yet. */
    isNew?: boolean;
    /**
     * True when the file is about to be trashed. `after` is '' and the gate
     * renders the whole of `before` as the loss the user is being asked to
     * accept. A deletion has no meaningful edited after-state, so the gate does
     * not honour one.
     */
    isDeleted?: boolean;
}

/**
 * Implemented by note-edit tools that can compute their result without writing.
 *
 * The contract is strict: `previewEdit` MUST return the exact content that
 * `execute` would write for the same input. A preview that differs from the
 * write turns the gate into a lie, which is the whole thing we are fixing.
 * `EditFileTool.previewMatchesExecute.test.ts` pins this.
 *
 * Return `null` when no preview can be produced (bad input, missing file). The
 * Pipeline then falls back to the plain approval card, never to no approval.
 */
export interface EditPreviewProvider {
    previewEdit(input: Record<string, unknown>): Promise<EditPreview | null>;
}

export function hasEditPreview(tool: unknown): tool is EditPreviewProvider {
    return typeof (tool as EditPreviewProvider)?.previewEdit === 'function';
}

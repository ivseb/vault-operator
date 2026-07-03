/**
 * Approval-card timeout wiring (IMP-41-01-02).
 *
 * showApprovalCard used to park the agent loop on an unresolved Promise with
 * no wall clock and no abort coupling: a walked-away user left the task (and
 * its provider session) pinned forever, and Stop during an open card still
 * required a second click on the card itself. This helper owns the timer and
 * abort listener; the card owns the DOM and resolves its Promise from the
 * callbacks.
 */

export interface ApprovalTimeoutHandle {
    dispose(): void;
}

export function wireApprovalTimeout(opts: {
    /** 0 disables the timeout entirely (legacy behaviour). */
    timeoutMs: number;
    abortSignal?: AbortSignal;
    onExpire: () => void;
    onAbort: () => void;
    /** Called once per second while 60 or fewer seconds remain. */
    onCountdownTick?: (remainingSec: number) => void;
}): ApprovalTimeoutHandle {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    let disposed = false;

    const dispose = (): void => {
        if (disposed) return;
        disposed = true;
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        if (intervalId !== undefined) clearInterval(intervalId);
        opts.abortSignal?.removeEventListener('abort', onAbortEvent);
    };

    const onAbortEvent = (): void => {
        dispose();
        opts.onAbort();
    };

    if (opts.abortSignal?.aborted) {
        disposed = true;
        opts.onAbort();
        return { dispose: () => { /* already settled */ } };
    }
    opts.abortSignal?.addEventListener('abort', onAbortEvent, { once: true });

    if (opts.timeoutMs > 0) {
        const expiresAt = Date.now() + opts.timeoutMs;
        timeoutId = setTimeout(() => {
            dispose();
            opts.onExpire();
        }, opts.timeoutMs);
        if (opts.onCountdownTick) {
            intervalId = setInterval(() => {
                const remainingSec = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
                if (remainingSec <= 60) opts.onCountdownTick?.(remainingSec);
            }, 1000);
        }
    }

    return { dispose };
}

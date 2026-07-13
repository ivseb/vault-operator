/**
 * ISandboxExecutor
 *
 * Strategy interface for sandbox code execution backends.
 * Desktop: ProcessSandboxExecutor (OS-level child_process.fork())
 * Mobile:  IframeSandboxExecutor (iframe sandbox="allow-scripts")
 *
 * Part of ADR-021: Sandbox OS-Level Process Isolation.
 */

export interface ISandboxExecutor {
    ensureReady(): Promise<void>;
    execute(compiledJs: string, input: Record<string, unknown>): Promise<unknown>;
    destroy(): void;

    /**
     * FIX-44-04: bind the governance task for the next execution so the bridge
     * can snapshot a checkpoint before every sandbox vault write. The sandbox
     * tools call this with their `context.taskId` before executing and with
     * `undefined` afterwards. Optional so lightweight executors need not implement it.
     */
    setGovernanceContext?(taskId: string | undefined): void;
}

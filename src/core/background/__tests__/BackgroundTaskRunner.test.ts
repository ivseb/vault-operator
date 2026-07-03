import { describe, it, expect, vi } from 'vitest';
import { BackgroundTaskRunner } from '../BackgroundTaskRunner';

/**
 * IMP-41-03-05: single-slot background task runner.
 *
 * Deliberately conservative: ONE background task at a time (a vault is a
 * shared write target), read-only via the research subagent profile, no
 * persistence across reloads. The runner owns slot state and abort; the
 * executor (injected — the real one wires AgentTaskRunner in main.ts) does
 * the actual agent work.
 */

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void } {
    let resolve!: (v: T) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

describe('BackgroundTaskRunner', () => {
    it('starts a task and reports active status', async () => {
        const gate = deferred<string>();
        const runner = new BackgroundTaskRunner(async () => gate.promise);
        const result = runner.start('research kant', 'Kant research');
        expect(result.ok).toBe(true);
        expect(runner.isActive()).toBe(true);
        expect(runner.getStatus()?.title).toBe('Kant research');
        gate.resolve('done');
        await vi.waitFor(() => expect(runner.isActive()).toBe(false));
    });

    it('rejects a second concurrent task (single slot)', () => {
        const gate = deferred<string>();
        const runner = new BackgroundTaskRunner(async () => gate.promise);
        expect(runner.start('one', 'One').ok).toBe(true);
        const second = runner.start('two', 'Two');
        expect(second.ok).toBe(false);
        if (!second.ok) expect(second.reason).toContain('already running');
    });

    it('frees the slot after completion and allows the next task', async () => {
        const runner = new BackgroundTaskRunner(async () => 'result');
        runner.start('one', 'One');
        await vi.waitFor(() => expect(runner.isActive()).toBe(false));
        expect(runner.start('two', 'Two').ok).toBe(true);
    });

    it('frees the slot when the executor throws', async () => {
        const runner = new BackgroundTaskRunner(async () => { throw new Error('boom'); });
        runner.start('one', 'One');
        await vi.waitFor(() => expect(runner.isActive()).toBe(false));
        expect(runner.getStatus()).toBeNull();
    });

    it('stop aborts the executor signal and frees the slot', async () => {
        let observedSignal: AbortSignal | undefined;
        const gate = deferred<string>();
        const runner = new BackgroundTaskRunner(async ({ abortSignal }) => {
            observedSignal = abortSignal;
            return gate.promise;
        });
        runner.start('one', 'One');
        expect(observedSignal?.aborted).toBe(false);
        runner.stop();
        expect(observedSignal?.aborted).toBe(true);
        gate.resolve('cancelled');
        await vi.waitFor(() => expect(runner.isActive()).toBe(false));
    });

    it('notifies change listeners on start and end', async () => {
        const changes: boolean[] = [];
        const runner = new BackgroundTaskRunner(async () => 'ok');
        runner.onChange((active) => changes.push(active));
        runner.start('one', 'One');
        await vi.waitFor(() => expect(runner.isActive()).toBe(false));
        expect(changes[0]).toBe(true);
        expect(changes[changes.length - 1]).toBe(false);
    });
});

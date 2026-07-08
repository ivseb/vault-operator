/**
 * agentBusyGate: pause background indexing/enrichment while an agent task is
 * running, so the boot-deferred reindex + the Haiku enrichment sidecar do not
 * compete with the task for the model provider (and the renderer thread).
 * General to every skill: any task run right after boot benefits.
 *
 * Resolves when the agent goes idle, or on a starvation deadline (so a
 * back-to-back-task marathon can never permanently starve indexing), or when
 * the pipeline is cancelled.
 */

import { describe, it, expect } from 'vitest';
import { waitWhileBusy } from '../agentBusyGate';

/** A controllable clock: sleep advances virtual time; now() reads it. */
function fakeClock() {
    let t = 0;
    return {
        now: () => t,
        sleep: (ms: number) => { t += ms; return Promise.resolve(); },
    };
}

describe('waitWhileBusy', () => {
    it('resolves immediately when the agent is not busy', async () => {
        const clock = fakeClock();
        let slept = 0;
        await waitWhileBusy(() => false, {
            maxWaitMs: 90_000, pollMs: 1000, now: clock.now,
            sleep: (ms) => { slept += ms; return clock.sleep(ms); },
        });
        expect(slept).toBe(0);
    });

    it('waits while busy and resolves once the agent goes idle', async () => {
        const clock = fakeClock();
        let polls = 0;
        // Busy for the first 3 polls, then idle.
        const isBusy = () => { return polls < 3; };
        await waitWhileBusy(isBusy, {
            maxWaitMs: 90_000, pollMs: 1000, now: clock.now,
            sleep: (ms) => { polls++; return clock.sleep(ms); },
        });
        expect(polls).toBe(3); // polled 3 times, then isBusy() returned false
        expect(clock.now()).toBe(3000);
    });

    it('resolves at the starvation deadline even if still busy', async () => {
        const clock = fakeClock();
        await waitWhileBusy(() => true, { // never idle
            maxWaitMs: 5000, pollMs: 1000, now: clock.now, sleep: clock.sleep,
        });
        // Stops once virtual time reaches the deadline; never blocks forever.
        expect(clock.now()).toBeGreaterThanOrEqual(5000);
        expect(clock.now()).toBeLessThan(7000);
    });

    it('resolves early when the pipeline is cancelled', async () => {
        const clock = fakeClock();
        let polls = 0;
        await waitWhileBusy(() => true, {
            maxWaitMs: 90_000, pollMs: 1000, now: clock.now,
            sleep: (ms) => { polls++; return clock.sleep(ms); },
            isCancelled: () => polls >= 2, // cancelled after 2 polls
        });
        expect(polls).toBe(2);
        expect(clock.now()).toBeLessThan(90_000);
    });
});

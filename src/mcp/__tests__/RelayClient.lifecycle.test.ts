/**
 * FIX-23-04-14: poll loop lifecycle under reconnect (review follow-up on
 * FIX-23-04-11, issue #53).
 *
 * disconnect() cannot abort an in-flight requestUrl. A connect() issued
 * while the previous loop's /poll is still parked at the relay starts a
 * second loop; when the old poll finally resolves, the old loop must exit
 * instead of re-entering (this.polling is true again for the NEW loop).
 * Before the generation guard both loops ran forever, continuously
 * superseding each other's parked poll at the DO and doubling quota use.
 * The 20s long-poll park window (FIX-23-04-11) made this pre-existing
 * race window twice as wide as the old 10s short-poll sleep.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requestUrlMock = vi.fn<(opts: unknown) => Promise<unknown>>();

vi.mock('obsidian', async (importOriginal) => {
    const actual = await importOriginal<typeof import('obsidian')>();
    return {
        ...actual,
        requestUrl: (opts: unknown) => requestUrlMock(opts),
    };
});

// RelayClient sleeps via window.setTimeout; vitest runs in a node env.
(globalThis as { window?: unknown }).window = globalThis;

import { RelayClient } from '../RelayClient';

interface PendingPoll {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
}

describe('RelayClient poll loop generation guard', () => {
    let polls: PendingPoll[];

    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, 'debug').mockImplementation(() => { /* silence */ });
        vi.spyOn(console, 'warn').mockImplementation(() => { /* silence */ });
        polls = [];
        requestUrlMock.mockReset();
        requestUrlMock.mockImplementation(() => new Promise((resolve, reject) => {
            polls.push({ resolve, reject });
        }));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('does not leave a zombie loop when connect() follows disconnect() during an in-flight poll', async () => {
        const client = new RelayClient({} as never);

        client.connect('https://relay.test', 'tok');
        await vi.advanceTimersByTimeAsync(0);
        expect(polls).toHaveLength(1);

        // Reconnect while poll #1 is still parked at the relay.
        client.disconnect();
        client.connect('https://relay.test', 'tok');
        await vi.advanceTimersByTimeAsync(0);
        expect(polls).toHaveLength(2);

        // Release the stale poll after 6s of (fake) elapsed time: that
        // looks like a long-poll release, so a zombie loop would re-poll
        // with zero delay.
        await vi.advanceTimersByTimeAsync(6_000);
        polls[0].resolve({ json: { requests: [] } });
        await vi.advanceTimersByTimeAsync(0);

        // Only the new loop's poll may be in flight; the stale loop must
        // have exited instead of issuing a third /poll.
        expect(polls).toHaveLength(2);
    });

    it('a stale loop failure does not clobber the connected state of the new loop', async () => {
        const client = new RelayClient({} as never);

        client.connect('https://relay.test', 'tok');
        await vi.advanceTimersByTimeAsync(0);
        client.disconnect();
        client.connect('https://relay.test', 'tok');
        await vi.advanceTimersByTimeAsync(0);
        expect(polls).toHaveLength(2);

        // New loop's poll succeeds fast and empty -> connected, 10s spacing.
        polls[1].resolve({ json: { requests: [] } });
        await vi.advanceTimersByTimeAsync(0);
        expect(client.connected).toBe(true);

        // Stale loop's poll rejects afterwards; without the generation
        // guard its catch path flips _connected back to false.
        polls[0].reject(new Error('socket closed'));
        await vi.advanceTimersByTimeAsync(0);
        expect(client.connected).toBe(true);
    });
});

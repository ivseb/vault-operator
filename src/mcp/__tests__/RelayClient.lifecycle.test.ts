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

    it('processes requests delivered to a superseded poll before the stale loop exits', async () => {
        // FIX-44-C2: the DO splices a batch off its queue when it answers a
        // parked poll. If that poll belongs to a superseded generation, the
        // guard used to discard the response wholesale -- the batch was
        // gone from the DO but never dispatched, so the external client
        // hung into a 504. Responding via /respond is generation-free, so
        // the stale loop must hand off the delivered work and only then exit.
        const respondCalls: { url: string; body: string }[] = [];
        requestUrlMock.mockImplementation((opts: unknown) => {
            const { url, body } = opts as { url: string; body?: string };
            if (url.endsWith('/respond')) {
                respondCalls.push({ url, body: body ?? '' });
                return Promise.resolve({ json: {} });
            }
            return new Promise((resolve, reject) => {
                polls.push({ resolve, reject });
            });
        });

        const client = new RelayClient({} as never);
        client.connect('https://relay.test', 'tok');
        await vi.advanceTimersByTimeAsync(0);
        client.disconnect();
        client.connect('https://relay.test', 'tok');
        await vi.advanceTimersByTimeAsync(0);
        expect(polls).toHaveLength(2);

        // The relay releases the STALE poll with a delivered batch.
        polls[0].resolve({
            json: {
                requests: [JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'initialize' })],
            },
        });
        await vi.advanceTimersByTimeAsync(0);

        // The delivered request must have been answered via /respond ...
        expect(respondCalls).toHaveLength(1);
        expect(respondCalls[0].body).toContain('"id":"7"');
        // ... while the stale loop still exits instead of double-polling.
        expect(polls).toHaveLength(2);
    });

    it('drops a batch delivered to a superseded poll when the relay URL changed', async () => {
        // Review finding (2026-07-14): the delivered-batch handoff above is
        // only safe when the reconnect kept the SAME relay + token (bridge
        // restart). When the user reconnects to a different relay, the batch
        // arrived under the OLD endpoint; executing it and POSTing the
        // result to the NEW relay would answer relay B with relay A's
        // correlation id, under a connection the user just abandoned.
        const respondCalls: { url: string; body: string }[] = [];
        const pollUrls: string[] = [];
        requestUrlMock.mockImplementation((opts: unknown) => {
            const { url, body } = opts as { url: string; body?: string };
            if (url.endsWith('/respond')) {
                respondCalls.push({ url, body: body ?? '' });
                return Promise.resolve({ json: {} });
            }
            pollUrls.push(url);
            return new Promise((resolve, reject) => {
                polls.push({ resolve, reject });
            });
        });

        const client = new RelayClient({} as never);
        client.connect('https://relay-a.test', 'tok');
        await vi.advanceTimersByTimeAsync(0);
        client.disconnect();
        client.connect('https://relay-b.test', 'tok');
        await vi.advanceTimersByTimeAsync(0);
        expect(polls).toHaveLength(2);
        expect(pollUrls).toEqual(['https://relay-a.test/poll', 'https://relay-b.test/poll']);

        // Relay A releases the stale poll with a delivered batch.
        polls[0].resolve({
            json: {
                requests: [JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'initialize' })],
            },
        });
        await vi.advanceTimersByTimeAsync(0);

        // The batch must be dropped: no dispatch, no /respond anywhere
        // (in particular none to relay B), and no third poll.
        expect(respondCalls).toHaveLength(0);
        expect(polls).toHaveLength(2);
    });

    it('drops a batch delivered to a superseded poll when the token was rotated', async () => {
        // Same relay, rotated token: the batch was delivered under a
        // credential the user just replaced (possibly revoked). Executing
        // requests (incl. write tools) under it must not happen.
        const respondCalls: { url: string; body: string }[] = [];
        requestUrlMock.mockImplementation((opts: unknown) => {
            const { url, body } = opts as { url: string; body?: string };
            if (url.endsWith('/respond')) {
                respondCalls.push({ url, body: body ?? '' });
                return Promise.resolve({ json: {} });
            }
            return new Promise((resolve, reject) => {
                polls.push({ resolve, reject });
            });
        });

        const client = new RelayClient({} as never);
        client.connect('https://relay.test', 'tok-old');
        await vi.advanceTimersByTimeAsync(0);
        client.disconnect();
        client.connect('https://relay.test', 'tok-new');
        await vi.advanceTimersByTimeAsync(0);
        expect(polls).toHaveLength(2);

        polls[0].resolve({
            json: {
                requests: [JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'initialize' })],
            },
        });
        await vi.advanceTimersByTimeAsync(0);

        expect(respondCalls).toHaveLength(0);
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

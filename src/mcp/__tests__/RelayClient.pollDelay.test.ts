/**
 * FIX-23-04-11: poll spacing decision for the long-poll relay (issue #53).
 *
 * The worker parks /poll up to ~20s. The client must re-poll immediately
 * after a long-poll response or after receiving requests, and only fall
 * back to the FIX-14-03-01 10s spacing when a legacy (not redeployed)
 * worker answers fast and empty. This keeps the free-plan quota at or
 * below today's level: idle long-polling is <= 180 polls/hour (4320/day)
 * versus 8640/day with the fixed 10s interval.
 */

import { describe, expect, it } from 'vitest';
import { computePollDelayMs } from '../RelayClient';

describe('computePollDelayMs', () => {
    it('re-polls immediately after a long-poll response (server parked the request)', () => {
        expect(computePollDelayMs(20_000, 0)).toBe(0);
    });

    it('re-polls immediately when requests were delivered, even on a fast response', () => {
        expect(computePollDelayMs(150, 2)).toBe(0);
    });

    it('falls back to the legacy 10s spacing on a fast empty response (worker not redeployed)', () => {
        expect(computePollDelayMs(150, 0)).toBe(10_000);
    });

    it('treats a response at the long-poll threshold as a long poll', () => {
        expect(computePollDelayMs(5_000, 0)).toBe(0);
    });
});

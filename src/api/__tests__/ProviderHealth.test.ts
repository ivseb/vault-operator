import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProviderHealth } from '../ProviderHealth';

/**
 * IMP-41-03-02 / ADR-146: circuit breaker per provider.
 *
 * Without health tracking a dead provider fails every request after a full
 * retry cycle. The breaker opens after repeated exhausted failures, fails
 * fast while open, lets one probe through after the half-open delay, and
 * ignores auth errors (a bad key is a configuration problem, not an outage).
 */

describe('ProviderHealth', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('starts closed and allows requests', () => {
        const health = new ProviderHealth();
        expect(health.canRequest('anthropic')).toBe(true);
        expect(health.getState('anthropic')).toBe('closed');
    });

    it('opens after 3 exhausted failures within the window', () => {
        const health = new ProviderHealth();
        health.reportFailure('anthropic', 'server');
        health.reportFailure('anthropic', 'network');
        expect(health.getState('anthropic')).toBe('closed');
        health.reportFailure('anthropic', 'server');
        expect(health.getState('anthropic')).toBe('open');
        expect(health.canRequest('anthropic')).toBe(false);
    });

    it('ignores auth and abort failures for breaker purposes', () => {
        const health = new ProviderHealth();
        for (let i = 0; i < 5; i++) {
            health.reportFailure('anthropic', 'auth');
            health.reportFailure('anthropic', 'abort');
        }
        expect(health.getState('anthropic')).toBe('closed');
    });

    it('half-opens after the probe delay and closes on success', () => {
        const health = new ProviderHealth();
        for (let i = 0; i < 3; i++) health.reportFailure('anthropic', 'server');
        expect(health.canRequest('anthropic')).toBe(false);

        vi.advanceTimersByTime(61_000);
        expect(health.getState('anthropic')).toBe('half-open');
        expect(health.canRequest('anthropic')).toBe(true);   // the probe
        expect(health.canRequest('anthropic')).toBe(false);  // only one probe

        health.reportSuccess('anthropic');
        expect(health.getState('anthropic')).toBe('closed');
        expect(health.canRequest('anthropic')).toBe(true);
    });

    it('re-opens when the probe fails', () => {
        const health = new ProviderHealth();
        for (let i = 0; i < 3; i++) health.reportFailure('anthropic', 'server');
        vi.advanceTimersByTime(61_000);
        expect(health.canRequest('anthropic')).toBe(true); // probe granted
        health.reportFailure('anthropic', 'server');
        expect(health.getState('anthropic')).toBe('open');
        expect(health.canRequest('anthropic')).toBe(false);
    });

    it('failure window expires: stale failures do not accumulate', () => {
        const health = new ProviderHealth();
        health.reportFailure('anthropic', 'server');
        vi.advanceTimersByTime(3 * 60_000); // beyond the 2min window
        health.reportFailure('anthropic', 'server');
        health.reportFailure('anthropic', 'server');
        expect(health.getState('anthropic')).toBe('closed'); // only 2 in window
    });

    it('tracks providers independently', () => {
        const health = new ProviderHealth();
        for (let i = 0; i < 3; i++) health.reportFailure('anthropic', 'server');
        expect(health.canRequest('anthropic')).toBe(false);
        expect(health.canRequest('openai')).toBe(true);
    });

    it('reports seconds until the next probe for the fail-fast message', () => {
        const health = new ProviderHealth();
        for (let i = 0; i < 3; i++) health.reportFailure('anthropic', 'server');
        const wait = health.secondsUntilProbe('anthropic');
        expect(wait).toBeGreaterThan(0);
        expect(wait).toBeLessThanOrEqual(60);
    });
});

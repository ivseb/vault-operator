/**
 * IMP-41-02-01b stage 3b: the engine owns the two condense triggers
 * (text-final and post-tool-batch) plus the shared FIX-COMPACT-06 retry
 * ladder that was duplicated verbatim in the inline loop. These tests pin
 * the gates, the FIX-PERF-20 cache-aware defer truth table, the halving
 * sequence 10k -> 5k -> 2.5k (floor 1k), FIX-COMPACT-02 (no retry after a
 * failed first pass) and the flush ordering incl. non-fatal rejection.
 */

import { describe, it, expect, vi } from 'vitest';
import { AgentLoopEngine, type CondensePorts } from '../AgentLoopEngine';
import { createInitialLoopState } from '../LoopState';
import type { MessageParam } from '../../../api/types';

const HISTORY: MessageParam[] = [{ role: 'user', content: 'x' }];

interface PortsHarness {
    ports: CondensePorts;
    calls: string[];
    condenseTails: Array<number | undefined>;
}

/** Context window 1000, threshold 70% -> 700. */
function makePorts(overrides: Partial<CondensePorts> = {}): PortsHarness {
    const calls: string[] = [];
    const condenseTails: Array<number | undefined> = [];
    const ports: CondensePorts = {
        condensingEnabled: true,
        thresholdPercent: 70,
        estimateTokens: vi.fn(() => { calls.push('estimate'); return 800; }),
        getContextWindow: () => 1000,
        microcompact: vi.fn(() => { calls.push('microcompact'); }),
        preCompactionFlush: vi.fn(async () => { calls.push('flush'); }),
        condense: vi.fn(async (_h, maxTail) => {
            calls.push('condense');
            condenseTails.push(maxTail);
            return true;
        }),
        rollingSummary: vi.fn(async () => { calls.push('rolling'); }),
        cacheAwareDeferEnabled: () => false,
        ...overrides,
    };
    return { ports, calls, condenseTails };
}

describe('AgentLoopEngine.maybeCondenseAtTextFinal', () => {
    it('always microcompacts but skips everything else on iteration 0', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        const { ports } = makePorts();

        await engine.maybeCondenseAtTextFinal(state, HISTORY, ports);

        expect(ports.microcompact).toHaveBeenCalledTimes(1);
        expect(ports.estimateTokens).not.toHaveBeenCalled();
        expect(ports.condense).not.toHaveBeenCalled();
    });

    it('skips when condensing is disabled', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        state.iteration = 3;
        const { ports } = makePorts({ condensingEnabled: false });

        await engine.maybeCondenseAtTextFinal(state, HISTORY, ports);

        expect(ports.microcompact).toHaveBeenCalledTimes(1);
        expect(ports.condense).not.toHaveBeenCalled();
    });

    it('does nothing below threshold', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        state.iteration = 3;
        const { ports } = makePorts({ estimateTokens: vi.fn(() => 600) });

        await engine.maybeCondenseAtTextFinal(state, HISTORY, ports);

        expect(ports.preCompactionFlush).not.toHaveBeenCalled();
        expect(ports.condense).not.toHaveBeenCalled();
    });

    it('flushes before condensing when over threshold, microcompact before the estimate', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        state.iteration = 3;
        const est = vi.fn()
            .mockReturnValueOnce(800)  // trigger check
            .mockReturnValue(500);     // post-condense: under threshold, no retry
        const { ports, calls, condenseTails } = makePorts({ estimateTokens: est });

        await engine.maybeCondenseAtTextFinal(state, HISTORY, ports);

        expect(calls[0]).toBe('microcompact');
        expect(calls.indexOf('flush')).toBeLessThan(calls.indexOf('condense'));
        expect(condenseTails).toEqual([undefined]); // first pass without tail override
    });

    it('FIX-PERF-20: defers when cache-aware is on, cache read beats creation and estimate is inside the 1.05 band', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        state.iteration = 3;
        state.totalCacheReadTokens = 100;
        state.totalCacheCreationTokens = 10;
        // 700 * 1.05 = 735; 720 is over threshold but inside the band -> defer.
        const { ports } = makePorts({
            estimateTokens: vi.fn(() => 720),
            cacheAwareDeferEnabled: () => true,
        });

        await engine.maybeCondenseAtTextFinal(state, HISTORY, ports);

        expect(ports.condense).not.toHaveBeenCalled();
        expect(ports.preCompactionFlush).not.toHaveBeenCalled();
    });

    it('FIX-PERF-20: condenses despite cache-aware flag when the estimate leaves the 1.05 band or cache does not win', async () => {
        const engine = new AgentLoopEngine();

        // Outside the band (740 >= 735): condense.
        const s1 = createInitialLoopState();
        s1.iteration = 3;
        s1.totalCacheReadTokens = 100;
        s1.totalCacheCreationTokens = 10;
        const h1 = makePorts({
            estimateTokens: vi.fn().mockReturnValueOnce(740).mockReturnValue(500),
            cacheAwareDeferEnabled: () => true,
        });
        await engine.maybeCondenseAtTextFinal(s1, HISTORY, h1.ports);
        expect(h1.ports.condense).toHaveBeenCalledTimes(1);

        // Cache does not win (read == 0): condense.
        const s2 = createInitialLoopState();
        s2.iteration = 3;
        const h2 = makePorts({
            estimateTokens: vi.fn().mockReturnValueOnce(720).mockReturnValue(500),
            cacheAwareDeferEnabled: () => true,
        });
        await engine.maybeCondenseAtTextFinal(s2, HISTORY, h2.ports);
        expect(h2.ports.condense).toHaveBeenCalledTimes(1);
    });

    it('FIX-COMPACT-06: halves the retry tail 10k -> 5k -> 2.5k while still over threshold', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        state.iteration = 3;
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { ports, condenseTails } = makePorts({
            estimateTokens: vi.fn(() => 800), // never drops under threshold
        });

        await engine.maybeCondenseAtTextFinal(state, HISTORY, ports);

        // First pass (no override), then MAX 2 retries with halved tails.
        expect(condenseTails).toEqual([undefined, 5000, 2500]);
        warnSpy.mockRestore();
    });

    it('FIX-COMPACT-02: a failed first pass never retries', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        state.iteration = 3;
        const { ports } = makePorts({
            condense: vi.fn(async () => false),
        });

        await engine.maybeCondenseAtTextFinal(state, HISTORY, ports);

        expect(ports.condense).toHaveBeenCalledTimes(1);
    });

    it('stops retrying once the estimate drops under the threshold', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        state.iteration = 3;
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const est = vi.fn()
            .mockReturnValueOnce(800) // trigger
            .mockReturnValueOnce(750) // retry 1 check: still over
            .mockReturnValue(600);    // retry 2 check: under -> stop
        const { ports, condenseTails } = makePorts({ estimateTokens: est });

        await engine.maybeCondenseAtTextFinal(state, HISTORY, ports);

        expect(condenseTails).toEqual([undefined, 5000]);
        warnSpy.mockRestore();
    });

    it('treats a rejecting flush as non-fatal and still condenses', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        state.iteration = 3;
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { ports } = makePorts({
            estimateTokens: vi.fn().mockReturnValueOnce(800).mockReturnValue(500),
            preCompactionFlush: vi.fn(async () => { throw new Error('flush broke'); }),
        });

        await engine.maybeCondenseAtTextFinal(state, HISTORY, ports);

        expect(ports.condense).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});

describe('AgentLoopEngine.maybeCondenseAfterToolBatch', () => {
    it('keeps the gate closed when completionResult is set (microcompact still runs)', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        state.iteration = 3;
        state.completionResult = 'done';
        const { ports } = makePorts();

        await engine.maybeCondenseAfterToolBatch(state, HISTORY, ports);

        expect(ports.microcompact).toHaveBeenCalledTimes(1);
        expect(ports.estimateTokens).not.toHaveBeenCalled();
        expect(ports.rollingSummary).not.toHaveBeenCalled();
    });

    it('condenses (flush first) when over threshold and never calls the rolling summary', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        state.iteration = 3;
        const { ports, calls } = makePorts({
            estimateTokens: vi.fn().mockReturnValueOnce(800).mockReturnValue(500),
        });

        await engine.maybeCondenseAfterToolBatch(state, HISTORY, ports);

        expect(calls.indexOf('flush')).toBeLessThan(calls.indexOf('condense'));
        expect(ports.rollingSummary).not.toHaveBeenCalled();
    });

    it('falls back to the rolling summary below threshold with the exact arguments', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        state.iteration = 3;
        const { ports } = makePorts({ estimateTokens: vi.fn(() => 600) });

        await engine.maybeCondenseAfterToolBatch(state, HISTORY, ports);

        expect(ports.condense).not.toHaveBeenCalled();
        expect(ports.rollingSummary).toHaveBeenCalledWith(HISTORY, 600, 700, 1000);
    });

    it('does nothing behind the iteration-0 gate (no cache-aware defer on this path)', async () => {
        const engine = new AgentLoopEngine();
        const state = createInitialLoopState();
        const { ports } = makePorts({ cacheAwareDeferEnabled: () => true });

        await engine.maybeCondenseAfterToolBatch(state, HISTORY, ports);

        expect(ports.estimateTokens).not.toHaveBeenCalled();
        expect(ports.condense).not.toHaveBeenCalled();
        expect(ports.rollingSummary).not.toHaveBeenCalled();
    });
});

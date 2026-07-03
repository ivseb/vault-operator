/**
 * IMP-41-02-01c contract v2: the ADR-061 FastPath pre-loop block as an
 * interceptor. Pins every gate in isolation (0.49/0.5 score edge,
 * successCount 2/3, non-learned source, chat-source regex, disabled
 * port), the success path (entries + completion hint in order, fired
 * flag, winner id) and the fail-open paths (zero tools executed,
 * executor throw).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastPathInterceptor, type FastPathPorts } from '../interceptors/FastPathInterceptor';
import type { RecipeMatchResult } from '../../mastery/RecipeMatchingService';
import type { FastPathResult } from '../../FastPathExecutor';
import type { RunStartContext } from '../interceptors/types';

let debugSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
    debugSpy.mockRestore();
    warnSpy.mockRestore();
});

function makeMatch(overrides: { score?: number; source?: string; successCount?: number } = {}): RecipeMatchResult {
    return {
        score: overrides.score ?? 0.8,
        recipe: {
            id: 'r-1',
            name: 'Knowledge Search & Synthesis',
            source: overrides.source ?? 'learned',
            successCount: overrides.successCount ?? 5,
        },
    } as unknown as RecipeMatchResult;
}

function makeResult(overrides: Partial<FastPathResult> = {}): FastPathResult {
    return {
        success: true,
        toolCallsExecuted: 3,
        historyEntries: [
            { role: 'assistant', content: 'ran tools' },
            { role: 'user', content: 'tool results' },
        ],
        ...overrides,
    } as FastPathResult;
}

function makePorts(overrides: Partial<FastPathPorts> = {}): FastPathPorts {
    return {
        enabled: () => true,
        getUserText: () => 'summarize my project notes',
        getRecipeMatches: () => [makeMatch()],
        executeRecipe: vi.fn(async () => makeResult()),
        ...overrides,
    };
}

const ctx: RunStartContext = { history: [], userMessageText: 'summarize my project notes' };

describe('FastPathInterceptor gates', () => {
    it('does nothing when disabled (no recipesSection or depth > 0)', async () => {
        const getRecipeMatches = vi.fn();
        const ports = makePorts({ enabled: () => false, getRecipeMatches });
        const interceptor = new FastPathInterceptor(ports);

        await interceptor.onRunStart(ctx);

        expect(getRecipeMatches).not.toHaveBeenCalled();
        expect(interceptor.fired()).toBe(false);
    });

    it('does nothing without a match', async () => {
        const ports = makePorts({ getRecipeMatches: () => [] });
        const interceptor = new FastPathInterceptor(ports);

        await interceptor.onRunStart(ctx);

        expect(ports.executeRecipe).not.toHaveBeenCalled();
    });

    it('skips chat-source queries even with a strong match', async () => {
        const ports = makePorts({ getUserText: () => 'search my chats for the deployment discussion' });
        const interceptor = new FastPathInterceptor(ports);

        await interceptor.onRunStart(ctx);

        expect(ports.executeRecipe).not.toHaveBeenCalled();
        expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('[FastPath] Skipped (chat-source query)'));
    });

    it('enforces the 0.5 score edge (FIX-F)', async () => {
        const p1 = makePorts({ getRecipeMatches: () => [makeMatch({ score: 0.49 })] });
        await new FastPathInterceptor(p1).onRunStart(ctx);
        expect(p1.executeRecipe).not.toHaveBeenCalled();

        const p2 = makePorts({ getRecipeMatches: () => [makeMatch({ score: 0.5 })] });
        await new FastPathInterceptor(p2).onRunStart(ctx);
        expect(p2.executeRecipe).toHaveBeenCalledTimes(1);
    });

    it('requires source=learned and successCount >= 3', async () => {
        const p1 = makePorts({ getRecipeMatches: () => [makeMatch({ source: 'user' })] });
        await new FastPathInterceptor(p1).onRunStart(ctx);
        expect(p1.executeRecipe).not.toHaveBeenCalled();

        const p2 = makePorts({ getRecipeMatches: () => [makeMatch({ successCount: 2 })] });
        await new FastPathInterceptor(p2).onRunStart(ctx);
        expect(p2.executeRecipe).not.toHaveBeenCalled();

        const p3 = makePorts({ getRecipeMatches: () => [makeMatch({ successCount: 3 })] });
        await new FastPathInterceptor(p3).onRunStart(ctx);
        expect(p3.executeRecipe).toHaveBeenCalledTimes(1);
    });
});

describe('FastPathInterceptor execution outcomes', () => {
    it('collects entries plus the completion hint in order and records the winner', async () => {
        const ports = makePorts();
        const interceptor = new FastPathInterceptor(ports);

        await interceptor.onRunStart(ctx);

        expect(interceptor.fired()).toBe(true);
        expect(interceptor.getRecipeWinnerId()).toBe('r-1');
        const entries = interceptor.getHistoryEntries();
        expect(entries).toHaveLength(3);
        expect(entries[0]).toMatchObject({ role: 'assistant' });
        expect(entries[2].role).toBe('user');
        expect(entries[2].content).toBe(
            '[Fast Path completed] The recipe "Knowledge Search & Synthesis" has been executed. '
            + '3 tool calls completed successfully. '
            + 'The search and read results are above. '
            + 'Now: analyze the results and complete the task (write summary, present findings). '
            + 'Do NOT re-search or re-read the same content -- use the results already in context.',
        );
    });

    it('does not fire when zero tools executed', async () => {
        const ports = makePorts({
            executeRecipe: vi.fn(async () => makeResult({ success: true, toolCallsExecuted: 0 })),
        });
        const interceptor = new FastPathInterceptor(ports);

        await interceptor.onRunStart(ctx);

        expect(interceptor.fired()).toBe(false);
        expect(interceptor.getHistoryEntries()).toEqual([]);
    });

    it('stays fail-open when the executor throws', async () => {
        const ports = makePorts({
            executeRecipe: vi.fn(async () => { throw new Error('planner exploded'); }),
        });
        const interceptor = new FastPathInterceptor(ports);

        await interceptor.onRunStart(ctx);

        expect(interceptor.fired()).toBe(false);
        expect(warnSpy).toHaveBeenCalledWith(
            '[FastPath] Pre-loop check failed (non-fatal), continuing with normal loop:',
            expect.any(Error),
        );
    });
});

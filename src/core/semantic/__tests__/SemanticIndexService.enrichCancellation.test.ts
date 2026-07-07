/**
 * AUDIT 2026-07-07 SEM-1 + SEM-2 regression tests.
 *
 * SEM-1: cancelEnrichment() reached neither the semaphore queue nor
 * in-flight calls -- queued context-prefix calls still performed their full
 * LLM round-trip after cancel (up to a whole 50-chunk batch at 6-way
 * concurrency).
 *
 * SEM-2: the 15 s timeout race settled generateContextPrefix and released
 * the semaphore slot, but no AbortSignal was passed to createMessage, so the
 * for-await kept consuming the stream (zombie streams escaping the cap).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Vault } from 'obsidian';
import { SemanticIndexService } from '../SemanticIndexService';
import type { KnowledgeDB } from '../../knowledge/KnowledgeDB';
import type { VectorStore } from '../../knowledge/VectorStore';
import type { ApiHandler } from '../../../api/types';

type PrivateService = {
    generateContextPrefix: (p: string) => Promise<string | null>;
    enrichmentCancelled: boolean;
    enrichmentAbortController: AbortController | null;
    contextualApiDisabledReason: string | null;
};

function makeService(handler: ApiHandler): SemanticIndexService {
    const knowledgeDB = {
        isOpen: () => true,
        getDB: () => ({ exec: () => [] }),
    } as unknown as KnowledgeDB;
    const vectorStore = {
        getAllChunks: () => [],
    } as unknown as VectorStore;
    const service = new SemanticIndexService({} as Vault, knowledgeDB, vectorStore, {
        enableContextualRetrieval: true,
    });
    service.setContextualApiHandler(handler);
    return service;
}

describe('SemanticIndexService enrichment cancellation (SEM-1 / SEM-2)', () => {
    beforeEach(() => {
        vi.stubGlobal('window', {
            setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number,
            clearTimeout: (id: number) => clearTimeout(id as unknown as NodeJS.Timeout),
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('SEM-1: queued calls abort when they acquire their slot after cancelEnrichment()', async () => {
        let streamsStarted = 0;
        const handler = {
            createMessage: (): AsyncGenerator<{ type: string; text: string }> => {
                streamsStarted++;
                return (async function* () {
                    await new Promise<void>((r) => setTimeout(r, 30));
                    yield { type: 'text', text: 'a context description longer than ten chars' };
                })();
            },
        } as unknown as ApiHandler;

        const service = makeService(handler);
        const priv = service as unknown as PrivateService;

        // Fire 10 calls: 6 acquire slots (enrichSemaphore cap), 4 queue.
        const calls = Array.from({ length: 10 }, () => priv.generateContextPrefix('prompt'));
        await new Promise<void>((r) => setTimeout(r, 5)); // let 6 start
        service.cancelEnrichment();
        await Promise.all(calls);

        // The 4 queued calls must NOT start their streams after cancel.
        expect(streamsStarted).toBe(6);
    });

    it('SEM-2: timeout aborts the underlying stream via AbortSignal (no zombie streams)', async () => {
        vi.useFakeTimers();
        let sawAbort = false;
        const handler = {
            createMessage: (
                _sys: string, _msgs: unknown[], _tools: unknown[], abortSignal?: AbortSignal,
            ): AsyncGenerator<{ type: string; text: string }> => {
                // eslint-disable-next-line require-yield -- endless stream that terminates only on abort; yielding would end the zombie scenario under test
                return (async function* () {
                    for (;;) {
                        if (abortSignal?.aborted) { sawAbort = true; return; }
                        await new Promise<void>((r) => setTimeout(r, 1000));
                    }
                })();
            },
        } as unknown as ApiHandler;

        const service = makeService(handler);
        const priv = service as unknown as PrivateService;

        const call = priv.generateContextPrefix('prompt');
        await vi.advanceTimersByTimeAsync(16_000); // past the 15 s timeout
        const result = await call;
        expect(result).toBeNull();
        // Let the generator observe the abort.
        await vi.advanceTimersByTimeAsync(1_100);
        expect(sawAbort).toBe(true);
    });

    it('SEM-1: cancelEnrichment() aborts IN-FLIGHT streams via the enrichment controller', async () => {
        let sawAbort = false;
        const handler = {
            createMessage: (
                _sys: string, _msgs: unknown[], _tools: unknown[], abortSignal?: AbortSignal,
            ): AsyncGenerator<{ type: string; text: string }> => {
                // eslint-disable-next-line require-yield -- endless stream that terminates only on abort; the in-flight cancel is the behaviour under test
                return (async function* () {
                    for (;;) {
                        if (abortSignal?.aborted) { sawAbort = true; return; }
                        await new Promise<void>((r) => setTimeout(r, 5));
                    }
                })();
            },
        } as unknown as ApiHandler;

        const service = makeService(handler);
        const priv = service as unknown as PrivateService;
        // runBackgroundEnrichment creates this controller; simulate its wiring.
        priv.enrichmentAbortController = new AbortController();

        const call = priv.generateContextPrefix('prompt');
        await new Promise<void>((r) => setTimeout(r, 10)); // stream in flight
        service.cancelEnrichment();
        expect(await call).toBeNull();
        await new Promise<void>((r) => setTimeout(r, 20));
        expect(sawAbort).toBe(true);
    });

    it('BUG-016 stays intact: a permanent 401 still disables contextual retrieval', async () => {
        const handler = {
            createMessage: (): AsyncGenerator<{ type: string; text: string }> => {
                // eslint-disable-next-line require-yield -- rejects before producing any chunk; the permanent-error path is the behaviour under test
                return (async function* () {
                    const err = new Error('invalid api key') as Error & { status: number };
                    err.status = 401;
                    throw err;
                })();
            },
        } as unknown as ApiHandler;

        const service = makeService(handler);
        const priv = service as unknown as PrivateService;
        expect(await priv.generateContextPrefix('prompt')).toBeNull();
        expect(priv.contextualApiDisabledReason).toBeTruthy();
    });
});

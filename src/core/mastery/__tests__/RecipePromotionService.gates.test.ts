import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecipePromotionService } from '../RecipePromotionService';
import type { RecipeStore } from '../RecipeStore';
import type { EpisodicExtractor, TaskEpisode } from '../EpisodicExtractor';
import type { ProceduralRecipe } from '../types';
import type { ApiHandler } from '../../../api/types';

/**
 * ADR-058 semantic recipe promotion: checkForPromotion(episode) promotes a
 * learned recipe once >= 3 semantically similar successful episodes exist
 * (current episode + 2 candidates from the EpisodicExtractor). Guarded by
 * getLearnedEnabled and the MAX_LEARNED_RECIPES cap.
 */

function makeStore(initial: ProceduralRecipe[] = []): {
    store: RecipeStore;
    saves: ProceduralRecipe[];
    increments: string[];
    saveSpy: ReturnType<typeof vi.fn>;
    incrementSpy: ReturnType<typeof vi.fn>;
} {
    const saves: ProceduralRecipe[] = [];
    const increments: string[] = [];
    const saveSpy = vi.fn(async (r: ProceduralRecipe) => {
        saves.push(r);
        initial.push(r);
    });
    const incrementSpy = vi.fn((id: string) => {
        increments.push(id);
    });
    const store = {
        getAll: () => initial,
        getById: (id: string) => initial.find((r) => r.id === id),
        save: saveSpy,
        incrementSuccess: incrementSpy,
    } as unknown as RecipeStore;
    return { store, saves, increments, saveSpy, incrementSpy };
}

function makeEpisode(overrides: Partial<TaskEpisode> = {}): TaskEpisode {
    return {
        id: overrides.id ?? 'ep-1',
        timestamp: '2026-06-07T00:00:00Z',
        userMessage: overrides.userMessage ?? 'do thing',
        mode: 'agent',
        toolSequence: overrides.toolSequence ?? [
            'search_files',
            'read_file',
            'write_file',
            'attempt_completion',
        ],
        toolLedger: '',
        success: overrides.success ?? true,
        resultSummary: overrides.resultSummary ?? 'ok',
    };
}

function makeExtractor(similar: TaskEpisode[] = []): EpisodicExtractor {
    return {
        findSimilarEpisodes: vi.fn(async () => similar),
    } as unknown as EpisodicExtractor;
}

// Minimal ApiHandler that streams a valid recipe JSON. The promotion LLM call
// expects { name, description, trigger, steps: [{tool, note}, ...] }.
function makeApi(): ApiHandler {
    const json = JSON.stringify({
        name: 'Search-Read-Write',
        description: 'searches files, reads them, writes a synthesis',
        trigger: 'search read write',
        steps: [
            { tool: 'search_files', note: 'find files' },
            { tool: 'read_file', note: 'read each' },
            { tool: 'write_file', note: 'emit synthesis' },
        ],
    });
    return {
        createMessage: async function* () {
            yield { type: 'text', text: json };
        },
    } as unknown as ApiHandler;
}

describe('RecipePromotionService promotion (ADR-058)', () => {
    let getApi: () => ApiHandler | null;
    beforeEach(() => {
        getApi = () => makeApi();
    });

    describe('ADR-058 semantic promotion', () => {
        it('promotes when enough semantically similar successful episodes exist', async () => {
            const similar = [
                makeEpisode({ id: 'ep-a', userMessage: 'do thing' }),
                makeEpisode({ id: 'ep-b', userMessage: 'do thing' }),
            ];
            const { store, saveSpy } = makeStore();
            const svc = new RecipePromotionService(store, getApi, () => true, makeExtractor(similar));
            await svc.checkForPromotion(makeEpisode());
            // ADR-058 path will fire promoteToRecipe (LLM call). saveSpy should be called.
            expect(saveSpy).toHaveBeenCalledTimes(1);
            expect(saveSpy.mock.calls[0][0].source).toBe('learned');
        });

        it('SKIPs when getLearnedEnabled returns false', async () => {
            const similar = [
                makeEpisode({ id: 'ep-a', userMessage: 'do thing' }),
                makeEpisode({ id: 'ep-b', userMessage: 'do thing' }),
            ];
            const { store, saveSpy } = makeStore();
            const svc = new RecipePromotionService(store, getApi, () => false, makeExtractor(similar));
            await svc.checkForPromotion(makeEpisode());
            expect(saveSpy).not.toHaveBeenCalled();
        });

        it('increments successCount on recipeWinner and skips promotion (recipe-win gate)', async () => {
            // Without the gate this fixture WOULD promote (2 similar episodes
            // + valid LLM JSON), so the assertions below prove the gate fires.
            const similar = [
                makeEpisode({ id: 'ep-a', userMessage: 'do thing' }),
                makeEpisode({ id: 'ep-b', userMessage: 'do thing' }),
            ];
            const { store, saveSpy, incrementSpy } = makeStore();
            const svc = new RecipePromotionService(store, getApi, () => true, makeExtractor(similar));
            await svc.checkForPromotion(makeEpisode(), 'learned-winner-1');
            expect(incrementSpy).toHaveBeenCalledExactlyOnceWith('learned-winner-1');
            expect(saveSpy).not.toHaveBeenCalled();
        });

        it('runs the normal ADR-058 path when recipeWinner is null', async () => {
            const similar = [
                makeEpisode({ id: 'ep-a', userMessage: 'do thing' }),
                makeEpisode({ id: 'ep-b', userMessage: 'do thing' }),
            ];
            const { store, saveSpy, incrementSpy } = makeStore();
            const svc = new RecipePromotionService(store, getApi, () => true, makeExtractor(similar));
            await svc.checkForPromotion(makeEpisode(), null);
            expect(incrementSpy).not.toHaveBeenCalled();
            expect(saveSpy).toHaveBeenCalledTimes(1);
        });

        it('SKIPs when MAX_LEARNED_RECIPES (50) is reached', async () => {
            const existing: ProceduralRecipe[] = Array.from({ length: 50 }, (_, i) => ({
                id: `learned-${i}`,
                name: `r${i}`,
                description: '',
                trigger: 'unrelated',
                steps: [],
                source: 'learned',
                schemaVersion: 1,
                successCount: 1,
                lastUsed: null,
                modes: [],
            }));
            const similar = [
                makeEpisode({ id: 'ep-a', userMessage: 'do thing' }),
                makeEpisode({ id: 'ep-b', userMessage: 'do thing' }),
            ];
            const { store, saveSpy } = makeStore(existing);
            const svc = new RecipePromotionService(store, getApi, () => true, makeExtractor(similar));
            await svc.checkForPromotion(makeEpisode());
            expect(saveSpy).not.toHaveBeenCalled();
        });
    });
});

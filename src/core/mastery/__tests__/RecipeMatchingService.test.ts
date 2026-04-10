import { describe, it, expect } from 'vitest';
import type { ProceduralRecipe } from '../types';
import type { RecipeStore } from '../RecipeStore';
import { RecipeMatchingService } from '../RecipeMatchingService';

// Minimal mock RecipeStore
function createMockStore(recipes: ProceduralRecipe[]): RecipeStore {
    return {
        getAll: (_mode?: string) => recipes,
        getById: (id: string) => recipes.find(r => r.id === id),
    } as RecipeStore;
}

function makeRecipe(overrides: Partial<ProceduralRecipe> = {}): ProceduralRecipe {
    return {
        id: overrides.id ?? 'test-recipe',
        name: overrides.name ?? 'Test Recipe',
        description: overrides.description ?? 'A test recipe for testing',
        trigger: overrides.trigger ?? 'test keyword trigger',
        steps: overrides.steps ?? [
            { tool: 'read_file', note: 'Read the file', params: {} },
        ],
        source: overrides.source ?? 'static',
        schemaVersion: overrides.schemaVersion ?? 1,
        successCount: overrides.successCount ?? 0,
        lastUsed: overrides.lastUsed ?? null,
        modes: overrides.modes ?? [],
    };
}

describe('RecipeMatchingService', () => {
    describe('match', () => {
        it('should return empty array when no recipes exist', () => {
            const service = new RecipeMatchingService(createMockStore([]));
            expect(service.match('test message')).toEqual([]);
        });

        it('should return empty array for empty message', () => {
            const service = new RecipeMatchingService(createMockStore([makeRecipe()]));
            expect(service.match('')).toEqual([]);
        });

        it('should match recipe by trigger keyword', () => {
            const recipe = makeRecipe({
                trigger: 'excalidraw drawing visualization',
            });
            const service = new RecipeMatchingService(createMockStore([recipe]));
            const results = service.match('Erstelle eine excalidraw Zeichnung');
            expect(results.length).toBe(1);
            expect(results[0].recipe.id).toBe('test-recipe');
        });

        it('should match with prefix matching for German word forms', () => {
            const recipe = makeRecipe({
                trigger: 'visualisierung erstellen zeichnung',
            });
            const service = new RecipeMatchingService(createMockStore([recipe]));
            // "visualisiert" shares prefix with "visualisierung" (>= 6 chars)
            const results = service.match('Ich habe das visualisiert');
            expect(results.length).toBe(1);
            expect(results[0].score).toBeGreaterThan(0);
        });

        it('should not match when no keywords overlap', () => {
            const recipe = makeRecipe({
                trigger: 'excalidraw drawing canvas',
            });
            const service = new RecipeMatchingService(createMockStore([recipe]));
            const results = service.match('Schreibe eine E-Mail');
            expect(results.length).toBe(0);
        });

        it('should return at most 3 results', () => {
            const recipes = Array.from({ length: 5 }, (_, i) =>
                makeRecipe({
                    id: `recipe-${i}`,
                    trigger: 'common keyword shared',
                    name: `Recipe ${i}`,
                }),
            );
            const service = new RecipeMatchingService(createMockStore(recipes));
            const results = service.match('Ich brauche das common keyword shared Feature');
            expect(results.length).toBeLessThanOrEqual(3);
        });

        it('should sort by score descending', () => {
            const recipes = [
                makeRecipe({ id: 'low', trigger: 'alpha beta gamma delta epsilon zeta' }),
                makeRecipe({ id: 'high', trigger: 'alpha beta' }),
            ];
            const service = new RecipeMatchingService(createMockStore(recipes));
            const results = service.match('alpha beta test');
            // 'high' should score higher (2/2 = 1.0 vs 2/6 = 0.33)
            if (results.length >= 2) {
                expect(results[0].recipe.id).toBe('high');
            }
        });
    });

    describe('buildPromptSection', () => {
        it('should return empty string for no matches', () => {
            const service = new RecipeMatchingService(createMockStore([]));
            expect(service.buildPromptSection([])).toBe('');
        });

        it('should include recipe name and steps', () => {
            const recipe = makeRecipe({
                name: 'Excalidraw Drawing',
                description: 'Create drawings',
                steps: [
                    { tool: 'read_file', note: 'Read template', params: {} },
                    { tool: 'write_file', note: 'Write result', params: {} },
                ],
            });
            const result = new RecipeMatchingService(createMockStore([])).buildPromptSection([
                { recipe, score: 0.5 },
            ]);
            expect(result).toContain('Excalidraw Drawing');
            expect(result).toContain('Create drawings');
            expect(result).toContain('read_file');
            expect(result).toContain('write_file');
            expect(result).toContain('PROCEDURAL RECIPES');
        });

        it('should mark conditional steps', () => {
            const recipe = makeRecipe({
                steps: [
                    { tool: 'search', note: 'Search first', params: {}, conditional: true },
                ],
            });
            const result = new RecipeMatchingService(createMockStore([])).buildPromptSection([
                { recipe, score: 0.5 },
            ]);
            expect(result).toContain('[if needed]');
        });
    });
});

/**
 * RecipePromotionService — Promotes recurring tool-sequence patterns to learned recipes.
 *
 * After each episode is recorded, this service checks whether the tool-sequence
 * pattern has appeared 3+ times successfully. If so, it uses one LLM call
 * (memory model) to generate a recipe description and trigger keywords,
 * then saves the result via RecipeStore.
 *
 * FEATURE-1505: Migrated from JSON files to MemoryDB (SQLite).
 * ADR-018: Episodic Task Memory — Promotion zu Rezepten
 */

import type { FileAdapter } from '../storage/types';
import type { MemoryDB } from '../knowledge/MemoryDB';
import type { RecipeStore } from './RecipeStore';
import type { TaskEpisode } from './EpisodicExtractor';
import type { ProceduralRecipe } from './types';
import type { ApiHandler } from '../../api/types';
import { SCHEMA_VERSION } from './staticRecipes';

/** Minimum successful occurrences of a pattern before promotion. */
const PROMOTION_THRESHOLD = 3;

interface PatternEntry {
    patternKey: string;
    toolSequence: string[];
    episodes: Array<{ userMessage: string; resultSummary: string }>;
    successCount: number;
}

export class RecipePromotionService {
    private fs: FileAdapter;
    private memoryDB: MemoryDB | null;
    private store: RecipeStore;
    private getApi: () => ApiHandler | null;
    private getLearnedEnabled: () => boolean;
    private patternsDir: string;

    constructor(
        fs: FileAdapter,
        store: RecipeStore,
        getApi: () => ApiHandler | null,
        getLearnedEnabled?: () => boolean,
        memoryDB?: MemoryDB | null,
    ) {
        this.fs = fs;
        this.memoryDB = memoryDB ?? null;
        this.store = store;
        this.getApi = getApi;
        this.getLearnedEnabled = getLearnedEnabled ?? (() => true);
        this.patternsDir = 'patterns';
    }

    async initialize(): Promise<void> {
        if (!this.memoryDB?.isOpen()) {
            const exists = await this.fs.exists(this.patternsDir);
            if (!exists) await this.fs.mkdir(this.patternsDir);
        }
        // One-time migration from files to DB
        if (this.memoryDB?.isOpen()) {
            await this.migrateFromFiles();
        }
    }

    /**
     * Check if an episode's tool-sequence pattern qualifies for promotion.
     * Called after each episode is recorded (fire-and-forget).
     */
    async checkForPromotion(episode: TaskEpisode): Promise<void> {
        if (!this.getLearnedEnabled()) return;
        if (!episode.success) return;
        if (episode.toolSequence.length < 2) return;

        const patternKey = this.makePatternKey(episode.toolSequence);

        // Check if already promoted as a recipe
        const existingRecipe = this.store.getById(`learned-${patternKey}`);
        if (existingRecipe) {
            this.store.incrementSuccess(existingRecipe.id);
            return;
        }

        // Load or create pattern tracker
        const pattern = await this.loadPattern(patternKey, episode.toolSequence);
        pattern.episodes.push({
            userMessage: episode.userMessage.slice(0, 200),
            resultSummary: episode.resultSummary.slice(0, 200),
        });
        pattern.successCount++;

        // Persist updated pattern
        await this.savePattern(pattern);

        // Check threshold
        if (pattern.successCount >= PROMOTION_THRESHOLD) {
            await this.promoteToRecipe(pattern);
        }
    }

    /**
     * Promote a pattern to a learned recipe using one LLM call.
     */
    private async promoteToRecipe(pattern: PatternEntry): Promise<void> {
        const api = this.getApi();
        if (!api) {
            console.warn('[RecipePromotion] No API available for promotion LLM call');
            return;
        }

        try {
            const exampleMessages = pattern.episodes
                .slice(-3)
                .map((e) => `- "${e.userMessage}" => ${e.resultSummary}`)
                .join('\n');

            const systemPrompt = 'You are a recipe generator. Given a tool sequence pattern and example uses, generate a JSON recipe. Respond ONLY with valid JSON, no markdown.';
            const userPrompt = `Tool sequence pattern: ${pattern.toolSequence.join(' -> ')}

Example uses:
${exampleMessages}

Generate a JSON object with:
- "name": Short recipe name (max 40 chars)
- "description": One sentence describing what this recipe does (max 100 chars)
- "trigger": Pipe-separated keywords for matching (max 8 keywords)
- "steps": Array of {tool, note} objects for each tool in the sequence`;

            let responseText = '';
            for await (const chunk of api.createMessage(systemPrompt, [
                { role: 'user', content: userPrompt },
            ], [], undefined)) {
                if (chunk.type === 'text') responseText += chunk.text;
            }

            // Parse LLM response (M-9: type-guarded validation)
            const raw: unknown = JSON.parse(responseText.trim());
            if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
                console.warn('[RecipePromotion] LLM response is not an object, skipping');
                return;
            }
            const parsed = raw as Record<string, unknown>;
            if (typeof parsed.name !== 'string' || typeof parsed.trigger !== 'string' || !Array.isArray(parsed.steps)) {
                console.warn('[RecipePromotion] Invalid LLM response structure, skipping');
                return;
            }
            const validSteps = (parsed.steps as unknown[]).filter(
                (s): s is { tool: string; note: string } =>
                    typeof s === 'object' && s !== null &&
                    typeof (s as Record<string, unknown>).tool === 'string' &&
                    typeof (s as Record<string, unknown>).note === 'string',
            );
            if (validSteps.length === 0) {
                console.warn('[RecipePromotion] No valid steps in LLM response, skipping');
                return;
            }

            const recipe: ProceduralRecipe = {
                id: `learned-${pattern.patternKey}`,
                name: parsed.name.slice(0, 40),
                description: typeof parsed.description === 'string' ? parsed.description.slice(0, 100) : '',
                trigger: parsed.trigger.slice(0, 200),
                steps: validSteps.map((s) => ({
                    tool: String(s.tool),
                    note: String(s.note),
                })),
                source: 'learned',
                schemaVersion: SCHEMA_VERSION,
                successCount: pattern.successCount,
                lastUsed: new Date().toISOString(),
                modes: [],
            };

            await this.store.save(recipe);
            console.debug(`[RecipePromotion] Promoted pattern to recipe: ${recipe.name}`);

            // Clean up pattern tracker
            await this.deletePattern(pattern.patternKey);
        } catch (e) {
            console.warn('[RecipePromotion] Promotion failed:', e);
        }
    }

    private makePatternKey(toolSequence: string[]): string {
        return toolSequence.join('-').replace(/[^a-z0-9_-]/gi, '').slice(0, 80);
    }

    // -----------------------------------------------------------------------
    // Pattern persistence (DB or files)
    // -----------------------------------------------------------------------

    private async loadPattern(key: string, toolSequence: string[]): Promise<PatternEntry> {
        if (this.memoryDB?.isOpen()) {
            return this.loadPatternFromDB(key, toolSequence);
        }
        return this.loadPatternFromFile(key, toolSequence);
    }

    private async savePattern(pattern: PatternEntry): Promise<void> {
        if (this.memoryDB?.isOpen()) {
            this.savePatternToDB(pattern);
            return;
        }
        await this.savePatternToFile(pattern);
    }

    private async deletePattern(key: string): Promise<void> {
        if (this.memoryDB?.isOpen()) {
            this.deletePatternFromDB(key);
            return;
        }
        await this.deletePatternFromFile(key);
    }

    // -----------------------------------------------------------------------
    // DB operations
    // -----------------------------------------------------------------------

    private loadPatternFromDB(key: string, toolSequence: string[]): PatternEntry {
        const db = this.memoryDB!.getDB();
        const result = db.exec('SELECT tool_sequence, episodes, success_count FROM patterns WHERE pattern_key = ?', [key]);
        if (result.length === 0 || result[0].values.length === 0) {
            return { patternKey: key, toolSequence, episodes: [], successCount: 0 };
        }
        const row = result[0].values[0];
        return {
            patternKey: key,
            toolSequence: JSON.parse((row[0] as string) ?? '[]'),
            episodes: JSON.parse((row[1] as string) ?? '[]'),
            successCount: (row[2] as number) ?? 0,
        };
    }

    private savePatternToDB(pattern: PatternEntry): void {
        const db = this.memoryDB!.getDB();
        db.run(
            `INSERT OR REPLACE INTO patterns (pattern_key, tool_sequence, episodes, success_count) VALUES (?, ?, ?, ?)`,
            [pattern.patternKey, JSON.stringify(pattern.toolSequence), JSON.stringify(pattern.episodes), pattern.successCount],
        );
        this.memoryDB!.markDirty();
    }

    private deletePatternFromDB(key: string): void {
        const db = this.memoryDB!.getDB();
        db.run('DELETE FROM patterns WHERE pattern_key = ?', [key]);
        this.memoryDB!.markDirty();
    }

    // -----------------------------------------------------------------------
    // Legacy file operations
    // -----------------------------------------------------------------------

    private async loadPatternFromFile(key: string, toolSequence: string[]): Promise<PatternEntry> {
        const filePath = `${this.patternsDir}/${key}.json`;
        try {
            const exists = await this.fs.exists(filePath);
            if (exists) {
                const raw = await this.fs.read(filePath);
                return JSON.parse(raw) as PatternEntry;
            }
        } catch { /* fall through */ }
        return { patternKey: key, toolSequence, episodes: [], successCount: 0 };
    }

    private async savePatternToFile(pattern: PatternEntry): Promise<void> {
        const filePath = `${this.patternsDir}/${pattern.patternKey}.json`;
        await this.fs.write(filePath, JSON.stringify(pattern, null, 2));
    }

    private async deletePatternFromFile(key: string): Promise<void> {
        const filePath = `${this.patternsDir}/${key}.json`;
        try {
            const exists = await this.fs.exists(filePath);
            if (exists) await this.fs.remove(filePath);
        } catch { /* non-fatal */ }
    }

    /** One-time migration: import pattern files into DB. */
    private async migrateFromFiles(): Promise<void> {
        try {
            const exists = await this.fs.exists(this.patternsDir);
            if (!exists) return;
            const listing = await this.fs.list(this.patternsDir);
            const jsonFiles = listing.files.filter((f: string) => f.endsWith('.json'));
            if (jsonFiles.length === 0) return;

            // Check if DB already has patterns (avoid double migration)
            const dbCount = this.memoryDB!.getDB().exec('SELECT COUNT(*) FROM patterns');
            if (dbCount.length > 0 && (dbCount[0].values[0][0] as number) > 0) return;

            let migrated = 0;
            for (const file of jsonFiles) {
                try {
                    const raw = await this.fs.read(file);
                    const pattern = JSON.parse(raw) as PatternEntry;
                    if (pattern.patternKey) {
                        this.savePatternToDB(pattern);
                        migrated++;
                    }
                } catch { /* skip corrupt */ }
            }

            if (migrated > 0) {
                await this.memoryDB!.save();
                console.debug(`[RecipePromotion] Migrated ${migrated} patterns from JSON files to DB`);
            }
        } catch (e) {
            console.warn('[RecipePromotion] Migration failed (non-fatal):', e);
        }
    }
}

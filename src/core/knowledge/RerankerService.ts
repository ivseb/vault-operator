/**
 * RerankerService -- Local cross-encoder reranking via transformers.js (WASM).
 *
 * Uses Xenova/ms-marco-MiniLM-L-6-v2 to re-score query+document pairs.
 * Pure JS + WASM — no native addon, no electron-rebuild, no external API calls.
 * Model is downloaded from HuggingFace Hub on first use and cached locally.
 *
 * ADR-052: Local Reranker Integration (transformers.js)
 * FEATURE-1504: Local Reranking
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RerankCandidate {
    path: string;
    text: string;
    score: number;
}

export interface RerankResult extends RerankCandidate {
    rerankScore: number;
}

// ---------------------------------------------------------------------------
// RerankerService
// ---------------------------------------------------------------------------

const MODEL_ID = 'Xenova/ms-marco-MiniLM-L-6-v2';

export class RerankerService {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- transformers.js types are dynamic
    private model: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- transformers.js types are dynamic
    private tokenizer: any = null;
    private _loading = false;
    private _loaded = false;

    /** Whether the model is loaded and ready for inference. */
    get isLoaded(): boolean { return this._loaded; }

    /** Whether the model is currently being loaded. */
    get isLoading(): boolean { return this._loading; }

    /**
     * Load the cross-encoder model and tokenizer.
     * Downloads from HuggingFace Hub on first call (~23MB), cached locally after.
     * Typically takes 2-5s on first load, <1s on subsequent loads (cached).
     */
    async loadModel(): Promise<void> {
        if (this._loaded || this._loading) return;
        this._loading = true;

        try {
            const { AutoModelForSequenceClassification, AutoTokenizer, env } = await import('@huggingface/transformers');

            // Force WASM backend (Electron may incorrectly detect as Node.js)
            if (env.backends?.onnx?.wasm) {
                env.backends.onnx.wasm.numThreads = Math.min(4, navigator?.hardwareConcurrency ?? 4);
            }

            console.debug(`[Reranker] Loading model ${MODEL_ID}...`);
            const startTime = Date.now();

            this.tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
            this.model = await AutoModelForSequenceClassification.from_pretrained(MODEL_ID, {
                dtype: 'q8', // INT8 quantized model (~23MB)
            });

            this._loaded = true;
            console.debug(`[Reranker] Model loaded in ${Date.now() - startTime}ms`);
        } catch (e) {
            console.warn('[Reranker] Failed to load model:', e);
            this._loaded = false;
        } finally {
            this._loading = false;
        }
    }

    /** Unload the model to free memory. */
    unload(): void {
        this.model = null;
        this.tokenizer = null;
        this._loaded = false;
    }

    /**
     * Rerank candidates using the cross-encoder model.
     * Each candidate is scored jointly with the query (not independently).
     *
     * @param query - The search query
     * @param candidates - Candidates from previous pipeline stages
     * @param topK - Max results to return (default: all)
     * @returns Candidates sorted by rerankScore (descending)
     */
    async rerank(query: string, candidates: RerankCandidate[], topK?: number): Promise<RerankResult[]> {
        if (!this._loaded) {
            // Lazy load on first rerank call
            await this.loadModel();
            if (!this._loaded) return candidates.map(c => ({ ...c, rerankScore: c.score }));
        }

        if (candidates.length === 0) return [];

        const startTime = Date.now();

        try {
            const results: RerankResult[] = [];

            for (const candidate of candidates) {
                // Truncate long texts to fit model's max sequence length (512 tokens)
                const text = candidate.text.slice(0, 1500);
                const inputs = await this.tokenizer(query, { text_pair: text, padding: true, truncation: true });
                const output = await this.model(inputs);

                // Extract logit and convert to score via sigmoid
                const logit = output.logits.data[0] as number;
                const rerankScore = 1 / (1 + Math.exp(-logit)); // sigmoid

                results.push({ ...candidate, rerankScore });
            }

            results.sort((a, b) => b.rerankScore - a.rerankScore);

            console.debug(`[Reranker] Reranked ${candidates.length} candidates in ${Date.now() - startTime}ms`);

            return topK ? results.slice(0, topK) : results;
        } catch (e) {
            console.warn('[Reranker] Reranking failed, returning original order:', e);
            return candidates.map(c => ({ ...c, rerankScore: c.score }));
        }
    }
}

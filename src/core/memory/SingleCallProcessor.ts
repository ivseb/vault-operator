/**
 * SingleCallProcessor -- runs SingleCallExtractor + FactIntegrator end-to-end.
 *
 * Phase 4 (FEATURE-0318 / PLAN-007 task C.1). Replaces the old
 * SessionExtractor + LongTermExtractor pair behind one queue
 * processor: read delta state, run one tool-call, write facts +
 * session summary + new delta state.
 *
 * The processor is intentionally thin -- it stitches engine modules
 * together but does no I/O of its own beyond the MemoryService and
 * MemoryDB handles it already holds.
 *
 * Constructor-Injection only (host wires CustomModel + ApiHandler factory).
 */

import type { CustomModel } from '../../types/settings';
import { buildApiHandlerForModel } from '../../api/index';
import type { MemoryService } from './MemoryService';
import type { MemoryDB } from '../knowledge/MemoryDB';
import type { EmbeddingService } from './EmbeddingService';
import type { SemanticIndexService } from '../semantic/SemanticIndexService';
import { FactStore } from './FactStore';
import { EdgeStore } from './EdgeStore';
import { ThreadDeltaStore } from './ThreadDeltaStore';
import { FactIntegrator } from './FactIntegrator';
import { SingleCallExtractor, type SingleCallMessage } from './SingleCallExtractor';
import type { PendingExtraction } from './ExtractionQueue';

export interface SingleCallProcessorDeps {
    memoryService: MemoryService;
    memoryDB: MemoryDB;
    embeddingService: EmbeddingService | null;
    getMemoryModel: () => CustomModel | null;
    /** Optional -- session summaries get indexed when provided + initialized. */
    getSemanticIndex?: () => SemanticIndexService | null;
}

export class SingleCallProcessor {
    constructor(private readonly deps: SingleCallProcessorDeps) {}

    async process(item: PendingExtraction): Promise<void> {
        const model = this.deps.getMemoryModel();
        if (!model) {
            console.warn('[SingleCall] No memory model configured, skipping extraction');
            return;
        }
        if (!this.deps.memoryDB.isOpen()) {
            console.warn('[SingleCall] memoryDB not open, skipping extraction');
            return;
        }
        if (!Array.isArray(item.messages) || item.messages.length === 0) {
            console.debug('[SingleCall] Empty messages, skipping');
            return;
        }

        const threadId = item.conversationId;
        const factStore = new FactStore(this.deps.memoryDB);
        const edgeStore = new EdgeStore(this.deps.memoryDB);
        const deltaStore = new ThreadDeltaStore(this.deps.memoryDB);
        const integrator = new FactIntegrator(
            factStore, edgeStore, this.deps.memoryDB, this.deps.embeddingService,
        );

        const messages: SingleCallMessage[] = item.messages.map((m, i) => ({
            role: m.role,
            text: m.text,
            index: i,
        }));

        const delta = deltaStore.get(threadId);
        const startMessageIndex = (delta?.lastExtractedMessageIndex ?? -1) + 1;
        if (startMessageIndex >= messages.length) {
            console.debug(`[SingleCall] ${threadId}: nothing new to extract`);
            return;
        }

        const api = buildApiHandlerForModel(model);
        const extractor = new SingleCallExtractor(api);
        const result = await extractor.extract({
            messages,
            startMessageIndex,
            conversationSoFar: delta?.deltaSummary ?? undefined,
        });

        if (result.facts.length > 0) {
            await integrator.integrate({
                facts: result.facts,
                mentions: result.mentions,
                sessionId: threadId,
                threadId,
            });
        }

        if (result.sessionSummary.trim().length > 0) {
            await this.deps.memoryService.writeSessionSummary(
                threadId,
                result.sessionSummary,
                item.title,
            );
            const semanticIndex = this.deps.getSemanticIndex?.();
            if (semanticIndex?.isIndexed) {
                await semanticIndex.indexSessionSummary(threadId, result.sessionSummary).catch((e) =>
                    console.warn('[SingleCall] Semantic indexing failed (non-fatal):', e),
                );
            }
        }

        deltaStore.save({
            threadId,
            lastExtractedMessageIndex: result.lastMessageIndex,
            deltaSummary: result.conversationSoFar || delta?.deltaSummary || null,
        });

        console.debug(
            `[SingleCall] ${threadId}: ${result.facts.length} facts (${result.rejected.length} rejected), ` +
            `drift=${result.topicDriftDetected}, tokens=${result.usage?.inputTokens ?? '?'}/${result.usage?.outputTokens ?? '?'}`,
        );
    }
}

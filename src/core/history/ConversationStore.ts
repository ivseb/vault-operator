/**
 * ConversationStore
 *
 * Persistence layer for chat conversations.
 * Stores conversations as JSON files in global storage with an in-memory index
 * for fast listing (no disk I/O for list operations).
 *
 * Storage: ~/.obsidian-agent/history/
 *   - index.json         — conversation metadata index
 *   - {id}.json          — individual conversation data
 */

import type { FileAdapter } from '../../core/storage/types';
import type { MessageParam } from '../../api/types';
import type { SourceInterface } from '../memory/SourceInterface';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationMeta {
    id: string;
    title: string;
    created: string;
    updated: string;
    messageCount: number;
    mode: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    /**
     * BA-26 / FEAT-23-04: chat surface this conversation came from.
     * Optional for backward-compat with conversations created before
     * Cross-Surface MCP. Reads default to 'obsilo' when missing.
     */
    sourceInterface?: SourceInterface;
    /**
     * BA-26 / FEAT-23-04: gating state for Manual-Sync-Mode.
     * 'pending' conversations are visible in the History sidebar but
     * not picked up by the ExtractionQueue until they get confirmed
     * (Star-click, mark_for_memory, save_to_memory parallel call).
     * Default 'confirmed' for backward-compat.
     */
    syncState?: 'pending' | 'confirmed' | 'rejected';
}

export interface UiMessage {
    role: 'user' | 'assistant';
    text: string;
    ts: string;
    /**
     * Serialised HTML of the assistant's collapsed "Steps" block (tool
     * calls + grouped operations) captured when the turn finished.
     * Re-injected on conversation reload so the user can still expand
     * the actions even after switching chats. Optional -- older
     * messages and turns without tool calls omit it.
     */
    toolStepsHtml?: string;
}

export interface ConversationData {
    meta: ConversationMeta;
    messages: MessageParam[];
    uiMessages: UiMessage[];
}

interface ConversationIndex {
    version: number;
    conversations: ConversationMeta[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10); // "2026-02-20"
    const hex = Math.random().toString(16).slice(2, 8); // "a1b2c3"
    return `${date}-${hex}`;
}

// ---------------------------------------------------------------------------
// ConversationStore
// ---------------------------------------------------------------------------

export class ConversationStore {
    private dir: string;
    private indexPath: string;
    private index: ConversationIndex = { version: 1, conversations: [] };

    constructor(private fs: FileAdapter) {
        this.dir = 'history';
        this.indexPath = 'history/index.json';
    }

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    async initialize(): Promise<void> {
        await this.ensureDir();
        await this.loadIndex();
    }

    // -----------------------------------------------------------------------
    // CRUD
    // -----------------------------------------------------------------------

    /**
     * Create a new conversation and return its id.
     *
     * BA-26 / FEAT-23-04: optional source-tagging + sync-state for
     * Cross-Surface MCP. Default values keep backward-compat with
     * Obsilo-internal call sites that pass only mode + model.
     */
    async create(
        mode: string,
        model: string,
        opts?: { sourceInterface?: SourceInterface; syncState?: 'pending' | 'confirmed' | 'rejected' },
    ): Promise<string> {
        const id = generateId();
        const now = new Date().toISOString();
        const meta: ConversationMeta = {
            id,
            title: 'New Conversation',
            created: now,
            updated: now,
            messageCount: 0,
            mode,
            model,
            inputTokens: 0,
            outputTokens: 0,
            sourceInterface: opts?.sourceInterface,
            syncState: opts?.syncState,
        };
        this.index.conversations.unshift(meta);
        await this.saveIndex();
        return id;
    }

    /**
     * BA-26 / FEAT-23-03: list conversations filtered by source.
     * Pass `undefined` to get the full list. Conversations without an
     * explicit sourceInterface tag are treated as 'obsilo'.
     */
    listBySource(source: SourceInterface | undefined): ConversationMeta[] {
        if (!source) return this.list();
        return this.index.conversations.filter((c) =>
            (c.sourceInterface ?? 'obsilo') === source
        );
    }

    /**
     * BA-26 / FEAT-23-04: confirm a pending conversation. Idempotent.
     * Returns true on a state change (pending -> confirmed), false
     * if the row was already confirmed or unknown.
     */
    async confirm(id: string): Promise<boolean> {
        const meta = this.getMeta(id);
        if (!meta) return false;
        if ((meta.syncState ?? 'confirmed') === 'confirmed') return false;
        meta.syncState = 'confirmed';
        await this.saveIndex();
        return true;
    }

    /** Save (overwrite) full conversation data. */
    async save(id: string, messages: MessageParam[], uiMessages: UiMessage[]): Promise<void> {
        const meta = this.getMeta(id);
        if (!meta) return;

        meta.updated = new Date().toISOString();
        meta.messageCount = uiMessages.length;

        const data: ConversationData = { meta, messages, uiMessages };
        const filePath = `${this.dir}/${id}.json`;
        await this.fs.write(filePath, JSON.stringify(data));
        await this.saveIndex();
    }

    /** Update metadata fields (e.g., title, token counts). */
    async updateMeta(id: string, patch: Partial<ConversationMeta>): Promise<void> {
        const meta = this.getMeta(id);
        if (!meta) return;
        Object.assign(meta, patch, { updated: new Date().toISOString() });
        await this.saveIndex();
    }

    /** Load full conversation from disk. */
    async load(id: string): Promise<ConversationData | null> {
        const filePath = `${this.dir}/${id}.json`;
        try {
            const raw = await this.fs.read(filePath);
            return JSON.parse(raw) as ConversationData;
        } catch {
            return null;
        }
    }

    /** Return cached index (no disk I/O). Newest first. */
    list(): ConversationMeta[] {
        return this.index.conversations;
    }

    /** Delete a single conversation. */
    async delete(id: string): Promise<void> {
        this.index.conversations = this.index.conversations.filter((c) => c.id !== id);
        await this.saveIndex();
        const filePath = `${this.dir}/${id}.json`;
        try {
            await this.fs.remove(filePath);
        } catch { /* non-fatal */ }
    }

    /** Delete all conversations. */
    async deleteAll(): Promise<void> {
        for (const c of this.index.conversations) {
            try {
                await this.fs.remove(`${this.dir}/${c.id}.json`);
            } catch { /* non-fatal */ }
        }
        this.index.conversations = [];
        await this.saveIndex();
    }

    /** Get count of stored conversations. */
    count(): number {
        return this.index.conversations.length;
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private getMeta(id: string): ConversationMeta | undefined {
        return this.index.conversations.find((c) => c.id === id);
    }

    private async ensureDir(): Promise<void> {
        const exists = await this.fs.exists(this.dir);
        if (!exists) {
            await this.fs.mkdir(this.dir);
        }
    }

    private async loadIndex(): Promise<void> {
        try {
            const raw = await this.fs.read(this.indexPath);
            this.index = JSON.parse(raw) as ConversationIndex;
        } catch {
            // No index yet — start fresh
            this.index = { version: 1, conversations: [] };
        }
    }

    private async saveIndex(): Promise<void> {
        await this.fs.write(this.indexPath, JSON.stringify(this.index, null, 2));
    }
}

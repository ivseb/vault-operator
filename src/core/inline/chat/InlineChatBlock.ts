/**
 * InlineChatBlock -- Markdown-Code-Fence serialization per ADR-143 (FEAT-33-05).
 *
 * Stores Inline-Chat conversations as a markdown code fence with a
 * versioned language tag so the note stays readable without the
 * plugin AND the plugin can render a rich UI in Live-Preview /
 * Reading-Mode via post-processor.
 *
 * Fence format:
 *
 * ```vault-operator-chat-v1
 * { "id": "ic-...", "selection_anchor": "...", "turns": [...],
 *   "model": "...", "created": "..." }
 * ```
 *
 * Pure-logic module so unit tests stay Node-env compatible. The
 * markdown-post-processor adapter lives next to InlineChatBlockRenderer
 * (added with the plugin entry-point wiring).
 *
 * Related: FEAT-33-05, ADR-143.
 */

export type InlineChatRole = 'user' | 'assistant';

export interface InlineChatTurn {
    role: InlineChatRole;
    content: string;
    /** ISO timestamp. */
    at: string;
}

export interface InlineChatBlock {
    /** Stable identifier (timestamp-based). */
    id: string;
    /** Original selected text the chat is anchored to. */
    selection_anchor: string;
    /** Conversation turns. */
    turns: InlineChatTurn[];
    /** Model id used for the conversation. */
    model: string;
    /** ISO timestamp of block creation. */
    created: string;
}

/** Cap per block per ADR-143 (auto-collapse beyond this). */
export const MAX_TURNS_PER_BLOCK = 20;

export const FENCE_LANG = 'vault-operator-chat-v1';
export const FENCE_OPEN = `\`\`\`${FENCE_LANG}`;
export const FENCE_CLOSE = '```';

/** Build a fresh chat block anchored to the given selection. */
export function createChatBlock(args: {
    id: string;
    selection_anchor: string;
    model: string;
    created: string;
}): InlineChatBlock {
    return {
        id: args.id,
        selection_anchor: args.selection_anchor,
        turns: [],
        model: args.model,
        created: args.created,
    };
}

/** Append a turn, enforcing the per-block cap. */
export function appendTurn(block: InlineChatBlock, turn: InlineChatTurn): InlineChatBlock {
    const turns = block.turns.concat(turn).slice(-MAX_TURNS_PER_BLOCK);
    return { ...block, turns };
}

/** Serialize a chat block into its markdown fence representation. */
export function serializeChatBlock(block: InlineChatBlock): string {
    const body = JSON.stringify(block, null, 2);
    return `${FENCE_OPEN}\n${body}\n${FENCE_CLOSE}\n`;
}

/**
 * Try to parse a fence body into an InlineChatBlock. Returns null when
 * the body is not valid JSON or does not match the expected shape.
 * Malformed blocks are not deleted -- the post-processor leaves them
 * as raw code fences so the user can see and recover them.
 */
export function parseChatBlockBody(body: string): InlineChatBlock | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        return null;
    }
    if (parsed === null || typeof parsed !== 'object') return null;
    const v = parsed as Record<string, unknown>;
    if (typeof v.id !== 'string') return null;
    if (typeof v.selection_anchor !== 'string') return null;
    if (typeof v.model !== 'string') return null;
    if (typeof v.created !== 'string') return null;
    if (!Array.isArray(v.turns)) return null;
    for (const t of v.turns) {
        if (t === null || typeof t !== 'object') return null;
        const turn = t as Record<string, unknown>;
        if (typeof turn.content !== 'string') return null;
        if (turn.role !== 'user' && turn.role !== 'assistant') return null;
        if (typeof turn.at !== 'string') return null;
    }
    return {
        id: v.id,
        selection_anchor: v.selection_anchor,
        model: v.model,
        created: v.created,
        turns: v.turns as InlineChatTurn[],
    };
}

/** Roundtrip helper: extract every chat block fence from a markdown string. */
export function extractChatBlocks(markdown: string): InlineChatBlock[] {
    const blocks: InlineChatBlock[] = [];
    const fenceOpen = FENCE_OPEN;
    let index = 0;
    while (true) {
        const start = markdown.indexOf(fenceOpen, index);
        if (start < 0) break;
        const bodyStart = markdown.indexOf('\n', start);
        if (bodyStart < 0) break;
        const closeIdx = markdown.indexOf(`\n${FENCE_CLOSE}`, bodyStart);
        if (closeIdx < 0) break;
        const body = markdown.slice(bodyStart + 1, closeIdx);
        const parsed = parseChatBlockBody(body);
        if (parsed !== null) blocks.push(parsed);
        index = closeIdx + FENCE_CLOSE.length + 1;
    }
    return blocks;
}

/**
 * FIX-44-47: the MCP surface gets the same drift contract that ADR-153
 * established agent-side with TOOL_EFFECTS + toolEffectCompleteness.
 *
 * Before this fix the write classification was a hand-maintained allowlist
 * (MCP_WRITE_TOOLS) next to the registration: a persisting tool missing from
 * the set was treated as read and exposed ungated on the bearer-token surface.
 *
 * 1. Completeness: every MCP tool definition declares an explicit effect,
 *    and definitions and dispatcher handlers cannot drift apart. The parity
 *    assertion is the real completeness enforcer: a handler added without a
 *    declared definition fails HERE, at test time.
 * 2. Pins: the sets of tools that run WITHOUT the write gate (read, session,
 *    dispatch) are frozen. Adding an ungated tool means deliberately editing
 *    this snapshot, not forgetting an allowlist entry.
 * 3. Fail-closed: an unknown or undeclared tool resolves to 'write'. On the
 *    live dispatch path an unknown tool is already rejected by the handler
 *    lookup before the gate; the resolver's fallback covers the residual
 *    runtime case of a registered handler whose definition lost its effect
 *    (only constructible via a cast).
 */

import { describe, it, expect } from 'vitest';
import {
    TOOLS,
    MCP_WRITE_TOOLS,
    resolveMcpToolEffect,
} from '../toolDefinitions';
import type { McpToolDefinition, McpToolEffect } from '../types';
import { MCP_REGISTERED_TOOL_NAMES } from '../tools/index';

const VALID_EFFECTS: ReadonlySet<McpToolEffect> = new Set<McpToolEffect>([
    'read', 'session', 'dispatch', 'write',
]);

function namesWithEffect(effect: McpToolEffect): string[] {
    return TOOLS.filter((t) => t.effect === effect).map((t) => t.name).sort();
}

describe('FIX-44-47: completeness of the MCP effect declarations', () => {
    it('every MCP tool definition declares an explicit, valid effect', () => {
        const undeclared = TOOLS
            .filter((t) => !VALID_EFFECTS.has(t.effect))
            .map((t) => t.name);
        expect(
            undeclared,
            `These MCP tool definitions have no valid effect declaration and ` +
            `would be write-gated fail-closed at runtime. Declare them in ` +
            `src/mcp/toolDefinitions.ts:\n  ${undeclared.join('\n  ')}`,
        ).toEqual([]);
    });

    it('dispatcher handlers and tool definitions cannot drift apart', () => {
        const handlerNames = [...MCP_REGISTERED_TOOL_NAMES].sort();
        const definitionNames = TOOLS.map((t) => t.name).sort();
        expect(handlerNames).toEqual(definitionNames);
    });
});

describe('FIX-44-47: gate pins (ungated sets are frozen)', () => {
    it('the read set is frozen', () => {
        expect(namesWithEffect('read')).toEqual([
            'get_context',
            'get_vault_implicit_edges',
            'get_vault_note_metadata',
            'read_notes',
            'recall_memory',
            'search_history',
            'search_vault',
        ]);
    });

    it('the session set is frozen (conversation-history bookkeeping only)', () => {
        expect(namesWithEffect('session')).toEqual([
            'close_conversation',
            'save_conversation',
            'sync_session',
        ]);
    });

    it('only execute_vault_op is a dispatcher (per-operation pipeline governance)', () => {
        expect(namesWithEffect('dispatch')).toEqual(['execute_vault_op']);
    });

    it('the write set covers every tool that mutates vault content or long-term memory', () => {
        const writeNames = namesWithEffect('write');
        expect(writeNames).toEqual([
            'save_to_memory',
            'update_memory',
            'write_vault',
        ]);
        // The exported gate set is DERIVED from the declarations, not
        // hand-maintained next to them.
        expect([...MCP_WRITE_TOOLS].sort()).toEqual(writeNames);
    });
});

describe('FIX-44-47: fail-closed resolution', () => {
    it('an unknown tool resolves to write (gated), never to read', () => {
        expect(resolveMcpToolEffect('brand_new_persisting_tool')).toBe('write');
    });

    it('a definition without an effect declaration resolves to write (gated)', () => {
        // JS-level fixture: simulates a definition that slipped past the
        // compile-time requirement (e.g. an untyped literal or a cast).
        const undeclared = {
            name: 'hypothetical_tool',
            description: 'a tool someone forgot to classify',
            inputSchema: { type: 'object', properties: {}, required: [] },
        } as unknown as McpToolDefinition;
        expect(resolveMcpToolEffect('hypothetical_tool', [undeclared])).toBe('write');
    });

    it('a declared read tool resolves to read', () => {
        expect(resolveMcpToolEffect('read_notes')).toBe('read');
    });
});

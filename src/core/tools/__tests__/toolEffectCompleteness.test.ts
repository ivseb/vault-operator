/**
 * FEAT-44-01 / ADR-153: the drift test, as a contract.
 *
 * The bug FEAT-44-01 closed came about exactly this way: ADR-10 audited the
 * approval matrix in full on 2026-02-23, tools were added afterwards, and nobody
 * noticed they fell through the gate. This suite makes that impossible.
 *
 * 1. Completeness: every registered tool has an effect class.
 * 2. CUD pin:      the set of tools that run without confirmation is frozen.
 *                  Moving a tool to 'read' or 'ui' means deliberately editing
 *                  this snapshot.
 * 3. Policy invariants: config and self-modify are not auto-approvable, and
 *                  read and ui hang off no flag.
 */

import { describe, it, expect } from 'vitest';
import { TOOL_METADATA } from '../toolMetadata';
import {
    TOOL_EFFECTS,
    EFFECT_POLICY,
    resolveToolEffect,
    type ToolEffect,
} from '../toolEffects';

/** Effects allowed to run without user confirmation. Everything else asks. */
const AUTO_EFFECTS: ReadonlySet<ToolEffect> = new Set<ToolEffect>(['read', 'ui']);

describe('ADR-153: completeness of the effect registry', () => {
    it('every registered tool has an effect class', () => {
        const missing = Object.keys(TOOL_METADATA).filter((name) => !(name in TOOL_EFFECTS));
        expect(
            missing,
            `These tools have no TOOL_EFFECTS entry and would fail-closed into an ` +
            `approval prompt on every call. Add them to ` +
            `src/core/tools/toolEffects.ts:\n  ${missing.join('\n  ')}`,
        ).toEqual([]);
    });

    it('the effect registry contains no dead entries', () => {
        // render_presentation was still in the old TOOL_GROUPS map long after the
        // tool was gone. Such dead entries fake coverage.
        const orphans = Object.keys(TOOL_EFFECTS).filter((name) => !(name in TOOL_METADATA));
        expect(
            orphans,
            `These TOOL_EFFECTS entries no longer have a tool:\n  ${orphans.join('\n  ')}`,
        ).toEqual([]);
    });

    it('every effect has a policy', () => {
        for (const name of Object.keys(TOOL_EFFECTS)) {
            const effect = resolveToolEffect(name, {});
            expect(effect, `${name} resolves to no effect`).toBeDefined();
            expect(EFFECT_POLICY[effect as ToolEffect], `effect ${effect} has no policy`).toBeDefined();
        }
    });
});

describe('ADR-153: CUD pin', () => {
    it('the set of tools that run automatically is frozen', () => {
        // Adding a tool here strips its user confirmation. That is a security
        // decision and needs a deliberate edit of this snapshot, not an accident.
        const auto = Object.keys(TOOL_EFFECTS)
            .filter((name) => {
                const e = resolveToolEffect(name, {});
                return e !== undefined && AUTO_EFFECTS.has(e);
            })
            .sort();

        expect(auto).toEqual([
            'ask_followup_question',
            'attempt_completion',
            'consult_flagship',
            'diff_checkpoint',
            'find_notes_by_type',
            'find_tool',
            'get_daily_note',        // only WITHOUT create; create=true -> note-edit
            'get_frontmatter',
            'get_linked_notes',
            'get_vault_stats',
            'inspect_self',
            'list_checkpoints',
            'list_files',
            'list_memory_source_notes',
            'list_pinned_conversations',
            'open_note',
            'plan_presentation',
            'probe_plugin',
            'query_base',
            'read_agent_logs',
            'read_checkpoint',
            'read_document',
            'read_file',
            'read_mcp_tool',
            'read_skill',
            'recall_memory',
            'resolve_capability_gap',
            'search_by_tag',
            'search_files',
            'search_history',
            'semantic_search',
            'switch_agent',
            'update_todo_list',
        ]);
    });

    it('get_daily_note switches effect class when create=true', () => {
        expect(resolveToolEffect('get_daily_note', { create: true })).toBe('note-edit');
        expect(resolveToolEffect('get_daily_note', { create: false })).toBe('read');
        expect(resolveToolEffect('get_daily_note', {})).toBe('read');
        expect(resolveToolEffect('get_daily_note', undefined)).toBe('read');
    });

    it('the five former bypasses require confirmation', () => {
        // These tools declare isWriteOperation = false and therefore used to slip
        // past checkApproval.
        expect(resolveToolEffect('update_settings', {})).toBe('config');
        expect(resolveToolEffect('manage_mcp_server', {})).toBe('config');
        expect(resolveToolEffect('update_soul', {})).toBe('self-modify');
        expect(resolveToolEffect('mark_for_memory', {})).toBe('self-modify');
        expect(resolveToolEffect('get_daily_note', { create: true })).toBe('note-edit');

        for (const name of ['update_settings', 'manage_mcp_server', 'update_soul', 'mark_for_memory']) {
            const effect = resolveToolEffect(name, {}) as ToolEffect;
            expect(AUTO_EFFECTS.has(effect), `${name} must not run automatically`).toBe(false);
        }
    });
});

describe('ADR-153: policy invariants', () => {
    it('config and self-modify are not auto-approvable', () => {
        expect(EFFECT_POLICY.config.alwaysAsk).toBe(true);
        expect(EFFECT_POLICY.config.key).toBeNull();
        expect(EFFECT_POLICY['self-modify'].alwaysAsk).toBe(true);
        expect(EFFECT_POLICY['self-modify'].key).toBeNull();
    });

    it('read and ui hang off no settings flag (auto, independent of the master)', () => {
        // Otherwise every read_file would raise an approval card while the master
        // toggle is off, which is the DEFAULT.
        expect(EFFECT_POLICY.read).toEqual({ key: null, alwaysAsk: false });
        expect(EFFECT_POLICY.ui).toEqual({ key: null, alwaysAsk: false });
    });

    it('every mutating or egress-capable effect hangs off a flag or always asks', () => {
        for (const [effect, policy] of Object.entries(EFFECT_POLICY) as Array<[ToolEffect, typeof EFFECT_POLICY[ToolEffect]]>) {
            if (AUTO_EFFECTS.has(effect)) continue;
            if (effect === 'plugin-api') continue; // read/write resolved from the input
            const gated = policy.alwaysAsk || policy.key !== null;
            expect(gated, `effect ${effect} runs automatically with no gate`).toBe(true);
        }
    });

    it('dynamic skill code tools are classified as sandbox', () => {
        // A skill declares its approval class in its own source. We do not trust
        // that self-report.
        expect(resolveToolEffect('custom_anything', {})).toBe('sandbox');
        expect(resolveToolEffect('custom_looks_harmless', {})).toBe('sandbox');
    });

    it('an unknown tool resolves to no effect (fail-closed)', () => {
        expect(resolveToolEffect('brand_new_tool', {})).toBeUndefined();
    });
});

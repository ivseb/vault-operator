/**
 * Wave B hardening (audit 2026-07-13): the "Always allow" grant and the
 * plugin-api read/write classification must stop leaking permissions the user
 * never saw.
 *
 * FIX-44-03b: granting one category from a card must not silently re-arm every
 *             dormant category flag when the master toggle flips on.
 * FIX-44-03a: the flag a card grants must match the flag the gate checks
 *             (plugin-api read vs write, resolved from the SAME input).
 * FIX-44-06:  a mutating method name (findAndReplace, getOrCreate) must never be
 *             classified as a read and auto-promoted.
 */

import { describe, it, expect } from 'vitest';
import { grantAutoApproval } from '../autoApprovalGrant';
import { classifyMethodIsWrite, isPluginApiWriteCall } from '../agent/pluginApiAdaptive';

describe('FIX-44-03b: grantAutoApproval does not re-arm dormant flags', () => {
    it('clears every other category when the master flips from off to on', () => {
        // A past permissive session left sandbox + web true; the master is off.
        const cfg: Record<string, unknown> = {
            enabled: false, noteEdits: false, vaultChanges: false,
            web: true, mcp: false, sandbox: true, skills: false, recipes: false,
            pluginApiRead: true, pluginApiWrite: false,
        };
        grantAutoApproval(cfg, 'noteEdits');

        expect(cfg.enabled).toBe(true);
        expect(cfg.noteEdits).toBe(true);     // the one the user approved
        expect(cfg.web).toBe(false);          // dormant flag NOT re-armed
        expect(cfg.sandbox).toBe(false);      // dormant flag NOT re-armed
        expect(cfg.pluginApiRead).toBe(false);
    });

    it('preserves existing grants when the master is already on', () => {
        const cfg: Record<string, unknown> = {
            enabled: true, noteEdits: true, web: false, sandbox: false,
            vaultChanges: false, mcp: false, skills: false, recipes: false,
            pluginApiRead: false, pluginApiWrite: false,
        };
        grantAutoApproval(cfg, 'web');

        expect(cfg.noteEdits).toBe(true);     // untouched
        expect(cfg.web).toBe(true);           // added
    });
});

describe('FIX-44-03a: isPluginApiWriteCall (shared UI + gate)', () => {
    it('returns the allowlist isWrite flag when the method is known', () => {
        // A built-in read method resolves to read (false) without any settings.
        expect(isPluginApiWriteCall({ plugin_id: 'dataview', method: 'query' }, undefined)).toBe(false);
    });

    it('defaults an unknown Tier-2 method to write', () => {
        expect(isPluginApiWriteCall({ plugin_id: 'x', method: 'doTheThing' }, undefined)).toBe(true);
    });

    it('honours a user override marking a method as a safe read', () => {
        const settings = { safeMethodOverrides: { 'x:doTheThing': true } } as never;
        expect(isPluginApiWriteCall({ plugin_id: 'x', method: 'doTheThing' }, settings)).toBe(false);
    });
});

describe('FIX-44-06: classifyMethodIsWrite catches compound mutators', () => {
    it('classifies read-prefixed compounds as writes, adjacent AND non-adjacent', () => {
        expect(classifyMethodIsWrite('findAndReplace')).toBe(true);
        expect(classifyMethodIsWrite('searchAndReplace')).toBe(true);
        expect(classifyMethodIsWrite('getOrCreate')).toBe(true);
        expect(classifyMethodIsWrite('getAndSet')).toBe(true);
        // FIX-44-06 follow-up: the mutation need not be adjacent to the prefix.
        expect(classifyMethodIsWrite('getItemsAndDelete')).toBe(true);
        expect(classifyMethodIsWrite('findRecordAndRemove')).toBe(true);
        expect(classifyMethodIsWrite('listNotesAndArchive')).toBe(true);
        expect(classifyMethodIsWrite('get_or_create')).toBe(true);
        expect(classifyMethodIsWrite('get_and_set')).toBe(true);
    });

    it('still classifies genuine reads as reads (no false positives on and/or substrings)', () => {
        expect(classifyMethodIsWrite('getPages')).toBe(false);
        expect(classifyMethodIsWrite('listItems')).toBe(false);
        expect(classifyMethodIsWrite('search')).toBe(false);
        expect(classifyMethodIsWrite('hasTag')).toBe(false);
        // "and" inside Brand / "Set" inside Settings must NOT trip the compound rule.
        expect(classifyMethodIsWrite('getBrandSettings')).toBe(false);
        expect(classifyMethodIsWrite('getCommandList')).toBe(false);
        expect(classifyMethodIsWrite('getStandardConfig')).toBe(false);
        expect(classifyMethodIsWrite('getOrderList')).toBe(false);
    });

    it('classifies plain writes as writes', () => {
        expect(classifyMethodIsWrite('deleteFile')).toBe(true);
        expect(classifyMethodIsWrite('updateFrontmatter')).toBe(true);
        expect(classifyMethodIsWrite('')).toBe(true);
    });
});

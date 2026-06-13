/**
 * BUG-3-CODEX-OAUTH-MODEL-MISMATCH
 *
 * The legacy ModelConfigModal Quick Pick sources its chatgpt-oauth model
 * options from MODEL_SUGGESTIONS['chatgpt-oauth'] (constants.ts), while the
 * provider only accepts ids in KNOWN_MODELS (chatgpt-oauth.ts, surfaced via
 * listKnownChatGptOAuthModels()). The two had drifted: the suggestion list
 * offered `gpt-5.5` as the first entry labelled "recommended for Pro" -- a
 * model the Codex backend rejects with HTTP 400
 * ("not supported when using Codex with a ChatGPT account").
 *
 * These tests pin the suggestion list to the provider allowlist so the two
 * sources cannot drift again. KNOWN_MODELS stays the single source of truth;
 * adding a new Codex id there must be mirrored here for the test to pass.
 */
import { describe, expect, it } from 'vitest';
import { MODEL_SUGGESTIONS } from '../constants';
import { listKnownChatGptOAuthModels } from '../../../api/providers/chatgpt-oauth';

describe('MODEL_SUGGESTIONS chatgpt-oauth alignment with KNOWN_MODELS', () => {
    const suggestions = MODEL_SUGGESTIONS['chatgpt-oauth'] ?? [];
    const knownIds = new Set(listKnownChatGptOAuthModels().map((m) => m.id));

    it('offers at least one model', () => {
        expect(suggestions.length).toBeGreaterThan(0);
    });

    it('never offers gpt-5.5 (Codex backend rejects it, API-tier only)', () => {
        const ids = suggestions.map((s) => s.id);
        expect(ids).not.toContain('gpt-5.5');
    });

    it('every suggested id is an invokable Codex model (subset of KNOWN_MODELS)', () => {
        for (const s of suggestions) {
            expect(knownIds.has(s.id), `suggested id ${s.id} is not in KNOWN_MODELS`).toBe(true);
        }
    });

    it('no label steers the user toward an unsupported model (no "recommended for Pro")', () => {
        for (const s of suggestions) {
            expect(s.label.toLowerCase()).not.toContain('recommended for pro');
        }
    });
});

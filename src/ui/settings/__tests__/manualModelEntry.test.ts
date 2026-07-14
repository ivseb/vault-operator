/**
 * Manual model-id entry logic for provider tier slots (issue #43).
 *
 * The ChatGPT OAuth Codex backend has no model-listing endpoint, so the tier
 * dropdowns can only ever show the static known lineup. These tests pin the
 * pure decision logic that lets a power user type a future Codex id without us
 * inventing model ids, while keeping every other provider on the dropdown.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
    MANUAL_TIER_INPUT_CLS,
    MANUAL_TIER_OPTION_VALUE,
    providerSupportsManualModelId,
    resolveTierSlotView,
} from '../manualModelEntry';
import { en } from '../../../i18n/locales/en';

describe('providerSupportsManualModelId', () => {
    it('allows manual entry for providers that may lack a model-list endpoint', () => {
        // ChatGPT OAuth (Codex) and custom OpenAI-compatible endpoints cannot
        // be relied on to enumerate models, so they get free-text entry.
        expect(providerSupportsManualModelId('chatgpt-oauth')).toBe(true);
        expect(providerSupportsManualModelId('custom')).toBe(true);
    });

    it('keeps dropdown-only for providers with a real /v1/models refresh', () => {
        expect(providerSupportsManualModelId('openai')).toBe(false);
        expect(providerSupportsManualModelId('anthropic')).toBe(false);
        expect(providerSupportsManualModelId('github-copilot')).toBe(false);
        expect(providerSupportsManualModelId('openrouter')).toBe(false);
    });
});

describe('resolveTierSlotView', () => {
    const discovered = ['gpt-5', 'gpt-5-codex', 'gpt-5.3-codex'];

    it('stays in select mode when manual entry is not allowed', () => {
        const view = resolveTierSlotView({
            override: 'something-unknown',
            discoveredIds: discovered,
            manualAllowed: false,
        });
        expect(view.mode).toBe('select');
        expect(view.manualValue).toBe('');
    });

    it('stays in select mode for an empty override', () => {
        const view = resolveTierSlotView({
            override: '',
            discoveredIds: discovered,
            manualAllowed: true,
        });
        expect(view.mode).toBe('select');
    });

    it('stays in select mode when the override is a discovered id', () => {
        const view = resolveTierSlotView({
            override: 'gpt-5.3-codex',
            discoveredIds: discovered,
            manualAllowed: true,
        });
        expect(view.mode).toBe('select');
        expect(view.manualValue).toBe('');
    });

    it('switches to manual mode for a custom (non-discovered) override', () => {
        const view = resolveTierSlotView({
            override: 'gpt-5.4-codex',
            discoveredIds: discovered,
            manualAllowed: true,
        });
        expect(view.mode).toBe('manual');
        expect(view.manualValue).toBe('gpt-5.4-codex');
    });

    it('switches to manual mode when the user explicitly requests it', () => {
        const view = resolveTierSlotView({
            override: '',
            discoveredIds: discovered,
            manualAllowed: true,
            manualRequested: true,
        });
        expect(view.mode).toBe('manual');
        expect(view.manualValue).toBe('');
    });

    it('trims whitespace around the override before comparing', () => {
        const view = resolveTierSlotView({
            override: '  gpt-5.3-codex  ',
            discoveredIds: discovered,
            manualAllowed: true,
        });
        expect(view.mode).toBe('select');
    });

    it('exposes a distinct sentinel option value', () => {
        expect(MANUAL_TIER_OPTION_VALUE).toBe('__manual__');
        // The sentinel must never collide with a real model id.
        expect(discovered).not.toContain(MANUAL_TIER_OPTION_VALUE);
    });
});

/**
 * FIX-55-02 (issue #55): the free-text model-id input rendered broken because
 * it carried the 'dropdown' class, which Obsidian core styles for <select>
 * elements (appearance:none, chevron background image, select padding). The
 * input must use its own class with a dedicated styles.css rule instead.
 */
describe('manual tier input styling (FIX-55-02)', () => {
    it('the input class list contains no select/dropdown classes', () => {
        const classes = MANUAL_TIER_INPUT_CLS.split(/\s+/);
        expect(classes).toContain('mcm-tier-manual-input');
        expect(classes).not.toContain('dropdown');
        expect(classes).not.toContain('mcm-tier-dropdown');
    });

    it('styles.css carries a rule for .mcm-tier-manual-input', () => {
        const css = fs.readFileSync(
            path.resolve(__dirname, '..', '..', '..', '..', 'styles.css'),
            'utf-8',
        );
        expect(css).toMatch(/\.mcm-tier-manual-input\s*\{/);
    });

    it('the placeholder suggests a current model id, not a retired one', () => {
        const placeholder = en['settings.providers.tier.manualPlaceholder'];
        expect(placeholder).toContain('gpt-5.6');
        expect(placeholder).not.toContain('gpt-5.3-codex');
    });
});

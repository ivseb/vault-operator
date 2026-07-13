/**
 * FIX-26-99-03 (issue #48, point 1 rest case): the first-run wizard's
 * "Add model" must write to the canonical providerConfigs[] store.
 *
 * Pre-fix it pushed into the legacy settings.activeModels[] without setting
 * schemaVersion, so a fresh wizard install triggered the one-shot
 * activeModelsToProviders migration on the next plugin load and confusingly
 * showed the MigrationNotificationModal right after first setup.
 */
import { describe, expect, it } from 'vitest';
import type { CustomModel, ProviderConfig } from '../../../types/settings';
import { applyWizardModelToProviderConfigs, type WizardModelSettings } from '../wizardAddModel';
import { migrateActiveModelsToProviders, SCHEMA_VERSION } from '../../../core/settings/migrations/activeModelsToProviders';
import { resolveTierModel } from '../../../core/routing/tierResolution';

function freshSettings(): WizardModelSettings {
    return {
        activeModels: [],
        activeModelKey: '',
        providerConfigs: [],
        activeProviderId: null,
        schemaVersion: undefined,
    };
}

function model(overrides: Partial<CustomModel> = {}): CustomModel {
    return {
        name: 'claude-sonnet-4-6',
        provider: 'anthropic',
        displayName: 'Claude Sonnet 4.6',
        apiKey: 'sk-test',
        enabled: true,
        ...overrides,
    };
}

describe('applyWizardModelToProviderConfigs (FIX-26-99-03)', () => {
    it('creates a provider config in the canonical store, not activeModels[]', () => {
        const settings = freshSettings();
        applyWizardModelToProviderConfigs(settings, model());

        expect(settings.activeModels).toEqual([]);
        expect(settings.providerConfigs).toHaveLength(1);
        const p = settings.providerConfigs[0];
        expect(p.type).toBe('anthropic');
        expect(p.apiKey).toBe('sk-test');
        expect(p.enabled).toBe(true);
        expect(p.discoveredModels.map((m) => m.id)).toEqual(['claude-sonnet-4-6']);
    });

    it('activates the new provider and stamps the schema version', () => {
        const settings = freshSettings();
        applyWizardModelToProviderConfigs(settings, model());

        expect(settings.activeProviderId).toBe(settings.providerConfigs[0].id);
        expect(settings.schemaVersion).toBe(SCHEMA_VERSION);
    });

    it('never triggers the legacy migration on the next load', () => {
        const settings = freshSettings();
        applyWizardModelToProviderConfigs(settings, model());

        const result = migrateActiveModelsToProviders(settings);
        expect(result.didMigrate).toBe(false);
    });

    it('classifies the model into a tier slot when possible', () => {
        const settings = freshSettings();
        applyWizardModelToProviderConfigs(settings, model());

        const p = settings.providerConfigs[0];
        expect(p.discoveredModels[0].autoTier).toBeDefined();
        const mapped = Object.values(p.tierMapping ?? {});
        expect(mapped).toContain('claude-sonnet-4-6');
    });

    it('merges a second model of the same provider type into the existing config', () => {
        const settings = freshSettings();
        applyWizardModelToProviderConfigs(settings, model());
        applyWizardModelToProviderConfigs(settings, model({
            name: 'claude-haiku-4-5-20251001',
            displayName: 'Claude Haiku 4.5',
        }));

        expect(settings.providerConfigs).toHaveLength(1);
        expect(settings.providerConfigs[0].discoveredModels.map((m) => m.id)).toEqual([
            'claude-sonnet-4-6',
            'claude-haiku-4-5-20251001',
        ]);
    });

    it('does not duplicate a model that is already present', () => {
        const settings = freshSettings();
        applyWizardModelToProviderConfigs(settings, model());
        applyWizardModelToProviderConfigs(settings, model());

        expect(settings.providerConfigs).toHaveLength(1);
        expect(settings.providerConfigs[0].discoveredModels).toHaveLength(1);
    });

    it('creates a second provider config for a different provider type', () => {
        const settings = freshSettings();
        applyWizardModelToProviderConfigs(settings, model());
        applyWizardModelToProviderConfigs(settings, model({
            name: 'gpt-5.2-pro',
            provider: 'openai',
            apiKey: 'sk-openai',
        }));

        expect(settings.providerConfigs).toHaveLength(2);
        // The first added provider stays active.
        expect(settings.activeProviderId).toBe(settings.providerConfigs[0].id);
    });

    it('keeps an already-active provider selection untouched', () => {
        const settings = freshSettings();
        settings.activeProviderId = 'ollama-main';
        applyWizardModelToProviderConfigs(settings, model());
        expect(settings.activeProviderId).toBe('ollama-main');
    });
});

/**
 * Review follow-up on FIX-26-99-03: the wizard-added model must be reachable
 * through the default tier cascade (mid -> fast), otherwise initApiHandler
 * resolves nothing and the very first message after the wizard hits the
 * "no model setup" card. classifyModelTier returns null for local providers
 * (ollama/lmstudio/custom) and unknown cloud ids, and a flagship-only
 * mapping is never reached by the mid cascade.
 */
describe('default tier cascade reachability (FIX-26-99-03 review follow-up)', () => {
    it('makes an unclassifiable local (ollama) model resolvable via the mid cascade', () => {
        const settings = freshSettings();
        applyWizardModelToProviderConfigs(settings, model({
            name: 'llama3.3:70b',
            provider: 'ollama',
            apiKey: undefined,
            baseUrl: 'http://localhost:11434',
        }));

        const p = settings.providerConfigs[0];
        expect(p.discoveredModels[0].autoTier).toBeUndefined();
        expect(resolveTierModel(settings, 'mid')?.name).toBe('llama3.3:70b');
    });

    it('makes a flagship-only model resolvable via the mid cascade', () => {
        const settings = freshSettings();
        applyWizardModelToProviderConfigs(settings, model({
            name: 'claude-opus-4-7',
            displayName: 'Claude Opus 4.7',
        }));

        const p = settings.providerConfigs[0];
        expect(p.tierMapping?.flagship).toBe('claude-opus-4-7');
        expect(resolveTierModel(settings, 'mid')?.name).toBe('claude-opus-4-7');
    });

    it('leaves the mid slot to the classified tier when the model lands in the cascade', () => {
        const settings = freshSettings();
        applyWizardModelToProviderConfigs(settings, model());

        const p = settings.providerConfigs[0];
        // claude-sonnet classifies into the cascade on its own; no fallback
        // slot must be written on top of the classification result.
        const slots = Object.values(p.tierMapping ?? {});
        expect(slots).toEqual(['claude-sonnet-4-6']);
        expect(resolveTierModel(settings, 'mid')?.name).toBe('claude-sonnet-4-6');
    });
});

describe('merge into an existing provider config (review follow-up)', () => {
    function disabledProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
        return {
            id: 'anthropic-main',
            type: 'anthropic',
            displayName: 'Anthropic',
            enabled: false,
            apiKey: 'sk-old',
            discoveredModels: [],
            lastRefreshAt: 0,
            tierMapping: {},
            tierOverrides: {},
            ...overrides,
        };
    }

    it('re-enables a disabled provider config it merges into', () => {
        const settings = freshSettings();
        settings.providerConfigs = [disabledProvider()];
        applyWizardModelToProviderConfigs(settings, model());

        expect(settings.providerConfigs).toHaveLength(1);
        expect(settings.providerConfigs[0].enabled).toBe(true);
    });

    it('lets a freshly entered apiKey overwrite a stale one on merge (review finding C3)', () => {
        // The wizard is reachable long after first run. When the stored key
        // is stale (revoked, rotated) the user re-runs the wizard with a new
        // key; silently keeping the old one reports success while the
        // provider keeps failing 401.
        const settings = freshSettings();
        settings.providerConfigs = [disabledProvider()];
        applyWizardModelToProviderConfigs(settings, model({ apiKey: 'sk-new' }));

        expect(settings.providerConfigs[0].apiKey).toBe('sk-new');
    });

    it('lets a freshly entered baseUrl overwrite a stale one on merge (review finding C3)', () => {
        const settings = freshSettings();
        settings.providerConfigs = [disabledProvider({ baseUrl: 'https://old.example' })];
        applyWizardModelToProviderConfigs(settings, model({ baseUrl: 'https://new.example' }));

        expect(settings.providerConfigs[0].baseUrl).toBe('https://new.example');
    });

    it('keeps existing credentials when the wizard fields were left empty', () => {
        const settings = freshSettings();
        settings.providerConfigs = [disabledProvider({ baseUrl: 'https://old.example' })];
        applyWizardModelToProviderConfigs(settings, model({ apiKey: undefined, baseUrl: undefined }));

        expect(settings.providerConfigs[0].apiKey).toBe('sk-old');
        expect(settings.providerConfigs[0].baseUrl).toBe('https://old.example');
    });

    it('still backfills empty provider credentials from the model', () => {
        const settings = freshSettings();
        settings.providerConfigs = [disabledProvider({ apiKey: undefined })];
        applyWizardModelToProviderConfigs(settings, model({ apiKey: 'sk-fresh' }));

        expect(settings.providerConfigs[0].apiKey).toBe('sk-fresh');
    });
});

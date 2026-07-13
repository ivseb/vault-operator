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
import type { CustomModel } from '../../../types/settings';
import { applyWizardModelToProviderConfigs, type WizardModelSettings } from '../wizardAddModel';
import { migrateActiveModelsToProviders, SCHEMA_VERSION } from '../../../core/settings/migrations/activeModelsToProviders';

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

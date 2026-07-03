import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnboardingService } from '../OnboardingService';
import type { MemoryService } from '../MemoryService';
import type ObsidianAgentPlugin from '../../../main';

/**
 * FIX-42-01-02 (issue #48): the onboarding prompt must not leak a hardcoded
 * German option or a raw placeholder token to non-German users. The active
 * app locale is injected by the host layer (ADR-080 keeps this module
 * obsidian-free), so getOnboardingPrompt takes the uiLocale as an argument.
 */

interface PluginStub {
    settings: {
        onboarding: { completed: boolean; startedAt: string };
        activeModels: unknown[];
        providerConfigs: unknown[];
    };
    saveSettings: ReturnType<typeof vi.fn>;
}

function makePlugin(overrides: Partial<PluginStub['settings']> = {}): PluginStub {
    return {
        settings: {
            onboarding: { completed: false, startedAt: '' },
            activeModels: [],
            providerConfigs: [],
            ...overrides,
        },
        saveSettings: vi.fn().mockResolvedValue(undefined),
    };
}

function makeService(plugin: PluginStub): OnboardingService {
    return new OnboardingService({} as MemoryService, plugin as unknown as ObsidianAgentPlugin);
}

afterEach(() => vi.restoreAllMocks());

describe('getOnboardingPrompt language injection', () => {
    it('leaks no German option and no raw placeholder for English users', () => {
        const prompt = makeService(makePlugin()).getOnboardingPrompt('en');
        expect(prompt).not.toContain('{{extraLanguageOptions}}');
        expect(prompt).not.toContain('Deutsch');
        // The two English options plus the language-agnostic fallback remain.
        expect(prompt).toContain('"English, keep it casual"');
        expect(prompt).toContain('Reply to me in whatever language I write in');
    });

    it('defaults to English when no locale is passed', () => {
        const prompt = makeService(makePlugin()).getOnboardingPrompt();
        expect(prompt).not.toContain('{{extraLanguageOptions}}');
        expect(prompt).not.toContain('Deutsch');
    });

    it('injects the native language option for a German app locale', () => {
        const prompt = makeService(makePlugin()).getOnboardingPrompt('de');
        expect(prompt).toContain('"Deutsch (my Obsidian language)"');
        // The following option keeps its own line (leading indent intact).
        expect(prompt).toContain('Reply to me in whatever language I write in');
        // The rest of the prompt stays English.
        expect(prompt).toContain('====== ONBOARDING MODE ======');
        expect(prompt).not.toContain('{{extraLanguageOptions}}');
    });

    it('injects the native name for zh-TW using the exact locale key', () => {
        const prompt = makeService(makePlugin()).getOnboardingPrompt('zh-TW');
        expect(prompt).toContain('繁體中文 (Traditional Chinese)');
    });

    it('adds no native option for an unknown locale', () => {
        const prompt = makeService(makePlugin()).getOnboardingPrompt('pt');
        expect(prompt).not.toContain('(my Obsidian language)');
        expect(prompt).not.toContain('{{');
    });
});

describe('getOnboardingPrompt gating and state', () => {
    it('returns empty and does no injection when the flow is not active', () => {
        // A configured provider means the first-run wizard is over.
        const plugin = makePlugin({ providerConfigs: [{ id: 'x' }] });
        const prompt = makeService(plugin).getOnboardingPrompt('de');
        expect(prompt).toBe('');
        expect(plugin.saveSettings).not.toHaveBeenCalled();
    });

    it('stamps startedAt once and saves, but not on a second call', () => {
        const plugin = makePlugin();
        const service = makeService(plugin);

        service.getOnboardingPrompt('en');
        expect(plugin.settings.onboarding.startedAt).not.toBe('');
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);

        const stamped = plugin.settings.onboarding.startedAt;
        service.getOnboardingPrompt('en');
        expect(plugin.settings.onboarding.startedAt).toBe(stamped);
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    });
});

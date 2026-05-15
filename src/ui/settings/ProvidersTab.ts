/**
 * EPIC-26 / FEAT-26-03 -- Provider-only Settings UI.
 *
 * Replaces the per-model "Models" list with a per-provider block layout.
 * Each block carries: enable toggle, auth fields (api-key or oauth-stub or
 * bedrock-credentials), discovered-model count + refresh button, and three
 * tier slots (fast / mid / flagship) with auto/override resolution.
 *
 * The legacy ModelsTab stays available during the migration window for
 * users who want to inspect the pre-migration setup.
 */

import { App, Notice, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import type {
    DiscoveredModel,
    ModelTier,
    ProviderConfig,
    ProviderType,
} from '../../types/settings';
import { PROVIDER_LABELS } from './constants';
import { t } from '../../i18n';

const TIER_ORDER: ModelTier[] = ['fast', 'mid', 'flagship'];

const CLOUD_PROVIDER_TYPES: ProviderType[] = [
    'anthropic', 'openai', 'gemini', 'openrouter', 'azure', 'bedrock',
];
const OAUTH_PROVIDER_TYPES: ProviderType[] = ['github-copilot', 'chatgpt-oauth'];
const LOCAL_PROVIDER_TYPES: ProviderType[] = ['ollama', 'lmstudio', 'custom'];
const ALL_PROVIDER_TYPES: ProviderType[] = [
    ...CLOUD_PROVIDER_TYPES,
    ...OAUTH_PROVIDER_TYPES,
    ...LOCAL_PROVIDER_TYPES,
    'kilo-gateway',
];

export class ProvidersTab {
    constructor(
        private readonly plugin: ObsidianAgentPlugin,
        private readonly app: App,
        private readonly rerender: () => void,
    ) {}

    build(containerEl: HTMLElement): void {
        // Intro banner
        const intro = containerEl.createDiv({ cls: 'agent-settings-info-banner' });
        const introIcon = intro.createSpan({ cls: 'agent-settings-info-icon' });
        setIcon(introIcon, 'server');
        const introText = intro.createDiv({ cls: 'agent-settings-info-text' });
        introText.createEl('strong', { text: t('settings.providers.title') });
        introText.createDiv({ text: t('settings.providers.intro') });

        const providers = this.plugin.settings.providerConfigs ?? [];

        // Active provider selector
        this.renderActiveProviderSelector(containerEl, providers);

        // Provider blocks
        if (providers.length === 0) {
            const empty = containerEl.createDiv({ cls: 'providers-empty' });
            empty.createEl('p', { text: t('settings.providers.empty') });
        } else {
            for (const p of providers) {
                this.renderProviderBlock(containerEl, p);
            }
        }

        // Add provider button
        const footer = containerEl.createDiv({ cls: 'providers-footer' });
        this.renderAddProviderButton(footer);
    }

    private renderActiveProviderSelector(parent: HTMLElement, providers: ProviderConfig[]): void {
        const wrap = parent.createDiv({ cls: 'providers-active-selector' });
        wrap.createEl('label', { text: t('settings.providers.activeLabel') });
        const select = wrap.createEl('select');
        const noneOpt = select.createEl('option', {
            text: t('settings.providers.activeNone'),
            value: '',
        });
        if (!this.plugin.settings.activeProviderId) noneOpt.selected = true;
        for (const p of providers) {
            if (!p.enabled) continue;
            const opt = select.createEl('option', {
                text: p.displayName ?? this.providerLabel(p.type),
                value: p.id,
            });
            if (this.plugin.settings.activeProviderId === p.id) opt.selected = true;
        }
        select.addEventListener('change', () => { void (async () => {
            const value = select.value || null;
            this.plugin.settings.activeProviderId = value;
            await this.plugin.saveSettings();
            this.rerender();
        })(); });
    }

    private renderProviderBlock(parent: HTMLElement, provider: ProviderConfig): void {
        const block = parent.createDiv({ cls: 'provider-block' });

        // Header
        const header = block.createDiv({ cls: 'provider-block-header' });
        const title = header.createEl('h3', {
            text: provider.displayName ?? this.providerLabel(provider.type),
        });
        if (this.plugin.settings.activeProviderId === provider.id) {
            title.createSpan({ cls: 'provider-active-badge', text: t('settings.providers.activeBadge') });
        }
        const enableWrap = header.createDiv({ cls: 'provider-enable-wrap' });
        const enableLabel = enableWrap.createEl('label');
        const enableCb = enableLabel.createEl('input', { type: 'checkbox' });
        enableCb.checked = provider.enabled;
        enableLabel.appendText(' ' + t('settings.providers.enabled'));
        enableCb.addEventListener('change', () => { void (async () => {
            provider.enabled = enableCb.checked;
            await this.plugin.saveSettings();
            this.rerender();
        })(); });

        // Auth section (type-specific)
        this.renderAuthSection(block, provider);

        // Discovery section
        this.renderDiscoverySection(block, provider);

        // Tier slot table
        this.renderTierSlotTable(block, provider);

        // Advisor-disabled warning when flagship slot is empty
        if (!this.resolveTierSlot(provider, 'flagship')) {
            const warn = block.createDiv({ cls: 'provider-advisor-disabled' });
            warn.createSpan({ text: t('settings.providers.advisorDisabled') });
        }

        // Remove provider button
        const removeBtn = block.createEl('button', {
            cls: 'provider-remove-btn',
            text: t('settings.providers.removeProvider'),
        });
        removeBtn.addEventListener('click', () => { void (async () => {
            const ok = window.confirm(t('settings.providers.removeConfirm', { name: provider.displayName ?? provider.type }));
            if (!ok) return;
            this.plugin.settings.providerConfigs = (this.plugin.settings.providerConfigs ?? []).filter((p) => p.id !== provider.id);
            if (this.plugin.settings.activeProviderId === provider.id) {
                this.plugin.settings.activeProviderId = null;
            }
            await this.plugin.saveSettings();
            this.rerender();
        })(); });
    }

    private renderAuthSection(block: HTMLElement, provider: ProviderConfig): void {
        const auth = block.createDiv({ cls: 'provider-auth-section' });
        if (OAUTH_PROVIDER_TYPES.includes(provider.type)) {
            this.renderOAuthAuth(auth, provider);
            return;
        }
        if (provider.type === 'bedrock') {
            this.renderBedrockAuth(auth, provider);
            return;
        }
        // API key
        const keyLabel = auth.createEl('label', { text: t('settings.providers.apiKey') });
        const keyInput = keyLabel.createEl('input', {
            type: 'password',
            attr: { placeholder: '••••••' },
        });
        keyInput.value = provider.apiKey ?? '';
        keyInput.addEventListener('change', () => { void this.persistField(provider, 'apiKey', keyInput.value); });

        // BaseURL for custom endpoints + azure + custom-OpenAI
        if (LOCAL_PROVIDER_TYPES.includes(provider.type) || provider.type === 'azure') {
            const urlLabel = auth.createEl('label', { text: t('settings.providers.baseUrl') });
            const urlInput = urlLabel.createEl('input', { type: 'text' });
            urlInput.value = provider.baseUrl ?? '';
            urlInput.addEventListener('change', () => { void this.persistField(provider, 'baseUrl', urlInput.value); });
        }

        // API version for azure
        if (provider.type === 'azure') {
            const verLabel = auth.createEl('label', { text: t('settings.providers.apiVersion') });
            const verInput = verLabel.createEl('input', { type: 'text', attr: { placeholder: '2024-10-21' } });
            verInput.value = provider.apiVersion ?? '';
            verInput.addEventListener('change', () => { void this.persistField(provider, 'apiVersion', verInput.value); });
        }
    }

    private renderOAuthAuth(parent: HTMLElement, provider: ProviderConfig): void {
        const isAuthed = !!provider.oauthToken
            || (provider.type === 'github-copilot' && !!this.plugin.settings.githubCopilotAccessToken)
            || (provider.type === 'chatgpt-oauth' && !!this.plugin.settings.chatgptOAuthAccessToken);

        const status = parent.createDiv({ cls: 'provider-oauth-status' });
        status.createSpan({
            text: isAuthed
                ? t('settings.providers.oauthAuthed')
                : t('settings.providers.oauthNotAuthed'),
        });

        const button = parent.createEl('button', {
            cls: 'mod-cta',
            text: isAuthed
                ? t('settings.providers.oauthReauth')
                : t('settings.providers.oauthSignIn'),
        });
        button.addEventListener('click', () => {
            // FEAT-26-03 SC-06 deferred: sign-in flow lives in legacy auth
            // services that the user can still invoke from the legacy
            // ModelsTab. Surfacing them here is a separate IMP item.
            new Notice(t('settings.providers.oauthSignInRedirect'));
            this.plugin.openSettingsAt('agent', 'models');
        });
    }

    private renderBedrockAuth(parent: HTMLElement, provider: ProviderConfig): void {
        // Region
        const regionLabel = parent.createEl('label', { text: t('settings.providers.bedrockRegion') });
        const regionInput = regionLabel.createEl('input', { type: 'text', attr: { placeholder: 'eu-central-1' } });
        regionInput.value = provider.awsRegion ?? '';
        regionInput.addEventListener('change', () => { void this.persistField(provider, 'awsRegion', regionInput.value); });

        // Auth mode switch
        const modeLabel = parent.createEl('label', { text: t('settings.providers.bedrockAuthMode') });
        const modeSelect = modeLabel.createEl('select');
        modeSelect.createEl('option', { text: 'api-key', value: 'api-key' });
        modeSelect.createEl('option', { text: 'access-key', value: 'access-key' });
        modeSelect.value = provider.awsAuthMode ?? 'api-key';
        modeSelect.addEventListener('change', () => { void (async () => {
            provider.awsAuthMode = modeSelect.value as 'api-key' | 'access-key';
            await this.plugin.saveSettings();
            this.rerender();
        })(); });

        if ((provider.awsAuthMode ?? 'api-key') === 'api-key') {
            const keyLabel = parent.createEl('label', { text: t('settings.providers.bedrockApiKey') });
            const keyInput = keyLabel.createEl('input', { type: 'password' });
            keyInput.value = provider.awsApiKey ?? '';
            keyInput.addEventListener('change', () => { void this.persistField(provider, 'awsApiKey', keyInput.value); });
        } else {
            const akLabel = parent.createEl('label', { text: 'Access Key ID' });
            const akInput = akLabel.createEl('input', { type: 'password' });
            akInput.value = provider.awsAccessKey ?? '';
            akInput.addEventListener('change', () => { void this.persistField(provider, 'awsAccessKey', akInput.value); });

            const skLabel = parent.createEl('label', { text: 'Secret Access Key' });
            const skInput = skLabel.createEl('input', { type: 'password' });
            skInput.value = provider.awsSecretKey ?? '';
            skInput.addEventListener('change', () => { void this.persistField(provider, 'awsSecretKey', skInput.value); });
        }
    }

    private renderDiscoverySection(block: HTMLElement, provider: ProviderConfig): void {
        const sec = block.createDiv({ cls: 'provider-discovery' });
        const count = provider.discoveredModels?.length ?? 0;
        sec.createSpan({
            text: t('settings.providers.discoveredCount', { count: String(count) }),
        });
        if (provider.lastRefreshAt) {
            const stamp = new Date(provider.lastRefreshAt).toLocaleString();
            sec.createSpan({
                cls: 'provider-discovery-stamp',
                text: ' · ' + t('settings.providers.lastRefresh', { stamp }),
            });
        }
        const btn = sec.createEl('button', {
            cls: 'provider-refresh-btn',
            text: t('settings.providers.refresh'),
        });
        btn.addEventListener('click', () => { void (async () => {
            const discovery = this.plugin.modelDiscovery;
            if (!discovery) {
                new Notice(t('settings.providers.refreshUnavailable'));
                return;
            }
            btn.disabled = true;
            btn.setText(t('settings.providers.refreshing'));
            try {
                await discovery.refreshProvider(provider.id);
                new Notice(t('settings.providers.refreshDone'));
            } catch (e) {
                console.warn('[ProvidersTab] refresh failed:', e);
                new Notice(t('settings.providers.refreshFailed', { msg: (e as Error).message }));
            } finally {
                btn.disabled = false;
                btn.setText(t('settings.providers.refresh'));
                this.rerender();
            }
        })(); });
    }

    private renderTierSlotTable(block: HTMLElement, provider: ProviderConfig): void {
        const table = block.createDiv({ cls: 'provider-tier-table' });
        for (const tier of TIER_ORDER) {
            const row = table.createDiv({ cls: 'provider-tier-row' });
            row.createDiv({
                cls: 'provider-tier-label',
                text: t(`settings.providers.tier.${tier}`),
            });

            const resolvedId = this.resolveTierSlot(provider, tier);
            const overrideActive = provider.tierOverrides?.[tier] !== undefined && provider.tierOverrides?.[tier] !== '';
            const autoSuggested = provider.tierMapping?.[tier];

            // Dropdown
            const select = row.createEl('select', { cls: 'provider-tier-select' });
            const autoOpt = select.createEl('option', {
                text: autoSuggested
                    ? t('settings.providers.tier.autoLabelWith', { id: this.discoveryDisplay(provider, autoSuggested) })
                    : t('settings.providers.tier.autoEmpty'),
                value: '',
            });
            if (!overrideActive) autoOpt.selected = true;

            const models = this.sortedModelsForTier(provider, tier);
            for (const m of models) {
                const opt = select.createEl('option', {
                    text: this.modelLabel(m),
                    value: m.id,
                });
                if (provider.tierOverrides?.[tier] === m.id) opt.selected = true;
            }
            select.addEventListener('change', () => { void (async () => {
                const value = select.value;
                provider.tierOverrides = provider.tierOverrides ?? {};
                if (value === '') {
                    delete provider.tierOverrides[tier];
                } else {
                    provider.tierOverrides[tier] = value;
                }
                await this.plugin.saveSettings();
                this.rerender();
            })(); });

            // Hint (auto-detected / manually set / different tier)
            if (resolvedId) {
                const hint = row.createDiv({ cls: 'provider-tier-hint' });
                if (overrideActive) {
                    hint.setText(t('settings.providers.tier.manuallySet'));
                } else {
                    hint.setText(t('settings.providers.tier.autoDetected'));
                }
            }
        }
    }

    private renderAddProviderButton(footer: HTMLElement): void {
        const wrap = footer.createDiv({ cls: 'providers-add-wrap' });
        wrap.createEl('label', { text: t('settings.providers.addProviderLabel') });
        const select = wrap.createEl('select');
        select.createEl('option', { text: t('settings.providers.choosePicker'), value: '' });
        const existingIds = new Set((this.plugin.settings.providerConfigs ?? []).map((p) => p.id));
        for (const type of ALL_PROVIDER_TYPES) {
            const defaultId = `${type}-main`;
            const label = existingIds.has(defaultId)
                ? `${this.providerLabel(type)} (${t('settings.providers.duplicateSuffix')})`
                : this.providerLabel(type);
            select.createEl('option', { text: label, value: type });
        }
        const addBtn = wrap.createEl('button', { cls: 'mod-cta', text: t('settings.providers.addProvider') });
        addBtn.addEventListener('click', () => { void (async () => {
            const type = select.value as ProviderType;
            if (!type) return;
            const id = this.allocateInstanceId(type);
            const provider: ProviderConfig = {
                id,
                type,
                displayName: this.providerLabel(type),
                enabled: true,
                discoveredModels: [],
                lastRefreshAt: 0,
                tierMapping: {},
                tierOverrides: {},
            };
            this.plugin.settings.providerConfigs = [...(this.plugin.settings.providerConfigs ?? []), provider];
            await this.plugin.saveSettings();
            this.rerender();
        })(); });
    }

    private allocateInstanceId(type: ProviderType): string {
        const existing = new Set((this.plugin.settings.providerConfigs ?? []).map((p) => p.id));
        const base = `${type}-main`;
        if (!existing.has(base)) return base;
        let n = 2;
        while (existing.has(`${type}-${n}`)) n++;
        return `${type}-${n}`;
    }

    private resolveTierSlot(provider: ProviderConfig, tier: ModelTier): string | undefined {
        return provider.tierOverrides?.[tier] ?? provider.tierMapping?.[tier];
    }

    private discoveryDisplay(provider: ProviderConfig, modelId: string): string {
        const m = (provider.discoveredModels ?? []).find((x) => x.id === modelId);
        return m?.displayName ?? modelId;
    }

    private sortedModelsForTier(provider: ProviderConfig, tier: ModelTier): DiscoveredModel[] {
        const all = provider.discoveredModels ?? [];
        const inTier = all.filter((m) => m.autoTier === tier);
        const otherTiers = all.filter((m) => m.autoTier !== tier);
        return [...inTier, ...otherTiers];
    }

    private modelLabel(m: DiscoveredModel): string {
        const base = m.displayName ?? m.id;
        if (!m.autoTier) return base;
        return `${base}  (${m.autoTier})`;
    }

    private providerLabel(type: ProviderType): string {
        return PROVIDER_LABELS[type] ?? type;
    }

    private async persistField<K extends keyof ProviderConfig>(
        provider: ProviderConfig,
        field: K,
        value: ProviderConfig[K] | string,
    ): Promise<void> {
        // @ts-expect-error -- generic field assignment after manual check at call site
        provider[field] = value === '' ? undefined : value;
        await this.plugin.saveSettings();
    }
}

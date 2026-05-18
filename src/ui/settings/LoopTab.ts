import { App, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { t } from '../../i18n';
import { addInfoButton } from './utils';

export class LoopTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    private buildIntroSection(containerEl: HTMLElement): void {
        const infoBanner = containerEl.createDiv('vault-op-box vault-op-box--intro');
        const infoIcon = infoBanner.createSpan({ cls: 'vault-op-box__icon' });
        setIcon(infoIcon, 'lightbulb');
        const infoText = infoBanner.createDiv({ cls: 'vault-op-box__text' });
        infoText.createEl('strong', { text: t('settings.loop.introTitle') });
        infoText.createDiv({ text: t('settings.loop.introDesc') });
    }

    build(containerEl: HTMLElement): void {
        this.buildIntroSection(containerEl);

        // ── Limits & retries ─────────────────────────────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.loop.headingLoop') });

        const errorLimitSetting = new Setting(containerEl)
            .setName(t('settings.loop.errorLimit'))
            .setDesc(t('settings.loop.errorLimitDesc'));
        addInfoButton(errorLimitSetting, t('settings.loop.errorLimit'), t('settings.loop.errorLimitInfo'));
        errorLimitSetting.addText((c) =>
            c
                .setValue(String(this.plugin.settings.advancedApi.consecutiveMistakeLimit))
                .onChange(async (v) => {
                    const n = parseInt(v);
                    if (!isNaN(n) && n >= 0) {
                        this.plugin.settings.advancedApi.consecutiveMistakeLimit = n;
                        await this.plugin.saveSettings();
                    }
                }),
        );

        const rateLimitSetting = new Setting(containerEl)
            .setName(t('settings.loop.rateLimit'))
            .setDesc(t('settings.loop.rateLimitDesc'));
        addInfoButton(rateLimitSetting, t('settings.loop.rateLimit'), t('settings.loop.rateLimitInfo'));
        rateLimitSetting.addText((c) =>
            c
                .setValue(String(this.plugin.settings.advancedApi.rateLimitMs))
                .onChange(async (v) => {
                    const n = parseInt(v);
                    if (!isNaN(n) && n >= 0) {
                        this.plugin.settings.advancedApi.rateLimitMs = n;
                        await this.plugin.saveSettings();
                    }
                }),
        );

        const maxIterSetting = new Setting(containerEl)
            .setName(t('settings.loop.maxIterations'))
            .setDesc(t('settings.loop.maxIterationsDesc'));
        addInfoButton(maxIterSetting, t('settings.loop.maxIterations'), t('settings.loop.maxIterationsInfo'));
        maxIterSetting.addSlider((s) =>
            s
                .setLimits(5, 50, 5)
                .setValue(this.plugin.settings.advancedApi.maxIterations ?? 25)
                .setDynamicTooltip()
                .onChange(async (v) => {
                    this.plugin.settings.advancedApi.maxIterations = v;
                    await this.plugin.saveSettings();
                }),
        );

        const maxDepthSetting = new Setting(containerEl)
            .setName(t('settings.loop.maxSubtaskDepth'))
            .setDesc(t('settings.loop.maxSubtaskDepthDesc'));
        addInfoButton(maxDepthSetting, t('settings.loop.maxSubtaskDepth'), t('settings.loop.maxSubtaskDepthInfo'));
        maxDepthSetting.addSlider((s) =>
            s
                .setLimits(1, 3, 1)
                .setValue(this.plugin.settings.advancedApi.maxSubtaskDepth ?? 2)
                .setDynamicTooltip()
                .onChange(async (v) => {
                    this.plugin.settings.advancedApi.maxSubtaskDepth = v;
                    await this.plugin.saveSettings();
                }),
        );

        // ── Auto-summarise ──────────────────────────────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.loop.headingCondensing') });

        const condensingSetting = new Setting(containerEl)
            .setName(t('settings.loop.enableCondensing'))
            .setDesc(t('settings.loop.enableCondensingDesc'));
        addInfoButton(condensingSetting, t('settings.loop.enableCondensing'), t('settings.loop.enableCondensingInfo'));
        condensingSetting.addToggle((c) =>
            c.setValue(this.plugin.settings.advancedApi.condensingEnabled ?? false).onChange(async (v) => {
                this.plugin.settings.advancedApi.condensingEnabled = v;
                await this.plugin.saveSettings();
                thresholdSetting.settingEl.classList.toggle('agent-u-hidden', !v);
            }),
        );

        const thresholdSetting = new Setting(containerEl)
            .setName(t('settings.loop.condensingThreshold'))
            .setDesc(t('settings.loop.condensingThresholdDesc'));
        addInfoButton(thresholdSetting, t('settings.loop.condensingThreshold'), t('settings.loop.condensingThresholdInfo'));
        thresholdSetting.addSlider((s) =>
            s
                .setLimits(50, 95, 5)
                .setValue(this.plugin.settings.advancedApi.condensingThreshold ?? 80)
                .setDynamicTooltip()
                .onChange(async (v) => {
                    this.plugin.settings.advancedApi.condensingThreshold = v;
                    await this.plugin.saveSettings();
                }),
        );
        thresholdSetting.settingEl.classList.toggle('agent-u-hidden',
            !(this.plugin.settings.advancedApi.condensingEnabled ?? false));

        // ── Power steering ──────────────────────────────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.loop.headingPowerSteering') });

        const powerSteeringSetting = new Setting(containerEl)
            .setName(t('settings.loop.powerSteeringFreq'))
            .setDesc(t('settings.loop.powerSteeringFreqDesc'));
        addInfoButton(powerSteeringSetting, t('settings.loop.powerSteeringFreq'), t('settings.loop.powerSteeringFreqInfo'));
        powerSteeringSetting.addText((c) =>
            c
                .setValue(String(this.plugin.settings.advancedApi.powerSteeringFrequency ?? 0))
                .onChange(async (v) => {
                    const n = parseInt(v);
                    if (!isNaN(n) && n >= 0) {
                        this.plugin.settings.advancedApi.powerSteeringFrequency = n;
                        await this.plugin.saveSettings();
                    }
                }),
        );

        // ── Task routing ────────────────────────────────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.loop.headingHelperModel') });

        const routerSetting = new Setting(containerEl)
            .setName(t('settings.loop.autoTaskRouterName'))
            .setDesc(t('settings.loop.autoTaskRouterDesc'));
        addInfoButton(routerSetting, t('settings.loop.autoTaskRouterName'), t('settings.loop.autoTaskRouterInfo'));
        routerSetting.addToggle((toggle) =>
            toggle
                .setValue(this.plugin.settings.autoTaskRouter?.enabled ?? true)
                .onChange(async (v) => {
                    this.plugin.settings.autoTaskRouter = { enabled: v };
                    await this.plugin.saveSettings();
                }),
        );
    }
}

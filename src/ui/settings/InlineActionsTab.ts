/**
 * InlineActionsTab -- Settings UI for Inline-Editor-AI-Actions (FEAT-33-01 TR-1.6, EPIC-33).
 *
 * Renders toggles + sliders for the inlineActions settings block.
 * The tab is registered as a sub-tab in AgentSettingsTab's advanced
 * area.
 *
 * Bot-Compliance: uses Obsidian Setting API + createDiv/createEl;
 * no innerHTML or direct style mutation.
 */

import { Setting, type App } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { resolveInlineActionsSettings } from '../../core/inline/inlineSettings';
import type { InlineActionsSettings } from '../../types/settings';
import { t } from '../../i18n';

export class InlineActionsTab {
    constructor(private plugin: ObsidianAgentPlugin, private _app: App, private rerender: () => void) {}

    private getSettings(): InlineActionsSettings {
        if (this.plugin.settings.inlineActions === undefined) {
            this.plugin.settings.inlineActions = {};
        }
        return this.plugin.settings.inlineActions;
    }

    private async save(): Promise<void> {
        await this.plugin.saveSettings();
    }

    build(containerEl: HTMLElement): void {
        const intro = containerEl.createDiv('vault-op-box vault-op-box--intro');
        intro.createEl('strong', { text: t('settings.inlineActions.introTitle') });
        intro.createDiv({
            text: t('settings.inlineActions.introDesc'),
        });

        const settings = this.getSettings();
        const resolved = resolveInlineActionsSettings(settings);

        new Setting(containerEl)
            .setName(t('settings.inlineActions.enabled'))
            .setDesc(t('settings.inlineActions.enabledDesc'))
            .addToggle(t => t
                .setValue(resolved.enabled)
                .onChange(async (v) => { settings.enabled = v; await this.save(); }),
            );

        new Setting(containerEl)
            .setName(t('settings.inlineActions.floatingMenu'))
            .setDesc(t('settings.inlineActions.floatingMenuDesc'))
            .addToggle(t => t
                .setValue(resolved.floatingMenuEnabled)
                .onChange(async (v) => { settings.floatingMenuEnabled = v; await this.save(); }),
            );

        new Setting(containerEl)
            .setName(t('settings.inlineActions.vaultRag'))
            .setDesc(t('settings.inlineActions.vaultRagDesc'))
            .addToggle(t => t
                .setValue(resolved.vaultRagInLookup)
                .onChange(async (v) => { settings.vaultRagInLookup = v; await this.save(); }),
            );

        new Setting(containerEl)
            .setName(t('settings.inlineActions.ragThreshold'))
            .setDesc(t('settings.inlineActions.ragThresholdDesc'))
            .addSlider(s => s
                .setLimits(0, 1, 0.05)
                .setValue(resolved.vaultRagConfidenceThreshold)
                .setDynamicTooltip()
                .onChange(async (v) => { settings.vaultRagConfidenceThreshold = v; await this.save(); }),
            );

        new Setting(containerEl)
            .setName(t('settings.inlineActions.showSources'))
            .setDesc(t('settings.inlineActions.showSourcesDesc'))
            .addToggle(t => t
                .setValue(resolved.showVaultSourcesInTooltip)
                .onChange(async (v) => { settings.showVaultSourcesInTooltip = v; await this.save(); }),
            );

        new Setting(containerEl)
            .setName(t('settings.inlineActions.chatDisplay'))
            .setDesc(t('settings.inlineActions.chatDisplayDesc'))
            .addDropdown(d => d
                .addOption('cm-block-widget', t('settings.inlineActions.chatDisplayBlock'))
                .addOption('popover-overlay', t('settings.inlineActions.chatDisplayPopover'))
                .setValue(resolved.inlineChatDisplay)
                .onChange(async (v) => {
                    settings.inlineChatDisplay = v === 'popover-overlay' ? 'popover-overlay' : 'cm-block-widget';
                    await this.save();
                }),
            );

        new Setting(containerEl)
            .setName(t('settings.inlineActions.skillsTopN'))
            .setDesc(t('settings.inlineActions.skillsTopNDesc'))
            .addText(t => t
                .setPlaceholder('10')
                .setValue(String(resolved.skillsTopN))
                .onChange(async (raw) => {
                    const n = Number.parseInt(raw, 10);
                    if (Number.isFinite(n) && n >= 0) {
                        settings.skillsTopN = n;
                        await this.save();
                    }
                }),
            );

        // Footer: rerender control + reload hint.
        const footer = containerEl.createDiv({ cls: 'setting-item-description' });
        footer.setText(t('settings.inlineActions.reloadHint'));
        new Setting(containerEl)
            .addButton(b => b.setButtonText(t('settings.inlineActions.refreshView')).onClick(() => this.rerender()));
    }
}

/**
 * VisualIntelligenceTab — Settings UI for Visual Intelligence (FEATURE-1115)
 *
 * Toggle + LibreOffice detection + guided download.
 */

import { Setting, setIcon } from 'obsidian';
import type { App } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { detectLibreOffice, clearLibreOfficeCache } from '../../core/office/libreOfficeDetector';

export class VisualIntelligenceTab {
    constructor(
        private plugin: ObsidianAgentPlugin,
        private app: App,
        private rerender: () => void,
    ) {}

    build(containerEl: HTMLElement): void {
        // Info banner
        const infoBanner = containerEl.createDiv('agent-settings-info-banner');
        const infoIcon = infoBanner.createSpan({ cls: 'agent-settings-info-icon' });
        setIcon(infoIcon, 'eye');
        const infoText = infoBanner.createDiv({ cls: 'agent-settings-info-text' });
        infoText.createEl('strong', { text: 'Visual intelligence' });
        infoText.createDiv({
            text: 'Renders presentations to images so the agent can visually inspect layout quality, ' +
                'text overflow, and design issues. Requires LibreOffice (free, open source).',
        });

        // Master toggle
        new Setting(containerEl)
            .setName('Enable visual intelligence')
            .setDesc('When enabled, the agent can use render_presentation to visually verify created slides.')
            .addToggle((toggle) => {
                toggle
                    .setValue(this.plugin.settings.visualIntelligence?.enabled ?? false)
                    .onChange(async (value) => {
                        if (!this.plugin.settings.visualIntelligence) {
                            this.plugin.settings.visualIntelligence = { enabled: false, multimodalAnalysisApproved: false };
                        }
                        this.plugin.settings.visualIntelligence.enabled = value;
                        await this.plugin.saveSettings();
                    });
            });

        // Multimodal Template Analysis toggle
        new Setting(containerEl)
            .setName('Multimodal template analysis')
            .setDesc(
                'When enabled, template analysis uses LibreOffice rendering + Claude Vision to generate ' +
                'semantic shape aliases, visual descriptions, and usage rules automatically. ' +
                'This incurs additional API costs (~$0.50-2.00 per template analysis).',
            )
            .addToggle((toggle) => {
                toggle
                    .setValue(this.plugin.settings.visualIntelligence?.multimodalAnalysisApproved ?? false)
                    .onChange(async (value) => {
                        if (!this.plugin.settings.visualIntelligence) {
                            this.plugin.settings.visualIntelligence = { enabled: false, multimodalAnalysisApproved: false };
                        }
                        this.plugin.settings.visualIntelligence.multimodalAnalysisApproved = value;
                        await this.plugin.saveSettings();
                    });
            });

        // LibreOffice status section
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'LibreOffice' }); // eslint-disable-line obsidianmd/ui/sentence-case -- LibreOffice is a proper noun

        const statusContainer = containerEl.createDiv({ cls: 'agent-settings-status-row' });
        const statusDot = statusContainer.createSpan({ cls: 'agent-settings-status-dot' });
        const statusText = statusContainer.createSpan({ cls: 'agent-settings-status-text' });

        // Run detection
        void this.detectAndRender(statusDot, statusText, containerEl);
    }

    private async detectAndRender(
        statusDot: HTMLElement,
        statusText: HTMLElement,
        containerEl: HTMLElement,
    ): Promise<void> {
        statusText.setText('Detecting...');
        statusDot.addClass('status-connecting');

        const customPath = this.plugin.settings.visualIntelligence?.libreOfficePath;
        const result = await detectLibreOffice(customPath);

        statusDot.removeClass('status-connecting');

        if (result.found && result.path) {
            statusDot.addClass('status-connected');
            statusText.setText(`LibreOffice found: ${result.path}`);
        } else {
            statusDot.addClass('status-disconnected');
            statusText.setText('LibreOffice not found'); // eslint-disable-line obsidianmd/ui/sentence-case -- LibreOffice is a proper noun

            // Download + Retry buttons
            const btnRow = containerEl.createDiv({ cls: 'agent-settings-btn-row' });

            const downloadBtn = btnRow.createEl('button', {
                cls: 'mod-cta',
                text: 'Download LibreOffice', // eslint-disable-line obsidianmd/ui/sentence-case -- LibreOffice is a proper noun
            });
            downloadBtn.addEventListener('click', () => {
                // eslint-disable-next-line -- require electron for shell.openExternal
                const { shell } = require('electron');
                void shell.openExternal('https://www.libreoffice.org/download/');
            });

            const retryBtn = btnRow.createEl('button', {
                text: 'Re-check',
            });
            retryBtn.addEventListener('click', () => {
                clearLibreOfficeCache();
                this.rerender();
            });
        }

        // Custom path input
        new Setting(containerEl)
            .setName('Custom LibreOffice path') // eslint-disable-line obsidianmd/ui/sentence-case -- LibreOffice is a proper noun
            .setDesc('Override the auto-detected path (leave empty for auto-detection).')
            .addText((text) => {
                text
                    .setPlaceholder('/Applications/LibreOffice.app/Contents/MacOS/soffice')
                    .setValue(this.plugin.settings.visualIntelligence?.libreOfficePath ?? '')
                    .onChange(async (value) => {
                        if (!this.plugin.settings.visualIntelligence) {
                            this.plugin.settings.visualIntelligence = { enabled: false, multimodalAnalysisApproved: false };
                        }
                        this.plugin.settings.visualIntelligence.libreOfficePath = value || undefined;
                        await this.plugin.saveSettings();
                        clearLibreOfficeCache();
                    });
            });
    }
}

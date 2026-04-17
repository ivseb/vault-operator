import { App, Setting } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { DEFAULT_AGENT_FOLDER } from '../../core/utils/agentFolder';
import { pickAgentFolder } from './AgentFolderPickerModal';
import { t } from '../../i18n';


export class VaultTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: t('settings.vault.desc'),
        });

        // ── Checkpoints ─────────────────────────────────────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'CHECKPOINTS' });

        new Setting(containerEl)
            .setName(t('settings.vault.enableCheckpoints'))
            .setDesc(t('settings.vault.enableCheckpointsDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.enableCheckpoints ?? true).onChange(async (v) => {
                    this.plugin.settings.enableCheckpoints = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName(t('settings.vault.snapshotTimeout'))
            .setDesc(t('settings.vault.snapshotTimeoutDesc'))
            .addText((t) =>
                t
                    .setValue(String(this.plugin.settings.checkpointTimeoutSeconds ?? 30))
                    .onChange(async (v) => {
                        const n = parseInt(v);
                        if (!isNaN(n) && n > 0) {
                            this.plugin.settings.checkpointTimeoutSeconds = n;
                            await this.plugin.saveSettings();
                        }
                    }),
            );

        new Setting(containerEl)
            .setName(t('settings.vault.autoCleanup'))
            .setDesc(t('settings.vault.autoCleanupDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.checkpointAutoCleanup ?? true).onChange(async (v) => {
                    this.plugin.settings.checkpointAutoCleanup = v;
                    await this.plugin.saveSettings();
                }),
            );

        // ── Task Extraction (FEATURE-100) ────────────────────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.vault.taskExtraction') });
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: t('settings.vault.taskExtractionDesc'),
        });

        const taskSettings = this.plugin.settings.taskExtraction ?? { enabled: true, taskFolder: 'Tasks' };

        new Setting(containerEl)
            .setName(t('settings.vault.taskExtractionEnable'))
            .setDesc(t('settings.vault.taskExtractionEnableDesc'))
            .addToggle((toggle) =>
                toggle.setValue(taskSettings.enabled).onChange(async (v) => {
                    this.plugin.settings.taskExtraction = { ...taskSettings, enabled: v };
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName(t('settings.vault.taskFolder'))
            .setDesc(t('settings.vault.taskFolderDesc'))
            .addText((text) =>
                text
                    .setPlaceholder('Tasks')
                    .setValue(taskSettings.taskFolder)
                    .onChange(async (v) => {
                        const folder = v.trim() || 'Tasks';
                        this.plugin.settings.taskExtraction = { ...taskSettings, taskFolder: folder };
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName(t('settings.vault.preferTaskNotes'))
            .setDesc(t('settings.vault.preferTaskNotesDesc'))
            .addToggle((toggle) =>
                toggle.setValue(taskSettings.preferTaskNotesPlugin ?? true).onChange(async (v) => {
                    this.plugin.settings.taskExtraction = { ...taskSettings, preferTaskNotesPlugin: v };
                    await this.plugin.saveSettings();
                }),
            );

        // ── Agent Folder (FEATURE-0507 / Issue #26) ────────────────────────────
        containerEl.createEl('h3', {
            cls: 'agent-settings-section',
            text: t('settings.vault.agentFolderHeading'),
        });
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: t('settings.vault.agentFolderDesc'),
        });

        let currentInput: HTMLInputElement | null = null;

        new Setting(containerEl)
            .setName(t('settings.vault.agentFolder'))
            .setDesc(t('settings.vault.agentFolderFieldDesc'))
            .addText((text) => {
                currentInput = text.inputEl;
                text
                    .setPlaceholder(DEFAULT_AGENT_FOLDER)
                    .setValue(this.plugin.settings.agentFolderPath ?? DEFAULT_AGENT_FOLDER)
                    .onChange(async (v) => {
                        const trimmed = v.trim();
                        this.plugin.settings.agentFolderPath = trimmed.length > 0 ? trimmed : DEFAULT_AGENT_FOLDER;
                        await this.plugin.saveSettings();
                    });
            })
            .addButton((btn) =>
                btn
                    .setButtonText(t('settings.vault.agentFolderPick'))
                    .setIcon('folder')
                    .onClick(() => {
                        void (async () => {
                            const picked = await pickAgentFolder(this.app);
                            if (!picked) return;
                            this.plugin.settings.agentFolderPath = picked.path;
                            if (currentInput) currentInput.value = picked.path;
                            await this.plugin.saveSettings();
                        })();
                    }),
            );
    }
}

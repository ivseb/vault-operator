import { App, Setting } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { t } from '../../i18n';


export class VaultTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: t('settings.vault.desc'),
        });

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
        containerEl.createEl('h3', { text: 'Task extraction' });
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            // eslint-disable-next-line obsidianmd/ui/sentence-case -- German nouns are capitalized per grammar rules
            text: 'Erkennt Aufgaben (- [ ] items) in Agent-Antworten und erstellt Task-Notes mit strukturiertem Frontmatter.',
        });

        const taskSettings = this.plugin.settings.taskExtraction ?? { enabled: true, taskFolder: 'Tasks' };

        new Setting(containerEl)
            .setName('Task extraction aktivieren')
            // eslint-disable-next-line obsidianmd/ui/sentence-case -- German nouns are capitalized per grammar rules
            .setDesc('Nach jeder Agent-Antwort nach Aufgaben scannen und ein Auswahl-Modal anzeigen.')
            .addToggle((toggle) =>
                toggle.setValue(taskSettings.enabled).onChange(async (v) => {
                    this.plugin.settings.taskExtraction = { ...taskSettings, enabled: v };
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName('Task-ordner')
            // eslint-disable-next-line obsidianmd/ui/sentence-case -- German nouns are capitalized per grammar rules
            .setDesc('Vault-Ordner in dem Task-Notes und die Task-Base erstellt werden.')
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
            // eslint-disable-next-line obsidianmd/ui/sentence-case -- TaskNotes is a proper noun (plugin name)
            .setName('TaskNotes plugin bevorzugen')
            // eslint-disable-next-line obsidianmd/ui/sentence-case -- German nouns are capitalized per grammar rules
            .setDesc('Wenn das Community plugin "TaskNotes" aktiv ist, Tasks in dessen Format erstellen. Ansonsten wird das interne Format verwendet.')
            .addToggle((toggle) =>
                toggle.setValue(taskSettings.preferTaskNotesPlugin ?? true).onChange(async (v) => {
                    this.plugin.settings.taskExtraction = { ...taskSettings, preferTaskNotesPlugin: v };
                    await this.plugin.saveSettings();
                }),
            );
    }
}

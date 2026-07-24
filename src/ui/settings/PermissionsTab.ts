import { App, Modal, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { t } from '../../i18n';
import { addSectionHeading, addSliderInput } from './utils';
import { PLUGIN_API_ALLOWLIST } from '../../core/tools/agent/pluginApiAllowlist';
import { applyDestructiveStyle } from '../buttonStyle';
import { resetToDefaultDeny } from '../../core/tools/autoApprovalGrant';
import { PRESETS } from '../../core/tools/agent/UpdateSettingsTool';


export class PermissionsTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    private buildIntroSection(containerEl: HTMLElement): void {
        // 2026-05-18: this tab grants the agent the right to act without
        // asking. Render the intro as an orange warning callout instead
        // of the neutral blue one used on the rest of the tabs, and roll
        // up the individual per-row warnings into one explicit notice.
        const banner = containerEl.createDiv('vault-op-box vault-op-box--warning');
        const icon = banner.createSpan({ cls: 'vault-op-box__icon' });
        setIcon(icon, 'shield-alert');
        const text = banner.createDiv({ cls: 'vault-op-box__text' });
        text.createEl('strong', { text: t('settings.permissions.introTitle') });
        text.createDiv({ text: t('settings.permissions.introDesc') });

        // AUDIT-030 L-4: users who add a provider in settings but skip the
        // onboarding wizard never see the "consent to permissive defaults"
        // step. Master toggle ships off (fail-closed), so this is polish
        // not a security fix, but a one-line hint makes the posture explicit.
        if (this.plugin.settings.onboarding?.completed === false) {
            const hint = containerEl.createDiv('vault-op-box vault-op-box--info');
            const hintIcon = hint.createSpan({ cls: 'vault-op-box__icon' });
            setIcon(hintIcon, 'info');
            const hintText = hint.createDiv({ cls: 'vault-op-box__text' });
            hintText.setText(t('settings.permissions.onboardingHint'));
        }
    }

    build(containerEl: HTMLElement): void {
        this.buildIntroSection(containerEl);
        this.buildKillSwitchSection(containerEl);

        // ── Auto-approve master toggle + visibility helper ───────────────
        addSectionHeading(
            containerEl,
            t('settings.permissions.headingAutoApprove'),
            { body: t('settings.permissions.sectionAutoApproveInfo') },
        );

        // FIX-44-31: the "Permissive warning" the intro copy promises. It was
        // defined in i18n but never rendered. Render it here and re-evaluate it
        // live whenever a relevant toggle changes, so the promise is real.
        const permissiveWarning = containerEl.createDiv('vault-op-box vault-op-box--warning');
        {
            const wi = permissiveWarning.createSpan({ cls: 'vault-op-box__icon' });
            setIcon(wi, 'alert-triangle');
            permissiveWarning.createDiv({ cls: 'vault-op-box__text' })
                .setText(t('settings.permissions.permissiveWarning'));
        }
        const refreshPermissiveWarning = (): void => {
            const a = this.plugin.settings.autoApproval;
            const risky = a.enabled === true && a.web === true
                && (a.noteEdits === true || a.vaultChanges === true);
            permissiveWarning.toggleClass('agent-u-hidden', !risky);
        };

        // eslint-disable-next-line prefer-const -- forward-declared for closure capture below; assigned after the master toggles to preserve DOM order
        let categoryContainer: HTMLDivElement;
        const refreshCategoryDisabled = (): void => {
            const masterOn = this.plugin.settings.autoApproval.enabled;
            categoryContainer.classList.toggle('agent-approval-categories--disabled', !masterOn);
            // Hard-disable every interactive control inside the category
            // block when the master is off. CSS opacity alone left toggles
            // clickable, so a user could "approve sandbox" while the master
            // gate silently overrode the choice in the pipeline.
            const inputs = categoryContainer.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
                'input, button',
            );
            inputs.forEach((el) => { el.disabled = !masterOn; });
            refreshPermissiveWarning();
        };

        new Setting(containerEl)
            .setName(t('settings.permissions.enableAutoApprove'))
            .setDesc(t('settings.permissions.enableAutoApproveDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.enabled).onChange(async (v) => {
                    this.plugin.settings.autoApproval.enabled = v;
                    await this.plugin.saveSettings();
                    refreshCategoryDisabled();
                }),
            );

        // FEAT-30-07: aus dem Loop-Tab hierher verschoben. Der Timeout
        // gehoert zum Approval-System (Auto-Deny unbeantworteter Karten,
        // IMP-41-01-02) und wirkt unabhaengig vom Auto-Approve-Master,
        // deshalb steht er ausserhalb des Kategorie-Containers.
        const approvalTimeoutSetting = new Setting(containerEl)
            .setName(t('settings.loop.approvalTimeout'))
            .setDesc(t('settings.loop.approvalTimeoutDesc'));
        addSliderInput(approvalTimeoutSetting, {
            min: 0, max: 60, step: 5,
            value: this.plugin.settings.advancedApi.approvalTimeoutMinutes ?? 10,
            onChange: async (v) => {
                this.plugin.settings.advancedApi.approvalTimeoutMinutes = v;
                await this.plugin.saveSettings();
            },
        });

        // FEAT-30-07: Auto-Promotion (Tier-2-Methode wird nach N echten
        // User-Approvals dauerhaft als Read auto-genehmigt) ist eine
        // Consent-Entscheidung und lebt deshalb hier statt im Plugin-API-
        // Tab. Review-Finding: sie greift bei ECHTEN User-Approvals, also
        // gerade auch bei ausgeschaltetem Auto-Approve-Master; deshalb
        // steht der Toggle ausserhalb des Kategorie-Containers. Widerruf
        // promoteter Methoden: Advanced > Plugin API.
        new Setting(containerEl)
            .setName(t('settings.shell.autoPromote'))
            .setDesc(t('settings.shell.autoPromoteDesc'))
            .addToggle((tg) => tg
                .setValue(this.plugin.settings.pluginApi?.autoPromotionEnabled !== false)
                .onChange(async (v) => {
                    if (!this.plugin.settings.pluginApi) {
                        this.plugin.settings.pluginApi = { enabled: true, safeMethodOverrides: {} };
                    }
                    this.plugin.settings.pluginApi.autoPromotionEnabled = v;
                    await this.plugin.saveSettings();
                }));

        // FIX-44-03c: the "Show approval bar in chat" toggle was removed. It
        // wrote autoApproval.showMenuInChat, which nothing consumed -- the
        // quick-toggle bar it promised does not exist. A toggle that does
        // nothing is a lie about the settings surface.

        // ── Per-category toggles ─────────────────────────────────────────
        categoryContainer = containerEl.createDiv('agent-approval-categories');

        addSectionHeading(
            categoryContainer,
            t('settings.permissions.headingPerCategory'),
            { body: t('settings.permissions.sectionPerCategoryInfo') },
        );

        // FIX-44-03c: reads are always auto-approved and master-independent
        // (EFFECT_POLICY.read has key:null). The old "Read operations" TOGGLE
        // wrote autoApproval.read, which the gate never reads -- turning it off
        // did nothing. Replaced with a non-interactive statement of fact so the
        // posture is honest instead of a dead switch.
        new Setting(categoryContainer)
            .setName(t('settings.permissions.readsAlwaysRun'))
            .setDesc(t('settings.permissions.readsAlwaysRunDesc'))
            .setDisabled(true);

        new Setting(categoryContainer)
            .setName(t('settings.permissions.noteEdits'))
            .setDesc(t('settings.permissions.noteEditsDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.noteEdits).onChange(async (v) => {
                    this.plugin.settings.autoApproval.noteEdits = v;
                    await this.plugin.saveSettings();
                    refreshPermissiveWarning();
                }),
            );

        new Setting(categoryContainer)
            .setName(t('settings.permissions.vaultChanges'))
            .setDesc(t('settings.permissions.vaultChangesDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.vaultChanges).onChange(async (v) => {
                    this.plugin.settings.autoApproval.vaultChanges = v;
                    await this.plugin.saveSettings();
                    refreshPermissiveWarning();
                }),
            );

        new Setting(categoryContainer)
            .setName(t('settings.permissions.webOps'))
            .setDesc(t('settings.permissions.webOpsDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.web).onChange(async (v) => {
                    this.plugin.settings.autoApproval.web = v;
                    await this.plugin.saveSettings();
                    refreshPermissiveWarning();
                }),
            );

        new Setting(categoryContainer)
            .setName(t('settings.permissions.mcpCalls'))
            .setDesc(t('settings.permissions.mcpCallsDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.mcp).onChange(async (v) => {
                    this.plugin.settings.autoApproval.mcp = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(categoryContainer)
            .setName(t('settings.permissions.subtasks'))
            .setDesc(t('settings.permissions.subtasksDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.subtasks).onChange(async (v) => {
                    this.plugin.settings.autoApproval.subtasks = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(categoryContainer)
            .setName(t('settings.permissions.pluginSkills'))
            .setDesc(t('settings.permissions.pluginSkillsDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.skills).onChange(async (v) => {
                    this.plugin.settings.autoApproval.skills = v;
                    await this.plugin.saveSettings();
                }),
            );

        addSectionHeading(
            categoryContainer,
            t('settings.permissions.headingPluginApi'),
            { body: t('settings.permissions.sectionPluginApiInfo') },
        );

        new Setting(categoryContainer)
            .setName(t('settings.permissions.pluginApiReads'))
            .setDesc(t('settings.permissions.pluginApiReadsDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.pluginApiRead ?? true).onChange(async (v) => {
                    this.plugin.settings.autoApproval.pluginApiRead = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(categoryContainer)
            .setName(t('settings.permissions.pluginApiWrites'))
            .setDesc(t('settings.permissions.pluginApiWritesDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.pluginApiWrite ?? false).onChange(async (v) => {
                    this.plugin.settings.autoApproval.pluginApiWrite = v;
                    await this.plugin.saveSettings();
                }),
            );

        // FEAT-30-07: die read/write-Klassifikation, die diese beiden Toggles
        // steuern, kommt aus der kuratierten Built-in-Allowlist. Die Liste
        // stand vorher als 23 statische Zeilen im Shell-Tab; hier ist sie
        // die einklappbare Erklaerung direkt neben den Consent-Toggles.
        this.buildAllowlistCatalog(categoryContainer);

        new Setting(categoryContainer)
            .setName(t('settings.permissions.recipes'))
            .setDesc(t('settings.permissions.recipesDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.autoApproval.recipes ?? false).onChange(async (v) => {
                    this.plugin.settings.autoApproval.recipes = v;
                    await this.plugin.saveSettings();
                }),
            );

        addSectionHeading(
            categoryContainer,
            t('settings.permissions.headingSandbox'),
            { body: t('settings.permissions.sectionSandboxInfo') },
        );

        new Setting(categoryContainer)
            .setName(t('settings.permissions.sandbox'))
            .setDesc(t('settings.permissions.sandboxDesc'))
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.autoApproval.sandbox ?? false).onChange(async (v) => {
                    if (v) {
                        const confirmed = await this.confirmHighRisk(
                            t('settings.permissions.sandboxConfirmTitle'),
                            t('settings.permissions.sandboxConfirmMessage'),
                        );
                        if (!confirmed) {
                            toggle.setValue(false);
                            return;
                        }
                    }
                    this.plugin.settings.autoApproval.sandbox = v;
                    await this.plugin.saveSettings();
                }),
            );

        // Apply the initial disabled state (after every control exists).
        refreshCategoryDisabled();
    }

    /**
     * FEAT-30-07: einklappbarer Katalog der kuratierten Plugin-API-Methoden.
     * Er ist die Datenquelle der pluginApiRead/pluginApiWrite-Toggles
     * (isPluginApiWriteCall klassifiziert Calls gegen genau diese Liste)
     * und stand vorher als 23 statische Zeilen im Shell-Tab.
     */
    private buildAllowlistCatalog(containerEl: HTMLElement): void {
        const details = containerEl.createEl('details', { cls: 'agent-permissions-catalog' });
        details.createEl('summary', {
            text: t('settings.permissions.allowlistCatalog', { count: PLUGIN_API_ALLOWLIST.length }),
        });
        details.createDiv({
            cls: 'setting-item-description',
            text: t('settings.permissions.allowlistCatalogDesc'),
        });
        for (const entry of PLUGIN_API_ALLOWLIST) {
            const badge = entry.isWrite ? t('settings.shell.badgeWrite') : t('settings.shell.badgeRead');
            new Setting(details)
                .setName(`${entry.pluginId}.${entry.method}`)
                .setDesc(`${entry.description}${badge}`);
        }
    }

    /**
     * FEAT-44-07: the kill switch, rendered ABOVE the auto-approve controls so
     * the way back to fail-closed is always in sight, never buried below the
     * grants it revokes. Two parts:
     *
     * (b) "Always ask (paranoid mode)": a persisted plain setting (survives the
     *     reload -- a brake that silently drops off on restart would be a trap).
     *     While on, the pipeline asks for every effect except read/ui,
     *     regardless of the toggles below, presets, and run-/session grants.
     *     Deliberately NOT an autoApproval category key, so the EFFECT_POLICY
     *     drift contract stays untouched.
     *
     * (a) "Reset to default-deny": one click (plus confirm) back to the
     *     restrictive preset, revoking all run- and session-scope grants.
     */
    private buildKillSwitchSection(containerEl: HTMLElement): void {
        addSectionHeading(
            containerEl,
            t('settings.permissions.headingKillSwitch'),
            { body: t('settings.permissions.sectionKillSwitchInfo') },
        );

        new Setting(containerEl)
            .setName(t('settings.permissions.paranoidMode'))
            .setDesc(t('settings.permissions.paranoidModeDesc'))
            .addToggle((tg) =>
                tg.setValue(this.plugin.settings.paranoidMode === true).onChange(async (v) => {
                    this.plugin.settings.paranoidMode = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName(t('settings.permissions.resetDefaultDeny'))
            .setDesc(t('settings.permissions.resetDefaultDenyDesc'))
            .addButton((btn) => {
                btn.setButtonText(t('settings.permissions.resetDefaultDenyButton'));
                applyDestructiveStyle(btn);
                btn.onClick(() => {
                    void (async () => {
                        const ok = await this.confirmHighRisk(
                            t('settings.permissions.resetConfirmTitle'),
                            t('settings.permissions.resetConfirmMessage'),
                            t('settings.permissions.resetConfirmAccept'),
                        );
                        if (!ok) return;
                        resetToDefaultDeny(this.plugin, PRESETS.restrictive);
                        await this.plugin.saveSettings();
                        new Notice(t('settings.permissions.resetDone'));
                        // Re-render so every toggle shows its post-reset state.
                        this.rerender();
                    })();
                });
            });
    }

    /**
     * Show a confirmation dialog for high-risk settings.
     * Returns true if the user confirmed, false otherwise.
     */
    private confirmHighRisk(title: string, message: string, acceptLabel?: string): Promise<boolean> {
        return new Promise((resolve) => {
            const modal = new (class extends Modal {
                onOpen(): void {
                    const { contentEl } = this;
                    contentEl.createEl('h3', { text: title });
                    contentEl.createEl('p', { text: message, cls: 'agent-setting-confirm-message' });

                    const btnRow = contentEl.createDiv('agent-setting-confirm-buttons');
                    const cancelBtn = btnRow.createEl('button', { text: t('settings.permissions.sandboxConfirmCancel') });
                    const confirmBtn = btnRow.createEl('button', {
                        text: acceptLabel ?? t('settings.permissions.sandboxConfirmAccept'),
                        cls: 'mod-warning',
                    });
                    cancelBtn.addEventListener('click', () => { this.close(); resolve(false); });
                    confirmBtn.addEventListener('click', () => { this.close(); resolve(true); });
                }
                onClose(): void {
                    resolve(false);
                }
            })(this.app);
            modal.open();
        });
    }
}

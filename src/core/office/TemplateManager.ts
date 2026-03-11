/**
 * TemplateManager -- loads default and user PPTX templates.
 *
 * Default templates are bundled with the plugin in the templates/ directory.
 * User templates can come from the vault or chat uploads.
 */

import { TFile } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';

const DEFAULT_TEMPLATE_NAME = 'default-executive';

const TEMPLATE_NAMES = [
    'default-executive',
    'default-modern',
    'default-minimal',
] as const;

export type DefaultTemplateName = typeof TEMPLATE_NAMES[number];

export class TemplateManager {
    private readonly plugin: ObsidianAgentPlugin;

    constructor(plugin: ObsidianAgentPlugin) {
        this.plugin = plugin;
    }

    /**
     * Load a bundled default template by name.
     * Falls back to 'default-executive' if name not found.
     */
    async loadDefaultTemplate(name?: string): Promise<ArrayBuffer> {
        const templateName = name && TEMPLATE_NAMES.includes(name as DefaultTemplateName)
            ? name
            : DEFAULT_TEMPLATE_NAME;

        const pluginDir = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
        const templatePath = `${pluginDir}/templates/${templateName}.pptx`;

        try {
            return await this.plugin.app.vault.adapter.readBinary(templatePath);
        } catch {
            throw new Error(
                `Default template "${templateName}" not found at ${templatePath}. ` +
                `Ensure the plugin was deployed correctly.`,
            );
        }
    }

    /**
     * Load a PPTX template from the vault by path.
     * If exact path doesn't match, searches for the filename across the vault.
     */
    async loadVaultTemplate(vaultPath: string): Promise<ArrayBuffer> {
        let file = this.plugin.app.vault.getAbstractFileByPath(vaultPath);

        // Fallback: search by filename if exact path not found
        if (!(file instanceof TFile)) {
            const filename = vaultPath.split('/').pop() ?? vaultPath;
            const allFiles = this.plugin.app.vault.getFiles();
            const match = allFiles.find(f =>
                f.name === filename && /^(pptx|potx)$/i.test(f.extension),
            );
            if (match) {
                file = match;
                console.debug(`[TemplateManager] Resolved "${vaultPath}" to "${match.path}"`);
            }
        }

        if (!(file instanceof TFile)) {
            throw new Error(`Template file not found in vault: ${vaultPath}`);
        }
        if (!file.extension.toLowerCase().match(/^(pptx|potx)$/)) {
            throw new Error(`Template must be a .pptx or .potx file, got: .${file.extension}`);
        }
        return await this.plugin.app.vault.readBinary(file);
    }

    /**
     * List available default template names.
     */
    listDefaultTemplates(): string[] {
        return [...TEMPLATE_NAMES];
    }
}

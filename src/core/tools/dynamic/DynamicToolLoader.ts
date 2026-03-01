/**
 * DynamicToolLoader
 *
 * Loads persisted dynamic tools from the plugin data directory at startup
 * and registers them with the ToolRegistry.
 *
 * Dynamic tools are stored as JSON records in:
 *   <configDir>/plugins/<pluginId>/dynamic-tools/<name>.json
 *
 * Part of Self-Development Phase 3: Sandbox + Dynamic Modules.
 */

import { TFile, TFolder } from 'obsidian';
import type ObsidianAgentPlugin from '../../../main';
import type { ToolRegistry } from '../ToolRegistry';
import type { SandboxExecutor } from '../../sandbox/SandboxExecutor';
import { DynamicToolFactory } from './DynamicToolFactory';
import type { DynamicToolRecord } from './types';

// ---------------------------------------------------------------------------
// DynamicToolLoader
// ---------------------------------------------------------------------------

export class DynamicToolLoader {
    private readonly toolsDir: string;

    constructor(private plugin: ObsidianAgentPlugin) {
        this.toolsDir = `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}/dynamic-tools`;
    }

    /**
     * Load all persisted dynamic tools and register them.
     */
    async loadAll(
        registry: ToolRegistry,
        sandboxExecutor: SandboxExecutor,
    ): Promise<number> {
        const folder = this.plugin.app.vault.getAbstractFileByPath(this.toolsDir);
        if (!(folder instanceof TFolder)) return 0;

        let loaded = 0;
        for (const child of folder.children) {
            if (child instanceof TFile && child.extension === 'json') {
                try {
                    const content = await this.plugin.app.vault.read(child);
                    const record = JSON.parse(content) as DynamicToolRecord;

                    const tool = DynamicToolFactory.create(
                        record.definition,
                        record.compiledJs,
                        sandboxExecutor,
                        this.plugin,
                    );
                    registry.register(tool);
                    loaded++;
                } catch (e) {
                    console.warn(`[DynamicToolLoader] Failed to load ${child.path}:`, e);
                }
            }
        }

        if (loaded > 0) {
            console.debug(`[DynamicToolLoader] Loaded ${loaded} dynamic tool(s)`);
        }
        return loaded;
    }

    /**
     * Save a dynamic tool record to disk.
     */
    async save(record: DynamicToolRecord): Promise<void> {
        await this.ensureDir();
        const filePath = `${this.toolsDir}/${record.definition.name}.json`;
        const content = JSON.stringify(record, null, 2);

        const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            await this.plugin.app.vault.modify(file, content);
        } else {
            await this.plugin.app.vault.create(filePath, content);
        }
    }

    /**
     * Delete a dynamic tool record from disk.
     */
    async remove(name: string): Promise<void> {
        const filePath = `${this.toolsDir}/${name}.json`;
        const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            await this.plugin.app.fileManager.trashFile(file);
        }
    }

    /**
     * List all persisted dynamic tool names.
     */
    async listNames(): Promise<string[]> {
        const folder = this.plugin.app.vault.getAbstractFileByPath(this.toolsDir);
        if (!(folder instanceof TFolder)) return [];
        return folder.children
            .filter((c): c is TFile => c instanceof TFile && c.extension === 'json')
            .map(f => f.basename);
    }

    /**
     * Get the tools directory path.
     */
    getToolsDir(): string {
        return this.toolsDir;
    }

    private async ensureDir(): Promise<void> {
        const folder = this.plugin.app.vault.getAbstractFileByPath(this.toolsDir);
        if (!(folder instanceof TFolder)) {
            await this.plugin.app.vault.createFolder(this.toolsDir);
        }
    }
}

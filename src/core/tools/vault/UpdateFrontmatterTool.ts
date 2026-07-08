/**
 * UpdateFrontmatterTool - Set or update YAML frontmatter fields in a note
 *
 * Uses Obsidian's fileManager.processFrontMatter for safe atomic updates.
 * This is the correct Obsidian API that handles all edge cases:
 * - Creates frontmatter block if none exists
 * - Preserves existing fields not mentioned in updates
 * - Handles list/array values correctly
 */

import { TFile } from 'obsidian';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

interface UpdateFrontmatterInput {
    path: string;
    updates: Record<string, unknown>;
    remove?: string[];
}

export class UpdateFrontmatterTool extends BaseTool<'update_frontmatter'> {
    readonly name = 'update_frontmatter' as const;
    readonly isWriteOperation = true;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'update_frontmatter',
            description:
                'Set or update YAML frontmatter fields in a note. Existing fields not mentioned in updates are preserved. Creates the frontmatter block if the note has none. Use this to set tags, status, dates, aliases, or any custom metadata.',
            input_schema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Path to the note relative to vault root.',
                    },
                    updates: {
                        type: 'object',
                        description:
                            'Key-value pairs to set. Values can be strings, numbers, booleans, or arrays. Example: {"status": "done", "tags": ["project", "active"], "priority": 1}',
                    },
                    remove: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Optional list of frontmatter keys to delete.',
                    },
                },
                required: ['path', 'updates'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { path, updates, remove = [] } = input as unknown as UpdateFrontmatterInput;
        const { callbacks } = context;

        try {
            if (!path) throw new Error('path parameter is required');
            if (!updates || typeof updates !== 'object') throw new Error('updates must be an object');

            const file = this.app.vault.getAbstractFileByPath(path);
            if (!file) throw new Error(`File not found: ${path}`);
            if (!(file instanceof TFile)) throw new Error(`Path is not a file: ${path}`);

            const changed: string[] = [];

            // processFrontMatter is the canonical Obsidian API for this
            await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
                for (const [key, value] of Object.entries(updates)) {
                    fm[key] = value;
                    changed.push(`${key}: ${JSON.stringify(value)}`);
                }
                for (const key of remove) {
                    if (key in fm) {
                        delete fm[key];
                        changed.push(`removed: ${key}`);
                    }
                }
            });

            const summary = changed.join(', ');
            // IMP-01-04-03 (Lever C): echo the ACTUAL re-read frontmatter block
            // (Obsidian serialises YAML its own way, not JSON) so the model has
            // the authoritative post-write frontmatter and the file's top
            // structure without re-reading the whole file. Small + size-safe.
            let echo = '';
            try {
                const after = await this.app.vault.read(file);
                const m = after.match(/^---\n[\s\S]*?\n---/);
                if (m) {
                    echo = '\n' + this.formatUntrustedContent('vault', m[0], { path, region: 'frontmatter' });
                }
            } catch { /* non-fatal: fall back to the change summary only */ }
            callbacks.pushToolResult(
                this.formatSuccess(
                    `Updated frontmatter in ${path} — ${summary}. Frontmatter now (no need to re-read the file):`,
                ) + echo,
            );
            callbacks.log(`Updated frontmatter in ${path}`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('update_frontmatter', error);
        }
    }
}

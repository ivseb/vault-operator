/**
 * mark_note_as_memory_source -- FEAT-03-25 / ADR-109.
 *
 * Markiert eine Vault-Note als memory-source. Effekt: bei naechstem
 * FrontmatterIndexer-Pass auf der Note (oder beim ersten Aufruf
 * direkt nach Mark) wird Single-Call-Extraction der Note-Inhalte
 * getriggert. Idempotent: doppeltes Mark schadet nicht.
 *
 * Optional: setzt zusaetzlich `memory-source: true` im Frontmatter
 * der Note (Default true), damit der Marker auch ueber andere
 * Tools/UI-Ansichten sichtbar bleibt.
 */

import { TFile } from 'obsidian';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import { validateVaultRelativePath } from './pathValidation';
import type { EditPreview } from '../editPreview';
import { resolveFrontmatterUpdate } from './frontmatterEdit';
import { checkFrontmatterIntegrity } from '../../utils/frontmatterGuard';
import { refreshOpenMarkdownViewsFor } from '../../utils/refreshMarkdownView';

interface Input {
    note_path: string;
    write_frontmatter?: boolean;
}

export class MarkNoteAsMemorySourceTool extends BaseTool<'mark_note_as_memory_source'> {
    readonly name = 'mark_note_as_memory_source' as const;
    readonly isWriteOperation = true;

    constructor(plugin: ObsidianAgentPlugin) { super(plugin); }

    getDefinition(): ToolDefinition {
        return {
            name: 'mark_note_as_memory_source',
            description:
                'Mark a Vault note as memory-source. The note\'s content will be extracted into '
                + 'Memory v2 facts on the next indexer pass (and re-extracted incrementally when '
                + 'the note is edited). Idempotent. Optionally writes `memory-source: true` to the '
                + 'note frontmatter so the marker stays visible.',
            input_schema: {
                type: 'object',
                properties: {
                    note_path: { type: 'string', description: 'Vault-relative path to a markdown note.' },
                    write_frontmatter: {
                        type: 'boolean',
                        description: 'Default true: also write `memory-source: true` to the note frontmatter.',
                    },
                },
                required: ['note_path'],
            },
        };
    }

    /**
     * FIX-44-13a: the diff the approval gate shows. Never writes.
     *
     * The frontmatter change (`memory-source: true`) is resolved by the same
     * `resolveFrontmatterUpdate` that `execute` writes through, so the diff the
     * user approves is by construction what lands on disk. Returns null when
     * there is nothing to diff (write_frontmatter=false, marker already set,
     * missing note) -- the Pipeline then falls back to the plain card, never to
     * no approval.
     */
    async previewEdit(input: Record<string, unknown>): Promise<EditPreview | null> {
        try {
            const { note_path, write_frontmatter = true } = input as unknown as Input;
            if (!write_frontmatter) return null;   // only the DB-side marker changes
            if (!note_path || typeof note_path !== 'string') return null;
            const safe = validateVaultRelativePath(note_path);
            if (!safe) return null;
            const file = this.plugin.app.vault.getAbstractFileByPath(safe);
            if (!(file instanceof TFile) || file.extension !== 'md') return null;

            const content = await this.plugin.app.vault.read(file);
            const { newContent } = resolveFrontmatterUpdate(content, { 'memory-source': true });
            if (newContent === content) return null;   // already marked: nothing to show
            return { path: safe, before: content, after: newContent };
        } catch {
            // A preview is a courtesy, never a gate. Fall back to the plain card.
            return null;
        }
    }

    async execute(input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<void> {
        const { note_path, write_frontmatter = true } = input as unknown as Input;
        if (!note_path || typeof note_path !== 'string') {
            ctx.callbacks.pushToolResult(this.formatError('note_path is required'));
            return;
        }
        // AUDIT-016 L-5: shared validateVaultRelativePath -- gleicher
        // Schutz wie in IngestTriageTool (Windows backslashes, NUL,
        // url-encoded traversal).
        const safe = validateVaultRelativePath(note_path);
        if (!safe) {
            ctx.callbacks.pushToolResult(this.formatError(`Invalid note path: ${note_path}`));
            return;
        }

        const file = this.plugin.app.vault.getAbstractFileByPath(safe);
        if (!(file instanceof TFile) || file.extension !== 'md') {
            ctx.callbacks.pushToolResult(this.formatError(`Markdown note not found: ${safe}`));
            return;
        }

        const store = this.plugin.memorySourceStore;
        if (!store) {
            ctx.callbacks.pushToolResult(this.formatError('MemorySourceStore not available (memory.db not open).'));
            return;
        }

        store.upsert(safe, 'agent-tool');

        if (write_frontmatter) {
            try {
                // FIX-44-13a: resolve + write through the same function whose
                // result the approval gate previewed. The old
                // fileManager.processFrontMatter reads/mutates/writes in one
                // atomic step and cannot say what it is ABOUT to write, so the
                // gate could only ever show a name card.
                const content = await this.plugin.app.vault.read(file);
                const { newContent } = resolveFrontmatterUpdate(content, { 'memory-source': true });
                if (newContent !== content) {
                    // FIX-44-09: never leave the frontmatter broken.
                    const reason = checkFrontmatterIntegrity(content, newContent);
                    if (reason) throw new Error(reason);
                    await this.plugin.app.vault.modify(file, newContent);
                    // FIX-01-07-03: push into the open CodeMirror buffer,
                    // otherwise the stale buffer saves itself back over the write.
                    await refreshOpenMarkdownViewsFor(this.plugin.app, file, newContent);
                }
            } catch (e) {
                console.warn(`[mark_note_as_memory_source] frontmatter write failed for ${safe}:`, e);
            }
        }

        // Trigger indexer pass right away so the note is extracted
        // without waiting for the next vault.on(modify).
        try {
            await this.plugin.frontmatterIndexer?.indexNote(file);
        } catch (e) {
            console.debug(`[mark_note_as_memory_source] indexer pass failed for ${safe}:`, e);
        }

        ctx.callbacks.pushToolResult(this.formatSuccess(
            `Note "${safe}" marked as memory-source. Extraction will run on the next indexer pass.`,
        ));
    }
}

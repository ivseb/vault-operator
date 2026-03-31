/**
 * read_notes -- Read one or more vault files with frontmatter, tags, and linked notes.
 */

import { TFile } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import type { McpToolResult } from '../types';

export async function handleReadNotes(
    plugin: ObsidianAgentPlugin,
    args: Record<string, unknown>,
): Promise<McpToolResult> {
    const paths = args.paths as string[] | undefined;
    if (!paths || !Array.isArray(paths) || paths.length === 0) {
        return { content: [{ type: 'text', text: 'Error: paths parameter is required (array of file paths)' }], isError: true };
    }

    const results: string[] = [];

    for (const path of paths.slice(0, 20)) { // max 20 files per call
        const file = plugin.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
            results.push(`--- ${path} ---\nError: File not found`);
            continue;
        }

        try {
            const content = await plugin.app.vault.cachedRead(file);
            const cache = plugin.app.metadataCache.getFileCache(file);

            // Frontmatter
            const fm = cache?.frontmatter;
            const fmStr = fm ? Object.entries(fm)
                .filter(([k]) => k !== 'position')
                .map(([k, v]) => `${k}: ${String(v)}`)
                .join('\n') : '';

            // Tags
            const tags: string[] = [];
            if (fm?.tags) {
                const arr = Array.isArray(fm.tags) ? fm.tags : [fm.tags];
                arr.forEach((t: unknown) => tags.push(String(t)));
            }
            if (cache?.tags) {
                cache.tags.forEach(tc => {
                    if (!tags.includes(tc.tag)) tags.push(tc.tag);
                });
            }

            // Linked notes
            const links = cache?.links?.map(l => l.link) ?? [];

            results.push([
                `--- ${path} ---`,
                fmStr ? `Frontmatter:\n${fmStr}` : '',
                tags.length > 0 ? `Tags: ${tags.join(', ')}` : '',
                links.length > 0 ? `Links: ${links.join(', ')}` : '',
                '',
                content,
            ].filter(Boolean).join('\n'));
        } catch (e) {
            results.push(`--- ${path} ---\nError: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    return { content: [{ type: 'text', text: results.join('\n\n') }] };
}

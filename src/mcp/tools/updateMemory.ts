/**
 * update_memory -- Update persistent memory files (profile, patterns, errors, projects).
 * Called by Claude when it learns something about the user or discovers a pattern.
 */

import type ObsidianAgentPlugin from '../../main';
import type { McpToolResult } from '../types';

const CATEGORY_MAP: Record<string, string> = {
    profile: 'user-profile.md',
    patterns: 'patterns.md',
    errors: 'errors.md',
    projects: 'projects.md',
};

export async function handleUpdateMemory(
    plugin: ObsidianAgentPlugin,
    args: Record<string, unknown>,
): Promise<McpToolResult> {
    const category = String(args.category ?? '');
    const content = String(args.content ?? '');

    if (!category || !CATEGORY_MAP[category]) {
        return {
            content: [{ type: 'text', text: `Error: category must be one of: ${Object.keys(CATEGORY_MAP).join(', ')}` }],
            isError: true,
        };
    }

    if (!content.trim()) {
        return { content: [{ type: 'text', text: 'Error: content is required' }], isError: true };
    }

    if (!plugin.memoryService) {
        return { content: [{ type: 'text', text: 'Error: Memory service not available' }], isError: true };
    }

    try {
        const fileName = CATEGORY_MAP[category];
        // Prefix with [via MCP] for transparency (FEATURE-1411)
        const prefixed = `\n[via MCP] ${content}`;
        await plugin.memoryService.appendToFile(fileName, prefixed);
        return { content: [{ type: 'text', text: `Updated ${fileName} (${category})` }] };
    } catch (e) {
        return {
            content: [{ type: 'text', text: `Error updating memory: ${e instanceof Error ? e.message : String(e)}` }],
            isError: true,
        };
    }
}

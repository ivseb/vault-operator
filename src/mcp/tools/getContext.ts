/**
 * get_context -- Returns user profile, memory, vault stats, skills, and rules.
 * ALWAYS called first by Claude to understand the user and vault context.
 */

import type ObsidianAgentPlugin from '../../main';
import type { McpToolResult } from '../types';

export async function handleGetContext(plugin: ObsidianAgentPlugin): Promise<McpToolResult> {
    const sections: string[] = [];

    // Memory context (user-profile, patterns, soul, projects)
    if (plugin.memoryService) {
        try {
            const files = await plugin.memoryService.loadMemoryFiles();
            const ctx = plugin.memoryService.buildMemoryContext(files);
            if (ctx) sections.push(ctx);
        } catch { /* non-fatal */ }
    }

    // Vault stats
    const vault = plugin.app.vault;
    const files = vault.getMarkdownFiles();
    const graphStore = plugin.graphStore;
    sections.push([
        '--- Vault Stats ---',
        `Notes: ${files.length}`,
        `Folders: ${vault.getAllFolders().length}`,
        `Graph edges: ${graphStore?.getEdgeCount() ?? 0}`,
        `Graph tags: ${graphStore?.getTagCount() ?? 0}`,
        `Semantic index: ${plugin.semanticIndex?.isIndexed ? 'built' : 'not built'}`,
        `Implicit connections: ${plugin.implicitConnectionService?.getCount() ?? 0}`,
    ].join('\n'));

    // Available skills
    if (plugin.skillsManager) {
        try {
            const skills = await plugin.skillsManager.discoverSkills();
            if (skills.length > 0) {
                sections.push('--- Available Skills ---');
                for (const s of skills) {
                    sections.push(`- ${s.name}: ${s.description ?? ''}`);
                }
            }
        } catch { /* non-fatal */ }
    }

    // Rules
    if (plugin.rulesLoader) {
        try {
            const rules = await plugin.rulesLoader.discoverRules();
            if (rules.length > 0) {
                sections.push('--- User Rules ---');
                for (const r of rules) {
                    sections.push(`- ${r}`);
                }
            }
        } catch { /* non-fatal */ }
    }

    return {
        content: [{ type: 'text', text: sections.join('\n\n') }],
    };
}

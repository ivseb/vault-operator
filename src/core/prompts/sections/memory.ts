/**
 * User Memory Section
 *
 * Injected after vault context, before tools. Contains user profile,
 * active projects, and behavioral patterns from the memory system.
 * Only included when memory context is available.
 *
 * FEATURE-1508: Memory files are stored outside the vault ({vault-parent}/.obsidian-agent/memory/).
 * The agent cannot access them via read_file/edit_file. Instead, memory is injected
 * into the system prompt and updated automatically via the extraction pipeline.
 */

export function getMemorySection(memoryContext?: string): string {
    if (!memoryContext?.trim()) return '';

    return [
        '',
        '====',
        '',
        'YOUR PERSISTENT MEMORY',
        '',
        'Your memory is loaded automatically into every conversation and persists across sessions.',
        'Memory is updated after each conversation via the extraction pipeline.',
        '',
        'Memory categories:',
        '  - Agent Identity — Your name, communication style, values',
        '  - User Profile — User identity, preferences, communication style',
        '  - Active Projects — Current projects and goals',
        '  - Behavioral Patterns — Workflow rules, learned procedures',
        '  - Known Errors — Error patterns and their resolutions',
        '',
        'When the user asks you to remember something, acknowledge it.',
        'The memory extraction pipeline will automatically save it after the conversation.',
        '',
        memoryContext.trim(),
    ].join('\n');
}

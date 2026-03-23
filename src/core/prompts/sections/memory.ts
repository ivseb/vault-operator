/**
 * User Memory Section
 *
 * Injected after vault context, before tools. Contains user profile,
 * active projects, and behavioral patterns from the memory system.
 * Only included when memory context is available.
 */

export function getMemorySection(memoryContext?: string): string {
    if (!memoryContext?.trim()) return '';

    return [
        '',
        '====',
        '',
        'YOUR PERSISTENT MEMORY',
        '',
        'You have a persistent memory stored in `.obsilo-sync/memory/` inside the vault.',
        'This memory is loaded into every conversation and persists across sessions.',
        '',
        'Memory files (use read_file and edit_file to manage):',
        '  - `.obsilo-sync/memory/patterns.md` — Workflow rules, behavioral patterns, learned procedures',
        '  - `.obsilo-sync/memory/learnings.md` — Task strategies, what worked/failed, tool effectiveness',
        '  - `.obsilo-sync/memory/user-profile.md` — User identity, preferences, communication style',
        '  - `.obsilo-sync/memory/projects.md` — Active projects and goals',
        '  - `.obsilo-sync/memory/errors.md` — Known errors and their fixes',
        '  - `.obsilo-sync/memory/soul.md` — Your identity, name, values (change rarely)',
        '  - `.obsilo-sync/memory/custom-tools.md` — Custom tools and skills register',
        '',
        'IMPORTANT RULES:',
        '- When asked to remember something: use edit_file on the EXACT paths above. NOT on Claude.md or any other file.',
        '- Read the file first, then append or update the relevant section.',
        '- Proactively save learnings when you discover something that will help in future sessions.',
        '- Example: edit_file(".obsilo-sync/memory/patterns.md", "## Presentation Workflow\\n- Always call plan_presentation before create_pptx...")',
        '',
        memoryContext.trim(),
    ].join('\n');
}

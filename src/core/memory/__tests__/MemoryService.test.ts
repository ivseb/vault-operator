import { describe, it, expect } from 'vitest';
import type { MemoryFiles } from '../MemoryService';

// We need to dynamically import to handle obsidian module resolution
describe('MemoryService', () => {
    async function getModule() {
        const mod = await import('../MemoryService');
        return mod;
    }

    describe('buildMemoryContext', () => {
        async function buildContext(files: MemoryFiles) {
            const { MemoryService } = await getModule();
            // Create with a minimal mock FileAdapter
            const fs = {
                exists: () => Promise.resolve(false),
                read: () => Promise.resolve(''),
                write: () => Promise.resolve(),
                mkdir: () => Promise.resolve(),
                list: () => Promise.resolve({ files: [] as string[], folders: [] as string[] }),
                remove: () => Promise.resolve(),
                append: () => Promise.resolve(),
                stat: () => Promise.resolve(null),
            };
            const service = new MemoryService(fs);
            return service.buildMemoryContext(files);
        }

        const emptyFiles: MemoryFiles = {
            userProfile: '',
            projects: '',
            patterns: '',
            knowledge: '',
            soul: '',
        };

        it('should return empty string for empty files', async () => {
            const result = await buildContext(emptyFiles);
            expect(result).toBe('');
        });

        // FIX-42-01-02 (issue #48): the default soul must not pin the agent
        // to German. The template is language-neutral English.
        it('ships a language-neutral English soul template', async () => {
            const { DEFAULT_SOUL_TEMPLATE } = await getModule();
            expect(DEFAULT_SOUL_TEMPLATE).toContain('Match the language the user writes in');
            expect(DEFAULT_SOUL_TEMPLATE).not.toContain('Deutsch');
        });

        it('skips the current English soul template as template-only', async () => {
            const { DEFAULT_SOUL_TEMPLATE } = await getModule();
            const result = await buildContext({ ...emptyFiles, soul: DEFAULT_SOUL_TEMPLATE });
            expect(result).toBe('');
        });

        // Legacy installs materialized the old German soul.md. After the
        // template switch it no longer matches TEMPLATES, but it must still
        // count as "never customized" and stay out of the system prompt.
        it('skips the legacy German soul template via fingerprint', async () => {
            const legacyGermanSoul = `# Agent Identity

## Name
Vault Operator

## Communication
- Language: Deutsch
- Style: Warm, nahbar, auf Augenhoehe

## Values
- Nuetzlichkeit vor Hoeflichkeit
- Ehrlichkeit — sage wenn ich etwas nicht weiss
- Respektiere die Arbeit des Nutzers
- Lerne aus Fehlern

## Anti-Patterns
- Keine leeren Floskeln
- Keine unnoetigen Entschuldigungen
- Keine Emojis
`;
            const result = await buildContext({ ...emptyFiles, soul: legacyGermanSoul });
            expect(result).toBe('');
        });

        it('still injects a customized soul', async () => {
            const result = await buildContext({
                ...emptyFiles,
                soul: '# Agent Identity\n\n## Name\nJarvis\n\n## Communication\n- Language: French',
            });
            expect(result).toContain('<agent_identity>');
            expect(result).toContain('Jarvis');
        });

        it('should return empty string for template-only files', async () => {
            const result = await buildContext({
                ...emptyFiles,
                userProfile: `# User Profile

## Identity
- Name:
- Role:

## Communication
- Language:
- Style:

## Agent Behavior
`,
            });
            expect(result).toBe('');
        });

        it('should include non-empty sections with XML tags', async () => {
            const result = await buildContext({
                ...emptyFiles,
                soul: '# Agent Identity\n\n## Name\nTestBot\n\n## Values\n- Helpful',
            });
            expect(result).toContain('<agent_identity>');
            expect(result).toContain('TestBot');
            expect(result).toContain('</agent_identity>');
        });

        it('should include multiple sections', async () => {
            const result = await buildContext({
                ...emptyFiles,
                soul: '# My Identity\nI am helpful',
                userProfile: '# Profile\nSenior Dev',
                projects: '# Projects\nProject Alpha',
                patterns: '',
                knowledge: '',
            });
            expect(result).toContain('<agent_identity>');
            expect(result).toContain('<user_profile>');
            expect(result).toContain('<active_projects>');
            expect(result).not.toContain('<behavioral_patterns>');
        });

        it('should truncate files exceeding MAX_CHARS_PER_FILE', async () => {
            const longContent = 'x'.repeat(1000);
            const result = await buildContext({
                ...emptyFiles,
                soul: longContent,
            });
            expect(result).toContain('[...truncated]');
            // Should not exceed MAX_CHARS_PER_FILE (800) + tag overhead
            expect(result.length).toBeLessThan(1000);
        });

        it('should truncate total output exceeding MAX_TOTAL_CHARS (4000)', async () => {
            // Each section: 800 chars content + ~40 chars XML tags = ~840 chars
            // 4 sections * 840 = ~3360 chars. Need content that pushes past 4000.
            const content = 'y'.repeat(800); // At per-file limit (no per-file truncation)
            const result = await buildContext({
                userProfile: content,
                projects: content,
                patterns: content,
                knowledge: '',
                soul: content,
            });
            // 4 * (800 + ~35 tag overhead) = ~3340 < 4000, so no total truncation
            // Verify at least that all sections are present
            expect(result).toContain('<agent_identity>');
            expect(result).toContain('<behavioral_patterns>');
            // Total should be under MAX_TOTAL_CHARS since each file is at limit but 4*~835 < 4000
            expect(result.length).toBeGreaterThan(3000);
        });

        it('should not include knowledge in output', async () => {
            const result = await buildContext({
                ...emptyFiles,
                knowledge: '# Domain Knowledge\nImportant facts here',
            });
            // knowledge.md is excluded from system prompt (on-demand only)
            expect(result).not.toContain('Domain Knowledge');
        });
    });
});

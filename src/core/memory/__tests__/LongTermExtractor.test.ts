import { describe, it, expect } from 'vitest';

/**
 * Tests for LongTermExtractor's private pure functions.
 * We access them indirectly through a test-only subclass or
 * by testing via the parseResponse/section manipulation behavior.
 *
 * Since parseResponse and appendToSection/replaceSection are private,
 * we test them by creating a minimal instance and using Reflect or
 * by extracting the logic patterns.
 */
describe('LongTermExtractor', () => {
    async function getExtractor() {
        const { LongTermExtractor } = await import('../LongTermExtractor');
        // Create with minimal mocks — we only test private pure methods
        const mockMemoryService = {} as ConstructorParameters<typeof LongTermExtractor>[0];
        const mockGetModel = () => null;
        const extractor = new LongTermExtractor(mockMemoryService, mockGetModel);
        return extractor;
    }

    describe('parseResponse', () => {
        async function parse(text: string) {
            const extractor = await getExtractor();
            // Access private method for testing
            return (extractor as unknown as { parseResponse(t: string): { updates: Array<{ file: string; action: string; section: string; content: string }> } | null }).parseResponse(text);
        }

        it('should parse valid JSON response', async () => {
            const result = await parse(JSON.stringify({
                updates: [
                    { file: 'user-profile.md', action: 'append', section: '## Identity', content: '- Name: Test' },
                ],
            }));
            expect(result).not.toBeNull();
            expect(result!.updates).toHaveLength(1);
            expect(result!.updates[0].file).toBe('user-profile.md');
        });

        it('should strip markdown code fences', async () => {
            const result = await parse('```json\n{"updates": [{"file": "projects.md", "action": "append", "section": "## Active", "content": "- Project X"}]}\n```');
            expect(result).not.toBeNull();
            expect(result!.updates).toHaveLength(1);
        });

        it('should return null for invalid JSON', async () => {
            const result = await parse('this is not json');
            expect(result).toBeNull();
        });

        it('should return null for non-object response', async () => {
            const result = await parse('"just a string"');
            expect(result).toBeNull();
        });

        it('should return null for array response', async () => {
            const result = await parse('[1, 2, 3]');
            expect(result).toBeNull();
        });

        it('should return null when updates is not an array', async () => {
            const result = await parse('{"updates": "not an array"}');
            expect(result).toBeNull();
        });

        it('should filter out invalid update entries', async () => {
            const result = await parse(JSON.stringify({
                updates: [
                    { file: 'user-profile.md', action: 'append', section: '## Test', content: 'Valid' },
                    { file: 'INVALID-FILE.md', action: 'append', section: '## Test', content: 'Filtered' },
                    { file: 'projects.md', action: 'invalid-action', section: '## Test', content: 'Filtered' },
                    { file: 'patterns.md', action: 'replace', section: '## Test', content: 'Also valid' },
                ],
            }));
            expect(result).not.toBeNull();
            // Only entries with valid file AND valid action pass
            expect(result!.updates).toHaveLength(2);
            expect(result!.updates[0].file).toBe('user-profile.md');
            expect(result!.updates[1].file).toBe('patterns.md');
        });

        it('should accept all allowed files', async () => {
            const allowedFiles = ['user-profile.md', 'projects.md', 'patterns.md', 'soul.md', 'errors.md', 'custom-tools.md'];
            const updates = allowedFiles.map(file => ({
                file,
                action: 'append',
                section: '## Test',
                content: 'Content',
            }));
            const result = await parse(JSON.stringify({ updates }));
            expect(result!.updates).toHaveLength(allowedFiles.length);
        });

        it('should return empty updates for empty array', async () => {
            const result = await parse('{"updates": []}');
            expect(result).not.toBeNull();
            expect(result!.updates).toHaveLength(0);
        });
    });

    describe('appendToSection', () => {
        async function appendSection(fileContent: string, section: string, newContent: string) {
            const extractor = await getExtractor();
            return (extractor as unknown as { appendToSection(f: string, s: string, n: string): string }).appendToSection(fileContent, section, newContent);
        }

        it('should append under existing section', async () => {
            const file = '# Title\n\n## Identity\n- Name: Test\n\n## Communication\n- Lang: DE';
            const result = await appendSection(file, '## Identity', '- Role: Developer');
            expect(result).toContain('- Name: Test');
            expect(result).toContain('- Role: Developer');
            expect(result).toContain('## Communication');
        });

        it('should create section if not found', async () => {
            const file = '# Title\n\n## Existing\nContent';
            const result = await appendSection(file, '## New Section', 'New content');
            expect(result).toContain('## New Section');
            expect(result).toContain('New content');
        });

        it('should append at end when section is the last one', async () => {
            const file = '# Title\n\n## Last Section\n- Item 1';
            const result = await appendSection(file, '## Last Section', '- Item 2');
            expect(result).toContain('- Item 1');
            expect(result).toContain('- Item 2');
        });
    });

    describe('replaceSection', () => {
        async function replaceSection(fileContent: string, section: string, newContent: string) {
            const extractor = await getExtractor();
            return (extractor as unknown as { replaceSection(f: string, s: string, n: string): string }).replaceSection(fileContent, section, newContent);
        }

        it('should replace content under existing section', async () => {
            const file = '# Title\n\n## Identity\n- Old content\n\n## Communication\n- Lang: DE';
            const result = await replaceSection(file, '## Identity', '- New content');
            expect(result).toContain('- New content');
            expect(result).not.toContain('- Old content');
            expect(result).toContain('## Communication');
        });

        it('should create section if not found', async () => {
            const file = '# Title\nContent';
            const result = await replaceSection(file, '## Missing', 'Added content');
            expect(result).toContain('## Missing');
            expect(result).toContain('Added content');
        });

        it('should replace content when section is last', async () => {
            const file = '# Title\n\n## Last\n- Old';
            const result = await replaceSection(file, '## Last', '- New');
            expect(result).toContain('- New');
            expect(result).not.toContain('- Old');
        });
    });
});

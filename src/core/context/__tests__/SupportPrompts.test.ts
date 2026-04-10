import { describe, it, expect } from 'vitest';
import { createSupportPrompt, getBuiltInPromptEntries, resolvePromptContent } from '../SupportPrompts';

describe('createSupportPrompt', () => {
    it('should create ENHANCE prompt with user input', () => {
        const result = createSupportPrompt('ENHANCE', { userInput: 'Write a blog post' });
        expect(result).toContain('Write a blog post');
        expect(result).toContain('Improve and enhance');
    });

    it('should create SUMMARIZE prompt with active file hint', () => {
        const result = createSupportPrompt('SUMMARIZE', { activeFile: 'notes/meeting.md' });
        expect(result).toContain('(active file: notes/meeting.md)');
        expect(result).toContain('Summarize');
    });

    it('should create EXPLAIN prompt', () => {
        const result = createSupportPrompt('EXPLAIN', { activeFile: 'doc.md' });
        expect(result).toContain('Explain');
        expect(result).toContain('(active file: doc.md)');
    });

    it('should create FIX prompt', () => {
        const result = createSupportPrompt('FIX', {});
        expect(result).toContain('Review');
        expect(result).toContain('fix');
    });

    it('should omit active file hint when not provided', () => {
        const result = createSupportPrompt('SUMMARIZE', {});
        expect(result).not.toContain('(active file:');
    });

    it('should handle empty userInput', () => {
        const result = createSupportPrompt('ENHANCE', { userInput: '' });
        expect(result).toContain('Improve and enhance');
        expect(result).not.toContain('undefined');
    });
});

describe('getBuiltInPromptEntries', () => {
    it('should return 4 built-in entries', () => {
        const entries = getBuiltInPromptEntries();
        expect(entries).toHaveLength(4);
    });

    it('should have correct structure for each entry', () => {
        const entries = getBuiltInPromptEntries();
        for (const entry of entries) {
            expect(entry.id).toMatch(/^builtin-/);
            expect(entry.name).toBeTruthy();
            expect(entry.slug).toBeTruthy();
            expect(entry.content).toBeTruthy();
            expect(entry.isBuiltIn).toBe(true);
        }
    });

    it('should include all prompt types', () => {
        const entries = getBuiltInPromptEntries();
        const slugs = entries.map(e => e.slug);
        expect(slugs).toContain('enhance');
        expect(slugs).toContain('summarize');
        expect(slugs).toContain('explain');
        expect(slugs).toContain('fix');
    });
});

describe('resolvePromptContent', () => {
    it('should replace ${userInput} syntax', () => {
        const result = resolvePromptContent('Hello ${userInput}', { userInput: 'world' });
        expect(result).toBe('Hello world');
    });

    it('should replace {{userInput}} syntax', () => {
        const result = resolvePromptContent('Hello {{userInput}}', { userInput: 'world' });
        expect(result).toBe('Hello world');
    });

    it('should replace {{activeFile}} syntax', () => {
        const result = resolvePromptContent('File: {{activeFile}}', { activeFile: 'test.md' });
        expect(result).toBe('File: test.md');
    });

    it('should replace {activeFile} syntax', () => {
        const result = resolvePromptContent('File: {activeFile}', { activeFile: 'test.md' });
        expect(result).toBe('File: test.md');
    });

    it('should replace ${activeFileHint} with formatted hint', () => {
        const result = resolvePromptContent('Context${activeFileHint}', { activeFile: 'note.md' });
        expect(result).toBe('Context (active file: note.md)');
    });

    it('should replace ${activeFileHint} with empty when no active file', () => {
        const result = resolvePromptContent('Context${activeFileHint}', {});
        expect(result).toBe('Context');
    });

    it('should handle missing params gracefully', () => {
        const result = resolvePromptContent('Hello {{userInput}}', {});
        expect(result).toBe('Hello');
    });

    it('should trim whitespace from result', () => {
        const result = resolvePromptContent('  hello  ', {});
        expect(result).toBe('hello');
    });
});

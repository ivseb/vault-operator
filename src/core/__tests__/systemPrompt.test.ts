import { describe, it, expect } from 'vitest';

/**
 * Tests for systemPrompt section ordering (ADR-062).
 *
 * Verifies that the KV-cache-optimized section order is maintained:
 * - Stable sections first (Mode, Capabilities, Tools, Routing, etc.)
 * - Dynamic sections after (Skills, Memory, Recipes, DateTime)
 * - DateTime MUST be last (timestamp invalidates KV-cache)
 */

// We test the section ordering by importing buildSystemPromptForMode
// with minimal config and checking the output structure.

async function buildTestPrompt(overrides: Record<string, unknown> = {}) {
    const { buildSystemPromptForMode } = await import('../systemPrompt');

    const defaultConfig = {
        mode: {
            slug: 'agent',
            name: 'Agent',
            roleDefinition: 'You are a helpful agent.',
            toolGroups: ['read', 'vault', 'edit', 'agent'] as import('../../types/settings').ToolGroup[],
            customInstructions: '',
        },
        includeTime: true,
        configDir: 'test-config-dir',
        ...overrides,
    };

    return buildSystemPromptForMode(defaultConfig as import('../systemPrompt').SystemPromptConfig);
}

describe('systemPrompt section ordering (ADR-062)', () => {
    it('should place DateTime at the end of the prompt', async () => {
        const prompt = await buildTestPrompt();

        // DateTime section contains "TODAY IS:" marker
        const dateTimeMarker = 'TODAY IS:';
        const dateTimeIndex = prompt.lastIndexOf(dateTimeMarker);

        // It should be in the last 500 chars of the prompt
        const distanceFromEnd = prompt.length - dateTimeIndex;
        expect(distanceFromEnd).toBeLessThan(500);
    });

    it('should place Mode Definition before Tools', async () => {
        const prompt = await buildTestPrompt();

        const modeIndex = prompt.indexOf('You are a helpful agent.');
        const toolsIndex = prompt.indexOf('TOOLS');

        expect(modeIndex).toBeGreaterThan(-1);
        expect(toolsIndex).toBeGreaterThan(-1);
        expect(modeIndex).toBeLessThan(toolsIndex);
    });

    it('should place Security Boundary before Skills', async () => {
        const prompt = await buildTestPrompt({
            skillsSection: '<available_skills><skill><name>TestSkill</name></skill></available_skills>',
        });

        const securityIndex = prompt.indexOf('SECURITY');
        const skillsIndex = prompt.indexOf('TestSkill');

        if (securityIndex > -1 && skillsIndex > -1) {
            expect(securityIndex).toBeLessThan(skillsIndex);
        }
    });

    it('should not include DateTime when includeTime is false', async () => {
        const prompt = await buildTestPrompt({ includeTime: false });
        expect(prompt).not.toContain('TODAY IS:');
    });

    it('should omit Skills and Memory for subtasks', async () => {
        const prompt = await buildTestPrompt({
            isSubtask: true,
            skillsSection: 'SHOULD_NOT_APPEAR',
            memoryContext: 'MEMORY_SHOULD_NOT_APPEAR',
        });

        expect(prompt).not.toContain('SHOULD_NOT_APPEAR');
        expect(prompt).not.toContain('MEMORY_SHOULD_NOT_APPEAR');
    });

    it('should include Recipes in the dynamic section when provided', async () => {
        const prompt = await buildTestPrompt({
            recipesSection: 'PROCEDURAL RECIPES\nTest Recipe',
        });

        expect(prompt).toContain('PROCEDURAL RECIPES');
        expect(prompt).toContain('Test Recipe');
    });
});

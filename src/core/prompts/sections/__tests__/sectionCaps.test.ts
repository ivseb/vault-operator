import { describe, it, expect } from 'vitest';
import { capSection, TAIL_SECTION_CAPS } from '../sectionCaps';
import { buildSystemPromptForMode, CACHE_BREAKPOINT_MARKER } from '../../../systemPrompt';
import { BUILT_IN_MODES } from '../../../modes/builtinModes';

/**
 * IMP-41-01-03: every volatile-tail section carries a char cap so a bloated
 * section (40 plugins, huge vault context) cannot silently dominate the
 * uncached tail of every request. Caps cut at a line boundary and append a
 * truncation marker; sections below their cap are byte-identical.
 */

describe('capSection', () => {
    it('returns short sections unchanged', () => {
        const text = 'line one\nline two';
        expect(capSection(text, 100)).toBe(text);
    });

    it('cuts at a line boundary and appends the truncation marker', () => {
        const lines = Array.from({ length: 100 }, (_, i) => `line ${i} with some padding text`);
        const text = lines.join('\n');
        const capped = capSection(text, 500);
        expect(capped.length).toBeLessThanOrEqual(500 + 60); // marker allowance
        expect(capped).toContain('[section truncated at 500 chars]');
        // No partial line before the marker: every line present must be complete.
        const body = capped.slice(0, capped.indexOf('\n[section truncated'));
        for (const line of body.split('\n')) {
            expect(lines).toContain(line);
        }
    });

    it('handles a single overlong line without a newline', () => {
        const text = 'x'.repeat(10_000);
        const capped = capSection(text, 500);
        expect(capped.length).toBeLessThanOrEqual(500 + 60);
        expect(capped).toContain('[section truncated at 500 chars]');
    });

    it('defines caps for all volatile tail sections', () => {
        expect(TAIL_SECTION_CAPS.pluginSkills).toBeGreaterThan(0);
        expect(TAIL_SECTION_CAPS.memory).toBe(4000);
        expect(TAIL_SECTION_CAPS.recipes).toBeGreaterThan(0);
        expect(TAIL_SECTION_CAPS.customInstructions).toBeGreaterThan(0);
        expect(TAIL_SECTION_CAPS.rules).toBeGreaterThan(0);
        expect(TAIL_SECTION_CAPS.vaultContext).toBeGreaterThan(0);
    });
});

describe('buildSystemPromptForMode tail caps (IMP-41-01-03)', () => {
    const mode = BUILT_IN_MODES[0];

    it('caps an oversized pluginSkillsSection in the assembled prompt', () => {
        const huge = Array.from({ length: 2000 }, (_, i) => `plugin skill line ${i}`).join('\n');
        const prompt = buildSystemPromptForMode({
            mode,
            configDir: '.obsidian',
            pluginSkillsSection: huge,
        });
        const tail = prompt.slice(prompt.indexOf(CACHE_BREAKPOINT_MARKER));
        expect(tail).toContain(`[section truncated at ${TAIL_SECTION_CAPS.pluginSkills} chars]`);
        expect(tail.length).toBeLessThan(huge.length);
    });

    it('caps an oversized custom instructions block', () => {
        const huge = Array.from({ length: 3000 }, (_, i) => `instruction ${i}`).join('\n');
        const prompt = buildSystemPromptForMode({
            mode,
            configDir: '.obsidian',
            globalCustomInstructions: huge,
        });
        expect(prompt).toContain(`[section truncated at ${TAIL_SECTION_CAPS.customInstructions} chars]`);
    });

    it('leaves prompts without oversized sections byte-identical (no marker)', () => {
        const prompt = buildSystemPromptForMode({
            mode,
            configDir: '.obsidian',
            pluginSkillsSection: 'one small plugin',
            globalCustomInstructions: 'be brief',
        });
        expect(prompt).not.toContain('[section truncated');
    });

    it('never caps the stable prefix (tools section stays intact)', () => {
        const prompt = buildSystemPromptForMode({
            mode,
            configDir: '.obsidian',
        });
        const stable = prompt.slice(0, prompt.indexOf(CACHE_BREAKPOINT_MARKER));
        expect(stable).not.toContain('[section truncated');
    });
});

/**
 * FEATURE-2205 / FEATURE-2206 (EPIC-022 follow-ups): lightweight tests for
 * the static slug helper that couples the autocomplete dropdown to the
 * slash-command resolver in AgentSidebarView.
 */

import { describe, it, expect } from 'vitest';
import { AutocompleteHandler } from '../AutocompleteHandler';

describe('AutocompleteHandler.slugifySkillName', () => {
    it('lower-cases and hyphenates multi-word names', () => {
        expect(AutocompleteHandler.slugifySkillName('Research Synthesis')).toBe('research-synthesis');
    });

    it('collapses non-alphanumeric runs into a single hyphen', () => {
        expect(AutocompleteHandler.slugifySkillName('PDF / Image: Extract!!')).toBe('pdf-image-extract');
    });

    it('strips leading and trailing hyphens', () => {
        expect(AutocompleteHandler.slugifySkillName('--Edge Case--')).toBe('edge-case');
    });

    it('is stable across invocations (same input -> same output)', () => {
        const once = AutocompleteHandler.slugifySkillName('My Skill 42');
        const twice = AutocompleteHandler.slugifySkillName('My Skill 42');
        expect(once).toBe(twice);
        expect(once).toBe('my-skill-42');
    });

    it('handles already-slugified input idempotently', () => {
        expect(AutocompleteHandler.slugifySkillName('already-slug')).toBe('already-slug');
    });

    it('returns an empty string for names made entirely of punctuation', () => {
        expect(AutocompleteHandler.slugifySkillName('!!!')).toBe('');
    });
});

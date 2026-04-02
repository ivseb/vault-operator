/**
 * Obsidian Conventions Section
 *
 * Central reference for Obsidian-specific formatting conventions.
 * Applied to all modes (not mode-specific).
 */

export function getObsidianConventionsSection(): string {
    return `====

OBSIDIAN CONVENTIONS

- Internal links: [[Note Name]] (not markdown links)
- Tags: lowercase, hyphenated — "machine-learning" not "Machine Learning"
- Frontmatter: ---\\ntitle: ...\\ntags: [...]\\ncreated: YYYY-MM-DD\\n---
- Headers: ## main sections, ### subsections
- Callouts: > [!note], > [!tip], > [!warning]`;
}

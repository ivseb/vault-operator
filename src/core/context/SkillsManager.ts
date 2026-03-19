/**
 * SkillsManager - Discover and match skills from global storage (Sprint 3.4)
 *
 * Skills are stored as Markdown files at:
 *   ~/.obsidian-agent/skills/{name}/SKILL.md
 *
 * SKILL.md frontmatter (required):
 *   name: string        — short identifier (lowercase, hyphens)
 *   description: string — what the skill is for (used for keyword matching)
 *
 * Optional frontmatter:
 *   trigger: string     — regex pattern for fast-path matching (same as bundled skills)
 *
 * SKILL.md body — instructions the agent should follow when using this skill.
 *
 * Matching priority:
 *   1. Trigger regex (fast path, if `trigger` frontmatter is present)
 *   2. Keyword overlap between description and user message
 *
 * Relevant skills are injected into the system prompt as an <available_skills>
 * block with full content inlined (no read_file round-trip needed).
 */

import type { FileAdapter } from '../storage/types';

export interface SkillMeta {
    /** Path relative to FileAdapter root (e.g. "skills/my-skill/SKILL.md") */
    path: string;
    /** Short name (from frontmatter or directory name) */
    name: string;
    /** Description used for keyword matching */
    description: string;
    /** Source: 'learned' (agent-created), 'user' (manual), or undefined (legacy) */
    source?: 'learned' | 'user' | 'bundled';
    /** Optional trigger regex for fast-path matching */
    trigger?: string;
}

export class SkillsManager {
    private readonly fs: FileAdapter;
    readonly skillsDir: string;

    constructor(fs: FileAdapter) {
        this.fs = fs;
        this.skillsDir = 'skills';
    }

    async initialize(): Promise<void> {
        try {
            const exists = await this.fs.exists(this.skillsDir);
            if (!exists) {
                await this.fs.mkdir(this.skillsDir);
            }
        } catch {
            // Non-fatal
        }
    }

    /**
     * Discover all skills by scanning for SKILL.md files.
     */
    async discoverSkills(): Promise<SkillMeta[]> {
        try {
            const exists = await this.fs.exists(this.skillsDir);
            if (!exists) return [];
            const listed = await this.fs.list(this.skillsDir);
            const skills: SkillMeta[] = [];
            for (const folder of listed.folders) {
                const skillPath = `${folder}/SKILL.md`;
                const fileExists = await this.fs.exists(skillPath);
                if (!fileExists) continue;
                try {
                    const content = await this.fs.read(skillPath);
                    const meta = this.parseFrontmatter(content, folder, skillPath);
                    if (meta) skills.push(meta);
                } catch {
                    // Skip unreadable skill files
                }
            }
            return skills;
        } catch {
            return [];
        }
    }

    /**
     * Get skills relevant to the user's message.
     * Matching priority:
     *   1. Trigger regex (fast path) — matches against frontmatter `trigger` field
     *   2. Keyword overlap — description words vs message words
     *
     * Returns a formatted prompt section string with full skill content inlined,
     * or empty string if no matches.
     */
    async getRelevantSkills(userMessage: string, toggles?: Record<string, boolean>): Promise<string> {
        const allSkills = await this.discoverSkills();
        // Filter out disabled skills when toggles are provided
        const skills = toggles
            ? allSkills.filter((s) => toggles[s.path] !== false)
            : allSkills;
        if (skills.length === 0) return '';

        const msgLower = userMessage.toLowerCase();
        // Word extraction: covers ASCII + common European letters (ä, ö, ü, ß, é, etc.)
        const wordPattern = /[a-z0-9\u00C0-\u024F_]{3,}/gi;
        const msgWords = new Set(msgLower.match(wordPattern) ?? []);

        const relevant = skills.filter((s) => {
            // Priority 1: Trigger regex (fast path)
            if (s.trigger) {
                try {
                    const regex = new RegExp(s.trigger, 'i');
                    if (regex.test(msgLower)) return true;
                } catch {
                    // Invalid regex — fall through to keyword matching
                }
            }
            // Priority 2: Keyword overlap on description
            const descWords = s.description.toLowerCase().match(wordPattern) ?? [];
            return descWords.some((w) => msgWords.has(w));
        });

        if (relevant.length === 0) return '';

        const lines: string[] = ['<available_skills>'];
        for (const s of relevant) {
            // Read the full SKILL.md content and inline it — no agent read_file needed
            let fullContent = '';
            try {
                const raw = await this.fs.read(s.path);
                // Strip frontmatter, keep only the body
                fullContent = raw.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();

                // ── Composition list compression ──────────────────────────────────────
                // Template skills (Acme etc.) have a composition bullet list that is
                // essential (agent needs ALL IDs to call get_composition_details) but
                // verbose (~27k chars for ~89 bullets). We compact each bullet to:
                //   - **Name** (ID: `id`, Pipeline: mode): Short description [flags]
                // This reduces average bullet from ~300 to ~100 chars, bringing the full
                // list from ~27k to ~10k chars — all IDs visible within the 15k cap.
                fullContent = fullContent.replace(
                    /^(- \*\*[^*]+\*\*) \(ID: `([^`]+)`,(?:[^)]*?Pipeline: ([^)]+))?\): ([^\n]+)$/gm,
                    (match: string, prefix: string, id: string, pipeline: string | undefined, rest: string) => {
                        // Keep only the first sentence of the description (before " -- ")
                        const shortDesc = rest.split(' -- ')[0].trim();
                        // Condense warnings into compact flags
                        const flags: string[] = [];
                        if (/image placeholder/.test(match)) flags.push('[img]');
                        if (/embedded chart|static chart/.test(match)) flags.push('[chart]');
                        if (/embedded table|static table/.test(match)) flags.push('[table]');
                        if (/fixed decorative|fixed picture/.test(match)) flags.push('[fixed]');
                        const pipeMode = (pipeline ?? 'clone').trim();
                        const flagStr = flags.length > 0 ? ' ' + flags.join('') : '';
                        return `${prefix} (ID: \`${id}\`, Pipeline: ${pipeMode}): ${shortDesc}${flagStr}`;
                    }
                );
                // Strip "Compositions by Narrative Phase" table — uses names not IDs,
                // not useful for composition ID lookup (~2.5k chars saved).
                fullContent = fullContent.replace(
                    /\n## Compositions by Narrative Phase\n[\s\S]*?(?=\n## )/,
                    '\n'
                );
                // ─────────────────────────────────────────────────────────────────────

                // Cap at 20k: after compression the full composition ID list (~11k) +
                // Brand DNA (~0.5k) + Design Rules (~6.5k) all fit with no IDs truncated.
                if (fullContent.length > 20000) fullContent = fullContent.slice(0, 20000) +
                    '\n…(skill truncated — remaining sections omitted.' +
                    ' DO NOT call manage_skill read — it is already active.' +
                    ' Use get_composition_details for per-composition shape details.)';
            } catch {
                // Fall back to name+description only if file can't be read
            }
            lines.push(`  <skill>`);
            lines.push(`    <name>${this.xmlEscape(s.name)}</name>`);
            lines.push(`    <description>${this.xmlEscape(s.description)}</description>`);
            if (fullContent) {
                lines.push(`    <instructions>${this.xmlEscape(fullContent)}</instructions>`);
            }
            lines.push(`  </skill>`);
        }
        lines.push('</available_skills>');
        return lines.join('\n');
    }

    /**
     * Read a skill file's content (for UI editing).
     */
    async readFile(path: string): Promise<string> {
        return this.fs.read(path);
    }

    /**
     * Write a skill file's content (for UI editing).
     */
    async writeFile(path: string, content: string): Promise<void> {
        await this.fs.write(path, content);
    }

    /**
     * Create a skill directory and file.
     */
    async createSkill(dirPath: string, content: string): Promise<void> {
        await this.fs.mkdir(dirPath);
        await this.fs.write(`${dirPath}/SKILL.md`, content);
    }

    /**
     * Delete a skill file and its parent directory if empty afterward.
     */
    async deleteSkill(path: string): Promise<void> {
        try {
            await this.fs.remove(path);
        } catch {
            // Non-fatal: file may already be gone
        }
        // Clean up empty parent directory (e.g. skills/my-skill/)
        const parentDir = path.substring(0, path.lastIndexOf('/'));
        if (parentDir) {
            try {
                const listing = await this.fs.list(parentDir);
                if (listing.files.length === 0 && listing.folders.length === 0) {
                    await this.fs.remove(parentDir);
                }
            } catch {
                // Non-fatal: directory may not exist
            }
        }
    }

    /**
     * Check if a path exists in global storage.
     */
    async fileExists(path: string): Promise<boolean> {
        return this.fs.exists(path);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private parseFrontmatter(content: string, folder: string, skillPath: string): SkillMeta | null {
        // Extract YAML frontmatter between --- delimiters
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        if (!match) return null;
        const yaml = match[1];

        const nameMatch = yaml.match(/^name:\s*(.+)$/m);
        const descMatch = yaml.match(/^description:\s*(.+)$/m);
        const sourceMatch = yaml.match(/^source:\s*(.+)$/m);
        const triggerMatch = yaml.match(/^trigger:\s*(.+)$/m);

        const name = nameMatch?.[1]?.trim() ?? folder.split('/').pop() ?? 'unknown';
        const description = descMatch?.[1]?.trim() ?? '';
        const source = sourceMatch?.[1]?.trim() as SkillMeta['source'];
        const trigger = triggerMatch?.[1]?.trim();

        if (!description) return null;

        return { path: skillPath, name, description, source, trigger };
    }

    private xmlEscape(s: string): string {
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}

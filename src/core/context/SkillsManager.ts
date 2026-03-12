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
                // Cap to avoid bloating the system prompt (16k allows detailed corporate template skills)
                if (fullContent.length > 16000) fullContent = fullContent.slice(0, 16000) + '\n…(truncated)';
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
     * Delete a skill file.
     */
    async deleteSkill(path: string): Promise<void> {
        await this.fs.remove(path);
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

/**
 * SkillsManager - Discover and read skills from global storage (Sprint 3.4).
 *
 * Skills are stored as Markdown files at:
 *   ~/.obsidian-agent/skills/{name}/SKILL.md
 *
 * SKILL.md frontmatter (required):
 *   name: string        -- short identifier (lowercase, hyphens)
 *   description: string -- what the skill is for
 *
 * SKILL.md body -- instructions the agent should follow when using this skill.
 *
 * Since FEAT-24-09 / ADR-116 the agent picks a skill itself from the stable
 * SKILLS directory in the system prompt and loads its body on demand via
 * the read_skill tool. The legacy per-message keyword classifier
 * (getRelevantSkills) was removed in IMP-24-09-01 (AUDIT-019 F-1):
 * the classifier path in AgentSidebarView had already been deleted as
 * part of FEAT-24-09, leaving the method as orphan dead code that risked
 * a silent re-injection of body content into the cached system-prompt
 * prefix if a future change ever re-wired it.
 */

import type { FileAdapter } from '../storage/types';

export interface SkillMeta {
    /** Path relative to FileAdapter root (e.g. "skills/my-skill/SKILL.md") */
    path: string;
    /** Short name (from frontmatter or directory name) */
    name: string;
    /** Description used for keyword matching */
    description: string;
    /** Source: 'learned' (agent-created), 'user' (manual), 'pro' (purchased premium), or undefined (legacy) */
    source?: 'learned' | 'user' | 'bundled' | 'pro';
    /** Optional trigger regex for fast-path matching */
    trigger?: string;
}

/**
 * How long a discoverSkills() result stays valid. Internal writes invalidate
 * eagerly; the TTL exists for EXTERNAL changes (manual copy, git checkout,
 * iCloud sync) that no plugin code path sees. Obsidian vault events do not
 * fire under the hidden agent folder and fs.watch is Electron-only, so a
 * short TTL is the platform-neutral way to pick those changes up.
 */
const DISCOVER_CACHE_TTL_MS = 30_000;

export class SkillsManager {
    private readonly fs: FileAdapter;
    readonly skillsDir: string;
    // FIX-PERF-32: cache the in-flight promise so two near-simultaneous
    // callers (AgentSidebarView pre-send + AgentTask.run) share the same
    // FS scan instead of duplicating it. invalidateCache() drops the
    // cache when a skill file changes; the TTL drops it for external edits.
    private cachedDiscover: Promise<SkillMeta[]> | null = null;
    private cachedDiscoverAt = 0;

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
     * FIX-PERF-32: cached. Call invalidateCache() when a SKILL.md file
     * is created, modified, deleted or renamed.
     */
    async discoverSkills(): Promise<SkillMeta[]> {
        const fresh = Date.now() - this.cachedDiscoverAt < DISCOVER_CACHE_TTL_MS;
        if (this.cachedDiscover && fresh) return this.cachedDiscover;
        this.cachedDiscoverAt = Date.now();
        this.cachedDiscover = this.discoverSkillsUncached().catch((err) => {
            // Do not stick a rejected promise in the cache; let the next
            // caller retry the scan.
            this.cachedDiscover = null;
            throw err;
        });
        return this.cachedDiscover;
    }

    /**
     * Drop the discoverSkills() cache. Call this on skill file events.
     */
    invalidateCache(): void {
        this.cachedDiscover = null;
        this.cachedDiscoverAt = 0;
    }

    private async discoverSkillsUncached(): Promise<SkillMeta[]> {
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
     * Read a skill file's content (for UI editing).
     */
    readFile(path: string): Promise<string> {
        return this.fs.read(path);
    }

    /**
     * Write a skill file's content (for UI editing).
     */
    async writeFile(path: string, content: string): Promise<void> {
        await this.fs.write(path, content);
        // FIX-PERF-32: invalidate discoverSkills() cache on internal writes
        if (path.endsWith('/SKILL.md')) this.invalidateCache();
    }

    /**
     * Create a skill directory and file.
     */
    async createSkill(dirPath: string, content: string): Promise<void> {
        await this.fs.mkdir(dirPath);
        await this.fs.write(`${dirPath}/SKILL.md`, content);
        // FIX-PERF-32: new skill, cache must be rebuilt
        this.invalidateCache();
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
        // FIX-PERF-32: invalidate even on partial failure - the deletion
        // may have succeeded before the throw.
        this.invalidateCache();
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
    fileExists(path: string): Promise<boolean> {
        return this.fs.exists(path);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private parseFrontmatter(content: string, folder: string, skillPath: string): SkillMeta | null {
        // Extract YAML frontmatter between --- delimiters
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        if (!match) return null;
        const yaml = match[1];

        const name = extractYamlField(yaml, 'name') ?? folder.split('/').pop() ?? 'unknown';
        const description = extractYamlField(yaml, 'description') ?? '';
        const source = extractYamlField(yaml, 'source') as SkillMeta['source'];
        const trigger = extractYamlField(yaml, 'trigger');

        if (!description) return null;

        return { path: skillPath, name, description, source, trigger };
    }
}

/**
 * Extract a scalar field from a minimal YAML frontmatter block.
 * Supports:
 *   key: value                    -- plain single line
 *   key: >                        -- folded: newlines collapse to a single space
 *     line 1
 *     line 2
 *   key: |                        -- literal: newlines are preserved
 *     line 1
 *     line 2
 * The block scalar terminates at the next top-level key or at the end of the
 * frontmatter (this parser only ever sees the content between the --- fences).
 * Nested keys, anchors, tags and other YAML features are intentionally unsupported.
 */
function extractYamlField(yaml: string, key: string): string | undefined {
    const lines = yaml.split('\n');
    const keyRe = new RegExp(`^${key}:\\s*(.*)$`);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = line.match(keyRe);
        if (!m) continue;

        const rest = m[1].trim();
        if (rest !== '>' && rest !== '|') {
            return rest.length > 0 ? rest : undefined;
        }

        // Block scalar: collect indented follow-up lines until we hit a top-level key.
        const collected: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
            const follow = lines[j];
            // Blank lines terminate '>' folding cleanly but do not end the block;
            // for our purposes (single description paragraph) treat them as separators.
            if (follow.trim() === '') {
                if (rest === '|') collected.push('');
                continue;
            }
            // A non-indented line that looks like `newkey:` ends the block.
            if (/^[A-Za-z_][\w-]*\s*:/.test(follow)) break;
            collected.push(follow.replace(/^\s+/, ''));
        }

        const joined = rest === '|' ? collected.join('\n') : collected.join(' ');
        const trimmed = joined.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }

    return undefined;
}

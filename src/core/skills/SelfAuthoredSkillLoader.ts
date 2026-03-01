/**
 * SelfAuthoredSkillLoader
 *
 * Loads and manages agent-created SKILL.md files with YAML frontmatter.
 * Skills are stored in the plugin data directory under skills/.
 * Hot-reload via Vault events.
 *
 * Part of Self-Development Phase 2: Skill Self-Authoring.
 */

import { TFile, TFolder } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SelfAuthoredSkill {
    name: string;
    description: string;
    trigger: RegExp;
    triggerSource: string;
    source: 'learned' | 'user' | 'bundled';
    requiredTools: string[];
    createdAt: Date;
    successCount: number;
    body: string;
    filePath: string;
}

// ---------------------------------------------------------------------------
// SelfAuthoredSkillLoader
// ---------------------------------------------------------------------------

export class SelfAuthoredSkillLoader {
    private skills = new Map<string, SelfAuthoredSkill>();
    private readonly skillsDir: string;

    constructor(private plugin: ObsidianAgentPlugin) {
        this.skillsDir = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}/skills`;
    }

    /**
     * Scan the skills directory and load all SKILL.md files.
     */
    async loadAll(): Promise<void> {
        this.skills.clear();
        const folder = this.plugin.app.vault.getAbstractFileByPath(this.skillsDir);
        if (!(folder instanceof TFolder)) return;

        for (const child of folder.children) {
            if (child instanceof TFolder) {
                // Look for SKILL.md inside each skill folder
                const skillFile = this.plugin.app.vault.getAbstractFileByPath(
                    `${child.path}/SKILL.md`
                );
                if (skillFile instanceof TFile) {
                    await this.loadSkillFile(skillFile);
                }
            }
        }

        console.debug(`[SelfAuthoredSkillLoader] Loaded ${this.skills.size} skill(s)`);
    }

    /**
     * Set up hot-reload watchers for skill file changes.
     */
    setupWatcher(): void {
        this.plugin.registerEvent(
            this.plugin.app.vault.on('modify', (file) => {
                if (file instanceof TFile && this.isSkillFile(file)) {
                    void this.loadSkillFile(file);
                }
            })
        );
        this.plugin.registerEvent(
            this.plugin.app.vault.on('create', (file) => {
                if (file instanceof TFile && this.isSkillFile(file)) {
                    void this.loadSkillFile(file);
                }
            })
        );
        this.plugin.registerEvent(
            this.plugin.app.vault.on('delete', (file) => {
                if (file instanceof TFile && this.isSkillFile(file)) {
                    this.removeSkillByPath(file.path);
                }
            })
        );
    }

    /**
     * Get metadata summary for system prompt (Progressive Disclosure: metadata only).
     */
    getMetadataSummary(): string {
        if (this.skills.size === 0) return '';
        return [...this.skills.values()]
            .map(s => `- ${s.name}: ${s.description} [trigger: ${s.triggerSource}]`)
            .join('\n');
    }

    /**
     * Get full skill body for activation (Progressive Disclosure: full content).
     */
    getSkillBody(name: string): string | undefined {
        return this.skills.get(name)?.body;
    }

    /**
     * Match a user message against skill triggers. Returns matching skills.
     */
    matchSkills(userMessage: string): SelfAuthoredSkill[] {
        const matches: SelfAuthoredSkill[] = [];
        for (const skill of this.skills.values()) {
            if (skill.trigger.test(userMessage)) {
                matches.push(skill);
            }
        }
        return matches;
    }

    /**
     * Get all loaded skills.
     */
    getAllSkills(): SelfAuthoredSkill[] {
        return [...this.skills.values()];
    }

    /**
     * Get a skill by name.
     */
    getSkill(name: string): SelfAuthoredSkill | undefined {
        return this.skills.get(name);
    }

    /**
     * Increment the success count for a skill.
     */
    async incrementSuccess(name: string): Promise<void> {
        const skill = this.skills.get(name);
        if (!skill) return;
        skill.successCount++;
        // Update the file
        await this.updateFrontmatterField(skill.filePath, 'successCount', String(skill.successCount));
    }

    /**
     * Get the skills directory path.
     */
    getSkillsDir(): string {
        return this.skillsDir;
    }

    // -----------------------------------------------------------------------
    // Private
    // -----------------------------------------------------------------------

    private async loadSkillFile(file: TFile): Promise<void> {
        try {
            const content = await this.plugin.app.vault.read(file);
            const parsed = this.parseSkillMd(content, file.path);
            if (parsed) {
                this.skills.set(parsed.name, parsed);
            }
        } catch (e) {
            console.warn(`[SelfAuthoredSkillLoader] Failed to load ${file.path}:`, e);
        }
    }

    private parseSkillMd(content: string, filePath: string): SelfAuthoredSkill | null {
        // Split frontmatter and body at --- delimiters
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        if (!fmMatch) return null;

        const frontmatter = fmMatch[1];
        const body = fmMatch[2].trim();

        // Parse frontmatter key-value pairs
        const fm = this.parseFrontmatter(frontmatter);
        if (!fm.name || !fm.description) return null;

        let trigger: RegExp;
        let triggerSource: string;
        try {
            triggerSource = fm.trigger ?? fm.name.toLowerCase();
            trigger = new RegExp(triggerSource, 'i');
        } catch {
            triggerSource = fm.name.toLowerCase();
            trigger = new RegExp(triggerSource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        }

        return {
            name: fm.name,
            description: fm.description,
            trigger,
            triggerSource,
            source: (fm.source as SelfAuthoredSkill['source']) ?? 'user',
            requiredTools: fm.requiredTools ? this.parseArray(fm.requiredTools) : [],
            createdAt: fm.createdAt ? new Date(fm.createdAt) : new Date(),
            successCount: fm.successCount ? parseInt(fm.successCount, 10) : 0,
            body,
            filePath,
        };
    }

    private parseFrontmatter(text: string): Record<string, string> {
        const result: Record<string, string> = {};
        for (const line of text.split('\n')) {
            const colonIdx = line.indexOf(':');
            if (colonIdx === -1) continue;
            const key = line.slice(0, colonIdx).trim();
            let value = line.slice(colonIdx + 1).trim();
            // Strip quotes
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            result[key] = value;
        }
        return result;
    }

    private parseArray(value: string): string[] {
        // Support [a, b, c] format
        const match = value.match(/^\[(.*)]$/);
        if (match) {
            return match[1].split(',').map(s => s.trim()).filter(Boolean);
        }
        return value.split(',').map(s => s.trim()).filter(Boolean);
    }

    private isSkillFile(file: TFile): boolean {
        return file.path.startsWith(this.skillsDir) && file.name === 'SKILL.md';
    }

    private removeSkillByPath(path: string): void {
        for (const [name, skill] of this.skills) {
            if (skill.filePath === path) {
                this.skills.delete(name);
                console.debug(`[SelfAuthoredSkillLoader] Removed skill: ${name}`);
                return;
            }
        }
    }

    private async updateFrontmatterField(filePath: string, key: string, value: string): Promise<void> {
        const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;
        const content = await this.plugin.app.vault.read(file);
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!fmMatch) return;

        const fm = fmMatch[1];
        const regex = new RegExp(`^${key}:.*$`, 'm');
        const updated = regex.test(fm)
            ? fm.replace(regex, `${key}: ${value}`)
            : fm + `\n${key}: ${value}`;

        const newContent = content.replace(fmMatch[0], `---\n${updated}\n---`);
        await this.plugin.app.vault.modify(file, newContent);
    }
}

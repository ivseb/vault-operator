/**
 * ManageSkillTool
 *
 * Allows the agent to create, update, delete, list, validate, and read
 * self-authored SKILL.md files. Skills are Markdown-based workflow
 * instructions with YAML frontmatter.
 *
 * Part of Self-Development Phase 2: Skill Self-Authoring.
 */

import { TFile, TFolder } from 'obsidian';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import type { SelfAuthoredSkillLoader } from '../../skills/SelfAuthoredSkillLoader';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

interface ManageSkillInput {
    action: 'create' | 'update' | 'delete' | 'list' | 'validate' | 'read';
    name?: string;
    description?: string;
    trigger?: string;
    required_tools?: string[];
    body?: string;
    source?: string;
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export class ManageSkillTool extends BaseTool<'manage_skill'> {
    readonly name = 'manage_skill' as const;
    readonly isWriteOperation = false;

    private skillLoader: SelfAuthoredSkillLoader;

    constructor(plugin: ObsidianAgentPlugin, skillLoader: SelfAuthoredSkillLoader) {
        super(plugin);
        this.skillLoader = skillLoader;
    }

    getDefinition(): ToolDefinition {
        return {
            name: this.name,
            description: 'Manage self-authored skills (SKILL.md files). Skills are reusable workflow instructions that persist across sessions. Actions: create, update, delete, list, validate, read.',
            input_schema: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        description: 'Action to perform.',
                        enum: ['create', 'update', 'delete', 'list', 'validate', 'read'],
                    },
                    name: {
                        type: 'string',
                        description: 'Skill name (required for create/update/delete/validate/read).',
                    },
                    description: {
                        type: 'string',
                        description: 'Short description of what the skill does (required for create).',
                    },
                    trigger: {
                        type: 'string',
                        description: 'Regex pattern for auto-triggering the skill from user messages (e.g. "daily|summary|zusammenfassung").',
                    },
                    required_tools: {
                        type: 'array',
                        description: 'List of tool names this skill needs.',
                        items: { type: 'string' },
                    },
                    body: {
                        type: 'string',
                        description: 'Markdown body with step-by-step instructions (required for create).',
                    },
                    source: {
                        type: 'string',
                        description: 'Skill source: "learned" (agent-created), "user" (user-created).',
                        enum: ['learned', 'user'],
                    },
                },
                required: ['action'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const params = input as unknown as ManageSkillInput;
        const action = (params.action ?? '').trim();

        try {
            if (action === 'create') {
                await this.handleCreate(params, callbacks);
            } else if (action === 'update') {
                await this.handleUpdate(params, callbacks);
            } else if (action === 'delete') {
                await this.handleDelete(params, callbacks);
            } else if (action === 'list') {
                this.handleList(callbacks);
            } else if (action === 'validate') {
                this.handleValidate(params, callbacks);
            } else if (action === 'read') {
                this.handleRead(params, callbacks);
            } else {
                callbacks.pushToolResult(this.formatError(`Unknown action: "${action}". Use: create, update, delete, list, validate, read`));
            }
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
        }
    }

    // -----------------------------------------------------------------------
    // Action handlers
    // -----------------------------------------------------------------------

    private async handleCreate(
        params: ManageSkillInput,
        callbacks: { pushToolResult(c: string): void },
    ): Promise<void> {
        if (!params.name) throw new Error('Missing "name" for create action.');
        if (!params.description) throw new Error('Missing "description" for create action.');
        if (!params.body) throw new Error('Missing "body" for create action.');

        const slug = this.slugify(params.name);
        const dirPath = `${this.skillLoader.getSkillsDir()}/${slug}`;
        const filePath = `${dirPath}/SKILL.md`;

        // Check if skill already exists
        const existing = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (existing instanceof TFile) {
            throw new Error(`Skill "${params.name}" already exists at ${filePath}. Use "update" action.`);
        }

        // Ensure directory exists
        const dir = this.plugin.app.vault.getAbstractFileByPath(dirPath);
        if (!(dir instanceof TFolder)) {
            await this.plugin.app.vault.createFolder(dirPath);
        }

        // Build SKILL.md content
        const content = this.buildSkillMd(params);
        await this.plugin.app.vault.create(filePath, content);

        callbacks.pushToolResult(this.formatSuccess(
            `Skill "${params.name}" created at ${filePath}. It will be available immediately via hot-reload.`
        ));
    }

    private async handleUpdate(
        params: ManageSkillInput,
        callbacks: { pushToolResult(c: string): void },
    ): Promise<void> {
        if (!params.name) throw new Error('Missing "name" for update action.');

        const skill = this.skillLoader.getSkill(params.name);
        if (!skill) throw new Error(`Skill "${params.name}" not found. Use "list" to see available skills.`);
        if (skill.source === 'bundled') throw new Error(`Bundled skills cannot be updated.`);

        const file = this.plugin.app.vault.getAbstractFileByPath(skill.filePath);
        if (!(file instanceof TFile)) throw new Error(`Skill file not found: ${skill.filePath}`);

        // Merge updates
        const content = this.buildSkillMd({
            name: params.name,
            description: params.description ?? skill.description,
            trigger: params.trigger ?? skill.triggerSource,
            required_tools: params.required_tools ?? skill.requiredTools,
            body: params.body ?? skill.body,
            source: skill.source,
        });

        await this.plugin.app.vault.modify(file, content);
        callbacks.pushToolResult(this.formatSuccess(`Skill "${params.name}" updated.`));
    }

    private async handleDelete(
        params: ManageSkillInput,
        callbacks: { pushToolResult(c: string): void },
    ): Promise<void> {
        if (!params.name) throw new Error('Missing "name" for delete action.');

        const skill = this.skillLoader.getSkill(params.name);
        if (!skill) throw new Error(`Skill "${params.name}" not found.`);
        if (skill.source === 'bundled') throw new Error(`Bundled skills cannot be deleted.`);

        const file = this.plugin.app.vault.getAbstractFileByPath(skill.filePath);
        if (file instanceof TFile) {
            await this.plugin.app.fileManager.trashFile(file);
        }

        callbacks.pushToolResult(this.formatSuccess(`Skill "${params.name}" deleted.`));
    }

    private handleList(callbacks: { pushToolResult(c: string): void }): void {
        const skills = this.skillLoader.getAllSkills();
        if (skills.length === 0) {
            callbacks.pushToolResult(this.formatSuccess('No self-authored skills found. Use "create" to make one.'));
            return;
        }

        const lines = skills.map(s => {
            const success = s.successCount > 0 ? ` (used ${s.successCount}x)` : '';
            return `- ${s.name}: ${s.description} [${s.source}]${success}`;
        });

        callbacks.pushToolResult(this.formatSuccess(
            `${skills.length} skill(s):\n${lines.join('\n')}`
        ));
    }

    private handleValidate(
        params: ManageSkillInput,
        callbacks: { pushToolResult(c: string): void },
    ): void {
        if (!params.name) throw new Error('Missing "name" for validate action.');

        const skill = this.skillLoader.getSkill(params.name);
        if (!skill) throw new Error(`Skill "${params.name}" not found.`);

        const issues: string[] = [];

        if (!skill.description) issues.push('Missing description');
        if (!skill.body || skill.body.length < 10) issues.push('Body too short (should describe steps)');

        // Check trigger regex validity
        try {
            new RegExp(skill.triggerSource);
        } catch {
            issues.push(`Invalid trigger regex: ${skill.triggerSource}`);
        }

        // Check required tools exist
        for (const tool of skill.requiredTools) {
            if (!this.plugin.toolRegistry.hasTool(tool as import('../types').ToolName)) {
                issues.push(`Required tool not found: ${tool}`);
            }
        }

        if (issues.length === 0) {
            callbacks.pushToolResult(this.formatSuccess(`Skill "${params.name}" is valid.`));
        } else {
            callbacks.pushToolResult(this.formatSuccess(
                `Skill "${params.name}" has ${issues.length} issue(s):\n${issues.map(i => `- ${i}`).join('\n')}`
            ));
        }
    }

    private handleRead(
        params: ManageSkillInput,
        callbacks: { pushToolResult(c: string): void },
    ): void {
        if (!params.name) throw new Error('Missing "name" for read action.');

        const skill = this.skillLoader.getSkill(params.name);
        if (!skill) throw new Error(`Skill "${params.name}" not found.`);

        callbacks.pushToolResult(this.formatSuccess(
            `# ${skill.name}\n\n**Description**: ${skill.description}\n**Trigger**: ${skill.triggerSource}\n**Source**: ${skill.source}\n**Used**: ${skill.successCount} time(s)\n**Tools**: ${skill.requiredTools.join(', ') || '(none)'}\n\n---\n\n${skill.body}`
        ));
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private buildSkillMd(params: Omit<ManageSkillInput, 'action'>): string {
        const tools = params.required_tools?.length
            ? `[${params.required_tools.join(', ')}]`
            : '[]';

        return `---
name: ${params.name}
description: ${params.description ?? ''}
trigger: "${params.trigger ?? params.name?.toLowerCase() ?? ''}"
source: ${params.source ?? 'learned'}
requiredTools: ${tools}
createdAt: ${new Date().toISOString()}
successCount: 0
---
${params.body ?? ''}
`;
    }

    private slugify(name: string): string {
        return name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
    }
}

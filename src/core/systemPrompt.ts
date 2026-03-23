/**
 * System Prompt Builder
 *
 * Orchestrates modular prompt sections into the final system prompt.
 * Each section is a pure function in src/core/prompts/sections/.
 *
 * Section order:
 *   1. Date/Time header
 *   2. Vault context
 *   3. Capabilities
 *   4. User memory
 *   5. Tools (filtered by mode)
 *   6. Plugin Skills (right after tools -- agent sees plugins before deciding)
 *   6.5. Procedural Recipes
 *   6.6. Self-Authored Skills
 *   7. Tool rules
 *   8. Tool decision guidelines
 *   9. Objective (task decomposition)
 *  10. Response format
 *  11. Explicit instructions
 *  12. Security boundary
 *  13. Mode role definition
 *  14. Custom instructions
 *  15. Skills (manual + bundled, trigger-matched per message)
 *  16. Rules
 *
 * Adapted from Kilo Code's src/core/prompts/system.ts — modularized for Obsidian.
 */

import type { ModeConfig } from '../types/settings';
import type { McpClient } from './mcp/McpClient';
import {
    getDateTimeSection,
    getVaultContextSection,
    getCapabilitiesSection,
    getMemorySection,
    getToolsSection,
    getToolRoutingSection,
    getObjectiveSection,
    getResponseFormatSection,
    getExplicitInstructionsSection,
    getSecurityBoundarySection,
    getModeDefinitionSection,
    getCustomInstructionsSection,
    getPluginSkillsSection,
    getSkillsSection,
    getRulesSection,
} from './prompts/sections';

/**
 * Configuration for building the system prompt.
 * Replaces 15+ positional parameters with a structured config object.
 */
export interface SystemPromptConfig {
    mode: ModeConfig;
    globalCustomInstructions?: string;
    includeTime?: boolean;
    rulesContent?: string;
    skillsSection?: string;
    mcpClient?: McpClient;
    allowedMcpServers?: string[];
    memoryContext?: string;
    pluginSkillsSection?: string;
    isSubtask?: boolean;
    webEnabled?: boolean;
    recipesSection?: string;
    configDir: string;
    selfAuthoredSkillsSection?: string;
}

/**
 * Build the system prompt for a given mode.
 *
 * Accepts either a SystemPromptConfig object (preferred) or positional
 * parameters (legacy, kept for backwards compatibility during migration).
 */
export function buildSystemPromptForMode(config: SystemPromptConfig): string;
/** @deprecated Use the config object overload instead. */
export function buildSystemPromptForMode(
    mode: ModeConfig,
    allModes?: ModeConfig[],
    globalCustomInstructions?: string,
    includeTime?: boolean,
    rulesContent?: string,
    skillsSection?: string,
    mcpClient?: McpClient,
    allowedMcpServers?: string[],
    memoryContext?: string,
    pluginSkillsSection?: string,
    isSubtask?: boolean,
    webEnabled?: boolean,
    recipesSection?: string,
    configDir?: string,
    selfAuthoredSkillsSection?: string,
): string;
export function buildSystemPromptForMode(
    configOrMode: SystemPromptConfig | ModeConfig,
    allModes?: ModeConfig[],
    globalCustomInstructions?: string,
    includeTime?: boolean,
    rulesContent?: string,
    skillsSection?: string,
    mcpClient?: McpClient,
    allowedMcpServers?: string[],
    memoryContext?: string,
    pluginSkillsSection?: string,
    isSubtask = false,
    webEnabled?: boolean,
    recipesSection?: string,
    configDir?: string,
    selfAuthoredSkillsSection?: string,
): string {
    // Normalize: if first arg has 'slug' and 'toolGroups', it's a ModeConfig (legacy call)
    // If it has 'mode' property, it's a SystemPromptConfig
    let mode: ModeConfig;
    if ('mode' in configOrMode && 'slug' in configOrMode.mode) {
        // Config object form
        const cfg = configOrMode;
        mode = cfg.mode;
        globalCustomInstructions = cfg.globalCustomInstructions;
        includeTime = cfg.includeTime;
        rulesContent = cfg.rulesContent;
        skillsSection = cfg.skillsSection;
        mcpClient = cfg.mcpClient;
        allowedMcpServers = cfg.allowedMcpServers;
        memoryContext = cfg.memoryContext;
        pluginSkillsSection = cfg.pluginSkillsSection;
        isSubtask = cfg.isSubtask ?? false;
        webEnabled = cfg.webEnabled;
        recipesSection = cfg.recipesSection;
        configDir = cfg.configDir;
        selfAuthoredSkillsSection = cfg.selfAuthoredSkillsSection;
    } else {
        // Legacy positional form
        mode = configOrMode as ModeConfig;
    }
    const sections: string[] = [
        // 1. Date/time + Vault context
        getDateTimeSection(includeTime) + getVaultContextSection(),

        // 2. Mode role definition — early context setting
        getModeDefinitionSection(mode),

        // 3. Skills — Primacy Effect: skills at top get strongest attention
        isSubtask ? '' : getSkillsSection(skillsSection),

        // 4. Capabilities (compact summary)
        getCapabilitiesSection(webEnabled),

        // 5. User memory (omit for subtasks)
        isSubtask ? '' : getMemorySection(memoryContext),

        // 6. Tools (filtered by mode)
        getToolsSection(mode.toolGroups, mcpClient, allowedMcpServers, webEnabled, !isSubtask),

        // 7. Plugin Skills
        getPluginSkillsSection(pluginSkillsSection),

        // 7.5. Procedural Recipes (ADR-017)
        (isSubtask || !recipesSection) ? '' : recipesSection,

        // 7.6. Self-Authored Skills
        (isSubtask || !selfAuthoredSkillsSection) ? '' : `SELF-AUTHORED SKILLS\n\nThe following skills are available. When a user message matches a skill trigger, use its instructions.\nTo manage skills: use the manage_skill tool.\n\n${selfAuthoredSkillsSection}`,

        // 8. Tool Routing (merged rules + guidelines — compact)
        getToolRoutingSection(configDir!),

        // 9. Objective (task decomposition)
        getObjectiveSection(),

        // 10. Response format (omit for subtasks)
        isSubtask ? '' : getResponseFormatSection(),

        // 11. Explicit instructions
        getExplicitInstructionsSection(),

        // 12. Security boundary
        getSecurityBoundarySection(),

        // 13. Custom instructions (omit for subtasks)
        isSubtask ? '' : getCustomInstructionsSection(globalCustomInstructions, mode.customInstructions),

        // 14. Rules (conditional)
        getRulesSection(rulesContent),
    ];

    // Filter empty strings from conditional sections, then join
    return sections.filter(Boolean).join('\n');
}


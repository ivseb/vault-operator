/**
 * System Prompt Builder
 *
 * Orchestrates modular prompt sections into the final system prompt.
 * Each section is a pure function in src/core/prompts/sections/.
 *
 * Section order (ADR-062: KV-Cache-Optimized):
 *
 * STABLE (cached across iterations):
 *   1. Mode definition
 *   2. Capabilities
 *   3. Obsidian conventions
 *   4. Tools (filtered by mode, largest stable block)
 *   5. Tool routing (rules + guidelines)
 *   6. Objective
 *   7. Response format
 *   8. Security boundary
 *   ── CACHE BREAKPOINT ──
 * DYNAMIC (can change per message/session):
 *   9. Plugin Skills
 *  10. Active Skills (LLM-classified per message)
 *  11. User memory
 *  12. Procedural Recipes
 *  13. Self-Authored Skills
 *  14. Custom instructions + Rules
 *  15. Explicit instructions
 *  16. Vault context
 *  17. DateTime (MUST be last -- timestamp invalidates cache)
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
    getObsidianConventionsSection,
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
    // ADR-062: KV-Cache-Optimized Section Order
    // STABLE sections first (cached by KV-cache across iterations),
    // DYNAMIC sections after the breakpoint (change per message/session).
    // A single changed token in the prefix invalidates the entire cache.
    // Reference: Manus Context Engineering (2025)
    const sections: string[] = [
        // ── STABLE (cached, does not change within a task session) ──────
        // 1. Mode role definition
        getModeDefinitionSection(mode),

        // 2. Capabilities (compact summary)
        getCapabilitiesSection(webEnabled),

        // 3. Obsidian conventions (central, not mode-specific)
        getObsidianConventionsSection(),

        // 4. Tools (filtered by mode — largest stable block, ~8k tokens)
        getToolsSection(mode.toolGroups, mcpClient, allowedMcpServers, webEnabled, !isSubtask),

        // 5. Tool Routing (merged rules + guidelines)
        getToolRoutingSection(configDir!),

        // 6. Objective (task decomposition)
        getObjectiveSection(),

        // 7. Response format (omit for subtasks)
        isSubtask ? '' : getResponseFormatSection(),

        // 8. Security boundary
        getSecurityBoundarySection(),

        // ── CACHE BREAKPOINT ────────────────────────────────────────────
        // Everything below can change per message or session.
        // Anthropic cache_control is set on the system prompt as a whole,
        // but a stable prefix maximizes KV-cache hits for all providers.

        // 9. Plugin Skills (can change when plugins are enabled/disabled)
        getPluginSkillsSection(pluginSkillsSection),

        // 10. Active Skills (LLM-classified per message — most dynamic)
        isSubtask ? '' : getSkillsSection(skillsSection),

        // 11. User memory (changes across sessions)
        isSubtask ? '' : getMemorySection(memoryContext),

        // 12. Procedural Recipes (ADR-017, matched per message)
        (isSubtask || !recipesSection) ? '' : recipesSection,

        // 13. Self-Authored Skills
        (isSubtask || !selfAuthoredSkillsSection) ? '' : `SELF-AUTHORED SKILLS\n\nThe following skills are available. When a user message matches a skill trigger, use its instructions.\nTo manage skills: use the manage_skill tool.\n\n${selfAuthoredSkillsSection}`,

        // 14. Custom instructions + Rules (user-defined, can change)
        isSubtask ? '' : getCustomInstructionsSection(globalCustomInstructions, mode.customInstructions),
        getRulesSection(rulesContent),

        // 15. Explicit instructions
        getExplicitInstructionsSection(),

        // 16. Vault context (file structure can change between tasks)
        getVaultContextSection(),

        // 17. DateTime — MUST be last (timestamp invalidates KV-cache!)
        getDateTimeSection(includeTime),
    ];

    // Filter empty strings from conditional sections, then join
    return sections.filter(Boolean).join('\n');
}


---
title: System Prompt Architecture
description: Modular system prompt assembly with 16 section modules, skills injection, and per-mode customization.
---

# System Prompt Architecture

Obsilo's system prompt is not a static string. It is assembled from 16 independent section modules, filtered by the active mode, and enriched with runtime context (skills, memory, rules). The orchestrator lives in `src/core/systemPrompt.ts`; the sections live in `src/core/prompts/sections/`.

## Why Modular?

A monolithic prompt becomes unmaintainable past 1000 tokens. Obsilo's prompt routinely exceeds 5000 tokens because the agent needs to understand 43+ tools, safety rules, vault conventions, and user-specific context. The modular approach solves three problems:

1. **Testability** -- each section is a pure function that can be unit-tested in isolation.
2. **Conditional assembly** -- subtasks skip skills, memory, and response format sections to keep child prompts lean.
3. **Per-mode customization** -- the mode definition section injects role-specific instructions without touching other sections.

## Assembly Order

The orchestrator `buildSystemPromptForMode()` assembles sections in a deliberate order. Position matters -- LLMs pay more attention to content near the top (primacy effect) and the bottom (recency effect):

| # | Section | Builder Function | Notes |
|---|---------|-----------------|-------|
| 1 | Date/Time + Vault Context | `getDateTimeSection` + `getVaultContextSection` | Grounding: the agent knows when and where it is |
| 2 | Mode Definition | `getModeDefinitionSection` | Early role setting -- shapes all subsequent interpretation |
| 3 | Skills | `getSkillsSection` | Primacy position for strongest attention (skipped in subtasks) |
| 4 | Capabilities | `getCapabilitiesSection` | Compact summary of what the agent can do |
| 4.5 | Obsidian Conventions | `getObsidianConventionsSection` | Vault-specific rules (frontmatter, wikilinks, etc.) |
| 5 | Memory | `getMemorySection` | User memory context (skipped in subtasks) |
| 6 | Tools | `getToolsSection` | Filtered by mode's `toolGroups` setting |
| 7 | Plugin Skills | `getPluginSkillsSection` | Right after tools -- agent sees plugin capabilities before deciding |
| 7.5 | Procedural Recipes | *(injected directly)* | ADR-017 structured multi-step workflows |
| 7.6 | Self-Authored Skills | *(injected directly)* | Agent-created skills from `manage_skill` |
| 8 | Tool Routing | `getToolRoutingSection` | Merged tool rules + decision guidelines (compact) |
| 9 | Objective | `getObjectiveSection` | Task decomposition strategy |
| 10 | Response Format | `getResponseFormatSection` | Output structure rules (skipped in subtasks) |
| 11 | Explicit Instructions | `getExplicitInstructionsSection` | Hard behavioral constraints |
| 12 | Security Boundary | `getSecurityBoundarySection` | Prompt injection defense, permission boundaries |
| 13 | Custom Instructions | `getCustomInstructionsSection` | User's global + mode-specific custom instructions |
| 14 | Rules | `getRulesSection` | Conditional rules from `.obsilo/rules/` |

::: info Section Filtering
Empty sections are filtered out before joining. A section builder returns an empty string when its input is absent (e.g., `getMemorySection('')` returns `''`). This means the prompt never contains hollow headers -- it is always as compact as possible.
:::

## Section Modules

All 16 section builders live in `src/core/prompts/sections/` and are re-exported through `src/core/prompts/sections/index.ts`:

| Module | File | Purpose |
|--------|------|---------|
| `dateTime` | `dateTime.ts` | Current date, optionally time |
| `vaultContext` | `vaultContext.ts` | Vault name, file count, folder structure hint |
| `capabilities` | `capabilities.ts` | What the agent can do (read, write, search, generate) |
| `memory` | `memory.ts` | User memory entries from MemoryDB |
| `tools` | `tools.ts` | Tool list filtered by mode + MCP tools |
| `toolRouting` | `toolRouting.ts` | Combined tool rules and decision guidelines |
| `objective` | `objective.ts` | Task decomposition and planning strategy |
| `responseFormat` | `responseFormat.ts` | Output formatting rules |
| `explicitInstructions` | `explicitInstructions.ts` | Hard behavioral constraints |
| `securityBoundary` | `securityBoundary.ts` | Prompt injection defense |
| `modeDefinition` | `modeDefinition.ts` | Active mode's role, description, constraints |
| `customInstructions` | `customInstructions.ts` | User-provided instructions (global + per-mode) |
| `pluginSkills` | `pluginSkills.ts` | Skills from installed Obsidian plugins |
| `skills` | `skills.ts` | Manual + bundled skills, trigger-matched per message |
| `rules` | `rules.ts` | Project rules from `.obsilo/rules/` directory |
| `obsidianConventions` | `obsidianConventions.ts` | Vault-specific conventions (links, frontmatter, etc.) |

## Skills Injection

Skills are markdown-based instructions that activate when a user message matches their trigger keywords. The injection flow:

1. **Skill loading** -- `SkillLoader` reads `.obsilo/skills/` and bundled skill files.
2. **Trigger matching** -- user message keywords are matched against skill trigger patterns.
3. **Section building** -- matched skills are concatenated into the skills section.
4. **Primacy placement** -- the skills section is placed at position 3 (right after mode definition) for maximum model attention.

Self-authored skills (created by the agent via `manage_skill`) follow the same path but are injected at position 7.6, after tools and plugin skills.

::: tip Why Skills Before Tools?
The primacy effect in LLMs means early content gets disproportionate attention. Skills contain high-level workflow instructions ("do X, then Y, then Z") that should guide tool selection. Placing skills before the tool list ensures the agent reads the strategy before the tactics.
:::

## Power Steering

During long loops, `AgentTask` injects a synthetic user message every `powerSteeringFrequency` iterations. This message contains:

- The active mode's role definition.
- Active skill names (if any).
- A reminder to stay on task.

This is not a system prompt modification -- it is a user-role message appended to the history. The model sees it as a gentle redirect, not a system-level override. The system prompt itself is cached and only rebuilt when the mode changes or tool availability shifts.

## Per-Mode Customization

Each `ModeConfig` provides:

- **`toolGroups`** -- which tool groups are available (read, vault, edit, web, agent, mcp).
- **`roleDefinition`** -- injected into the mode definition section.
- **`customInstructions`** -- appended to the custom instructions section.

::: details Subtask Prompt Stripping
When `isSubtask` is true, the prompt assembly skips: skills (position 3), memory (position 5), recipes (7.5), self-authored skills (7.6), response format (10), and custom instructions (13). This keeps child task prompts focused and compact -- a subtask should execute its specific job, not inherit the full parent context.
:::

## Prompt Caching

The system prompt and tool definitions are cached per mode in `AgentTask.run()`. The cache is invalidated when:

- The active mode changes (via `switch_mode` tool).
- A settings change affects tool availability (e.g., `webTools.enabled` toggle).
- An explicit cache invalidation is triggered via `invalidateToolCache()`.

This avoids rebuilding the prompt on every iteration -- significant when the prompt exceeds 5000 tokens and the loop runs 10+ iterations.

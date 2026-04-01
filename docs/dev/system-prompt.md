---
title: System Prompt
description: How the agent's system prompt is assembled from modular sections, skills, memory, and mode context.
---

# System prompt

The system prompt is the first thing the model sees. It tells the agent who it is, what tools it has, what rules to follow, and what the user's vault looks like. In Obsilo, the prompt is not a static string -- it is assembled from ~16 independent section modules, filtered by the active mode, and enriched with runtime context like skills and memory.

The orchestrator is `buildSystemPromptForMode()` in `src/core/systemPrompt.ts`. The sections live in `src/core/prompts/sections/`.

## Why modular?

A monolithic prompt becomes unworkable past a few hundred lines. Obsilo's prompt routinely exceeds 5000 tokens because the agent needs to understand 43+ tools, safety rules, vault conventions, and user-specific context. Splitting it into modules solves two real problems:

- Different modes need different prompts. A read-only mode should not include write-tool descriptions. Subtasks should skip skills and memory to stay lean. With modules, you toggle sections on or off.
- Adding a skill or a new tool group should not require editing a monolithic template. Each concern lives in its own file.

## Assembly order

Position matters. LLMs pay more attention to content near the top (primacy effect) and the bottom (recency effect). The sections are ordered deliberately:

| # | Section | What it does |
|---|---------|-------------|
| 1 | Date/Time + Vault Context | Grounds the agent: when and where it is |
| 2 | Mode Definition | Sets the role early, shaping everything that follows |
| 3 | Skills | High-priority workflow instructions (skipped in subtasks) |
| 4 | Capabilities | Compact summary of what the agent can do |
| 4.5 | Obsidian Conventions | Vault-specific rules: frontmatter, wikilinks, etc. |
| 5 | Memory | User memory context (skipped in subtasks) |
| 6 | Tools | Tool list, filtered by the mode's `toolGroups` |
| 7 | Plugin Skills | Skills from installed Obsidian plugins |
| 8 | Tool Routing | Tool selection rules and decision guidelines |
| 9 | Objective | Task decomposition strategy |
| 10 | Response Format | Output structure rules (skipped in subtasks) |
| 11 | Explicit Instructions | Hard behavioral constraints |
| 12 | Security Boundary | Prompt injection defense, permission boundaries |
| 13 | Custom Instructions | User's global + per-mode instructions |
| 14 | Rules | Conditional rules from `.obsilo/rules/` |

Empty sections are filtered out before joining. If there is no memory context, the memory section is absent -- no hollow headers, no wasted tokens.

## How skills get injected

Skills are markdown files that contain workflow instructions. They activate when a user message matches their trigger keywords. The flow:

1. `SkillLoader` reads skills from `.obsilo/skills/` and the bundled skill directory.
2. The user's message is compared against each skill's trigger patterns.
3. Matching skills are concatenated into the skills section.
4. That section is placed at position 3 -- right after the mode definition -- for maximum attention.

Skills go before the tool list on purpose. They contain high-level strategy ("do X, then Y, then Z") that should guide which tools the agent picks. The agent reads the plan before it sees the toolkit.

Self-authored skills -- ones the agent created via `manage_skill` -- follow the same path but land at position 7, after tools and plugin skills. They supplement the primary skills, not replace them.

## How memory gets injected

The memory section pulls relevant entries from the user's memory database and injects them as context. In subtasks, memory is skipped entirely to keep child prompts focused.

## Token budget

The system prompt cannot exceed the model's context window. When you add a long custom instruction or load several skills, the prompt grows. Sections have implicit priorities: core sections (tools, security boundary) are always present. Optional sections (memory, skills, custom instructions) can be trimmed or skipped based on the context.

Subtasks are the most aggressive about trimming. A child task skips skills, memory, response format, recipes, self-authored skills, and custom instructions. It gets the tools, the rules, and the job. Nothing more.

## Per-mode customization

Each mode provides a `roleDefinition` that goes into the mode definition section, and optional `customInstructions` appended to the custom instructions section. The `toolGroups` field controls which tools appear in the tools section.

Two modes can produce very different system prompts from the same set of section modules. Ask mode gets a read-only role definition and no write tools. Agent mode gets the full set.

## Prompt caching

The system prompt and tool definitions are cached per mode in `AgentTask`. The cache is rebuilt only when:

- The active mode changes (via `switch_mode`).
- A settings change affects tool availability (like toggling web tools).
- An explicit invalidation is triggered.

This avoids rebuilding a 5000+ token prompt on every loop iteration.

## Power steering

During long-running tasks, `AgentTask` injects a synthetic user message every N iterations. It contains the active mode's role definition, active skill names, and a reminder to stay on task. This is not a system prompt change -- it is a user-role message appended to the conversation history. The model treats it as a gentle redirect.

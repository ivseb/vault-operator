---
title: Memory
description: How Obsilo remembers things across conversations with three tiers of memory.
---

# Memory

Without memory, every conversation starts from zero. You'd re-explain your preferences, your projects, your writing style. Obsilo's memory system fixes this by persisting information across conversations in three tiers, each with a different lifespan and purpose.

## Three tiers

Session memory is automatic. When a conversation ends, the system extracts a summary: what was discussed, what decisions were made, what tools were used. These summaries live in the `sessions` table inside `memory.db` (SQLite, same engine as the knowledge layer). You never need to manage session memory; it accumulates on its own. Over hundreds of conversations, the session archive becomes a searchable log of everything you've worked on with the agent.

Long-term memory is durable facts about you and your work. The `MemoryService` (`src/core/memory/MemoryService.ts`) manages five Markdown files stored in `~/.obsidian-agent/memory/`:

| File | What it holds | Token budget |
|------|--------------|--------------|
| `user-profile.md` | Your name, role, communication preferences | ~200 tokens |
| `projects.md` | Active projects and their context | ~300 tokens |
| `patterns.md` | Behavioral patterns the agent has learned | ~200 tokens |
| `soul.md` | Agent identity and personality | ~200 tokens |
| `knowledge.md` | Domain knowledge (on-demand only, not in system prompt) | -- |

Each file has a hard cap of 800 characters when injected into the system prompt, with a combined maximum of 4,000 characters across all files. This keeps memory useful without eating the context window.

Soul is a special case. It defines how the agent communicates: language, tone, values, anti-patterns. The default soul speaks German, avoids filler phrases, and prioritizes usefulness over politeness. You can edit `soul.md` directly to reshape the agent's personality.

There are also two utility files: `errors.md` tracks known error patterns the agent has encountered, and `custom-tools.md` records dynamic tools and skills the agent has created. Both are loaded on demand rather than injected into every system prompt.

## How memory flows

```mermaid
flowchart LR
    C[Conversation ends] --> E[Extract summary]
    E --> S[Store in MemoryDB]
    S --> P[Load into system prompt]
    P --> N[Next conversation]
```

At the start of each conversation, the system loads `user-profile.md`, `projects.md`, `patterns.md`, and `soul.md` into the system prompt. The `knowledge.md` file is deliberately excluded from automatic loading. It's only retrieved on demand via semantic search to avoid wasting context on information that may not be relevant.

The `MemoryRetriever` (`src/core/memory/MemoryRetriever.ts`) handles the loading. It reads each file, truncates to the character budget, and assembles the combined memory block. If a file doesn't exist yet, the system creates it from a template on first access. The templates are minimal, just headings and placeholder fields that the agent fills in as it learns about you.

## MemoryDB

The `MemoryDB` (`src/core/knowledge/MemoryDB.ts`) is a separate SQLite database from the knowledge layer. It stores structured data across four tables:

| Table | Purpose |
|-------|---------|
| `sessions` | Conversation summaries with title, source, timestamp |
| `episodes` | Individual task executions: user message, tools used, success/failure |
| `recipes` | Learned multi-step patterns that can be replayed |
| `patterns` | Frequently observed tool sequences |

The database lives at `{vault-parent}/.obsidian-agent/memory.db` and is shared across vaults. The agent remembers you regardless of which vault you open.

Episodes are the most granular unit. Each episode records a single user request, the mode the agent was in, the exact sequence of tools it called, a ledger of tool outcomes, and whether the overall task succeeded. This data powers both the recipe system and the analytics visible in the Debug settings tab.

## Memory updates

The agent updates memory through two paths. Automatic extraction happens at conversation end. The system pulls out key facts and stores them as sessions and episodes. Explicit updates happen when the agent (or you) writes directly to a memory file using the `update_memory` tool.

Both the `update_memory` tool and the MCP server's `update_memory` endpoint write to the same files. If you use Obsilo through Claude Desktop via MCP, your memory still accumulates in the same place.

You can also edit the memory files directly in a text editor. They're plain Markdown. If the agent has learned something incorrect about you, open `user-profile.md` and fix it. The corrected version takes effect on the next conversation.

## Recipes and patterns

Over time, the `episodes` table reveals patterns. If you frequently ask the agent to "create a weekly summary from my daily notes" and it always uses the same sequence of `search_files` -> `read_file` -> `create_note`, that sequence gets stored as a recipe. Future requests matching the same pattern can skip the planning step and jump straight to execution.

Recipes include a `success_count` that tracks how often they've worked. Low-success recipes get deprioritized. The system is conservative about applying recipes, only suggesting them when trigger keywords match with high confidence.

Recipes are versioned with a `schema_version` field. If the recipe format changes in a future release, old recipes can be migrated or discarded rather than causing errors. Each recipe also records which modes it applies to, so a recipe learned in "code" mode won't be suggested in "ask" mode.

## Onboarding

New users start with empty memory files. The `OnboardingService` (`src/core/memory/OnboardingService.ts`) detects this state and triggers a first-run flow that asks a few questions: your name, your preferred language, what you primarily use Obsidian for. The answers populate `user-profile.md` and `soul.md`, giving the agent a baseline to work from. You can skip onboarding entirely and let memory build up organically through conversations.

## Token economics

Memory competes for space in the system prompt alongside rules, tool descriptions, and skills. The 4,000-character total budget for memory translates to roughly 1,000-1,200 tokens depending on content. This is a deliberate trade-off: enough memory to be useful, but not so much that it crowds out other context. If you find the memory too sparse, you can increase the per-file and total character limits in the source code, but you'll lose space for other system prompt sections.

The `knowledge.md` file sits outside this budget because it's only loaded when the agent calls semantic search. It can grow as large as you like without affecting the system prompt size.

---
title: Mode System
description: Built-in and custom modes, tool filtering, and per-mode configuration.
---
# Mode System

Modes define what the agent can do and how it behaves. Each mode specifies which tool groups are available, an optional model override, a role definition, and custom instructions. The `ModeService` is the central authority for mode resolution and tool access filtering.

## ModeService

**File:** `src/core/modes/ModeService.ts`

The service resolves the active mode by checking sources in priority order: **built-in** then **global** then **vault-local**. Vault-local entries whose slug matches a built-in act as overrides -- the vault version replaces the built-in in the resolved list.

Key methods:

| Method | Purpose |
|--------|---------|
| `getAllModes()` | Returns merged list: effective built-ins + global + vault modes |
| `getActiveMode()` | Returns the current mode; falls back to `ask` if the saved slug is invalid |
| `getToolDefinitions(mode)` | Returns LLM tool definitions filtered to the mode's effective tool set |
| `getEffectiveToolNames(mode)` | Applies user overrides on top of mode defaults (never escalates beyond group) |
| `switchMode(slug)` | Persists the new active mode to settings |
| `setModeToolOverride(slug, tools)` | Stores a permanent per-mode tool filter (intersected with allowed groups) |

Web tools (`web_search`, `web_fetch`) are dynamically removed from the definition set when `webTools.enabled` is `false`, regardless of mode configuration. This prevents the LLM from calling disabled tools.

## Built-in Modes

**File:** `src/core/modes/builtinModes.ts`

Two default modes cover everyday knowledge work:

### Ask (read-only)

- **Tool groups:** `read`, `vault`, `agent`
- **Behavior:** Conversational Q&A, vault search, exploration. Cannot modify files.
- **Mode escalation:** When the user requests a write operation, the agent calls `switch_mode` to escalate to Agent mode.

### Agent (full autonomy)

- **Tool groups:** `read`, `vault`, `edit`, `web`, `agent`, `mcp`, `skill`
- **Behavior:** Fully capable autonomous agent with all tools, sub-agent spawning, web access, MCP, and plugin skills.

## Tool Groups

Tool groups are the building blocks of mode configuration. Each group maps to a set of tool names:

| Group | Tools |
|-------|-------|
| `read` | read_file, read_document, list_files, search_files |
| `vault` | get_frontmatter, search_by_tag, get_vault_stats, get_linked_notes, get_daily_note, open_note, semantic_search, query_base |
| `edit` | write_file, edit_file, append_to_file, create_folder, delete_file, move_file, update_frontmatter, generate_canvas, create_excalidraw, create_base, update_base, create_pptx, create_docx, create_xlsx, plan_presentation |
| `web` | web_fetch, web_search |
| `agent` | ask_followup_question, attempt_completion, update_todo_list, new_task, switch_mode, update_settings, configure_model, read_agent_logs, manage_mcp_server, manage_skill, evaluate_expression, manage_source |
| `mcp` | use_mcp_tool |
| `skill` | execute_command, execute_recipe, call_plugin_api, resolve_capability_gap, enable_plugin, render_presentation |

The `expandToolGroups()` function converts a list of group names into the flat set of tool names used for LLM tool definition filtering.

## Custom Modes

Users can create specialist modes beyond Ask and Agent. Custom modes are stored at two levels:

### Global Modes

**File:** `src/core/modes/GlobalModeStore.ts`

Stored in `~/.obsidian-agent/modes.json`. Available across all vaults. The `GlobalModeStore` handles persistence with size validation (rejects files > 500KB) and graceful fallback on parse errors.

### Vault-Local Modes

Stored in `settings.customModes[]` within the plugin's vault-specific settings. Scoped to a single vault.

### Per-Mode Configuration

Each `ModeConfig` supports:

| Field | Type | Purpose |
|-------|------|---------|
| `slug` | string | Unique identifier |
| `name` | string | Display name |
| `icon` | string | Lucide icon name |
| `toolGroups` | ToolGroup[] | Which tool groups are available |
| `roleDefinition` | string | System prompt role section |
| `customInstructions` | string | Additional instructions appended to the system prompt |
| `whenToUse` | string | Description of when this mode is appropriate |
| `source` | string | `built-in`, `global`, or `vault` |

Model overrides and skill/MCP server filtering are configured through `settings.modeToolOverrides[slug]`, which stores the effective tool list after user customization.

## Mode-Aware Tool Filtering

The mode system intersects with the [governance layer](/dev/governance) at two points:

1. **Definition filtering:** `ModeService.getToolDefinitions()` determines which tools the LLM can see. Tools outside the active mode's groups are not included in the API request.
2. **Override safety:** `getEffectiveToolNames()` applies user overrides but never escalates beyond the mode's allowed groups -- overrides can only restrict, not expand.

## Multi-Agent Mode Propagation

When a subtask is spawned via `new_task`, the child task inherits mode restrictions from the parent. The subtask mode is specified explicitly in the spawn call, allowing the parent to delegate to a more restricted mode (e.g., Agent spawning an Ask-mode subtask for research).

## Related ADRs

| ADR | Topic |
|-----|-------|
| ADR-004 | Mode-based tool filtering design |

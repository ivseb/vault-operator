# Vault Operator runtime capabilities

What the plugin can actually do, so a skill promises only real capabilities. The single most important fact here: a SKILL body and a sandbox script have very different reach. Get that split wrong and the skill breaks.

## Contents

- The body-versus-script split (read this first)
- Tools by job
- Deferred tools
- Composability primitives
- Choosing where a step runs

## The body-versus-script split

A skill runs in two places, and they are not the same environment.

**The SKILL body** is instructions the agent follows. From the body the agent can call every registered tool: read and write files, search, generate diagrams and Office documents, run semantic search, ingest documents, call other skills, call MCP tools, ask the user. If the skill needs a capability, the default is to have the body call the tool for it.

**A `scripts/*.js` helper** runs in the sandbox via `run_skill_script`. It gets exactly two things: `ctx.vault` (read, readBinary, list, mkdir, write, writeBinary) and `ctx.requestUrl` (four CDN hosts only). Nothing else. Not `read_file`, not `edit_file`, not `search_files`, not `semantic_search`, not `invoke_skill`, not any other tool. A script cannot parse a PPTX, cannot reach an arbitrary URL, cannot open the editor, cannot read plugin settings.

Consequence: if a step needs a tool, the body calls it. A script is only for deterministic computation over data the body already gathered and passed in via `args`. When a script "needs" another tool, the fix is to restructure so the body calls the tool and hands the result to the script.

## Tools by job

The agent has around 65 tools depending on the build. Group them by the job a skill might need. Names are the callable tool names.

**Read the vault:** `read_file` (text, chunked to the model window, see the read-window cap in obsidian-constraints), `read_document` (parse PPTX, XLSX, DOCX, PDF, JSON, XML, CSV into Markdown; use this for binary and Office files, not `read_file`), `list_files`, `search_files` (grep and regex), `semantic_search` (meaning-based, needs the index built), `get_frontmatter`, `search_by_tag`, `find_notes_by_type`, `get_linked_notes`, `get_vault_stats`, `query_base`.

**Write the vault:** `write_file` (create or fully replace; not for .pptx/.docx/.xlsx/.drawio/.excalidraw), `edit_file` (targeted string replacement, `old_str` must match exactly including whitespace), `append_to_file` (fails on dot-paths, see obsidian-constraints), `update_frontmatter`, `set_block_anchors` (batch fuzzy-matched `^block` anchors in one write; use this instead of hand-rolling an indexOf loop against messy text), `move_file`, `delete_file` (trashes via FileManager), `create_folder`.

**Generate artefacts:** `create_pptx`, `create_docx`, `create_xlsx` (Office documents, quality-gated, run in the plugin process with full library access), `plan_presentation` (call before `create_pptx`), `generate_canvas`, `create_excalidraw`, `create_drawio`, `create_base` and `update_base`.

**Ingest and knowledge:** `ingest_document` (source note with full original text, bypasses token limits), `ingest_triage`, `ingest_deep`, `anti_echo_search`, and the memory tools (`recall_memory`, `mark_for_memory`, `mark_note_as_memory_source`, `update_soul`).

**Web:** `web_fetch`, `web_search` (from the body only; a script cannot reach these).

**Sandbox compute:** `evaluate_expression` (one-off JS in the sandbox, result capped at 16000 chars, use for genuine computation and binary generation, not to orchestrate tool sequences), `run_skill_script` (a persisted helper).

**Orchestration and agent:** `ask_followup_question`, `update_todo_list` (for 3-plus-step tasks), `attempt_completion` (ends a skill subtask; an `allowedTools` list must include it), `new_task`, `invoke_skill`, `invoke_mcp_server`, `use_mcp_tool`, `consult_flagship` (one hard synthesis step, max three per task), `run_in_background`.

## Deferred tools

About nineteen tools are not in the default prompt and must be activated before use, among them `evaluate_expression`, `generate_canvas`, `create_excalidraw`, `create_drawio`, `plan_presentation`, `ingest_document`, `get_vault_stats`, `vault_health_check`, `search_by_tag`, `get_linked_notes`, `get_daily_note`, `query_base`, `create_base`, `update_base`, `list_checkpoints`, `inspect_self`, `update_settings`, `manage_source`, `manage_mcp_server`.

If a skill relies on a deferred tool, either the body calls `find_tool` once to activate it, or, better, the skill declares it in the `allowedTools` frontmatter. For an imported (non-trusted) skill, `allowedTools` also has to intersect with the current mode's tool groups, and the list must include `attempt_completion` or the subtask cannot return.

## Composability primitives

A skill can call another skill or an MCP tool as a step. Use `invoke_skill` for skill-to-skill (isolated subtask, own history, returns a result string; default budget 12 iterations, hard cap 25; cycle detection and composition depth cap 5). Use `invoke_mcp_server` for an MCP tool inside a workflow so the composition guard sees it. See `composability.md` for the full contract. Keep one job per skill so composition stays clean.

## Choosing where a step runs

For each capability in the brief:

1. If a built-in tool does it, the body calls that tool. This is the default and the most reliable path. Do not reimplement `create_pptx`, `set_block_anchors`, `ingest_document`, or `semantic_search` inside a script.
2. If no tool fits but the sandbox can compute it from data the body gathers, write a `scripts/*.js` helper and pass the data in via `args`. Check it against `sandbox-and-limits.md` first, and probe it live with `evaluate_expression`.
3. If neither fits, the capability is not available. Redesign the step or tell the user, and offer the closest thing that is possible.

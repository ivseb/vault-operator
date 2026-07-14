---
title: Safety and control
description: Auto-approve, checkpoints, approvals, and the operation log. How to stay in control of what Vault Operator does.
---

# Safety and control

Nothing changes in your vault without your knowledge.

See also: [Checkpoints](../concepts/checkpoints.md) and [Governance](../concepts/governance.md).

## The approval system

Vault Operator is fail-closed by default. It asks before any action that modifies your vault. Every write, edit, delete, or external call triggers an approval card in the chat.

### What an approval card shows

When Vault Operator wants to do something, a card appears with the tool name and a short preview:

- **Write a file:** path and a truncated preview of the content
- **Edit a file:** path and a truncated preview of the edit
- **Delete a file:** which file will be removed
- **Move or rename:** source and destination paths

Click the card to expand the full payload before deciding. Four levels, from narrow to broad:

- **Allow once**: this action only.
- **Allow for this run**: stop asking for this kind of change until the current task ends. The grant is never persisted and is shared with sub-tasks of the same run.
- **Allow this session**: stop asking for this kind of change until the plugin reloads (restart Obsidian or disable/enable the plugin). The grant lives only in memory and is never written to disk.
- **Always allow**: auto-approve this category from now on (a persisted setting).

Run and session grants cover the whole effect category shown on the card, not just the one tool: approving a `delete_file` card for the session also covers the other vault-change tools (`move_file`, `create_folder`, further deletes) until the plugin reloads, and an MCP card covers every tool on every configured MCP server. Plugin-API calls carry one extra distinction: the grant records read vs. write, so approving a plugin-API *read* never covers plugin-API *writes*. Settings changes and agent self-modification can never be covered by any scope. High-blast-radius operations always re-ask, whatever scope was granted: `restore_checkpoint`, `extract_zip`, and the `vault_health_check` mass repairs (`fix_backlinks`, `cleanup`, `fix_categories`; the read-only `check` stays covered).

## Auto-approve categories

Every tool call is classified into one effect by a central registry, and the effect decides whether it can auto-approve. The master switch under **Settings > Vault Operator > Agents > Permissions** ships **off**: with it off, everything that writes, spends money, or leaves the device asks. Reads always run.

| Category | What it covers | Risk level |
|----------|----------------|------------|
| **reads** | Reading files, listing folders, searching, semantic search | Always run (nothing changes); no toggle |
| **note edits** | Writing, editing, appending, frontmatter updates, ingest | High (changes your content) |
| **vault changes** | Create/move/delete files, extract archives, restore checkpoint, canvas and office docs | High (changes structure; harder to undo) |
| **web** | Fetching pages, web search, anti-echo search | Medium (external data enters the vault) |
| **mcp** | Calling external MCP tools/servers | Medium (depends on the connected server) |
| **subtasks** | Spawning sub-agents | Medium |
| **skills** | Running a skill (only trusted built-in / Pro skills auto-approve) | Medium |
| **recipes** | Running a stored recipe | Medium |
| **plugin API** | Reading from / writing to other plugins (two separate toggles) | Medium to high |
| **sandbox** | Agent-authored expressions, skill scripts, dynamic skill tools | High (runs generated code); toggle carries a confirm |

Two effects are **never** auto-approvable, whatever the settings say: **settings changes** (`update_settings`, `configure_model`, MCP server management) and **agent self-modification** (persona, memory, source). The agent cannot turn its own permissions on.

:::warning Permissive combination
If you auto-approve both **web** and a write category, Vault Operator lights up a "Permissive" warning in the Permissions tab. The agent could fetch content from the internet and act on it without asking.
:::

## Kill switch

At the top of the Permissions tab sit two emergency brakes:

- **Always ask (paranoid mode).** A runtime override: while it is on, every action except reads and pure UI steps asks for confirmation, regardless of the category toggles, presets, and any run or session grants. The approval cards stop offering scope grants while it is active (a grant would not take effect). The switch is a persisted setting, so it stays on across restarts until you turn it off; use it when you are inspecting an unfamiliar skill or model and want to watch every step.
- **Reset to default-deny.** One click (behind a confirmation) applies the restrictive preset: the auto-approve master goes off, every category returns to asking, and all grants given for the current run or session are revoked. Paranoid mode is not changed by the reset. Use it when the configuration has drifted more permissive than you are comfortable with and you want the fail-closed default back without flipping toggles one by one.

## Reviewing changes

### Before the edit

The approval card shows the tool name and a truncated preview. Expand the card to see the full path and payload before approving.

### After the edit

Once the agent runs the tool, the chat shows a result row with a `+N / -M` diff badge for files that were edited. Click the row to inspect the full diff.

### The edit review panel

Since v3.0.0, the same review panel handles every change that touches a note. It appears for sidebar tasks after the agent finishes, and for inline-chat actions like Rewrite or Translate (see [Inline chat](inline-chat.md)).

The panel layout:

- Side-by-side aligned diff. The left column shows the original content. The right column shows the proposed content.
- Line numbers and `+` / `−` gutters on both sides, so you can see exactly which lines were added or removed.
- The right column is editable (`contenteditable` with plaintext-only input). Click in and type to adjust the proposal before applying.
- A live `+N / −N` counter above the right column updates as you edit.
- When the change spans more than one file, a file list on the left lets you switch between them. Each file has a "Diese Datei skippen" toggle to skip writing that file.
- The footer offers two actions: "Verwerfen" discards everything. "Anwenden" writes the right-column content to disk.

For sidebar tasks, the panel opens automatically once the agent finishes a turn that wrote files. The modal title reads "Änderungen prüfen". For inline-chat actions, the panel opens automatically once the model finishes streaming.

### Checkpoint view

The same panel runs in checkpoint mode when you open a past snapshot. In this mode the right column is read-only and shows the snapshot content. The footer replaces "Anwenden" with "Wiederherstellen", which restores the snapshot to the vault.

Inline-chat edits also create checkpoints under a stable per-note task id, so every inline Rewrite or Translate is undoable from the inline checkpoint marker in the chat (Diff, Undo this, Undo from here, More menu). See [Inline chat](inline-chat.md) for the marker controls.

## Checkpoints and undo

Vault Operator creates a checkpoint before the first modification to any file in a task. Checkpoints live in a shadow git repository (via isomorphic-git) that sits next to your vault, not inside it, so your own git history is untouched. For details see [Checkpoints](../concepts/checkpoints.md).

### The undo bar

After every task that modified files, an undo bar appears with one button:

- **"Undo all changes":** restore every file to its pre-task state in one click

In parallel, the edit review panel (see above) opens automatically so you can inspect, edit, and apply per file.

:::tip Undo is always available
Even if you auto-approve everything, the checkpoint system records the state before changes. You can always undo after the fact.
:::

### How checkpoints work

1. Vault Operator snapshots each file before its first modification in a task.
2. The shadow repo stores the snapshot as a git commit.
3. If you undo, the original content comes back from the snapshot.
4. Files that were newly created (did not exist before the task) get deleted on undo.

Checkpoints are automatic. There is nothing to configure.

## The operation log

Every tool call is recorded in a daily log file.

Each entry records:

- Timestamp
- Tool name and parameters (sensitive values like API keys are redacted)
- Success or failure
- Duration

**Location:** JSONL files in your vault under `.vault-operator/data/logs/`, one per day, named by date (for example `2026-03-31.jsonl`).

**Retention:** Logs are kept for 30 days, then deleted. Browse recent logs in **Settings > Vault Operator > Advanced > Log**.

:::info No file content in logs
The operation log records that a file was read or written, but not the full content. It logs path and content length, not the actual text.
:::

## The ignore file

Create `.obsidian-agentignore` in your vault root to define paths the agent must never access. Same syntax as `.gitignore`:

```
# Private journal: agent cannot read or modify these
journal/
diary-*.md

# Credentials and sensitive files
secrets/
*.env
```

There is also `.obsidian-agentprotected` for files the agent can read but never write:

```
# Templates: agent can reference but not modify
templates/
```

Both files are protected themselves. The agent cannot modify or delete them. See [Governance](../concepts/governance.md) for the full ignore and protect model.

:::tip Always-blocked paths
Vault Operator never accesses `.git/`, the Obsidian workspace cache, or internal config files, no matter how you configure it.
:::

## Best practices

1. Start with approvals on. Leave auto-approve disabled until you are comfortable with how Vault Operator works. Watch the approval cards to learn what the agent does.

2. Enable categories gradually. Turn on `read` first (low risk), then add others as you build trust. Keep `edit` and `skill` on manual approval longer.

3. Avoid the permissive combination. Do not auto-approve `web` and `edit` at the same time unless you fully trust the content sources.

4. Use the ignore file. If you have sensitive notes (financial records, medical info, private journals), add them to `.obsidian-agentignore` before giving the agent broad permissions.

5. Review the operation log now and then. A quick scan of recent logs shows what the agent has been doing and catches anything off.

6. Back up your vault. Checkpoints give you undo inside Vault Operator, but a proper vault backup (Obsidian Sync, git, or a file-system backup) protects against everything else.

7. Run read-only sessions when you only want answers. Two paths that work today:
   - Leave auto-approve off for `edit`, `skill`, and `mcp`, and decline any write card. The agent then has to ask for every change.
   - Open the tool picker (knife icon in the chat header) and disable the `edit`, `web`, `agent`, `mcp`, and `skill` groups for the current agent. The override persists in `modeToolOverrides` and survives reloads.

   The New agent modal currently grants every tool group on create. Per-agent tool filtering happens through the tool picker override, not through the create form.

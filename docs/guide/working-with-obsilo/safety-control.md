---
title: Safety & Control
description: Permissions, checkpoints, approvals, and the audit log -- how to stay in control of what Obsilo does.
---

# Safety & Control

Obsilo is designed around one principle: **nothing changes in your vault without your knowledge.** This page explains the safety systems and how to configure them for your comfort level.

## The Approval System

By default, Obsilo uses a **fail-closed** approach -- it must ask before performing any action that modifies your vault. Every write, edit, delete, or external call triggers an approval card in the chat.

### What an Approval Card Shows

When Obsilo wants to do something, a card appears with:

- **Write a file** -- the full content that will be written
- **Edit a file** -- a diff showing exactly what changes (lines added and removed)
- **Delete a file** -- which file will be removed
- **Move/rename** -- source and destination paths

You can **Allow once** (approve this specific action) or **Always allow** (auto-approve this category from now on).

## Permission Categories

You can enable auto-approve for individual categories. Go to **Settings > Obsilo Agent > Permissions** to see the full list:

| Category | What it covers | Risk level |
|----------|---------------|-----------|
| **Read operations** | Reading files, listing folders, searching | Low -- nothing changes |
| **Note edits** | Editing existing Markdown notes | Medium -- changes your content |
| **Vault changes** | Creating, moving, or deleting files and folders | Medium-High -- structural changes |
| **Web operations** | Fetching web pages, searching the internet | Low-Medium -- external data access |
| **MCP calls** | Calling external tools via the Model Context Protocol | Medium -- depends on the tool |
| **Subtasks** | Spawning background sub-agents | Low -- inherits parent permissions |
| **Plugin skills** | Running built-in skill workflows | Low -- guided multi-step tasks |
| **Plugin API reads** | Reading Obsidian plugin data | Low -- read-only |
| **Plugin API writes** | Modifying Obsidian plugin settings | High -- can change app behavior |
| **Recipes** | Running multi-step automated workflows | High -- many actions in sequence |
| **Sandbox** | Executing code in the isolated sandbox | High -- runs generated code |

:::warning Permissive Mode Warning
If you enable auto-approve for both **web operations** and **note edits** (or vault changes), Obsilo shows a security warning. This combination means the agent could fetch content from the internet and write it to your vault without asking -- a pattern that increases risk.
:::

## How to Review Changes

### The Approval Card

Before any write operation, an approval card appears directly in the chat. For file edits, it shows a color-coded diff with a badge like `+3 / -1` indicating lines added and removed. Read the diff carefully before approving.

### The Diff Review Modal

After a task completes, you can review all changes at once:

1. The **undo bar** appears below the last message
2. Click **"Review changes"** to open the diff review modal
3. For each file, you see every change grouped by section (headings, paragraphs, code blocks)
4. Decide per section: **Keep**, **Undo**, or **Edit** (modify the change manually)

This gives you fine-grained control -- you can keep most of a task's work while reverting one specific paragraph.

## Checkpoints and Undo

Obsilo creates a **checkpoint** before the first modification to any file in a task. Checkpoints are stored in a shadow repository (using isomorphic-git) that does not interfere with your own git history.

### The Undo Bar

After every task that modified files, an undo bar appears:

- **"Undo all changes"** -- restores every file to its pre-task state with one click
- **"Review changes"** -- opens the diff review modal for per-file decisions

:::tip Undo Is Always Available
Even if you auto-approve everything, the checkpoint system records the state before changes. You can always undo after the fact.
:::

### How Checkpoints Work

1. Obsilo snapshots each file before its first modification in a task
2. The snapshot is stored as a git commit in the shadow repository
3. If you undo, the original content is restored from the snapshot
4. Files that were newly created (did not exist before the task) are deleted on undo

Checkpoints are automatic -- you do not need to configure anything.

## The Operation Log

Every tool call is recorded in a daily audit log file. This is your paper trail for everything Obsilo does.

**What is logged:**
- Timestamp
- Tool name and parameters (sensitive values like API keys are automatically redacted)
- Whether it succeeded or failed
- How long it took

**Where to find it:** The logs are stored as JSONL files (one per day) in your plugin directory under `logs/`. Each file is named by date, for example `2026-03-31.jsonl`.

**Retention:** Logs are kept for **30 days**, then automatically deleted. You can browse recent logs in **Settings > Obsilo Agent > Log**.

:::info The Log Never Stores File Content
For privacy, the operation log records that a file was read or written, but not the full content. It logs the file path and content length, not the actual text.
:::

## The Ignore File

Create a file called `.obsidian-agentignore` in your vault root to define paths the agent should never access. It uses the same syntax as `.gitignore`:

```
# Private journal -- agent cannot read or modify these
journal/
diary-*.md

# Credentials and sensitive files
secrets/
*.env
```

There is also `.obsidian-agentprotected` for files the agent can **read** but never **write**:

```
# Templates -- agent can reference but not modify
templates/
```

Both files are themselves protected -- the agent cannot modify or delete them.

:::tip Always-Blocked Paths
Regardless of your configuration, Obsilo never accesses `.git/`, the Obsidian workspace cache, or internal config files. These are blocked by default.
:::

## Security Best Practices

1. **Start with approvals on.** Leave auto-approve disabled until you are comfortable with how Obsilo works. Watch the approval cards to learn what the agent does.

2. **Enable categories gradually.** Start by auto-approving reads (low risk), then note edits after you trust the agent's judgment. Keep vault changes and sandbox on manual approval longer.

3. **Avoid the permissive combination.** Do not auto-approve web operations and writes at the same time unless you fully trust the content sources.

4. **Use the ignore file.** If you have sensitive notes (financial records, medical info, private journals), add them to `.obsidian-agentignore` before giving the agent broad permissions.

5. **Review the operation log periodically.** A quick scan of recent logs helps you understand what the agent has been doing and catch anything unexpected.

6. **Back up your vault.** Checkpoints provide undo within Obsilo, but a proper vault backup (Obsidian Sync, git, or file-system backup) protects against everything.

7. **Use Ask mode for exploration.** When you just want answers without any changes, switch to Ask mode. It is read-only by design -- nothing in your vault can be modified.

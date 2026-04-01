---
title: Your First Conversation
description: Learn the basics of chatting with Obsilo -- modes, context, and how the agent thinks.
---

# Your First Conversation

Obsilo is not a simple chatbot. It is an agent that can read, write, and search your vault. Understanding a few core concepts makes the experience much better.

## Modes

Obsilo has two built-in modes:

| Mode | What it does | When to use it |
|------|-------------|----------------|
| **Ask** | Read-only. Searches and analyzes but never changes your vault. | Questions, research, analysis |
| **Agent** | Full access. Can read, write, edit, create, and delete files. | Active work, content creation, refactoring |

Switch modes using the dropdown in the chat toolbar, or let the agent switch automatically.

:::tip Start with Ask Mode
If you are new to Obsilo, start in **Ask** mode. It cannot change anything, so you can explore safely. Switch to **Agent** mode when you are ready to let it work.
:::

## Context -- What the Agent Knows

The agent sees:
- **Your message** and the conversation history
- **The active note** (if "auto-add active file" is enabled in Settings > Interface)
- **Attached files** (drag & drop or click the paperclip icon)
- **@-mentioned files** (type `@` in the chat to search your vault)
- **Its memory** of past conversations (if memory is enabled)

The agent does **not** read your entire vault upfront. It searches and reads files on demand, using tools.

## The Activity Block

When the agent works, an expandable **activity block** appears below the response. It shows every tool call in real time:

- **Tool name** (e.g., `read_file`, `search_files`, `semantic_search`)
- **Key parameters** (e.g., the file path or search query)
- **Result** (expand to see details)
- **Diff badge** for write operations: `+3 / -1` lines changed

Click the activity block to expand or collapse it at any time.

## Approvals

By default, the agent **asks for your approval** before any write operation. An approval card appears showing exactly what the agent wants to do:

- **Write file** -- shows the full content
- **Edit file** -- shows the diff (what changes)
- **Delete file** -- shows which file
- **Move file** -- shows source and destination

Click **"Allow once"** to approve, or **"Always allow"** to auto-approve that category.

:::warning Auto-Approve with Care
Enabling auto-approve for writes means the agent acts without asking. The checkpoint system lets you undo, but review what changed after each task.
:::

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message (configurable: Ctrl/Cmd+Enter) |
| `Shift+Enter` | New line |
| `/` | Open workflow/prompt picker |
| `@` | Open file mention picker |

## Tips for Better Results

1. **Be specific.** "Summarize the meeting notes from March" works better than "summarize my notes."
2. **Mention files.** Use `@filename` to point the agent to specific notes.
3. **Use modes.** Ask mode for questions, Agent mode for actions.
4. **Check the activity.** The activity block shows you exactly what the agent did -- great for learning how it works.
5. **Let it search.** The agent can search your vault semantically. Ask broad questions like "What do I know about X?" and let semantic search find the relevant notes.

## Next Steps

- [Choosing a Model](/guide/choosing-a-model) -- Provider comparison and recommendations
- [Chat Interface](/guide/working-with-obsilo/chat-interface) -- Deep dive into all chat features
- [Knowledge Discovery](/guide/working-with-obsilo/knowledge-discovery) -- Set up semantic search

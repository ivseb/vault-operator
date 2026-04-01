---
title: Vault Operations
description: How Obsilo reads, writes, searches, and structures your vault.
---

# Vault Operations

Obsilo can read, write, search, and organize files across your entire vault. This page explains what the agent can do, how each operation works, and when you might use them.

## How It Works

The agent does not access your vault directly. It uses **tools** -- small, purpose-built functions that each do one thing. When you ask the agent to find a note or create a file, it selects the right tools and calls them on your behalf.

Every tool call is visible in the [activity block](/guide/working-with-obsilo/chat-interface#activity-blocks), and write operations require [approval](/guide/working-with-obsilo/safety-control) unless you enable auto-approve.

## Reading Your Vault

These tools let the agent look at your files without changing anything. They are available in both **Ask** and **Agent** mode.

| Tool | What it does |
|------|-------------|
| **read_file** | Opens a note and reads its content |
| **list_files** | Lists files and folders in a given path |
| **search_files** | Finds notes by text content (keyword search) |
| **search_by_tag** | Finds all notes with a specific tag |
| **get_frontmatter** | Reads the YAML metadata at the top of a note |
| **get_linked_notes** | Follows wikilinks and backlinks from a note |
| **get_daily_note** | Opens today's daily note (or a specific date) |

### Practical Examples

- *"What notes do I have in the Projects folder?"* -- uses `list_files`
- *"Find everything I wrote about client onboarding"* -- uses `search_files`
- *"Show me all notes tagged #review"* -- uses `search_by_tag`
- *"What links to my quarterly goals note?"* -- uses `get_linked_notes`
- *"Read today's daily note"* -- uses `get_daily_note`

:::tip Semantic Search Goes Further
Keyword search matches exact words. For finding notes by meaning (e.g., "notes about improving sleep" finding a note titled "Evening Routine"), see [Knowledge Discovery](/guide/working-with-obsilo/knowledge-discovery).
:::

## Writing and Editing

These tools modify your vault. They are only available in **Agent** mode and require approval by default.

| Tool | What it does |
|------|-------------|
| **write_file** | Creates a new note or replaces an existing one |
| **edit_file** | Makes targeted changes to part of a note |
| **append_to_file** | Adds content to the end of an existing note |
| **update_frontmatter** | Changes YAML metadata fields |

### Practical Examples

- *"Create a note summarizing our Q1 results"* -- uses `write_file`
- *"Replace the second paragraph in @project-brief with a shorter version"* -- uses `edit_file`
- *"Add today's action items to @task-list"* -- uses `append_to_file`
- *"Set the status field to 'complete' in @project-brief"* -- uses `update_frontmatter`

:::info Checkpoints Protect Your Files
Before any write operation, Obsilo saves a snapshot of the file. If something goes wrong, click **Undo** in the [undo bar](/guide/working-with-obsilo/chat-interface#the-undo-bar) to restore the original.
:::

## Organizing Files and Folders

These tools help you restructure your vault.

| Tool | What it does |
|------|-------------|
| **create_folder** | Creates a new folder (including nested paths) |
| **move_file** | Moves a note to a different folder or renames it |
| **delete_file** | Sends a note to the Obsidian trash |

### Practical Examples

- *"Create an Archive/2025 folder and move all notes tagged #archived there"* -- uses `create_folder` + `move_file`
- *"Rename @old-project-name to new-project-name"* -- uses `move_file`
- *"Delete all empty notes in the Inbox folder"* -- uses `delete_file`

:::warning Deletion Uses Obsidian Trash
Deleted files go to Obsidian's trash (`.trash` folder), not permanent deletion. You can recover them from there. This follows Obsidian's standard file management behavior.
:::

## Vault Statistics

The agent can give you an overview of your vault using **get_vault_stats**:

- Total number of notes, folders, and attachments
- Vault size
- Tag distribution
- Recently modified files

**Example:** *"Give me a summary of my vault -- how many notes, what are the most used tags?"*

## Canvas and Visual Maps

Obsilo can create visual representations of your notes and their relationships.

| Tool | What it does |
|------|-------------|
| **generate_canvas** | Creates an Obsidian Canvas (.canvas) with cards and connections |
| **create_excalidraw** | Creates an Excalidraw drawing (requires the Excalidraw plugin) |

**Example:** *"Create a canvas map showing all notes in the Projects folder and their connections"*

## Bases (Structured Data)

Bases let you work with your notes as structured data -- similar to a database view.

| Tool | What it does |
|------|-------------|
| **create_base** | Creates a new Base from notes matching certain criteria |
| **query_base** | Queries an existing Base with filters and sorting |
| **update_base** | Modifies entries in a Base |

**Example:** *"Create a Base of all notes tagged #book with columns for author, rating, and status from frontmatter"*

:::info Requires Obsidian Bases
The Bases feature uses Obsidian's built-in Bases functionality. Make sure your Obsidian version supports it (1.8+).
:::

## Tips for Vault Operations

1. **Be specific about paths.** Saying "the Projects folder" is clearer than "my project notes."
2. **Use @-mentions** to reference specific files. The agent does not have to search for them.
3. **Let the agent chain tools.** A single request like "find all notes about X, summarize them, and create a new note with the summary" will use multiple tools automatically.
4. **Check the activity block** to see exactly which files were read or changed.
5. **Start in Ask mode** if you only want to explore. Switch to Agent mode when you are ready to make changes.

## Next Steps

- [Knowledge Discovery](/guide/working-with-obsilo/knowledge-discovery) -- Semantic search and the knowledge graph
- [Chat Interface](/guide/working-with-obsilo/chat-interface) -- Attachments, history, and shortcuts
- [Office Documents](/guide/advanced/office-documents) -- Create PPTX, DOCX, and XLSX from your notes

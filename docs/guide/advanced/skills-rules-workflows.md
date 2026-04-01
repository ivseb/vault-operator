---
title: Skills, Rules & Workflows
description: Create custom behaviors, constraints, and automated task sequences.
---

# Skills, Rules & Workflows

Obsilo's behavior is fully customizable. You can give it permanent instructions, teach it new abilities, and create reusable multi-step sequences -- all without writing code.

## The Four Building Blocks

| Type | What it does | Triggered by | Location |
|------|-------------|-------------|----------|
| **Rules** | Static instructions always injected into the system prompt | Always active (toggle on/off) | `.obsidian-agent/rules/*.md` |
| **Skills** | Instruction sets injected when relevant keywords are detected | Automatic keyword matching | `.obsidian-agent/skills/{name}/SKILL.md` |
| **Workflows** | Multi-step sequences triggered by slash commands | `/workflow-name` in chat | `.obsidian-agent/workflows/*.md` |
| **Custom Prompts** | Reusable templates with variables | `/` picker in chat | Settings > Custom Prompts |

## Rules -- Always-On Instructions

Rules are the simplest customization. A rule is a Markdown file that gets injected into every conversation.

**Create a rule:**
1. Navigate to `.obsidian-agent/rules/` in your vault
2. Create a new `.md` file (e.g., `tone.md`)
3. Write your instruction in plain text

```markdown
Always respond in a friendly, concise tone.
Never use bullet points -- use numbered lists instead.
When summarizing notes, always include the creation date.
```

Toggle rules on and off in **Settings > Obsilo Agent > Rules**. Disabled rules stay in the folder but are not injected.

:::tip When to Use Rules
Rules are best for global constraints that should always apply -- tone of voice, formatting preferences, language requirements, or domain-specific terminology.
:::

## Skills -- Context-Aware Abilities

Skills are more powerful than rules. They are only injected when the agent detects that a conversation is relevant to the skill's domain, keeping the system prompt lean.

**Create a skill:**
1. Create a folder under `.obsidian-agent/skills/` (e.g., `meeting-notes/`)
2. Add a `SKILL.md` file with frontmatter:

```markdown
---
name: Meeting Notes
description: Formats meeting notes with attendees, decisions, and action items
---

When the user asks you to create or format meeting notes:
1. Ask for the meeting title, date, and attendees if not provided
2. Structure the note with these sections: Attendees, Agenda, Discussion, Decisions, Action Items
3. Tag action items with the responsible person
4. Add frontmatter with type: meeting, date, and participants
```

The agent automatically matches this skill when the user mentions meetings, agendas, or action items.

### Per-Mode Filtering

Skills can be restricted to specific modes. A skill meant for Agent mode (writing) will not activate in Ask mode (read-only). This prevents the agent from suggesting write actions when it cannot execute them.

### VaultDNA -- Automatic Plugin Discovery

VaultDNA is a built-in feature that scans your installed Obsidian plugins and generates skill files for them automatically. This means the agent knows about your Dataview queries, Templater templates, and other plugin commands without manual setup.

VaultDNA runs on startup and updates when plugins change. You will find the generated skill files under `.obsidian-agent/skills/` alongside your custom ones.

:::info No Maintenance Needed
VaultDNA-generated skills update themselves. You do not need to edit them -- but you can create your own skills that build on top of plugin capabilities.
:::

## Workflows -- Multi-Step Sequences

Workflows are like saved procedures. They define a sequence of steps the agent follows when triggered.

**Create a workflow:**
1. Create a file in `.obsidian-agent/workflows/` (e.g., `weekly-review.md`)
2. Define the steps:

```markdown
# Weekly Review

1. Search for all notes created or modified in the last 7 days
2. Group them by folder and summarize each group
3. List any open action items (unchecked checkboxes)
4. Create a new note called "Weekly Review - [date]" with the summary
5. Move the note to the Reviews/ folder
```

**Trigger it:** Type `/weekly-review` in the chat input. The agent follows the steps in order.

## Custom Prompts -- Quick Templates

Custom prompts are reusable message templates with variable placeholders.

| Variable | Replaced with |
|----------|--------------|
| `{{userInput}}` | Whatever the user types after selecting the prompt |
| `{{activeFile}}` | The content of the currently open note |

**Example:** A prompt called "Explain Like I'm 5" with the template `Explain the following in simple terms a beginner would understand: {{activeFile}}`.

Create and manage custom prompts in **Settings > Obsilo Agent > Custom Prompts**, or type `/` in the chat to browse and trigger them.

## Choosing the Right Tool

| You want to... | Use |
|----------------|-----|
| Set a permanent formatting or tone rule | Rule |
| Teach the agent a domain-specific process | Skill |
| Create a repeatable multi-step procedure | Workflow |
| Save a frequently used prompt | Custom Prompt |

:::warning Keep Rules Focused
Too many rules bloat the system prompt and can confuse the model. Prefer skills for specialized knowledge -- they only activate when needed.
:::

## Next Steps

- [Office Documents](/guide/advanced/office-documents) -- Create presentations, documents, and spreadsheets
- [Connectors](/guide/advanced/connectors) -- Connect external tools and expose your vault
- [Multi-Agent & Tasks](/guide/advanced/multi-agent) -- Delegate work to sub-agents

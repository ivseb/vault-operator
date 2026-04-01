---
title: Installation & Quick Start
description: Install Obsilo and start your first conversation in under 3 minutes.
---

# Installation & Quick Start

Get Obsilo running in your Obsidian vault in under 3 minutes.

## Install the Plugin

1. Open **Obsidian Settings** > **Community Plugins** > **Browse**
2. Search for **"Obsilo Agent"**
3. Click **Install**, then **Enable**

The Obsilo icon appears in the left sidebar.

:::tip BRAT (Beta Testing)
For the latest beta version, install via [BRAT](https://github.com/TfTHacker/obsidian42-brat): Add `pssah4/obsilo` as a beta plugin.
:::

## Add Your First Model

Obsilo needs an AI model to work. Open **Settings > Obsilo Agent > Models** and click **"+ add model"**.

### Free Option (No Credit Card)

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Sign in and click **"Create API Key"**
3. Copy the key and paste it into Obsilo

Google Gemini offers powerful models at no cost with generous rate limits.

### Best Quality

| Provider | Model | Strengths |
|----------|-------|-----------|
| Anthropic | Claude Sonnet 4.6 | Best overall quality, excellent tool use |
| OpenAI | GPT-4o | Fast, good at structured output |
| Google | Gemini 2.5 Pro | Free tier, large context window |

### Local & Private

For maximum privacy, run a model locally -- no data leaves your machine:

- **Ollama**: Install from [ollama.ai](https://ollama.ai), then `ollama pull llama3.2`
- **LM Studio**: Download from [lmstudio.ai](https://lmstudio.ai), install a model, start the server

:::info No Lock-In
Obsilo supports 10+ providers. You can switch models anytime, even mid-conversation. Configure multiple models and pick the right one for each task.
:::

## Your First Chat

1. Click the **Obsilo icon** in the left sidebar
2. Type a message and press **Enter**
3. Watch the agent work -- it shows every tool call in real time

### Try These Prompts

- *"What notes do I have about [any topic]?"*
- *"Summarize the note I'm currently viewing"*
- *"Create a new note with a summary of my last 3 daily notes"*
- *"Find all notes tagged with #project and create a canvas showing their connections"*

## What Happens Behind the Scenes

When you send a message, Obsilo:

1. **Reads your message** and decides which tools to use
2. **Calls tools** (read files, search, write) -- you see each call in the activity block
3. **Asks for approval** before any write operation (unless you enable auto-approve)
4. **Returns a response** with the result

Every write operation creates a **checkpoint** -- you can undo any change with one click.

## Next Steps

- [Your First Conversation](/guide/first-conversation) -- Learn about modes, context, and how the agent thinks
- [Choosing a Model](/guide/choosing-a-model) -- Find the best model for your workflow
- [Safety & Control](/guide/working-with-obsilo/safety-control) -- Understand permissions and checkpoints

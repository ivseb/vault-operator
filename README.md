# Obsilo Agent

**Agentic AI for Obsidian.**

An autonomous AI operating layer for your Obsidian vault. 49+ tools, semantic search, persistent memory, multi-agent workflows, office document creation, and full safety controls. Works with 10+ providers. Local-first. Open source. Free.

[www.obsilo.ai](https://www.obsilo.ai)

---

## What It Does

You describe a task in natural language. Obsilo plans, searches your vault, reads relevant notes, creates or edits content, browses the web when needed, and reports back -- all while showing you exactly what it's doing in real time. Every write operation requires your approval and creates a checkpoint you can undo with one click.

## Features

### 49+ Built-in Tools

Organized into six groups:

- **Read & Search**: `read_file`, `read_document`, `list_files`, `search_files`
- **Vault Intelligence**: `semantic_search`, `get_frontmatter`, `search_by_tag`, `get_linked_notes`, `get_vault_stats`, `get_daily_note`, `query_base`, `open_note`
- **Write & Edit**: `write_file`, `edit_file`, `append_to_file`, `update_frontmatter`, `create_folder`, `delete_file`, `move_file`, `generate_canvas`, `create_excalidraw`, `create_base`, `update_base`
- **Office Documents**: `plan_presentation`, `create_pptx`, `create_docx`, `create_xlsx`
- **Web**: `web_fetch`, `web_search` (Brave / Tavily)
- **Agent Control**: `new_task`, `update_todo_list`, `ask_followup_question`, `evaluate_expression`, `manage_skill`, `switch_mode`, and more
- **Plugin Integration**: `execute_command`, `call_plugin_api`, `enable_plugin`, `resolve_capability_gap`, `execute_recipe`, `render_presentation`
- **MCP**: `use_mcp_tool` -- connect any MCP server

### Knowledge Discovery

Local vector index (Vectra + Xenova transformers) with no cloud required. Combines semantic similarity with full-text keyword search (RRF fusion), 1-hop wikilink graph augmentation, local reranking (cross-encoder via WebAssembly), contextual retrieval, and implicit connection discovery between unlinked notes.

### Agent Modes

Two built-in modes -- **Ask** (read-only knowledge assistant) and **Agent** (full capabilities). Create custom modes with their own roles, tool sets, and instructions. Per-mode model overrides let you run a fast model for quick questions and a powerful one for complex tasks.

### Multi-Agent Workflows

Spawn sub-agents with `new_task` for complex parallel or sequential workflows -- Orchestrator-Worker, Prompt Chaining, Evaluator-Optimizer, and Routing patterns built in. Depth-limited to 2 levels with parallel execution for read-safe tools.

### Office Documents

Create PowerPoint, Word, and Excel files directly in your vault:
- **Template mode**: Use your corporate `.pptx` template -- the agent analyzes every layout and placeholder, plans content with an internal LLM call, and builds the presentation in your exact design.
- **Ad-hoc mode**: Create presentations from scratch without a template.
- **Reading**: Parse existing PPTX, DOCX, XLSX, PDF, CSV, and JSON files as conversation context.
- **Visual QA**: Render presentations to images for layout verification (requires LibreOffice).

### Sandbox Code Execution

Run TypeScript directly in a secure sandboxed iframe. Import npm packages (pptxgenjs, xlsx, pdf-lib, d3, etc.) from CDN -- no Node.js or shell required. Process data, automate complex batch operations, and create reusable skills with code modules.

### Plugin Integration

Obsilo automatically scans your installed Obsidian plugins and generates skill files that teach the agent how to use them. The agent learns each plugin's commands, settings, and file formats -- so it can create Excalidraw drawings, build Kanban boards, populate Dataview tables, or use any other plugin on your behalf.

### Memory & Personalization

Three-tier memory system:
- **Session memory**: Summaries of each conversation -- decisions, outcomes, open questions
- **Long-term memory**: Durable facts promoted from sessions -- your preferences, projects, workflow patterns
- **Soul**: Core understanding of your communication style and how you like the agent to behave

Chat-linking adds frontmatter references back to conversations, so you can trace any change to the chat that caused it.

### Context Injection

- **Rules** (`.obsidian-agent/rules/`): permanent instructions injected into every system prompt
- **Skills** (`.obsidian-agent/skills/`): keyword-matched mini-instructions auto-injected per message
- **Workflows** (`.obsidian-agent/workflows/`): slash-command driven instruction sets
- **Custom Prompts**: `/prompt-slug` templates with `{{userInput}}` and `{{activeFile}}` variables

### Safety & Control

- **Approval-based writes**: every write operation requires explicit approval (or configured auto-approval per category)
- **Automatic checkpoints**: isomorphic-git shadow repo snapshots before every task's first write
- **Diff review**: color-coded diffs with per-section Keep / Undo / Edit decisions after each task
- **Vault governance**: `.obsidian-agentignore` and `.obsidian-agentprotected` access control files
- **Audit log**: JSONL operation trail with parameter sanitization (30-day retention)

### Provider Flexibility

| Provider | Type | Auth | Notes |
|----------|------|------|-------|
| Anthropic | Cloud | API key | Claude model family. Best tool use in testing. |
| OpenAI | Cloud | API key | GPT model family. Fast, good structured output. |
| Google | Cloud | API key | Gemini models. Free tier available. |
| OpenRouter | Gateway | API key | 100+ models from many providers with a single key. |
| Azure OpenAI | Enterprise | API key + endpoint | Enterprise compliance and private endpoints. |
| GitHub Copilot | Gateway | OAuth | Uses your existing Copilot subscription. No separate API key. |
| Kilo Gateway | Gateway | Device auth / token | Centralized gateway with organization context. |
| Ollama | Local | None | Free, fully private. Many open-source models. |
| LM Studio | Local | None | Free, fully private. Visual model browser. |
| Custom | Any | Varies | Any OpenAI-compatible endpoint. |

### MCP Integration

Connect MCP servers via stdio, SSE, or streamable-HTTP. Tools are dynamically discovered and exposed to the agent. Per-mode whitelisting available. Obsilo can also act as an MCP server, exposing your vault to Claude Desktop or any MCP client.

---

## Installation

### Community Plugins

1. Open **Obsidian Settings** > **Community Plugins** > **Browse**
2. Search for **"Obsilo Agent"**
3. Click **Install**, then **Enable**

### BRAT (Beta)

For the latest beta version:

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from Community Plugins
2. Open BRAT settings and select **Add Beta Plugin**
3. Enter `https://github.com/pssah4/obsilo`
4. Enable "Obsilo Agent" in Settings > Community Plugins

### Manual Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/pssah4/obsilo.git
   cd obsilo
   npm install
   npm run build
   ```
2. Copy `main.js`, `styles.css`, and `manifest.json` to your vault:
   ```
   <vault>/.obsidian/plugins/obsilo-agent/
   ```
3. Enable the plugin in Obsidian: Settings > Community Plugins > Enable "Obsilo Agent"

### Requirements
- Obsidian 1.4.0 or later (1.8+ for Bases features)
- Desktop only (not available on mobile)
- Node.js 18+ for building from source

---

## Quick Start

1. **Add a model**: Settings > Obsilo Agent > Models > click "+ add model"
   - **Free option**: Get a [Google AI Studio](https://aistudio.google.com/app/apikey) API key (no credit card needed)
   - **Best quality**: Anthropic Claude Sonnet 4.6 or OpenAI GPT-4o
   - **Local & private**: [Ollama](https://ollama.ai) or [LM Studio](https://lmstudio.ai)
2. **Open the sidebar**: Click the Obsilo icon in the ribbon
3. **Ask a question**: Type any question about your vault, e.g. *"What are my most-linked notes?"*
4. **Run a task**: Switch to Agent mode and try *"Create a weekly review template"*

For search to work at its best, configure an embedding model and build the semantic index in Settings > Embeddings.

---

## Network Usage

This plugin makes network requests depending on your configuration:

- **LLM API calls**: Every message is sent to the configured model provider (Anthropic, OpenAI, Google, OpenRouter, Azure, or a local server like Ollama/LM Studio). No data is sent without a configured provider.
- **Web search** (optional): When using `web_search`, requests go to the configured search API (Brave or Tavily). Disabled by default.
- **MCP servers** (optional): Connected MCP servers may make additional network requests depending on their configuration.
- **No telemetry**: The plugin does not collect analytics, usage data, or crash reports.
- **API key storage**: API keys are stored in Obsidian's plugin settings (`data.json`), which is not encrypted. If you use Obsidian Sync, your keys will be synced.

---

## Directory Structure

```
<vault>/
├── .obsidian-agent/
│   ├── rules/            # Permanent system prompt instructions
│   ├── workflows/        # Slash-command workflow files
│   └── skills/           # Keyword-matched skill instructions
│
└── .obsidian/plugins/obsilo-agent/
    ├── checkpoints/      # Shadow git repo (automatic undo)
    ├── logs/             # JSONL operation audit trail
    ├── memory/           # Agent memory files (session, long-term, soul)
    └── semantic-index/   # Local vector index
```

---

## Documentation

Full documentation: **[www.obsilo.ai](https://www.obsilo.ai)**

**Getting Started**
- [Installation & Quick Start](https://www.obsilo.ai/guide/getting-started)
- [Your First Conversation](https://www.obsilo.ai/guide/first-conversation)
- [Choosing a Model](https://www.obsilo.ai/guide/choosing-a-model)

**Working with Obsilo**
- [Chat Interface](https://www.obsilo.ai/guide/working-with-obsilo/chat-interface)
- [Vault Operations](https://www.obsilo.ai/guide/working-with-obsilo/vault-operations)
- [Knowledge Discovery](https://www.obsilo.ai/guide/working-with-obsilo/knowledge-discovery)
- [Memory & Personalization](https://www.obsilo.ai/guide/working-with-obsilo/memory-personalization)
- [Safety & Control](https://www.obsilo.ai/guide/working-with-obsilo/safety-control)

**Advanced**
- [Skills, Rules & Workflows](https://www.obsilo.ai/guide/advanced/skills-rules-workflows)
- [Office Documents](https://www.obsilo.ai/guide/advanced/office-documents)
- [Connectors (MCP)](https://www.obsilo.ai/guide/advanced/connectors)
- [Multi-Agent & Tasks](https://www.obsilo.ai/guide/advanced/multi-agent)

**Reference**
- [Tools](https://www.obsilo.ai/guide/reference/tools)
- [Providers & Models](https://www.obsilo.ai/guide/reference/providers)
- [Settings](https://www.obsilo.ai/guide/reference/settings)
- [Troubleshooting](https://www.obsilo.ai/guide/reference/troubleshooting)

---

## Development

```bash
npm install       # Install dependencies
npm run dev       # Dev build with watch mode
npm run build     # Production build
```

---

## License

Apache 2.0

---

## Acknowledgements

- [Kilo Code](https://kilocode.ai) -- architectural inspiration
- [Obsidian](https://obsidian.md) -- the platform
- [Vectra](https://github.com/Stevenic/vectra) -- local vector database
- [Xenova Transformers](https://github.com/xenova/transformers.js) -- local ONNX embeddings
- [isomorphic-git](https://isomorphic-git.org) -- pure JS git for checkpoints
- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) -- Model Context Protocol

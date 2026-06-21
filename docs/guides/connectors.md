---
title: Connectors
description: Connect external MCP tools to Vault Operator, expose your vault to Claude Desktop and ChatGPT, and reach it remotely via a Cloudflare relay.
---

# Connectors

Vault Operator can call tools that live in external MCP servers, expose your vault and memory layer to other AI clients, and let you reach it remotely. All of this lives under one tab: **Settings > Vault Operator > Customize > Connectors**.

The tab has three in-page sections:

- **Local connector**: turn this Obsidian instance into an MCP server for Claude Desktop and similar local clients.
- **Remote access**: pair the local server with a Cloudflare relay so ChatGPT, Perplexity, or another remote client can reach it.
- **External tool servers**: list of MCP servers that Vault Operator calls out to.

## External tool servers: call MCP tools from the agent

The MCP client lets Vault Operator use tools that live in external MCP servers. You can extend what the agent can do without writing a plugin.

### What you can connect

Any MCP-compatible server works. A few common examples:

- Database tools (query SQLite, PostgreSQL, or other databases)
- Web services (call APIs, fetch data)
- Local utilities exposed over HTTP (file system helpers, custom scripts)
- Third-party integrations (GitHub, Slack, calendar services)

### Setup

1. Open **Settings > Vault Operator > Customize > Connectors > External tool servers**
2. Click **"+ Add Server"**
3. Choose the transport type:

| Transport | When to use |
|-----------|-------------|
| Streamable HTTP | Modern remote servers (recommended) |
| SSE | Older remote servers using Server-Sent Events (fallback) |

4. Enter the server URL
5. Save. The agent picks up available tools automatically.

Once connected, the agent calls external tools with `use_mcp_tool` and manages servers with `manage_mcp_server`.

:::tip Stdio-only servers need a bridge
Vault Operator does not start child processes for stdio MCP servers. If the server you want to use only ships a stdio binary (for example Playwright MCP), run it locally as an HTTP server first, then point Vault Operator at that URL. Example: `npx @playwright/mcp@latest --port 3001`, then add `http://localhost:3001` as a Streamable HTTP server.
:::

:::tip Discovery is automatic
You don't need to tell the agent which tools are available. It reads the tool list from each connected MCP server and uses them when they fit your request.
:::

## Local connector: expose Vault Operator to other AI clients

You can turn Vault Operator into an MCP server so Claude Desktop, ChatGPT, Perplexity, or any other MCP client can read and write your vault, memory, and history layers.

### Why this matters

Most external AI clients cannot access your Obsidian notes on their own. With Vault Operator's local connector enabled, they get structured access to:

- The vault: search and read notes, run vault operations
- Persistent memory: cross-surface facts and preferences
- Conversation history: search past chats across surfaces

Each external call carries a `source_interface` tag (`obsilo`, `claude-ai`, `claude-code`, `chatgpt`, `perplexity`, `unknown`) so memory and history stay separable per surface. See [Unified Chat Memory](/concepts/unified-chat-memory) for the cross-surface UX.

### Available tools (four tiers)

| Tier | Tools | What they do |
|------|-------|-------------|
| Read | `get_context`, `search_vault`, `read_notes`, `get_vault_note_metadata`, `get_vault_implicit_edges` | Vault, ontology, structural information |
| Memory | `recall_memory`, `save_to_memory`, `update_memory` (deprecated) | Persistent facts and preferences across surfaces |
| History | `save_conversation`, `close_conversation`, `search_history`, `sync_session` | Conversations as living documents, plus full-text search |
| Write | `write_vault`, `execute_vault_op` | Create, edit, delete files. Runs vault operations from the plugin's tool registry. |

`execute_vault_op` is the gateway to all vault operations. It lists the available tools at runtime, including `vault_health_check`, `semantic_search`, `create_pptx`, and others. The list is generated from the plugin's tool registry, so new tools show up automatically without any config changes.

`get_context` is meant to be called first in every conversation. It returns user profile, memory, behavioral patterns, vault statistics, available skills, and rules.

### Strict source isolation

Strict source isolation is **off by default** for all surfaces. External clients see the full memory and history layer through `get_context`, `recall_memory`, and `search_history`.

Turn it on under **Settings > Vault Operator > Customize > Connectors > Cross-Surface Sync** when you want to keep your personal memory inside Vault Operator and only share structural vault info with external clients. With strict mode on, those three tools only return items tagged `source_interface = obsilo`.

You can also enable per-surface sync to opt specific clients into shared memory after turning strict mode on.

### Setup for Claude Desktop

1. Open **Settings > Vault Operator > Customize > Connectors > Local connector**
2. Enable the local connector
3. Click **"Configure Claude Desktop"**. This writes the configuration into Claude Desktop's config file for you.
4. Restart Claude Desktop

Claude Desktop now sees the vault, memory, and history as available tool sources.

### Setup for ChatGPT (custom connector)

1. In Vault Operator, open **Settings > Vault Operator > Customize > Connectors > Remote access** and copy the relay URL (see Remote access below).
2. In ChatGPT, open **Settings > Connectors > Create custom connector**.
3. Use the relay URL as the MCP server endpoint.
4. Authorize. ChatGPT now has the same four tiers available, gated by your strict-source-isolation setting.

### Setup for Perplexity

1. Same relay URL as ChatGPT.
2. Add it as an MCP server in Perplexity's connector settings.
3. Authorize.

:::warning Write access
The write tier lets external clients modify your vault. Enable per-surface write access only for clients you trust with file-level access. The read and history tiers are safe for everyday use.
:::

## Remote access via Cloudflare relay

Remote access lets you talk to your vault from anywhere, as long as Obsidian is running on your machine.

### How it works

A Cloudflare Workers relay acts as a bridge between your local Vault Operator instance and remote clients. The RelayClient in Vault Operator holds a persistent connection to the deployed worker. The relay uses HTTP long-polling. The client polls for incoming requests, processes them locally, and sends responses back. Authentication uses a token embedded in the URL. No data is stored on the relay. It is a passthrough.

### Setup

1. Deploy the Cloudflare Worker (see the relay deployment guide)
2. In **Settings > Vault Operator > Customize > Connectors > Remote access**, enter your worker URL
3. Authenticate with the provided token
4. The relay connects automatically when Obsidian is running

:::info Always-on requirement
Remote access requires Obsidian to be running on your machine. The relay forwards requests to your local instance. It does not store your vault data in the cloud.
:::

## Living documents and source-interface tagging

When you use Vault Operator through Claude Desktop, ChatGPT, or Perplexity, every persisted message carries a `source_interface` tag. The history sidebar in Obsidian groups conversations by source so you can see what came in from which surface.

Multiple `save_conversation` calls within 30 minutes from the same source interface append to a single thread instead of creating new conversations. This is the living-document model. Memory extraction runs incrementally on the new turns rather than re-processing the whole thread.

`sync_session` is the legacy bulk path: an external client sends an entire transcript at the end of a conversation. It is kept for clients that do not yet support per-turn `save_conversation`.

## Provider setup lives elsewhere

Picking and authenticating AI providers (Anthropic, OpenAI, Gemini, OpenRouter, Azure, Ollama, LM Studio, custom, GitHub Copilot, Kilo Gateway, Bedrock, ChatGPT-OAuth) is covered in [Providers and models](/reference/providers). The Connectors tab is only about MCP and the relay.

## Next steps

- [Unified Chat Memory](/concepts/unified-chat-memory): How memory and history flow across surfaces.
- [MCP architecture](/concepts/mcp-architecture): The protocol details behind the connectors.
- [Skills, Rules and Workflows](/guides/skills-rules-workflows): Customize the agent's behavior.
- [Office documents](/guides/office-documents): Create presentations and documents.

---
title: Connectors
description: MCP client for external tools, MCP server for Claude Desktop, and remote access.
---

# Connectors

Obsilo can connect to external tools, expose your vault to other AI applications, and even provide remote access from anywhere. This is powered by the Model Context Protocol (MCP) and a Cloudflare relay.

## MCP Client -- Connect External Tools

The MCP client lets Obsilo use tools provided by external MCP servers. This means you can extend the agent's capabilities without writing plugins.

### What You Can Connect

Any MCP-compatible server works. Common examples:
- **Database tools** -- query SQLite, PostgreSQL, or other databases
- **Web services** -- interact with APIs, fetch data
- **Local tools** -- file system utilities, shell commands, custom scripts
- **Third-party integrations** -- GitHub, Slack, calendar services

### Setup

1. Open **Settings > Obsilo Agent > MCP**
2. Click **"+ Add Server"**
3. Choose the transport type:

| Transport | When to use |
|-----------|------------|
| **stdio** | Local servers running as command-line processes |
| **SSE** | Remote servers using Server-Sent Events (legacy) |
| **Streamable HTTP** | Modern remote servers (recommended for remote) |

4. Enter the server command or URL
5. Save -- the agent discovers available tools automatically

Once connected, the agent can call external tools using `use_mcp_tool` and manage servers with `manage_mcp_server`.

:::tip Discovery Is Automatic
You do not need to tell the agent which tools are available. It reads the tool list from each connected MCP server and uses them when relevant to your request.
:::

## MCP Server -- Expose Your Vault to Claude Desktop

This is one of Obsilo's most unique features. You can turn Obsilo into an MCP server, letting Claude Desktop (or any MCP client) read and write your Obsidian vault.

### Why This Matters

Without Obsilo, Claude Desktop has no way to access your Obsidian notes. With the MCP server enabled, Claude Desktop gains structured access to your vault -- searching, reading, and even writing notes through a controlled interface.

### Available Tools (3 Tiers)

| Tier | Tools | What they do |
|------|-------|-------------|
| **Read** | `read_notes`, `search_vault`, `get_context` | Search and read vault content |
| **Session** | `sync_session`, `update_memory` | Synchronize conversation context and memory |
| **Write** | `write_vault` | Create and modify notes in your vault |

### Setup

1. Open **Settings > Obsilo Agent > MCP > Server** tab
2. Enable the MCP server
3. Click **"Configure Claude Desktop"** -- this automatically adds the configuration to Claude Desktop's config file
4. Restart Claude Desktop

That is it. Claude Desktop now sees your vault as an available tool source.

:::warning Write Access
The write tier lets Claude Desktop modify your vault. Enable it only if you trust the prompts you send through Claude Desktop. The read and session tiers are safe for everyday use.
:::

## Remote Access -- Cloudflare Relay

Remote access lets you interact with your vault from anywhere -- even when you are away from your computer, as long as Obsidian is running.

### How It Works

A Cloudflare Workers relay acts as a bridge between your local Obsilo instance and remote clients. The RelayClient in Obsilo maintains a persistent connection to the deployed worker.

### Setup

1. Deploy the Cloudflare Worker (see the relay deployment guide)
2. In **Settings > Obsilo Agent > MCP > Remote**, enter your worker URL
3. Authenticate with the provided token
4. The relay connects automatically when Obsidian is running

:::info Always-On Requirement
Remote access requires Obsidian to be running on your machine. The relay forwards requests to your local instance -- it does not store your vault data in the cloud.
:::

## Provider Overview

Obsilo supports 10+ AI providers. Most use a simple API key, but two offer alternative authentication:

| Provider | Auth Method | Notes |
|----------|------------|-------|
| **GitHub Copilot** | OAuth device flow | Uses your existing GitHub Copilot subscription. No separate API key needed -- you sign in with your GitHub account. |
| **Kilo Gateway** | Device auth + manual token | Community gateway with shared rate limits. Device authentication or paste a token manually. |
| **Anthropic, OpenAI, Google, etc.** | API key | Paste your key in Settings > Models. Standard setup. |

### Setting Up GitHub Copilot

1. Open **Settings > Obsilo Agent > Models > + Add Model**
2. Select **GitHub Copilot** as the provider
3. Click **"Sign in with GitHub"** -- a device code appears
4. Open the GitHub URL, enter the code, and authorize
5. Select a model (Claude or GPT via Copilot)

### Setting Up Kilo Gateway

1. Select **Kilo Gateway** as the provider
2. Choose **Device Auth** (recommended) or **Manual Token**
3. For device auth: follow the on-screen flow to authenticate
4. For manual token: paste your token from the Kilo dashboard

:::tip Free Access
GitHub Copilot works if you already have a Copilot subscription. Kilo Gateway offers community access with shared limits. Both are good options if you want to try Obsilo without purchasing a separate API key.
:::

## Next Steps

- [Skills, Rules & Workflows](/guide/advanced/skills-rules-workflows) -- Customize the agent's behavior
- [Office Documents](/guide/advanced/office-documents) -- Create presentations and documents
- [Multi-Agent & Tasks](/guide/advanced/multi-agent) -- Delegate work to sub-agents

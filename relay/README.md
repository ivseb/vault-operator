# Obsilo Relay

A lightweight relay server that makes your Obsidian vault accessible from AI assistants like Claude, ChatGPT, Cursor, and any MCP-compatible tool.

## How it works

```
AI Assistant  -->  HTTPS  -->  This Relay (Cloudflare)  <--  WebSocket  <--  Obsilo Plugin
(claude.ai,                    (always reachable)                           (your computer)
 ChatGPT, etc.)
```

The relay is a thin proxy. It receives MCP requests from AI assistants and forwards them to your Obsilo plugin via WebSocket. No data is stored on the relay.

## Setup (5 minutes)

### 1. Create a Cloudflare account

Go to [dash.cloudflare.com](https://dash.cloudflare.com) and sign up (free).
Then enable the **Workers Paid plan** ($5/month) in your dashboard -- this is required for Durable Objects.

### 2. Install Wrangler (Cloudflare CLI)

```bash
npm install -g wrangler
wrangler login
```

### 3. Clone and deploy

```bash
git clone https://github.com/pssah4/obsilo
cd obsilo/relay
npm install
npx wrangler deploy
```

### 4. Set your relay token

Generate a token in Obsilo (Settings > Connections > Remote access > Generate token), then:

```bash
npx wrangler secret put RELAY_TOKEN
# Paste the token from Obsilo settings
```

### 5. Configure Obsilo

In Obsidian, go to Obsilo Settings > Connections > Remote access:
- Enable remote access
- Enter your relay URL: `https://obsilo-relay.<your-account>.workers.dev`
- Enter the same token you set in step 4

### 6. Add to your AI assistant

Copy the relay URL and add it as a connector:

- **claude.ai:** Settings > Connectors > Add custom connector > paste URL
- **ChatGPT:** Settings > Apps > Developer Mode > Add connector > paste URL
- **Cursor/Windsurf:** MCP server settings > add remote server > paste URL

## Cost

Cloudflare Workers Paid: $5/month flat. The relay uses Durable Objects with Hibernation -- no cost while idle. Typical usage (a few hundred requests/day) stays well within the included limits.

## Security

- All requests require a Bearer token (shared secret between Obsilo and the relay)
- TLS encryption enforced by Cloudflare
- No data stored on the relay (pure forwarding)
- You control the relay on your own Cloudflare account

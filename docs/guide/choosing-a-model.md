---
title: Choosing a Model
description: Compare providers and models to find the best fit for your workflow and budget.
---

# Choosing a Model

Obsilo works with any LLM provider. The right choice depends on your priorities: quality, speed, privacy, or cost.

## Quick Recommendation

| Priority | Provider | Model | Why |
|----------|----------|-------|-----|
| Best quality | Anthropic | Claude Sonnet 4.6 | Best tool use, follows instructions precisely |
| Best free | Google | Gemini 2.5 Flash | Free tier, fast, large context |
| Best local | Ollama | Qwen 2.5 7B | Runs on your machine, no data leaves |
| Most models | OpenRouter | Any | Access 100+ models with one key |
| Already have Copilot | GitHub Copilot | GPT-4o / Claude | Use your existing subscription |

## Supported Providers

### Cloud Providers (API Key Required)

| Provider | Setup | Models | Embedding | Notes |
|----------|-------|--------|-----------|-------|
| **Anthropic** | API key from [console.anthropic.com](https://console.anthropic.com) | Claude family | Via OpenAI key | Best overall quality |
| **OpenAI** | API key from [platform.openai.com](https://platform.openai.com) | GPT-4o, o1, o3 | Native | Fast, good structured output |
| **Google** | API key from [AI Studio](https://aistudio.google.com/app/apikey) | Gemini family | Via OpenAI key | Free tier available |
| **OpenRouter** | Key from [openrouter.ai](https://openrouter.ai) | 100+ models | No | Single key, many models |
| **Azure OpenAI** | Enterprise deployment | GPT-4o | Native | Enterprise compliance |

### Gateway Providers (Login-Based)

| Provider | Setup | Models | Notes |
|----------|-------|--------|-------|
| **GitHub Copilot** | Sign in with GitHub account | GPT-4o, Claude, Gemini | Uses your existing Copilot subscription |
| **Kilo Gateway** | Sign in with Kilo account | Multiple frontier models | Organization context, dynamic model listing |

### Local Providers (Free, Private)

| Provider | Setup | Models | Notes |
|----------|-------|--------|-------|
| **Ollama** | Install from [ollama.ai](https://ollama.ai) | Llama, Qwen, Mistral, ... | Best local experience |
| **LM Studio** | Install from [lmstudio.ai](https://lmstudio.ai) | Any GGUF model | Visual model browser |
| **Custom** | Any OpenAI-compatible endpoint | Depends on server | For self-hosted setups |

:::tip Embedding Models
For semantic search, you need an **embedding model** in addition to a chat model. The cheapest option is OpenAI's `text-embedding-3-small` (~$0.02 per 1M tokens). Configure it in Settings > Embeddings.
:::

## Model for Each Task

You can configure **different models per mode**. A common setup:

| Mode | Model | Reasoning |
|------|-------|-----------|
| Ask | Fast/cheap model (Gemini Flash, GPT-4o-mini) | Quick answers, read-only |
| Agent | Powerful model (Claude Sonnet, GPT-4o) | Complex tasks, tool use |
| Memory extraction | Small model (Haiku, GPT-4o-mini) | Background task, cost-efficient |

Configure per-mode models in **Settings > Modes > [Mode Name] > Model**.

## Cost Considerations

| Usage Level | Monthly Cost | Recommendation |
|-------------|-------------|----------------|
| Light (few chats/day) | $0-5 | Google Gemini (free) or GPT-4o-mini |
| Moderate (daily use) | $5-20 | Claude Sonnet or GPT-4o |
| Heavy (power user) | $20-50+ | Claude Sonnet + local fallback |
| Zero cost | $0 | Ollama or LM Studio (local) |

:::info GitHub Copilot
If you already pay for GitHub Copilot, you can use those credits in Obsilo -- no additional API key needed. Sign in via Settings > Models > Add Model > GitHub Copilot.
:::

## Next Steps

- [Chat Interface](/guide/working-with-obsilo/chat-interface) -- Deep dive into the chat experience
- [Knowledge Discovery](/guide/working-with-obsilo/knowledge-discovery) -- Set up semantic search (needs an embedding model)
- [Providers Reference](/guide/reference/providers) -- Detailed setup guides for each provider

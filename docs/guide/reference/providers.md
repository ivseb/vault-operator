---
title: Providers & Models
description: Setup guides for all supported AI providers -- Anthropic, OpenAI, Copilot, Kilo, Ollama, and more.
---

# Providers & Models

Obsilo supports 10 AI providers. This page walks you through setting up each one.

For all providers: open **Settings > Obsilo Agent > Models**, click **"+ add model"**, and select your provider.

## Cloud Providers

### Anthropic

| | |
|---|---|
| **What you need** | API key from [console.anthropic.com](https://console.anthropic.com) |
| **Recommended models** | Claude Sonnet 4.6 (best overall), Claude Haiku (fast and cheap) |
| **Embedding** | Not available natively -- use OpenAI for embeddings |

**Setup:**
1. Create an account at [console.anthropic.com](https://console.anthropic.com)
2. Go to **API Keys** and create a new key
3. In Obsilo, select **Anthropic** as provider, paste the key, and pick a model

:::tip Best Tool Use
Anthropic models are consistently the best at using Obsilo's tools correctly. If quality is your priority, start here.
:::

### OpenAI

| | |
|---|---|
| **What you need** | API key from [platform.openai.com](https://platform.openai.com) |
| **Recommended models** | GPT-4o (balanced), o3 (reasoning), GPT-4o-mini (budget) |
| **Embedding** | Native support -- `text-embedding-3-small` recommended |

**Setup:**
1. Create an account at [platform.openai.com](https://platform.openai.com)
2. Go to **API Keys** and generate a new key
3. In Obsilo, select **OpenAI** as provider, paste the key, and pick a model

:::info Embedding Models
An OpenAI key also gives you access to embedding models for semantic search. Configure in **Settings > Embeddings**.
:::

### OpenRouter

| | |
|---|---|
| **What you need** | API key from [openrouter.ai](https://openrouter.ai) |
| **Recommended models** | Any -- OpenRouter gives access to 100+ models from multiple providers |
| **Embedding** | Not available |

**Setup:**
1. Create an account at [openrouter.ai](https://openrouter.ai)
2. Go to **Keys** and create a new API key
3. In Obsilo, select **OpenRouter** as provider, paste the key
4. Browse or type any model ID (e.g., `anthropic/claude-sonnet-4.6`, `google/gemini-2.5-pro`)

### Azure OpenAI

| | |
|---|---|
| **What you need** | Azure subscription, a deployed model, API key, and endpoint URL |
| **Recommended models** | GPT-4o (deployed in your Azure region) |
| **Embedding** | Native support via deployed embedding model |

**Setup:**
1. Deploy a model in your Azure OpenAI resource
2. Copy the **endpoint URL**, **API key**, and **deployment name**
3. In Obsilo, select **Azure OpenAI** as provider and fill in all three fields

:::info Enterprise Use
Azure OpenAI is ideal for organizations with compliance requirements. Data stays within your Azure tenant.
:::

## Gateway Providers

### GitHub Copilot

| | |
|---|---|
| **What you need** | An active GitHub Copilot subscription (Individual, Business, or Enterprise) |
| **Recommended models** | GPT-4o, Claude Sonnet (available through Copilot) |
| **Embedding** | Not available |

**Setup (OAuth Device Flow):**
1. In Obsilo, select **GitHub Copilot** as provider
2. Click **"Sign in with GitHub"** -- a device code appears
3. Open [github.com/login/device](https://github.com/login/device) in your browser
4. Enter the code and authorize the app
5. Obsilo automatically detects your available models

:::tip No Extra Cost
If you already pay for GitHub Copilot, this costs nothing extra. The models are included in your subscription.
:::

### Kilo Gateway

| | |
|---|---|
| **What you need** | A Kilo Code account with gateway access |
| **Recommended models** | Depends on your organization's available models |
| **Embedding** | Not available |

**Setup (Device Auth -- recommended):**
1. In Obsilo, select **Kilo Gateway** as provider
2. Click **"Sign in"** -- a device code and URL appear
3. Open the URL in your browser, enter the code, and authorize
4. Models are loaded dynamically from your organization

**Setup (Manual Token):**
1. Obtain a gateway token from your Kilo Code admin
2. In Obsilo, select **Kilo Gateway** and choose **"Manual Token"**
3. Paste the token -- models load automatically

## Local Providers

### Ollama

| | |
|---|---|
| **What you need** | Ollama installed on your machine |
| **Recommended models** | Qwen 2.5 7B (balanced), Llama 3.2 (general), Codestral (code) |
| **Embedding** | Supported via `nomic-embed-text` or similar |

**Setup:**
1. Install Ollama from [ollama.ai](https://ollama.ai)
2. Pull a model: `ollama pull qwen2.5:7b`
3. In Obsilo, select **Ollama** as provider -- no API key needed
4. The model list auto-detects running models

:::tip Privacy
With Ollama, no data ever leaves your machine. Perfect for sensitive vaults.
:::

### LM Studio

| | |
|---|---|
| **What you need** | LM Studio installed with a model loaded |
| **Recommended models** | Any GGUF model -- browse the built-in catalog |
| **Embedding** | Supported for compatible models |

**Setup:**
1. Install LM Studio from [lmstudio.ai](https://lmstudio.ai)
2. Download a model from the catalog and load it
3. Start the **local server** (LM Studio > Developer tab)
4. In Obsilo, select **LM Studio** as provider -- no API key needed

### Custom Endpoint

| | |
|---|---|
| **What you need** | Any OpenAI-compatible API endpoint |
| **Recommended models** | Depends on the server |
| **Embedding** | Depends on the server |

**Setup:**
1. In Obsilo, select **Custom** as provider
2. Enter the **base URL** (e.g., `http://localhost:8080/v1`)
3. Enter an **API key** if your server requires one
4. Type the **model name** exactly as the server expects

This works with any server that implements the OpenAI chat completions API, including vLLM, text-generation-inference, LocalAI, and self-hosted endpoints.

## Provider Comparison

| Provider | Auth | Cost | Privacy | Embedding | Best for |
|----------|------|------|---------|-----------|----------|
| Anthropic | API key | Pay-per-use | Cloud | No | Best quality |
| OpenAI | API key | Pay-per-use | Cloud | Yes | Structured output, embeddings |
| OpenRouter | API key | Pay-per-use | Cloud | No | Model variety |
| Azure OpenAI | API key + endpoint | Enterprise | Enterprise tenant | Yes | Compliance |
| GitHub Copilot | OAuth | Subscription | Cloud | No | Existing subscribers |
| Kilo Gateway | Device auth / token | Organization | Cloud | No | Team deployments |
| Ollama | None | Free | Fully local | Yes | Privacy, offline |
| LM Studio | None | Free | Fully local | Yes | Visual model browser |
| Custom | Varies | Varies | Varies | Varies | Self-hosted setups |

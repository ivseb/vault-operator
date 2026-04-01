---
title: Knowledge Discovery
description: Semantic search, knowledge graph, implicit connections, and local reranking.
---

# Knowledge Discovery

Most search tools match exact words. Obsilo goes further: it understands **meaning**. A search for "improving focus" can find a note titled "Deep Work Techniques" even though the words do not overlap. This page explains how to set it up and get the most from it.

## What Is Semantic Search?

Traditional keyword search looks for exact text matches. Semantic search converts your notes into mathematical representations (called **embeddings**) that capture their meaning. When you search, your query is also converted, and the system finds notes whose meaning is closest to your question.

This means:
- *"recipes for pasta"* finds notes about Italian cooking, even if they never say "pasta"
- *"how to sleep better"* finds your note titled "Evening Wind-Down Routine"
- *"budget planning"* finds notes about financial forecasting and expense tracking

## Setup

Semantic search requires an **embedding model** to convert text into embeddings. You set this up once, and Obsilo handles the rest.

1. Open **Settings > Obsilo Agent > Embeddings**
2. Choose an embedding model from the dropdown
3. Click **Build Index** to process your vault

:::tip Which Embedding Model?
Any configured provider that supports embeddings will work. If you are using OpenAI or a compatible API, the default embedding model is a good starting point. Local models via Ollama also work well for privacy.
:::

### Building the Index

The first build processes every note in your vault. This can take a few minutes for large vaults (1000+ notes). After the initial build, the index updates automatically:

- **On startup** -- new or changed files are re-indexed
- **On file changes** -- edits trigger re-indexing after a short delay
- **Manually** -- use the **Rebuild Index** button in settings at any time

:::info Your Notes Stay Local
Embeddings are stored in a local database inside your vault. If you use a cloud embedding model, note content is sent to the provider for processing, but the resulting embeddings are stored only on your machine. With a local model, nothing leaves your device.
:::

## How Search Works Under the Hood

When you or the agent run a semantic search, Obsilo uses a **hybrid approach** that combines multiple strategies for the best results:

### 1. BM25 (Keyword Matching)

A fast, traditional ranking algorithm. It finds notes that contain your search terms and ranks them by relevance. Good for specific terms like names, dates, or technical jargon.

### 2. Semantic Similarity (Embedding Matching)

Compares the meaning of your query against the embeddings of every chunk in your vault. Finds conceptually related notes even without keyword overlap.

### 3. Reciprocal Rank Fusion (RRF)

Combines the results from BM25 and semantic search into a single ranked list. Notes that score well on both methods rise to the top. This hybrid approach consistently outperforms either method alone.

## The Knowledge Graph

Beyond search, Obsilo builds a **knowledge graph** from the structure already in your vault:

- **Wikilinks** -- `[[note]]` connections between your notes
- **Tags** -- shared tags create implicit groupings
- **MOC properties** -- Maps of Content link related topics

When the agent searches, it can **expand results through the graph**. If a search finds Note A, and Note A links to Note B, the agent can follow that link to discover additional relevant content. You can configure how many "hops" the graph expansion follows in settings.

**Example:** Searching for "machine learning" finds your note on Neural Networks. Graph expansion then follows its wikilinks to find your notes on Training Data and Model Evaluation -- related topics you might not have found with search alone.

## Implicit Connections

This is one of Obsilo's most powerful features. It automatically finds notes that are **semantically similar but not linked to each other**.

Think of it as the agent saying: *"These two notes are about very similar topics, but you never connected them. You might want to."*

When implicit connections are found, a **suggestion banner** appears in the sidebar offering to show you the discovered relationships. This can surface surprising connections across different areas of your vault.

:::tip Great for Large Vaults
The larger your vault, the more valuable implicit connections become. Notes written months apart about related topics are easy to miss manually.
:::

## Local Reranking

After the initial search returns candidates, Obsilo can run a second pass using a **cross-encoder model** to improve result quality. This model runs entirely on your device using WebAssembly -- no data is sent anywhere.

The reranker (based on ms-marco-MiniLM) reads each candidate alongside your query and produces a more accurate relevance score. Results that looked promising but are not actually relevant get pushed down; truly relevant results rise up.

This happens automatically when enabled. You can toggle it in **Settings > Obsilo Agent > Embeddings > Local Reranking**.

## Contextual Retrieval

When enabled, Obsilo enriches each chunk with additional context before creating its embedding. The agent uses the surrounding content of the note to add a brief description of what each chunk is about. This improves search accuracy, especially for short or ambiguous passages.

For example, a chunk containing just a table of numbers becomes much more findable when the system adds context like "quarterly revenue figures from the 2025 financial review."

## Configuration Tips

| Setting | Where | Recommendation |
|---------|-------|----------------|
| **Embedding model** | Settings > Embeddings | Choose based on your privacy needs and provider |
| **Chunk size** | Settings > Embeddings > Advanced | Default works well for most vaults. Smaller chunks (256 tokens) for short notes, larger (1024) for long-form writing |
| **Excluded folders** | Settings > Embeddings > Excluded | Exclude templates, archive, or attachment folders to keep the index focused |
| **Auto-index** | Settings > Embeddings | Keep enabled for automatic updates on file changes |
| **Graph hops** | Settings > Embeddings > Graph | 1-2 hops is usually enough. More hops find broader connections but may include noise |
| **Local reranking** | Settings > Embeddings | Enable for better result quality at minimal performance cost |

:::warning Large Vaults and Performance
For vaults with 5000+ notes, the initial index build may take 10-20 minutes depending on your embedding model. After that, incremental updates are fast. Consider excluding large attachment folders or archives that you rarely search.
:::

## Practical Examples

- *"Find notes related to my goals for this year"* -- semantic search finds notes about resolutions, plans, and objectives
- *"What do I know about distributed systems?"* -- searches by meaning across your entire vault
- *"Show me notes similar to @architecture-decisions"* -- finds thematically related notes
- *"Are there any notes I should link together?"* -- triggers implicit connection discovery

## Next Steps

- [Vault Operations](/guide/working-with-obsilo/vault-operations) -- Reading, writing, and organizing your files
- [Memory & Personalization](/guide/working-with-obsilo/memory-personalization) -- How Obsilo remembers your preferences
- [Settings Reference](/guide/reference/settings) -- All embedding and search settings explained

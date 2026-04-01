<template>
  <div class="roadmap">
    <div class="roadmap-section" v-for="section in sections" :key="section.title">
      <div class="roadmap-header">
        <span :class="['roadmap-badge', section.status]">{{ section.badge }}</span>
        <h3 class="roadmap-title">{{ section.title }}</h3>
      </div>
      <p class="roadmap-desc">{{ section.description }}</p>
    </div>

    <div class="versions">
      <h3>Version History</h3>
      <div class="version-item" v-for="v in versions" :key="v.version">
        <span class="version-tag">{{ v.version }}</span>
        <span class="version-date">{{ v.date }}</span>
        <span class="version-desc">{{ v.description }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
const sections = [
  {
    title: 'Core Agent & Chat',
    badge: 'Shipped',
    status: 'done',
    description: '49+ tools, multi-agent orchestration, context condensing, power steering, parallel tool execution.',
  },
  {
    title: 'Knowledge Layer',
    badge: 'Shipped',
    status: 'done',
    description: 'SQLite-backed semantic search, knowledge graph with link expansion, implicit connection discovery, local cross-encoder reranking.',
  },
  {
    title: 'Office Pipeline',
    badge: 'Shipped',
    status: 'done',
    description: 'Create PPTX, DOCX, XLSX from chat. Template-aware presentations with plan_presentation. Parse office files as context.',
  },
  {
    title: 'Multi-Provider',
    badge: 'Shipped',
    status: 'done',
    description: 'Anthropic, OpenAI, GitHub Copilot, Kilo Gateway, Ollama, LM Studio, Azure, OpenRouter, and custom endpoints.',
  },
  {
    title: 'MCP Connector',
    badge: 'Shipped',
    status: 'done',
    description: 'Obsilo as MCP server for Claude Desktop. 3-tier tool exposure (read/search/write). MCP client for external tools.',
  },
  {
    title: 'Memory & Personalization',
    badge: 'Shipped',
    status: 'done',
    description: '3-tier memory (session, long-term, soul). Onboarding wizard. Chat-linking with frontmatter and protocol handler.',
  },
  {
    title: 'Safety & Governance',
    badge: 'Shipped',
    status: 'done',
    description: 'Fail-closed approvals, local checkpoints with undo, operation audit log, per-category permissions, .obsidian-agentignore.',
  },
  {
    title: 'Self-Development',
    badge: 'Shipped',
    status: 'done',
    description: '5-tier framework: markdown skills, dynamic sandbox tools, core self-modification, plugin API bridge, proactive learning.',
  },
  {
    title: 'Remote Access',
    badge: 'In Progress',
    status: 'wip',
    description: 'Cloudflare Workers relay for accessing your vault from anywhere via MCP. Secure authentication layer.',
  },
  {
    title: 'Deferred Tool Loading',
    badge: 'Planned',
    status: 'planned',
    description: 'Load tool schemas on demand instead of upfront. Reduces system prompt size by 30-40%.',
  },
  {
    title: 'Memory Side-Query',
    badge: 'Planned',
    status: 'planned',
    description: 'Selective memory loading via frontmatter-based relevance matching. Only inject memories that matter.',
  },
  {
    title: 'Parallel Sub-Tasks',
    badge: 'Planned',
    status: 'planned',
    description: 'Fan-out research across multiple sub-agents running in parallel. Faster answers for broad questions.',
  },
]

const versions = [
  { version: 'v2.2', date: 'Mar 2026', description: 'MCP Connector, Knowledge Layer, Copilot & Kilo providers' },
  { version: 'v2.1', date: 'Mar 2026', description: 'Office pipeline, chat-linking, task extraction, sidebar refactoring' },
  { version: 'v2.0', date: 'Feb 2026', description: 'Self-development framework, sandbox isolation, agent skill mastery' },
  { version: 'v1.0', date: 'Jan 2026', description: 'Core agent, semantic search, memory, multi-agent, i18n, web tools' },
]
</script>

<style scoped>
.roadmap {
  margin: 2rem 0;
}

.roadmap-section {
  padding: 1rem 0;
  border-bottom: 1px solid var(--vp-c-divider);
}

.roadmap-section:last-of-type {
  border-bottom: none;
}

.roadmap-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.roadmap-title {
  margin: 0;
  font-size: 1.05rem;
}

.roadmap-badge {
  display: inline-block;
  padding: 0.15rem 0.6rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
}

.roadmap-badge.done {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
}

.roadmap-badge.wip {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}

.roadmap-badge.planned {
  background: rgba(124, 58, 237, 0.15);
  color: var(--vp-c-brand-1);
}

.roadmap-desc {
  margin: 0.35rem 0 0;
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
  line-height: 1.5;
}

.versions {
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--vp-c-divider);
}

.versions h3 {
  margin: 0 0 1rem;
}

.version-item {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  padding: 0.4rem 0;
}

.version-tag {
  font-weight: 700;
  font-family: var(--vp-font-family-mono);
  font-size: 0.85rem;
  color: var(--vp-c-brand-1);
  min-width: 3rem;
}

.version-date {
  color: var(--vp-c-text-3);
  font-size: 0.8rem;
  min-width: 5.5rem;
}

.version-desc {
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
}
</style>

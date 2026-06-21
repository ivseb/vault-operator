<script setup lang="ts">
import { withBase } from 'vitepress'

/* Plugin version. Keep in sync with manifest.json on every release.
   Single source of truth is manifest.json; this is a manual mirror because
   VitePress build does not inline the manifest at runtime. */
const PLUGIN_VERSION = '2.14.15'

interface AudienceLink {
  label: string
  href: string
}

const knowledgeWorkerLinks: AudienceLink[] = [
  { label: 'Have your first conversation in 10 minutes', href: '/tutorials/getting-started' },
  { label: 'Drop a PDF and get a sense-making note', href: '/tutorials/quick-ingest' },
  { label: 'Search your vault by meaning, not keywords', href: '/tutorials/search-by-meaning' },
]

const developerLinks: AudienceLink[] = [
  { label: 'Tour the codebase', href: '/concepts/codebase-tour' },
  { label: 'Understand the tool system', href: '/concepts/tool-system' },
  { label: 'Read the MCP architecture', href: '/concepts/mcp-architecture' },
]
</script>

<template>
  <section class="lp-hero">
    <h1 class="lp-title">Vault Operator</h1>
    <p class="lp-tagline">Agentic AI operating layer for your vault</p>
    <p class="lp-sub">
      Drop a PDF, ask a question, build a draft. The agent acts on your vault and every action is reversible.
    </p>

    <div class="lp-cta">
      <a :href="withBase('/tutorials/getting-started')" class="lp-btn lp-btn-primary">
        Try it in 3 minutes
      </a>
      <a :href="withBase('/concepts/')" class="lp-btn lp-btn-secondary">
        Read how it works
      </a>
    </div>

    <ul class="lp-trust" aria-label="Trust badges">
      <li class="lp-trust-item">Free, open source</li>
      <li class="lp-trust-item">Local-first</li>
      <li class="lp-trust-item">Apache 2.0 license</li>
      <li class="lp-trust-item lp-trust-version">v{{ PLUGIN_VERSION }}</li>
    </ul>
  </section>

  <section class="lp-fork" aria-label="Pick your starting point">
    <article class="lp-fork-card">
      <h2 class="lp-fork-head">Use it</h2>
      <p class="lp-fork-sub">For knowledge workers</p>
      <ul class="lp-fork-list">
        <li v-for="link in knowledgeWorkerLinks" :key="link.href">
          <a :href="withBase(link.href)">{{ link.label }}</a>
        </li>
      </ul>
    </article>

    <article class="lp-fork-card">
      <h2 class="lp-fork-head">Understand it</h2>
      <p class="lp-fork-sub">For developers</p>
      <ul class="lp-fork-list">
        <li v-for="link in developerLinks" :key="link.href">
          <a :href="withBase(link.href)">{{ link.label }}</a>
        </li>
      </ul>
    </article>
  </section>

  <section class="lp-footer-cta" aria-label="Get started">
    <a
      href="obsidian://show-plugin?id=vault-operator"
      class="lp-btn lp-btn-primary"
    >
      Install from Obsidian
    </a>
    <a
      href="https://github.com/pssah4/vault-operator"
      class="lp-btn lp-btn-secondary"
      target="_blank"
      rel="noopener"
    >
      GitHub
    </a>
    <a :href="withBase('/')" class="lp-btn lp-btn-secondary">
      Documentation
    </a>
  </section>
</template>

<style scoped>
/* Entrance fade for the hero only. Subtle, no parallax, no motion on scroll. */
@keyframes lp-fade-up {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .lp-hero { animation: none; }
}

/* ==Hero == */
.lp-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 4.5rem 1.5rem 0;
  background: radial-gradient(ellipse 80% 50% at 50% -10%, rgba(124, 58, 237, 0.25), transparent);
  animation: lp-fade-up 0.4s ease-out both;
}

.lp-title {
  font-size: clamp(2.4rem, 5.2vw, 3.6rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.1;
  margin: 0 0 0.5rem;
  background: linear-gradient(135deg, var(--vp-c-text-1) 30%, var(--vp-c-brand-1));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.lp-tagline {
  font-size: clamp(1.1rem, 2.4vw, 1.35rem);
  font-weight: 600;
  color: var(--vp-c-text-1);
  margin: 0 0 0.6rem;
  max-width: 720px;
}

.lp-sub {
  font-size: clamp(0.95rem, 2vw, 1.1rem);
  color: var(--vp-c-text-2);
  max-width: 640px;
  line-height: 1.6;
  margin: 0 0 1.5rem;
  text-wrap: pretty;
}

/* ==Buttons (shared) == */
.lp-cta {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  justify-content: center;
  margin-bottom: 1.75rem;
}

.lp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.65rem 1.5rem;
  border-radius: 8px;
  font-size: 0.92rem;
  font-weight: 600;
  text-decoration: none;
  transition: background 0.15s, border-color 0.15s, transform 0.1s, color 0.15s;
  border: 1px solid transparent;
}
.lp-btn:hover { transform: translateY(-1px); text-decoration: none; }

.lp-btn-primary {
  background: #7c3aed;
  color: #fff;
  border-color: #7c3aed;
}
.lp-btn-primary:hover {
  background: #6d28d9;
  border-color: #6d28d9;
  color: #fff;
}

.lp-btn-secondary {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-divider);
  background: transparent;
}
.lp-btn-secondary:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-text-1);
}

/* ==Trust strip == */
.lp-trust {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  justify-content: center;
  list-style: none;
  padding: 0;
  margin: 0 0 2rem;
}
.lp-trust-item {
  font-size: 0.75rem;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  padding: 0.3rem 0.8rem;
  line-height: 1;
}
.lp-trust-version {
  color: var(--vp-c-brand-1);
  font-weight: 600;
}

/* ==Audience fork == */
.lp-fork {
  max-width: 960px;
  margin: 1.5rem auto 0;
  padding: 0 1.5rem;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}
.lp-fork-card {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 1.5rem 1.4rem;
  transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
}
.lp-fork-card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(124, 58, 237, 0.08);
}
.lp-fork-head {
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin: 0 0 0.2rem;
  color: var(--vp-c-text-1);
  border: none;
  padding: 0;
}
.lp-fork-sub {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vp-c-text-3);
  margin: 0 0 0.9rem;
}
.lp-fork-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.lp-fork-list a {
  color: var(--vp-c-text-1);
  font-size: 0.92rem;
  line-height: 1.4;
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: color 0.15s, border-color 0.15s;
}
.lp-fork-list a:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

/* ==Footer CTA == */
.lp-footer-cta {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin: 3rem auto 1rem;
  padding: 0 1.5rem;
}

/* ==Responsive == */
@media (max-width: 600px) {
  .lp-hero { padding: 3rem 1rem 0; }
  .lp-fork { grid-template-columns: 1fr; }
  .lp-footer-cta { flex-direction: column; align-items: stretch; }
  .lp-footer-cta .lp-btn { width: 100%; }
}
</style>

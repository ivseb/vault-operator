import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

const guideSidebarEN = [
  {
    text: 'Getting Started',
    items: [
      { text: 'Installation & Quick Start', link: '/guide/getting-started' },
      { text: 'Your First Conversation', link: '/guide/first-conversation' },
      { text: 'Choosing a Model', link: '/guide/choosing-a-model' },
    ],
  },
  {
    text: 'Working with Obsilo',
    items: [
      { text: 'Chat Interface', link: '/guide/working-with-obsilo/chat-interface' },
      { text: 'Vault Operations', link: '/guide/working-with-obsilo/vault-operations' },
      { text: 'Knowledge Discovery', link: '/guide/working-with-obsilo/knowledge-discovery' },
      { text: 'Memory & Personalization', link: '/guide/working-with-obsilo/memory-personalization' },
      { text: 'Safety & Control', link: '/guide/working-with-obsilo/safety-control' },
    ],
  },
  {
    text: 'Advanced',
    items: [
      { text: 'Skills, Rules & Workflows', link: '/guide/advanced/skills-rules-workflows' },
      { text: 'Office Documents', link: '/guide/advanced/office-documents' },
      { text: 'Connectors', link: '/guide/advanced/connectors' },
      { text: 'Multi-Agent & Tasks', link: '/guide/advanced/multi-agent' },
    ],
  },
  {
    text: 'Reference',
    items: [
      { text: 'Tools', link: '/guide/reference/tools' },
      { text: 'Providers & Models', link: '/guide/reference/providers' },
      { text: 'Settings', link: '/guide/reference/settings' },
      { text: 'Troubleshooting', link: '/guide/reference/troubleshooting' },
    ],
  },
]

const guideSidebarDE = [
  {
    text: 'Erste Schritte',
    items: [
      { text: 'Installation & Schnellstart', link: '/de/guide/getting-started' },
      { text: 'Dein erstes Gespräch', link: '/de/guide/first-conversation' },
      { text: 'Modell wählen', link: '/de/guide/choosing-a-model' },
    ],
  },
  {
    text: 'Arbeiten mit Obsilo',
    items: [
      { text: 'Chat-Oberfläche', link: '/de/guide/working-with-obsilo/chat-interface' },
      { text: 'Vault-Operationen', link: '/de/guide/working-with-obsilo/vault-operations' },
      { text: 'Wissen entdecken', link: '/de/guide/working-with-obsilo/knowledge-discovery' },
      { text: 'Gedächtnis & Personalisierung', link: '/de/guide/working-with-obsilo/memory-personalization' },
      { text: 'Sicherheit & Kontrolle', link: '/de/guide/working-with-obsilo/safety-control' },
    ],
  },
  {
    text: 'Fortgeschritten',
    items: [
      { text: 'Skills, Rules & Workflows', link: '/de/guide/advanced/skills-rules-workflows' },
      { text: 'Office-Dokumente', link: '/de/guide/advanced/office-documents' },
      { text: 'Konnektoren', link: '/de/guide/advanced/connectors' },
      { text: 'Multi-Agent & Aufgaben', link: '/de/guide/advanced/multi-agent' },
    ],
  },
  {
    text: 'Referenz',
    items: [
      { text: 'Tools', link: '/de/guide/reference/tools' },
      { text: 'Provider & Modelle', link: '/de/guide/reference/providers' },
      { text: 'Einstellungen', link: '/de/guide/reference/settings' },
      { text: 'Problembehandlung', link: '/de/guide/reference/troubleshooting' },
    ],
  },
]

const devSidebar = [
  {
    text: 'Fundamentals',
    items: [
      { text: 'How Obsilo works', link: '/dev/' },
      { text: 'The agent loop', link: '/dev/agent-loop' },
    ],
  },
  {
    text: 'Tools and decisions',
    items: [
      { text: 'Tool system', link: '/dev/tool-system' },
      { text: 'System prompt', link: '/dev/system-prompt' },
      { text: 'Modes', link: '/dev/mode-system' },
    ],
  },
  {
    text: 'Safety',
    items: [
      { text: 'Governance', link: '/dev/governance' },
    ],
  },
  {
    text: 'Intelligence',
    items: [
      { text: 'Knowledge layer', link: '/dev/knowledge-layer' },
      { text: 'Memory', link: '/dev/memory-system' },
    ],
  },
  {
    text: 'Extensibility',
    items: [
      { text: 'Plugin discovery', link: '/dev/vault-dna' },
      { text: 'Self-development', link: '/dev/self-development' },
      { text: 'MCP', link: '/dev/mcp-architecture' },
    ],
  },
  {
    text: 'Specialized systems',
    items: [
      { text: 'Office pipeline', link: '/dev/office-pipeline' },
      { text: 'Provider auth', link: '/dev/provider-auth' },
      { text: 'UI architecture', link: '/dev/ui-architecture' },
    ],
  },
]

export default withMermaid(
  defineConfig({
    title: 'Obsilo',
    description: 'Agentic AI for Obsidian',
    head: [
      ['meta', { property: 'og:title', content: 'Obsilo -- Agentic AI for Obsidian' }],
      ['meta', { property: 'og:description', content: 'An autonomous AI operating layer for Obsidian with 55+ tools, semantic search, multi-agent workflows, and full safety controls.' }],
    ],

    appearance: 'dark',
    lastUpdated: true,
    cleanUrls: true,

    locales: {
      root: {
        label: 'English',
        lang: 'en',
        themeConfig: {
          nav: [
            { text: 'Guide', link: '/guide/getting-started', activeMatch: '/guide/' },
            { text: 'How It Works', link: '/dev/', activeMatch: '/dev/' },
            { text: 'About', link: '/about' },
          ],
          sidebar: {
            '/guide/': guideSidebarEN,
            '/dev/': devSidebar,
          },
          editLink: {
            pattern: 'https://github.com/pssah4/obsilo/edit/main/docs/:path',
            text: 'Edit this page on GitHub',
          },
          footer: {
            message: '<a href="https://github.com/pssah4/obsilo/blob/main/LICENSE">Apache 2.0</a> | <a href="/imprint">Imprint</a>',
            copyright: 'Provided as-is, without any warranty or liability.',
          },
        },
      },
      de: {
        label: 'Deutsch',
        lang: 'de',
        link: '/de/',
        themeConfig: {
          nav: [
            { text: 'Anleitung', link: '/de/guide/getting-started', activeMatch: '/de/guide/' },
            { text: 'Architektur', link: '/dev/', activeMatch: '/dev/' },
            { text: 'Über uns', link: '/de/about' },
          ],
          sidebar: {
            '/de/guide/': guideSidebarDE,
            '/dev/': devSidebar,
          },
          editLink: {
            pattern: 'https://github.com/pssah4/obsilo/edit/main/docs/:path',
            text: 'Diese Seite auf GitHub bearbeiten',
          },
          footer: {
            message: '<a href="https://github.com/pssah4/obsilo/blob/main/LICENSE">Apache 2.0</a> | <a href="/imprint">Impressum</a>',
            copyright: 'Bereitgestellt ohne Gewährleistung oder Haftung.',
          },
          docFooter: {
            prev: 'Vorherige Seite',
            next: 'Nächste Seite',
          },
          outline: { label: 'Auf dieser Seite' },
          lastUpdated: { text: 'Zuletzt aktualisiert' },
          returnToTopLabel: 'Zurück nach oben',
          sidebarMenuLabel: 'Menü',
          darkModeSwitchLabel: 'Design',
        },
      },
    },

    themeConfig: {
      siteTitle: 'Obsilo',
      search: {
        provider: 'local',
      },
    },

    mermaid: {},
  }),
)

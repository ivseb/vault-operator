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
      { text: 'Dein erstes Gespraech', link: '/de/guide/first-conversation' },
      { text: 'Modell waehlen', link: '/de/guide/choosing-a-model' },
    ],
  },
  {
    text: 'Arbeiten mit Obsilo',
    items: [
      { text: 'Chat-Oberflaeche', link: '/de/guide/working-with-obsilo/chat-interface' },
      { text: 'Vault-Operationen', link: '/de/guide/working-with-obsilo/vault-operations' },
      { text: 'Wissen entdecken', link: '/de/guide/working-with-obsilo/knowledge-discovery' },
      { text: 'Gedaechtnis & Personalisierung', link: '/de/guide/working-with-obsilo/memory-personalization' },
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
    text: 'Architecture',
    items: [
      { text: 'Overview', link: '/dev/' },
      { text: 'Agent Loop', link: '/dev/agent-loop' },
      { text: 'Tool System', link: '/dev/tool-system' },
      { text: 'System Prompt', link: '/dev/system-prompt' },
    ],
  },
  {
    text: 'Subsystems',
    items: [
      { text: 'Knowledge Layer', link: '/dev/knowledge-layer' },
      { text: 'Memory System', link: '/dev/memory-system' },
      { text: 'Office Pipeline', link: '/dev/office-pipeline' },
      { text: 'Provider Auth', link: '/dev/provider-auth' },
      { text: 'MCP Architecture', link: '/dev/mcp-architecture' },
      { text: 'Self-Development', link: '/dev/self-development' },
    ],
  },
  {
    text: 'Infrastructure',
    items: [
      { text: 'Governance & Safety', link: '/dev/governance' },
      { text: 'Mode System', link: '/dev/mode-system' },
      { text: 'UI Architecture', link: '/dev/ui-architecture' },
      { text: 'VaultDNA', link: '/dev/vault-dna' },
    ],
  },
]

export default withMermaid(
  defineConfig({
    title: 'Obsilo',
    description: 'Agentic AI for Obsidian',
    head: [
      ['link', { rel: 'icon', href: '/assets/OBSILO_ICON50x50_lila.png' }],
      ['meta', { property: 'og:title', content: 'Obsilo -- Agentic AI for Obsidian' }],
      ['meta', { property: 'og:description', content: 'An autonomous AI operating layer for Obsidian with 49+ tools, semantic search, multi-agent workflows, and full safety controls.' }],
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
            { text: 'Architecture', link: '/dev/', activeMatch: '/dev/' },
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
            { text: 'Ueber', link: '/about' },
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
            copyright: 'Bereitgestellt ohne Gewaehrleistung oder Haftung.',
          },
          docFooter: {
            prev: 'Vorherige Seite',
            next: 'Naechste Seite',
          },
          outline: { label: 'Auf dieser Seite' },
          lastUpdated: { text: 'Zuletzt aktualisiert' },
          returnToTopLabel: 'Zurueck nach oben',
          sidebarMenuLabel: 'Menue',
          darkModeSwitchLabel: 'Design',
        },
      },
    },

    themeConfig: {
      logo: '/assets/OBSILO_ICON50x50_lila.png',
      siteTitle: 'Obsilo',
      socialLinks: [
        { icon: 'github', link: 'https://github.com/pssah4/obsilo' },
      ],
      search: {
        provider: 'local',
      },
    },

    mermaid: {},
  }),
)

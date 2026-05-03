/**
 * SourceInterface -- Whitelist-Tag fuer Cross-Surface AI Workflow.
 *
 * BA-26 / EPIC-23 / ADR-108. Identifiziert das Chat-UI, ueber das
 * eine Memory- oder History-Schreibung kam. Engine-Public-Helper:
 * keine Obsidian-Imports, keine Globals, pure Funktionen.
 */

export const SOURCE_INTERFACES = [
    'obsilo',       // Obsilo's eigene Sidebar-Chats
    'claude-ai',    // claude.ai (Web)
    'claude-code',  // Claude Code CLI / IDE
    'chatgpt',      // chatgpt.com / Mobile
    'perplexity',   // perplexity.ai
    'unknown',      // Fallback wenn weder Connector-Konfig noch Argument einen Wert liefert
] as const;

export type SourceInterface = typeof SOURCE_INTERFACES[number];

/**
 * Validiert einen externen Wert gegen die Whitelist. Unbekannte
 * Werte fallen auf 'unknown' zurueck. Akzeptiert beliebigen Input
 * (string, undefined, null, number, etc.) damit MCP-Tool-Handler
 * sie ohne Pre-Cast aufrufen koennen.
 */
export function validateSourceInterface(value: unknown): SourceInterface {
    if (typeof value !== 'string') return 'unknown';
    return (SOURCE_INTERFACES as readonly string[]).includes(value)
        ? value as SourceInterface
        : 'unknown';
}

// --------------------------------------------------------------
// Sync-Mode (FEAT-23-04, ADR-108)
// --------------------------------------------------------------

export type SyncMode = 'auto' | 'manual';
export type PerProviderSyncOverride = 'global' | SyncMode;

export interface CrossSurfaceSettings {
    /** Globaler Default-Mode wenn perProvider auf 'global' steht. */
    defaultSyncMode: SyncMode;
    /** Per-Provider-Override. Leere Eintraege fallen implizit auf 'global'. */
    perProvider: Partial<Record<SourceInterface, PerProviderSyncOverride>>;
}

/**
 * Privacy-sichere Defaults: ChatGPT und Perplexity gelten als
 * Familien-geteilte Accounts (Sebastian-Use-Case). Claude-Tools
 * gelten als persoenlich.
 */
export const DEFAULT_CROSS_SURFACE_SETTINGS: CrossSurfaceSettings = {
    defaultSyncMode: 'auto',
    perProvider: {
        'obsilo': 'global',
        'claude-ai': 'global',
        'claude-code': 'global',
        'chatgpt': 'manual',
        'perplexity': 'manual',
        'unknown': 'manual',
    },
};

/**
 * Resolved den effektiven Sync-Mode fuer eine source_interface.
 * Override 'global' (oder undefined) faellt auf den globalen Default.
 * Konzentriert die Auswertungs-Logik damit MCP-Handler und
 * ExtractionQueue konsistent entscheiden.
 */
export function resolveSyncMode(
    source: SourceInterface,
    settings: CrossSurfaceSettings,
): SyncMode {
    const override = settings.perProvider[source] ?? 'global';
    return override === 'global' ? settings.defaultSyncMode : override;
}

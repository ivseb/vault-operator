/**
 * InlineWebLookup -- one-shot web search for the inline Lookup-Action (EPIC-33).
 *
 * Wraps the project's existing WebSearchProvider (Brave / Tavily) so
 * the inline action can fall back to the web when the vault has
 * insufficient coverage. NO AgentTask, NO tool registry, NO subtask.
 *
 * Honors the same privacy gates as the WebSearchTool:
 *  - settings.webTools.enabled
 *  - settings.webTools.provider in {'brave', 'tavily'}
 *  - API key present for the picked provider
 * Any gate failing -> search() returns [] (caller treats as web-unavailable).
 *
 * Audit reference: edgesAudit.webTools "non-tool callers (e.g. the
 * IMP-20-06-01 FreshnessVerifier web pass) can reuse the same
 * provider plumbing without going through the agent tool loop."
 */

import {
    searchByProvider,
    type WebSearchProviderName,
    type WebSearchResult,
} from '../../tools/web/WebSearchProvider';

export interface WebLookupResult {
    title: string;
    url: string;
    snippet: string;
    /** Synthetic rank-based score for sort stability. */
    score: number;
}

export interface WebToolsSettingsShape {
    enabled: boolean;
    provider: 'brave' | 'tavily' | 'none';
    braveApiKey: string;
    tavilyApiKey: string;
}

export interface InlineWebLookupOptions {
    /** Reads the live webTools settings on every call. */
    getWebSettings: () => WebToolsSettingsShape;
    /** Injectable provider call for unit tests. */
    fetchProvider?: typeof searchByProvider;
}

export class InlineWebLookup {
    private readonly getWebSettings: () => WebToolsSettingsShape;
    private readonly fetchProvider: typeof searchByProvider;

    constructor(options: InlineWebLookupOptions) {
        this.getWebSettings = options.getWebSettings;
        this.fetchProvider = options.fetchProvider ?? searchByProvider;
    }

    async search(query: string, count = 3): Promise<WebLookupResult[]> {
        const settings = this.getWebSettings();
        if (settings.enabled !== true) return [];
        if (settings.provider === 'none') return [];

        const providerName: WebSearchProviderName = settings.provider;
        const apiKey = providerName === 'brave' ? settings.braveApiKey : settings.tavilyApiKey;
        if (apiKey.length === 0) return [];

        const q = buildQuery(query);
        if (q.length === 0) return [];

        try {
            const raw: WebSearchResult[] = await this.fetchProvider(providerName, q, count, apiKey);
            return raw.slice(0, count).map((r, idx) => ({
                title: r.title,
                url: r.url,
                snippet: r.snippet,
                score: Math.max(0, 1.0 - 0.1 * idx),
            }));
        } catch (e) {
            console.debug('[InlineWebLookup] provider call failed (fallback to []):', e);
            return [];
        }
    }
}

function buildQuery(text: string): string {
    const oneLine = text.trim().split('\n')[0].slice(0, 200);
    if (oneLine.length === 0) return '';
    // Short uppercase tokens are likely acronyms -> add a hint.
    if (/^[A-Z0-9]{2,10}$/.test(oneLine)) return `${oneLine} definition`;
    return oneLine;
}

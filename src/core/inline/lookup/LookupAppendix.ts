/**
 * LookupAppendix -- markdown renderer for the inline Lookup-Action result (EPIC-33).
 *
 * Pure function. Takes the typed RAG / web / edge results and emits a
 * single markdown block that gets appended to the assistant bubble
 * AFTER the LLM stream completes. Sections are omitted when empty.
 *
 * Order:
 *   1. Vault sources    (one bullet per LookupRagSource)
 *   2. Web sources      (one bullet per WebLookupResult)
 *   3. Explicit connections   (backlink / outgoing-link / tag-cooccurrence)
 *   4. Implicit connections   (implicit-similarity)
 *
 * Wikilink targets always strip `.md`. Confidence rendered as a 2-decimal number.
 * Web results render as plain markdown links, never as wikilinks.
 */

import type { LookupRagSource } from '../actions/LookupAction';
import type { InlineEdgeHit } from './LookupEdgeAggregator';
import type { WebLookupResult } from './InlineWebLookup';

export type LookupTier = 'strong' | 'weak' | 'empty';

export interface RenderArgs {
    tier: LookupTier;
    vaultSources: LookupRagSource[];
    webResults: WebLookupResult[];
    edges: InlineEdgeHit[];
}

export function renderLookupAppendix(args: RenderArgs): string {
    const parts: string[] = [];

    if (args.tier === 'weak' && args.vaultSources.length > 0) {
        parts.push('*Low confidence -- vault match is partial.*');
    }

    if (args.vaultSources.length > 0) {
        parts.push('**Vault sources**');
        for (const s of args.vaultSources) {
            const display = s.notePath.replace(/\.md$/, '');
            const conf = Math.round(s.confidence * 100) / 100;
            const excerpt = s.excerpt !== undefined && s.excerpt.length > 0
                ? ` -- ${truncate(s.excerpt, 120)}`
                : '';
            parts.push(`- [[${display}]] (${conf})${excerpt}`);
        }
    }

    if (args.webResults.length > 0) {
        if (parts.length > 0) parts.push('');
        parts.push('**Web sources**');
        for (const w of args.webResults) {
            const snippet = w.snippet.length > 0 ? ` -- ${truncate(w.snippet, 160)}` : '';
            parts.push(`- [${w.title}](${w.url})${snippet}`);
        }
    }

    const explicit = args.edges.filter(e => e.type !== 'implicit-similarity');
    const implicit = args.edges.filter(e => e.type === 'implicit-similarity');

    if (explicit.length > 0) {
        if (parts.length > 0) parts.push('');
        parts.push('**Explicit connections**');
        for (const e of explicit) {
            const display = e.targetPath.replace(/\.md$/, '');
            parts.push(`- [[${display}]] -- ${e.reason}`);
        }
    }

    if (implicit.length > 0) {
        if (parts.length > 0) parts.push('');
        parts.push('**Implicit connections**');
        for (const e of implicit) {
            const display = e.targetPath.replace(/\.md$/, '');
            parts.push(`- [[${display}]] -- ${e.reason}`);
        }
    }

    if (parts.length === 0) return '';
    return '\n\n' + parts.join('\n');
}

function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1).trimEnd()}…`;
}

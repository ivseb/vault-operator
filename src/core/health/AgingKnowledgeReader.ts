/**
 * AgingKnowledgeReader -- read-side helper for the Aging-knowledge UI
 * (IMP-20-06-01 Wave 3).
 *
 * Reads `note_freshness` mirror columns plus a per-path history slice
 * and maps verdict + confidence into the modal's severity buckets per
 * the ADR-106 amendment:
 *
 *   outdated                                       -> critical
 *   widerspricht  with confidence >= HIGH_CONF     -> critical
 *   widerspricht  with confidence <  HIGH_CONF     -> moderate
 *   ergaenzt                                       -> moderate
 *   no_external_source                             -> info
 *   deckt-sich                                     -> ok (hidden by default)
 *
 * Persistence shape comes from KnowledgeDB schema v11.
 */

import type { VerdictLiteral, VerifierTier } from './types';

interface SqlDb {
    exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: unknown[][] }>;
}

export type AgingSeverity = 'critical' | 'moderate' | 'info' | 'ok';

export interface AgingRow {
    path: string;
    verdict: VerdictLiteral;
    confidence: number;
    summary: string;
    sources: string[];
    lastCheckedAt: string;
    verifierTier: VerifierTier;
    severity: AgingSeverity;
}

export interface AgingHistoryRow {
    runAt: string;
    verdict: VerdictLiteral;
    confidence: number;
    summary: string;
    sources: string[];
    verifierTier: VerifierTier;
    modelId: string;
}

const HIGH_CONFIDENCE_THRESHOLD = 0.7;

export class AgingKnowledgeReader {
    constructor(private readonly db: SqlDb) {}

    listAll(includeOk = false): AgingRow[] {
        const res = this.db.exec(
            `SELECT path, last_verdict, last_confidence, last_summary,
                    last_sources_json, last_checked_at, last_verifier_tier
             FROM note_freshness
             WHERE last_verdict IS NOT NULL
             ORDER BY last_checked_at DESC`,
        );
        if (!res.length || !res[0].values.length) return [];

        const rows: AgingRow[] = [];
        for (const r of res[0].values) {
            const verdict = String(r[1] ?? '') as VerdictLiteral;
            const confidence = Number(r[2] ?? 0);
            const severity = mapSeverity(verdict, confidence);
            if (severity === 'ok' && !includeOk) continue;

            rows.push({
                path: String(r[0]),
                verdict,
                confidence,
                summary: (r[3] as string | null) ?? '',
                sources: parseSources(r[4] as string | null),
                lastCheckedAt: (r[5] as string | null) ?? '',
                verifierTier: ((r[6] as string | null) ?? 'mid') as VerifierTier,
                severity,
            });
        }
        return rows;
    }

    listHistory(path: string): AgingHistoryRow[] {
        const res = this.db.exec(
            `SELECT run_at, verdict, confidence, summary, sources_json,
                    verifier_tier, model_id
             FROM note_freshness_history
             WHERE path = ?
             ORDER BY run_at DESC`,
            [path],
        );
        if (!res.length || !res[0].values.length) return [];

        return res[0].values.map((r) => ({
            runAt: String(r[0] ?? ''),
            verdict: String(r[1] ?? '') as VerdictLiteral,
            confidence: Number(r[2] ?? 0),
            summary: (r[3] as string | null) ?? '',
            sources: parseSources(r[4] as string | null),
            verifierTier: ((r[5] as string | null) ?? 'mid') as VerifierTier,
            modelId: String(r[6] ?? ''),
        }));
    }
}

export function mapSeverity(verdict: VerdictLiteral, confidence: number): AgingSeverity {
    if (verdict === 'outdated') return 'critical';
    if (verdict === 'widerspricht') {
        return confidence >= HIGH_CONFIDENCE_THRESHOLD ? 'critical' : 'moderate';
    }
    if (verdict === 'ergaenzt') return 'moderate';
    if (verdict === 'no_external_source') return 'info';
    return 'ok';
}

function parseSources(json: string | null): string[] {
    if (!json) return [];
    try {
        const parsed: unknown = JSON.parse(json);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((s): s is string => typeof s === 'string');
    } catch {
        return [];
    }
}

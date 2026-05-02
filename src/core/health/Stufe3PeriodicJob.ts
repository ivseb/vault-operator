/**
 * Stufe3PeriodicJob -- wochentlicher Background-Job mit hartem
 * Token-Budget-Cap.
 *
 * Backs FEAT-19-20 (Periodischer Lint) plus FEAT-19-21 (Hot-Cluster).
 * ADR-105: setInterval mit Cooldown-Persistenz, Hard-Cap mit
 * 80%-Notification, kalender-wochentlich Reset Montag 0:00.
 *
 * Pipeline:
 *   1. Iteration ueber Hot-Clusters (sortiert nach Freshness-Score asc).
 *   2. Pro Cluster: Semantic-Pre-Filter LLM-Call (yes/no/unsure).
 *   3. Bei yes/unsure: Light-Web-Search-Pass plus LLM-Synthese.
 *   4. Strong-Signal-Filter (min N unabhaengige Sources).
 *   5. Notification gesammelt.
 *
 * LLM-Call und Web-Search sind als Hooks injiziert (kein direktes
 * Coupling). Token-Counter pro Call.
 */

import type { ClusterMetadataStore, ClusterMetadataRecord } from '../knowledge/ClusterMetadataStore';

export interface PreFilterResult { decision: 'yes' | 'no' | 'unsure'; tokensUsed: number; }
export interface UpdateFinding {
    cluster: string;
    title: string;
    summary: string;
    sources: string[]; // url-list
    detectedAt: string;
    strongSignal: boolean;
}

export interface WebUpdatePassResult {
    findings: UpdateFinding[];
    tokensUsed: number;
}

export type PreFilterFn = (cluster: ClusterMetadataRecord) => Promise<PreFilterResult>;
export type WebUpdatePassFn = (cluster: ClusterMetadataRecord) => Promise<WebUpdatePassResult>;
export type NotificationSink = (findings: UpdateFinding[]) => void;
export type BudgetExceededSink = (info: { spentUsd: number; budgetUsd: number }) => void;

export interface Stufe3JobOptions {
    /** Default 2.0 USD pro Woche. */
    weeklyBudgetUsd: number;
    /** Default 0.8: Notification ab 80%. */
    notificationThreshold: number;
    /** Wenn dryRun true: Web-Search/LLM-Calls werden simuliert (Zero-Cost). */
    dryRun?: boolean;
    /** Tokens-zu-USD-Konversion (zB Haiku ~ 0.0015 USD/1k input). Default Haiku-Schatzung. */
    tokensPerUsd?: number;
}

export interface Stufe3JobState {
    weekStartIso: string; // ISO date of monday-week-start (UTC)
    spentUsd: number;
    notifiedAt80Percent: boolean;
}

export interface Stufe3RunResult {
    clustersProcessed: number;
    findingsCount: number;
    spentUsd: number;
    budgetExceeded: boolean;
    state: Stufe3JobState;
}

const DEFAULT_TOKENS_PER_USD = 660_000; // ~0.0015 USD per 1k tokens (Haiku-Schaetzung input)

export class Stufe3PeriodicJob {
    private state: Stufe3JobState;

    constructor(
        private readonly clusterMetadataStore: ClusterMetadataStore,
        private readonly preFilter: PreFilterFn,
        private readonly webUpdatePass: WebUpdatePassFn,
        private readonly notificationSink: NotificationSink,
        private readonly options: Stufe3JobOptions,
        initialState?: Stufe3JobState,
        private readonly budgetExceededSink?: BudgetExceededSink,
    ) {
        this.state = initialState ?? this.freshState();
    }

    /** Sollte beim Plugin-Onload aufgerufen werden bevor run() laeuft. */
    rolloverIfNewWeek(): void {
        const currentWeekStart = mondayOfWeek(new Date()).toISOString();
        if (currentWeekStart !== this.state.weekStartIso) {
            this.state = { weekStartIso: currentWeekStart, spentUsd: 0, notifiedAt80Percent: false };
        }
    }

    getState(): Stufe3JobState { return { ...this.state }; }

    /** Single Pass. setInterval-Wrapper liegt im Plugin. */
    async run(): Promise<Stufe3RunResult> {
        this.rolloverIfNewWeek();
        const result: Stufe3RunResult = {
            clustersProcessed: 0,
            findingsCount: 0,
            spentUsd: 0,
            budgetExceeded: false,
            state: this.state,
        };

        const hot = this.clusterMetadataStore.getHotClusters();
        // Sort by lastExternalCheck asc (oldest first), so reife Cluster zuerst
        hot.sort((a, b) => {
            const ta = a.lastExternalCheck ? new Date(a.lastExternalCheck).getTime() : 0;
            const tb = b.lastExternalCheck ? new Date(b.lastExternalCheck).getTime() : 0;
            return ta - tb;
        });

        const allFindings: UpdateFinding[] = [];

        for (const cluster of hot) {
            if (this.budgetReached()) {
                result.budgetExceeded = true;
                break;
            }

            // Step 1: Pre-Filter
            const pre = await this.preFilter(cluster);
            this.spendTokens(pre.tokensUsed);
            if (this.budgetReached()) { result.budgetExceeded = true; break; }
            if (pre.decision === 'no') {
                result.clustersProcessed++;
                continue;
            }

            // Step 2: Web-Update-Pass
            const webResult = await this.webUpdatePass(cluster);
            this.spendTokens(webResult.tokensUsed);
            this.clusterMetadataStore.setLastExternalCheck(cluster.cluster, new Date().toISOString());

            // Step 3: Strong-Signal-Filter
            for (const finding of webResult.findings) {
                if (finding.strongSignal) allFindings.push(finding);
            }
            result.clustersProcessed++;

            if (this.budgetReached()) { result.budgetExceeded = true; break; }
        }

        if (allFindings.length > 0) {
            this.notificationSink(allFindings);
        }

        result.findingsCount = allFindings.length;
        result.spentUsd = this.state.spentUsd;
        result.state = { ...this.state };
        return result;
    }

    private spendTokens(tokens: number): void {
        const tokensPerUsd = this.options.tokensPerUsd ?? DEFAULT_TOKENS_PER_USD;
        const cost = tokens / tokensPerUsd;
        this.state.spentUsd += cost;
        const ratio = this.state.spentUsd / this.options.weeklyBudgetUsd;
        if (!this.state.notifiedAt80Percent && ratio >= this.options.notificationThreshold) {
            this.state.notifiedAt80Percent = true;
            this.budgetExceededSink?.({ spentUsd: this.state.spentUsd, budgetUsd: this.options.weeklyBudgetUsd });
        }
    }

    private budgetReached(): boolean {
        return this.state.spentUsd >= this.options.weeklyBudgetUsd;
    }

    private freshState(): Stufe3JobState {
        return {
            weekStartIso: mondayOfWeek(new Date()).toISOString(),
            spentUsd: 0,
            notifiedAt80Percent: false,
        };
    }
}

/** Berechnet Montag 0:00 UTC der Wochenwoche fuer ein gegebenes Datum. */
export function mondayOfWeek(d: Date): Date {
    const date = new Date(d.getTime());
    const day = date.getUTCDay(); // 0=So, 1=Mo, ..., 6=Sa
    const diff = day === 0 ? -6 : 1 - day; // shift to Monday
    date.setUTCDate(date.getUTCDate() + diff);
    date.setUTCHours(0, 0, 0, 0);
    return date;
}

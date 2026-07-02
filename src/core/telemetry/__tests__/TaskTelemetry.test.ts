import { describe, it, expect } from 'vitest';
import { cacheHitRate, formatTelemetryFooter, TaskTelemetry } from '../TaskTelemetry';
import type { FileAdapter } from '../../storage/types';

describe('cacheHitRate (FEAT-24-05)', () => {
    it('returns null when there is no cache activity', () => {
        expect(cacheHitRate(1000, 0, 0)).toBeNull();
        expect(cacheHitRate(0, 0, 0)).toBeNull();
    });

    it('computes reads over (non-cached input + reads + writes), rounded', () => {
        // 8000 cached of 8000+2000 = 80%
        expect(cacheHitRate(2000, 8000, 0)).toBe(80);
        // a cache-write turn: 0 reads, 5000 writes, 1000 input -> 0%
        expect(cacheHitRate(1000, 0, 5000)).toBe(0);
        // mixed: 6000 reads, 1500 writes, 2500 input -> 6000/10000 = 60%
        expect(cacheHitRate(2500, 6000, 1500)).toBe(60);
        // rounding
        expect(cacheHitRate(2, 1, 0)).toBe(33);
    });
});

describe('formatTelemetryFooter (FEAT-24-05)', () => {
    it('shows in/out and cost, no cache segment when there is no cache', () => {
        const s = formatTelemetryFooter({ inputTokens: 12340, outputTokens: 2100, cacheReadTokens: 0, costEur: 0.042 });
        expect(s).toContain('12,340 in');
        expect(s).toContain('2,100 out');
        // v2.10.0: formatEur switched to Intl.NumberFormat('de-DE', currency: EUR);
        // 0.042 with min 2 / max 4 fraction digits renders as "0,042 €"
        // (the German locale uses non-breaking space U+00A0 between amount
        // and currency symbol).
        expect(s).toContain('0,042 €');
        expect(s).not.toContain('hit');
        expect(s).not.toContain('cached');
    });

    it('adds cached count and hit-rate when there is cache activity', () => {
        const s = formatTelemetryFooter({
            inputTokens: 2000, outputTokens: 500, cacheReadTokens: 8000, cacheCreationTokens: 0, costEur: 0.01,
        });
        expect(s).toContain('8,000 cached');
        expect(s).toContain('80% hit');
    });

    it('shows hit-rate even on a pure cache-write turn (0% hit)', () => {
        const s = formatTelemetryFooter({
            inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 20000, costEur: 0.3,
        });
        expect(s).toContain('0% hit');
        expect(s).not.toContain('cached'); // cacheReadTokens is 0
    });

    it('appends the subscription marker', () => {
        const s = formatTelemetryFooter({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, costEur: 0.001, isSubscription: true });
        expect(s).toContain('(~ via Sub)');
    });
});

// FIX-24-05-05: the persisted entry must carry the per-model breakdown and
// price the task as the sum of per-model costs.
describe('TaskTelemetry.record with usageByModel (FIX-24-05-05)', () => {
    function makeFakeFs(): { fs: FileAdapter; files: Map<string, string> } {
        const files = new Map<string, string>();
        const dirs = new Set<string>();
        const fs = {
            exists: async (p: string) => files.has(p) || dirs.has(p),
            read: async (p: string) => files.get(p) ?? '',
            write: async (p: string, content: string) => { files.set(p, content); },
            mkdir: async (p: string) => { dirs.add(p); },
        } as unknown as FileAdapter;
        return { fs, files };
    }

    it('computes cost as the sum over per-model buckets', async () => {
        const { fs } = makeFakeFs();
        const telemetry = new TaskTelemetry(fs);
        const entry = await telemetry.record({
            promptPreview: 'p',
            modelId: 'claude-opus-4-8',
            mode: 'agent',
            inputTokens: 2_000_000,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            outcome: 'completed',
            usageByModel: {
                'claude-haiku-4-5': { input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 },
                'claude-opus-4-8': { input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 },
            },
        });
        // Haiku $1 + Opus $5 = $6; single-id pricing would say $10.
        expect(entry.costUsd).toBeCloseTo(6, 5);
        expect(entry.usageByModel?.['claude-haiku-4-5']?.input).toBe(1_000_000);
    });

    it('keeps single-model pricing when no buckets are given', async () => {
        const { fs } = makeFakeFs();
        const telemetry = new TaskTelemetry(fs);
        const entry = await telemetry.record({
            promptPreview: 'p',
            modelId: 'claude-opus-4-8',
            mode: 'agent',
            inputTokens: 2_000_000,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            outcome: 'completed',
        });
        expect(entry.costUsd).toBeCloseTo(10, 5);
        expect(entry.usageByModel).toBeUndefined();
    });
});

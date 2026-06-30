import { describe, it, expect, beforeEach } from 'vitest';
import { TaskTelemetry, readRecentCondense } from '../TaskTelemetry';
import type { FileAdapter } from '../../storage/types';

/**
 * FIX-COMPACT-07: TaskTelemetry persists condense events to a parallel
 * JSONL so the threshold and helper-model selection can be tuned
 * against empirical data.
 */

class MemoryFs implements FileAdapter {
    private files = new Map<string, string>();
    private dirs = new Set<string>();

    async exists(path: string): Promise<boolean> {
        return this.files.has(path) || this.dirs.has(path);
    }
    async read(path: string): Promise<string> {
        return this.files.get(path) ?? '';
    }
    async write(path: string, content: string): Promise<void> {
        this.files.set(path, content);
    }
    async mkdir(path: string): Promise<void> {
        this.dirs.add(path);
    }
    async remove(path: string): Promise<void> {
        this.files.delete(path);
        this.dirs.delete(path);
    }
    async list(_path: string): Promise<{ files: string[]; folders: string[] }> {
        return { files: [], folders: [] };
    }
    async append(path: string, data: string): Promise<void> {
        const cur = this.files.get(path) ?? '';
        this.files.set(path, cur + data);
    }
    async stat(_path: string): Promise<{ mtime: number; size: number } | null> { return null; }
}

describe('TaskTelemetry.recordCondense (FIX-COMPACT-07)', () => {
    let fs: MemoryFs;
    let telemetry: TaskTelemetry;
    beforeEach(() => {
        fs = new MemoryFs();
        telemetry = new TaskTelemetry(fs);
    });

    it('appends a JSONL line per successful condense', async () => {
        await telemetry.recordCondense({
            startedAt: new Date().toISOString(),
            durationMs: 123,
            success: true,
            prevTokens: 50_000,
            newTokens: 12_000,
            savedTokens: 38_000,
            helperModelUsed: true,
            modelId: 'haiku',
            maxTailTokens: 10_000,
        });
        const recent = await readRecentCondense(fs);
        expect(recent.length).toBe(1);
        expect(recent[0].success).toBe(true);
        expect(recent[0].savedTokens).toBe(38_000);
        expect(recent[0].helperModelUsed).toBe(true);
        expect(recent[0].modelId).toBe('haiku');
    });

    it('persists failure events with their error message', async () => {
        await telemetry.recordCondense({
            startedAt: new Date().toISOString(),
            durationMs: 50,
            success: false,
            prevTokens: 50_000,
            newTokens: 50_000,
            savedTokens: 0,
            helperModelUsed: true,
            modelId: 'haiku',
            maxTailTokens: 10_000,
            errorMessage: 'rate_limit_exceeded',
        });
        const recent = await readRecentCondense(fs);
        expect(recent.length).toBe(1);
        expect(recent[0].success).toBe(false);
        expect(recent[0].errorMessage).toBe('rate_limit_exceeded');
    });

    it('survives multiple appends', async () => {
        for (let i = 0; i < 5; i++) {
            await telemetry.recordCondense({
                startedAt: new Date().toISOString(),
                durationMs: i * 10,
                success: i % 2 === 0,
                prevTokens: 10_000 + i,
                newTokens: 5_000,
                savedTokens: 5_000 + i,
                helperModelUsed: false,
                modelId: 'mock',
                maxTailTokens: 10_000,
            });
        }
        const recent = await readRecentCondense(fs);
        expect(recent.length).toBe(5);
        expect(recent.map((e) => e.durationMs)).toEqual([0, 10, 20, 30, 40]);
    });
});

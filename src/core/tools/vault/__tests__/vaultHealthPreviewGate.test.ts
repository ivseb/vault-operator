/**
 * FEAT-44-02b: vault_health_check presents its repair scope as ONE card.
 *
 * This is the motivating card-fatigue case: a repair action over a large
 * vault used to be approved on a blind name card (its writes happen inside
 * VaultHealthService, invisible to the gate). previewBatch now surfaces the
 * planned target list (via planRepairTargets) so the user approves a
 * defined scope. scopeOnly: the exact mutation per note is decided inside
 * processFrontMatter at write time; a simulated diff could drift from the
 * write, an honest path list cannot.
 */

import { describe, it, expect, vi } from 'vitest';
import { VaultHealthCheckTool } from '../VaultHealthCheckTool';

function makeTool(planned: string[] | null, opts: { serviceMissing?: boolean } = {}) {
    const planRepairTargets = vi.fn(() => {
        if (planned === null) throw new Error('db not open');
        return planned;
    });
    const plugin = {
        app: { vault: {} },
        settings: { categoryProperty: 'Kategorie', backlinksProperty: 'Notizen' },
        vaultHealthService: opts.serviceMissing ? undefined : { planRepairTargets },
    };
    const tool = new VaultHealthCheckTool(plugin as never);
    return { tool, planRepairTargets };
}

describe('FEAT-44-02b: vault_health_check batch preview', () => {
    it('returns the planned repair scope for fix_backlinks', async () => {
        const { tool, planRepairTargets } = makeTool(['Notes/A.md', 'Notes/B.md', 'Notes/T-Backlinks.base']);

        const batch = await tool.previewBatch({ action: 'fix_backlinks' });

        expect(planRepairTargets).toHaveBeenCalledWith('fix_backlinks', 'Notizen', 'Kategorie');
        expect(batch).not.toBeNull();
        expect(batch!.scopeOnly).toBe(true);
        expect(batch!.entries.map((e) => e.path)).toEqual([
            'Notes/A.md', 'Notes/B.md', 'Notes/T-Backlinks.base',
        ]);
        expect(batch!.summary).toContain('fix_backlinks');
        expect(batch!.summary).toContain('3');
    });

    it.each(['cleanup', 'fix_categories'])('covers the %s action', async (action) => {
        const { tool, planRepairTargets } = makeTool(['Notes/A.md']);
        const batch = await tool.previewBatch({ action });
        expect(planRepairTargets).toHaveBeenCalledTimes(1);
        expect(batch!.entries).toHaveLength(1);
    });

    it.each(['check', 'refresh', 'cleanup_edges'])(
        'returns null for non-file-writing action %s (plain card)',
        async (action) => {
            const { tool, planRepairTargets } = makeTool(['Notes/A.md']);
            expect(await tool.previewBatch({ action })).toBeNull();
            expect(planRepairTargets).not.toHaveBeenCalled();
        },
    );

    it('returns null when the plan is empty (repair is a no-op)', async () => {
        const { tool } = makeTool([]);
        expect(await tool.previewBatch({ action: 'cleanup' })).toBeNull();
    });

    it('returns null when the health service is missing or the plan throws', async () => {
        const missing = makeTool(['x.md'], { serviceMissing: true });
        expect(await missing.tool.previewBatch({ action: 'cleanup' })).toBeNull();

        const throwing = makeTool(null);
        expect(await throwing.tool.previewBatch({ action: 'cleanup' })).toBeNull();
    });
});

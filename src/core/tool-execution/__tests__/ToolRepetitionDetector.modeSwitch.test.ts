import { describe, it, expect } from 'vitest';
import { ToolRepetitionDetector } from '../ToolRepetitionDetector';

/**
 * FIX-COMPACT-04: mode switches must not wipe the loop guard.
 *
 * Previously the AgentTask called `repetitionDetector.reset()` on every
 * mode switch. Loops via Code -> Architect -> Code therefore bypassed
 * both the exact-repetition block AND the "already failed" ledger
 * because the new mode inherited zero memory.
 *
 * The detector keeps all recorded calls and the sliding window. A new
 * `markModeSwitch(newMode)` method just appends an annotation entry so
 * the summarizer in the condensing prompt sees the transition.
 */
describe('ToolRepetitionDetector mode-switch annotations (FIX-COMPACT-04)', () => {
    it('markModeSwitch keeps all prior calls intact', () => {
        const d = new ToolRepetitionDetector();
        d.record('read_file', { path: 'a.md' }, 'ok', 0);
        d.record('search_files', { query: 'foo' }, '<error>fail</error>', 1, 'failed');
        d.markModeSwitch('architect');
        d.record('write_file', { path: 'b.md' }, 'ok', 2);
        const seq = d.getToolSequence();
        // mode-switch annotation does NOT appear in tool sequence (it's not a tool)
        expect(seq).toEqual(['read_file', 'search_files', 'write_file']);
        const ledger = d.getLedger();
        expect(ledger).toContain('read_file');
        expect(ledger).toContain('search_files');
        expect(ledger).toContain('write_file');
        expect(ledger).toContain('PREVIOUSLY FAILED');
    });

    it('renders the mode switch annotation in the ledger', () => {
        const d = new ToolRepetitionDetector();
        d.record('read_file', { path: 'a.md' }, 'ok', 0);
        d.markModeSwitch('architect');
        const ledger = d.getLedger();
        expect(ledger).toMatch(/mode.*switch|switched mode|MODE SWITCH/i);
        expect(ledger).toContain('architect');
    });

    it('sliding window survives mode switch (exact-repetition still blocks)', () => {
        const d = new ToolRepetitionDetector();
        d.record('search_files', { query: 'foo' }, 'ok', 0);
        d.record('search_files', { query: 'foo' }, 'ok', 1);
        d.markModeSwitch('architect');
        d.record('search_files', { query: 'foo' }, 'ok', 2);
        // Fourth identical call must be blocked even though the mode flipped.
        const check = d.check('search_files', { query: 'foo' });
        expect(check.blocked).toBe(true);
    });

    it('multiple mode switches are all annotated in order', () => {
        const d = new ToolRepetitionDetector();
        d.markModeSwitch('architect');
        d.record('read_file', { path: 'a.md' }, 'ok', 0);
        d.markModeSwitch('code');
        const ledger = d.getLedger();
        // Both mode switches are visible
        expect((ledger.match(/architect/g) ?? []).length).toBeGreaterThanOrEqual(1);
        expect((ledger.match(/code/g) ?? []).length).toBeGreaterThanOrEqual(1);
    });
});

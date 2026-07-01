import { describe, it, expect } from 'vitest';
import { ToolRepetitionDetector } from '../ToolRepetitionDetector';

/**
 * FIX-COMPACT-01: failed tool calls must be visible to the condensing
 * summarizer through the ledger, so the post-condense agent does not
 * silently retry an approach that already failed.
 *
 * Contract:
 * - record() accepts an optional outcome flag ('success' | 'failed').
 * - getLedger() renders a dedicated 'PREVIOUSLY FAILED TOOL CALLS' section
 *   for failed entries with a 'do not retry with same args' hint.
 * - Failed entries DO feed the exact-repetition sliding window so the
 *   detector still blocks a 3x identical failing call within the window.
 */
describe('ToolRepetitionDetector failed-outcome handling (FIX-COMPACT-01)', () => {
    it('renders failed calls under a dedicated FAILED section in the ledger', () => {
        const d = new ToolRepetitionDetector();
        d.record('read_file', { path: 'a.md' }, 'L1-L120 of a.md', 0, 'success');
        d.record('search_files', { query: 'foo' }, '<error>nothing found</error>', 1, 'failed');
        const ledger = d.getLedger();
        expect(ledger).toContain('PREVIOUSLY FAILED TOOL CALLS');
        expect(ledger).toContain('do not retry with same args');
        expect(ledger).toContain('search_files');
        // Successful calls stay in the existing success section
        expect(ledger).toContain('Tool calls executed so far');
        expect(ledger).toContain('read_file');
    });

    it('defaults outcome to success when not specified (backwards-compatible)', () => {
        const d = new ToolRepetitionDetector();
        d.record('read_file', { path: 'a.md' }, 'ok', 0);
        const ledger = d.getLedger();
        expect(ledger).toContain('Tool calls executed so far');
        expect(ledger).not.toContain('PREVIOUSLY FAILED TOOL CALLS');
    });

    it('failed entries also feed the sliding window (exact-repetition block)', () => {
        const d = new ToolRepetitionDetector();
        d.record('write_vault', { path: 'x.md' }, '<error>permission denied</error>', 0, 'failed');
        d.record('write_vault', { path: 'x.md' }, '<error>permission denied</error>', 1, 'failed');
        d.record('write_vault', { path: 'x.md' }, '<error>permission denied</error>', 2, 'failed');
        const check = d.check('write_vault', { path: 'x.md' });
        expect(check.blocked).toBe(true);
    });

    it('failed entries appear in getToolSequence (chronological order preserved)', () => {
        const d = new ToolRepetitionDetector();
        d.record('read_file', { path: 'a.md' }, 'ok', 0, 'success');
        d.record('search_files', { query: 'foo' }, '<error>fail</error>', 1, 'failed');
        d.record('write_file', { path: 'b.md' }, 'ok', 2, 'success');
        expect(d.getToolSequence()).toEqual(['read_file', 'search_files', 'write_file']);
    });
});

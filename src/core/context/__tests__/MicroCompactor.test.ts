import { describe, it, expect } from 'vitest';
import { microcompactToolResults, shouldDeferMicrocompact, PRUNED_MARKER } from '../MicroCompactor';
import { FileDossier } from '../FileDossier';
import type { MessageParam } from '../../../api/types';

/** Build a turn: assistant(tool_use) + user(tool_result with `len` chars of body). */
function turn(id: string, toolName: string, bodyLen: number, input: Record<string, unknown> = {}): MessageParam[] {
    return [
        { role: 'assistant', content: [{ type: 'tool_use', id, name: toolName, input }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'x'.repeat(bodyLen) }] },
    ];
}

describe('microcompactToolResults', () => {
    it('is a no-op when the history is short', () => {
        const history: MessageParam[] = [
            { role: 'user', content: 'do the thing' },
            ...turn('t1', 'read_file', 60_000, { path: 'Notes/A.md' }),
        ];
        const before = JSON.stringify(history);
        const res = microcompactToolResults(history, { keepRecentMessages: 6 });
        expect(res.prunedBlocks).toBe(0);
        expect(JSON.stringify(history)).toBe(before);
    });

    it('prunes large old tool_result contents to a skeleton with a re-read pointer', () => {
        const history: MessageParam[] = [
            { role: 'user', content: 'summarize my notes' },
            ...turn('t1', 'read_file', 50_000, { path: 'Notes/A.md' }),
            ...turn('t2', 'read_file', 50_000, { path: 'Notes/B.md' }),
            ...turn('t3', 'semantic_search', 40_000, { query: 'foo' }),
            { role: 'assistant', content: [{ type: 'text', text: 'here is the summary' }] },
            { role: 'user', content: 'now another question' },
            ...turn('t4', 'read_file', 50_000, { path: 'Notes/C.md' }),
            { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
        ];
        const res = microcompactToolResults(history, { keepRecentMessages: 4, minPruneChars: 1500 });
        // t1, t2, t3 are old (before the last 4 messages) -> pruned. t4 is in the protected tail.
        expect(res.prunedBlocks).toBe(3);
        expect(res.freedCharsApprox).toBeGreaterThan(100_000);

        const t1Result = (history[2].content as Array<{ type: string; content: string }>)[0];
        expect(t1Result.content.startsWith(PRUNED_MARKER)).toBe(true);
        expect(t1Result.content).toContain('read_file');
        expect(t1Result.content).toContain('Notes/A.md');

        // The most recent read_file (t4) is untouched.
        const t4Result = (history[history.length - 2].content as Array<{ type: string; content: string }>)[0];
        expect(t4Result.content).toBe('x'.repeat(50_000));
    });

    it('never touches the first user message', () => {
        const history: MessageParam[] = [
            { role: 'user', content: 'x'.repeat(80_000) },
            ...turn('t1', 'read_file', 50_000, { path: 'A.md' }),
            ...turn('t2', 'read_file', 50_000, { path: 'B.md' }),
            ...turn('t3', 'read_file', 50_000, { path: 'C.md' }),
            { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
        ];
        microcompactToolResults(history, { keepRecentMessages: 4 });
        expect(history[0].content).toBe('x'.repeat(80_000));
    });

    it('keeps the tool_use / tool_result pairing intact', () => {
        const history: MessageParam[] = [
            { role: 'user', content: 'task' },
            ...turn('t1', 'read_file', 50_000, { path: 'A.md' }),
            ...turn('t2', 'read_file', 50_000, { path: 'B.md' }),
            ...turn('t3', 'read_file', 50_000, { path: 'C.md' }),
            { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
        ];
        microcompactToolResults(history, { keepRecentMessages: 4 });
        const assistant = history[1].content as Array<{ type: string; id: string }>;
        const result = history[2].content as Array<{ type: string; tool_use_id: string }>;
        expect(assistant[0].type).toBe('tool_use');
        expect(assistant[0].id).toBe('t1');
        expect(result[0].type).toBe('tool_result');
        expect(result[0].tool_use_id).toBe('t1');
    });

    it('is idempotent — a second run prunes nothing more', () => {
        const history: MessageParam[] = [
            { role: 'user', content: 'task' },
            ...turn('t1', 'read_file', 50_000, { path: 'A.md' }),
            ...turn('t2', 'read_file', 50_000, { path: 'B.md' }),
            ...turn('t3', 'read_file', 50_000, { path: 'C.md' }),
            { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
        ];
        const first = microcompactToolResults(history, { keepRecentMessages: 4 });
        expect(first.prunedBlocks).toBeGreaterThan(0);
        const snapshot = JSON.stringify(history);
        const second = microcompactToolResults(history, { keepRecentMessages: 4 });
        expect(second.prunedBlocks).toBe(0);
        expect(JSON.stringify(history)).toBe(snapshot);
    });

    it('leaves small results and error results alone', () => {
        const history: MessageParam[] = [
            { role: 'user', content: 'task' },
            { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'list_files', input: {} }] },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'short output' }] },
            { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'read_file', input: { path: 'X.md' } }] },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'y'.repeat(50_000), is_error: true }] },
            ...turn('t3', 'read_file', 50_000, { path: 'C.md' }),
            ...turn('t4', 'read_file', 50_000, { path: 'D.md' }),
            { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
        ];
        const res = microcompactToolResults(history, { keepRecentMessages: 2, minPruneChars: 1500 });
        // small one untouched, error one untouched, t3 pruned (before the protected tail), t4 in tail
        expect(res.prunedBlocks).toBe(1);
        expect((history[2].content as Array<{ content: string }>)[0].content).toBe('short output');
        expect((history[4].content as Array<{ content: string }>)[0].content).toBe('y'.repeat(50_000));
    });
});

describe('IMP-41-03-06: dossier feed at prune time', () => {
    it('records pruned path-bearing results into the dossier', () => {
        const dossier = new FileDossier();
        const big = 'important finding about kant '.repeat(100);
        const history: import('../../../api/types').MessageParam[] = [
            { role: 'user', content: 'task' },
            {
                role: 'assistant',
                content: [{ type: 'tool_use', id: 't1', name: 'read_file', input: { path: 'Notes/Kant.md' } }],
            },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: big }] },
            // protected tail padding
            { role: 'assistant', content: 'a' }, { role: 'user', content: 'b' },
            { role: 'assistant', content: 'c' }, { role: 'user', content: 'd' },
            { role: 'assistant', content: 'e' }, { role: 'user', content: 'f' },
        ];
        const result = microcompactToolResults(history, { dossier, keepRecentMessages: 2 });
        expect(result.prunedBlocks).toBe(1);
        const rendered = dossier.render();
        expect(rendered).toContain('Notes/Kant.md');
        expect(rendered).toContain('important finding about kant');
    });

    it('marks write-tool results as written', () => {
        const dossier = new FileDossier();
        const big = 'wrote a large section '.repeat(120);
        const history: import('../../../api/types').MessageParam[] = [
            { role: 'user', content: 'task' },
            {
                role: 'assistant',
                content: [{ type: 'tool_use', id: 'w1', name: 'write_file', input: { path: 'Out/Report.md' } }],
            },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'w1', content: big }] },
            { role: 'assistant', content: 'a' }, { role: 'user', content: 'b' },
            { role: 'assistant', content: 'c' }, { role: 'user', content: 'd' },
        ];
        microcompactToolResults(history, { dossier, keepRecentMessages: 2 });
        expect(dossier.render()).toContain('Out/Report.md (written)');
    });
});

describe('FIX-COMPACT-09: dry run + economy guard', () => {
    function bigHistory(): MessageParam[] {
        return [
            { role: 'user', content: 'task' },
            ...turn('t1', 'read_file', 50_000, { path: 'Notes/A.md' }),
            ...turn('t2', 'read_file', 50_000, { path: 'Notes/B.md' }),
            { role: 'assistant', content: 'a' }, { role: 'user', content: 'b' },
            { role: 'assistant', content: 'c' }, { role: 'user', content: 'd' },
        ];
    }

    it('dryRun counts what a real run would prune without mutating the history', () => {
        const history = bigHistory();
        const before = JSON.stringify(history);
        const probe = microcompactToolResults(history, { keepRecentMessages: 4, dryRun: true });
        expect(JSON.stringify(history)).toBe(before);
        expect(probe.prunedBlocks).toBe(2);

        const real = microcompactToolResults(history, { keepRecentMessages: 4 });
        expect(real.prunedBlocks).toBe(probe.prunedBlocks);
        expect(real.freedCharsApprox).toBe(probe.freedCharsApprox);
    });

    it('dryRun does not feed the dossier', () => {
        const dossier = new FileDossier();
        const history = bigHistory();
        microcompactToolResults(history, { keepRecentMessages: 4, dossier, dryRun: true });
        expect(dossier.render()).not.toContain('Notes/A.md');
    });

    it('shouldDeferMicrocompact applies the economy guard below the ceiling, prunes on real pressure', () => {
        // small free, low pressure -> defer (cache rebuild would cost more than the free)
        expect(shouldDeferMicrocompact({ pressure: 0.2, wouldFreeTokens: 500, pressureCeiling: 0.75, minFreedTokens: 3000 })).toBe(true);
        // large free amortizes the one-time cache rebuild -> prune even at low pressure
        expect(shouldDeferMicrocompact({ pressure: 0.2, wouldFreeTokens: 5000, pressureCeiling: 0.75, minFreedTokens: 3000 })).toBe(false);
        // FIX-COMPACT-09 gap fix: mid pressure (>= old floor 0.6 but < ceiling) with a
        // small free now DEFERS. Previously the guard was skipped in this band and
        // pruned unconditionally, busting the prompt-cache prefix on every turn --
        // exactly where the cache rebuild is most expensive (the 0.80 EUR driver).
        expect(shouldDeferMicrocompact({ pressure: 0.7, wouldFreeTokens: 500, pressureCeiling: 0.75, minFreedTokens: 3000 })).toBe(true);
        // real pressure at/above the ceiling -> always prune to make room before full condense
        expect(shouldDeferMicrocompact({ pressure: 0.78, wouldFreeTokens: 500, pressureCeiling: 0.75, minFreedTokens: 3000 })).toBe(false);
        // exactly at the ceiling counts as real pressure -> prune
        expect(shouldDeferMicrocompact({ pressure: 0.75, wouldFreeTokens: 500, pressureCeiling: 0.75, minFreedTokens: 3000 })).toBe(false);
    });
});

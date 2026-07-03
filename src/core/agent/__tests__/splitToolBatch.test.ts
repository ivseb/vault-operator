import { describe, it, expect } from 'vitest';
import { splitToolBatch } from '../splitToolBatch';

/**
 * IMP-41-02-02: parallel-prefix batch splitting.
 *
 * The legacy rule was all-or-nothing: one write anywhere forced the whole
 * batch sequential, serializing independent reads. New rule: the maximal
 * parallel-safe PREFIX runs concurrently, the rest stays sequential in
 * model order (a read AFTER a write may depend on that write's output, so
 * only the prefix is split — no islands).
 */

const SAFE = new Set(['read_file', 'search_files', 'list_files']);

function uses(...names: string[]): Array<{ name: string }> {
    return names.map((name) => ({ name }));
}

describe('splitToolBatch', () => {
    it('splits reads before a write into parallel prefix + sequential rest', () => {
        const { parallelPrefix, sequentialRest } = splitToolBatch(uses('read_file', 'search_files', 'write_file'), SAFE);
        expect(parallelPrefix.map((t) => t.name)).toEqual(['read_file', 'search_files']);
        expect(sequentialRest.map((t) => t.name)).toEqual(['write_file']);
    });

    it('keeps a write-first batch fully sequential', () => {
        const { parallelPrefix, sequentialRest } = splitToolBatch(uses('write_file', 'read_file'), SAFE);
        expect(parallelPrefix).toEqual([]);
        expect(sequentialRest.map((t) => t.name)).toEqual(['write_file', 'read_file']);
    });

    it('runs an all-reads batch fully parallel (legacy parity)', () => {
        const { parallelPrefix, sequentialRest } = splitToolBatch(uses('read_file', 'list_files'), SAFE);
        expect(parallelPrefix.map((t) => t.name)).toEqual(['read_file', 'list_files']);
        expect(sequentialRest).toEqual([]);
    });

    it('does not parallelize a single-element prefix (no gain)', () => {
        const { parallelPrefix, sequentialRest } = splitToolBatch(uses('read_file', 'write_file'), SAFE);
        expect(parallelPrefix).toEqual([]);
        expect(sequentialRest.map((t) => t.name)).toEqual(['read_file', 'write_file']);
    });

    it('keeps reads AFTER a write sequential (may depend on the write)', () => {
        const { parallelPrefix, sequentialRest } = splitToolBatch(
            uses('read_file', 'read_file', 'write_file', 'read_file'), SAFE,
        );
        expect(parallelPrefix).toHaveLength(2);
        expect(sequentialRest.map((t) => t.name)).toEqual(['write_file', 'read_file']);
    });

    it('handles empty input', () => {
        const { parallelPrefix, sequentialRest } = splitToolBatch([], SAFE);
        expect(parallelPrefix).toEqual([]);
        expect(sequentialRest).toEqual([]);
    });
});

/**
 * Regression tests for AUDIT-034 M-8 (XlsxParser DoS via crafted cell refs).
 *
 * Pins the cell-ref validator that gates which cells are admitted into the
 * sparse grid. Without these clamps, a hostile workbook with a single cell
 * like `r="ZZZZZZ1"` pushes maxCol into the hundreds of millions and the
 * downstream render loop allocates billions of cells.
 *
 * Excel hard limits (OOXML spec, Excel 2007+):
 *   columns: A..XFD = 16384 (zero-based max 16383)
 *   rows:    1..1048576
 */

import { describe, it, expect } from 'vitest';
import { parseAndValidateCellRef } from '../XlsxParser';

describe('parseAndValidateCellRef (AUDIT-034 M-8)', () => {
    describe('accepts well-formed refs within Excel limits', () => {
        it('A1 -> col=0 row=1', () => {
            expect(parseAndValidateCellRef('A1')).toEqual({ colIdx: 0, rowIdx: 1 });
        });

        it('B5 -> col=1 row=5', () => {
            expect(parseAndValidateCellRef('B5')).toEqual({ colIdx: 1, rowIdx: 5 });
        });

        it('Z1 -> col=25 row=1', () => {
            expect(parseAndValidateCellRef('Z1')).toEqual({ colIdx: 25, rowIdx: 1 });
        });

        it('AA1 -> col=26 row=1', () => {
            expect(parseAndValidateCellRef('AA1')).toEqual({ colIdx: 26, rowIdx: 1 });
        });

        it('XFD1048576 (last legal cell) is accepted', () => {
            const result = parseAndValidateCellRef('XFD1048576');
            expect(result).not.toBeNull();
            expect(result?.colIdx).toBe(16383);
            expect(result?.rowIdx).toBe(1048576);
        });
    });

    describe('rejects refs that exceed Excel column limit', () => {
        it('ZZZZZZ1 (6-letter column) is skipped', () => {
            expect(parseAndValidateCellRef('ZZZZZZ1')).toBeNull();
        });

        it('AAAA1 (4-letter column, beyond XFD) is skipped', () => {
            expect(parseAndValidateCellRef('AAAA1')).toBeNull();
        });

        it('XFE1 (one past last legal column) is skipped', () => {
            expect(parseAndValidateCellRef('XFE1')).toBeNull();
        });
    });

    describe('rejects refs that exceed Excel row limit', () => {
        it('A99999999999 (11-digit row) is skipped', () => {
            expect(parseAndValidateCellRef('A99999999999')).toBeNull();
        });

        it('A1048577 (one past last legal row) is skipped', () => {
            expect(parseAndValidateCellRef('A1048577')).toBeNull();
        });
    });

    describe('rejects malformed refs', () => {
        it('empty string is skipped', () => {
            expect(parseAndValidateCellRef('')).toBeNull();
        });

        it('null is skipped', () => {
            expect(parseAndValidateCellRef(null)).toBeNull();
        });

        it('undefined is skipped', () => {
            expect(parseAndValidateCellRef(undefined)).toBeNull();
        });

        it('1A (digit before letter) is skipped', () => {
            expect(parseAndValidateCellRef('1A')).toBeNull();
        });

        it('A0 (zero row not allowed by Excel) is skipped', () => {
            expect(parseAndValidateCellRef('A0')).toBeNull();
        });

        it('a1 (lowercase letter) is skipped', () => {
            expect(parseAndValidateCellRef('a1')).toBeNull();
        });

        it('A (no row) is skipped', () => {
            expect(parseAndValidateCellRef('A')).toBeNull();
        });

        it('1 (no column) is skipped', () => {
            expect(parseAndValidateCellRef('1')).toBeNull();
        });

        it('A1B (mixed trailing chars) is skipped', () => {
            expect(parseAndValidateCellRef('A1B')).toBeNull();
        });
    });
});

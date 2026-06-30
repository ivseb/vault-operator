/**
 * AUDIT-038 ISSUE-006 -- QueryBaseTool's view-block parser.
 *
 * The previous extractFilters() had `line !== lines[i]` as a guard for
 * "we hit the next view header" — but `line` came from `lines[i]`, so
 * the guard was tautologically false. The break never fired. For .base
 * files with multiple views the parser would either (a) collapse all
 * filters of every view onto the first targeted view, or (b) silently
 * miss the boundary entirely depending on indentation.
 *
 * These tests pin the right behaviour BEFORE the fix so regressions
 * are caught.
 */

import { describe, it, expect } from 'vitest';
import { extractFilters, extractOrder } from '../baseQueryParser';

const TWO_TABLE_VIEWS = `
views:
  - type: table
    name: a
    filters:
      and:
        - 'status = "open"'
        - 'priority = "high"'
  - type: table
    name: b
    filters:
      and:
        - 'status = "closed"'
        - 'priority = "low"'
`.trim();

const TABLE_THEN_CARDS = `
views:
  - type: table
    name: a
    filters:
      and:
        - 'status = "open"'
  - type: cards
    name: b
    filters:
      and:
        - 'status = "closed"'
`.trim();

const TWO_TABLES_WITH_ORDER = `
views:
  - type: table
    name: a
    order:
      - file.name
      - status
  - type: table
    name: b
    order:
      - priority
      - due
`.trim();

describe('extractFilters (AUDIT-038 ISSUE-006)', () => {
    it('reads only the requested view, not the next one', () => {
        const got = extractFilters(TWO_TABLE_VIEWS, 'a');
        expect(got).toEqual(['status = "open"', 'priority = "high"']);
    });

    it('reads view B independently when view B is requested', () => {
        const got = extractFilters(TWO_TABLE_VIEWS, 'b');
        expect(got).toEqual(['status = "closed"', 'priority = "low"']);
    });

    it('does NOT leak filters from the next view (the original bug)', () => {
        const got = extractFilters(TWO_TABLE_VIEWS, 'a');
        expect(got).not.toContain('status = "closed"');
        expect(got).not.toContain('priority = "low"');
    });

    it('also handles non-table view types as the next view boundary', () => {
        // Before the fix, the boundary check matched "- type: table" only,
        // so a following cards view would silently leak its filters into
        // the target table view.
        const got = extractFilters(TABLE_THEN_CARDS, 'a');
        expect(got).toEqual(['status = "open"']);
        expect(got).not.toContain('status = "closed"');
    });

    it('returns all filters when no viewName is given (current single-view behaviour)', () => {
        // Empty viewName means "first matching view". The bug regressed
        // even this case once a second view existed.
        const got = extractFilters(TABLE_THEN_CARDS, '');
        expect(got).toContain('status = "open"');
    });
});

describe('extractOrder (AUDIT-038 ISSUE-006 follow-up)', () => {
    it('reads only the requested view order, not the next one', () => {
        const got = extractOrder(TWO_TABLES_WITH_ORDER, 'a');
        expect(got).toEqual(['file.name', 'status']);
    });

    it('reads view B order independently', () => {
        const got = extractOrder(TWO_TABLES_WITH_ORDER, 'b');
        expect(got).toEqual(['priority', 'due']);
    });
});

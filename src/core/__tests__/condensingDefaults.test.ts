import { describe, it, expect } from 'vitest';
import {
    DEFAULT_CONDENSING_ENABLED,
    DEFAULT_CONDENSING_THRESHOLD,
    DEFAULT_ROLLING_SUMMARY_THRESHOLD,
    DEFAULT_MICROCOMPACTION_ENABLED,
} from '../condensingDefaults';
import { DEFAULT_SETTINGS } from '../../types/settings';

/**
 * FIX-COMPACT-03: unify condensing defaults across all spawn paths.
 *
 * Previously: settings.ts=80/true, AgentTaskRunner=70 (silent),
 * AgentSidebarView fallback=false (silent). Subagents inherited
 * different thresholds depending on the spawn path.
 *
 * Contract: every fallback uses the same exported constant. New
 * call sites picking up the same constant get the same behaviour
 * without copy-pasting magic numbers.
 */
describe('Unified condensing defaults (FIX-COMPACT-03)', () => {
    it('settings DEFAULT_SETTINGS.advancedApi matches the central constants', () => {
        expect(DEFAULT_SETTINGS.advancedApi.condensingEnabled).toBe(DEFAULT_CONDENSING_ENABLED);
        expect(DEFAULT_SETTINGS.advancedApi.condensingThreshold).toBe(DEFAULT_CONDENSING_THRESHOLD);
        expect(DEFAULT_SETTINGS.advancedApi.microcompactionEnabled).toBe(DEFAULT_MICROCOMPACTION_ENABLED);
        expect(DEFAULT_SETTINGS.advancedApi.rollingSummaryThreshold).toBe(DEFAULT_ROLLING_SUMMARY_THRESHOLD);
    });

    it('defaults are sensible (enabled, 80 percent threshold, rolling at 50 percent)', () => {
        // Pin the values explicitly so a future change to either side
        // surfaces here instead of drifting silently.
        expect(DEFAULT_CONDENSING_ENABLED).toBe(true);
        expect(DEFAULT_CONDENSING_THRESHOLD).toBe(80);
        expect(DEFAULT_MICROCOMPACTION_ENABLED).toBe(true);
        expect(DEFAULT_ROLLING_SUMMARY_THRESHOLD).toBe(50);
    });

    it('rolling threshold sits strictly below full-condense threshold', () => {
        expect(DEFAULT_ROLLING_SUMMARY_THRESHOLD).toBeLessThan(DEFAULT_CONDENSING_THRESHOLD);
    });
});

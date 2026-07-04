/**
 * FIX-COMPACT-03: single source of truth for condensing defaults.
 *
 * Three call sites previously held independent literals:
 *   - DEFAULT_SETTINGS.advancedApi   (settings.ts)
 *   - AgentTaskRunner option fallbacks
 *   - AgentSidebarView spawn-time `??` fallbacks
 *
 * The values drifted (Runner used 70, Sidebar fell back to false), so
 * subagents inherited different compacting behaviour depending on the
 * spawn path. Exporting one constant per setting forces every caller
 * through the same default and a future tuning change updates them all
 * atomically.
 */

export const DEFAULT_CONDENSING_ENABLED = true;
export const DEFAULT_CONDENSING_THRESHOLD = 80;
export const DEFAULT_MICROCOMPACTION_ENABLED = true;
export const DEFAULT_ROLLING_SUMMARY_THRESHOLD = 50;

/**
 * FIX-COMPACT-09: microcompact economy guard. A prune rewrites history before
 * the stable cache breakpoint and forces a full prompt-cache prefix re-write
 * (observed: ~260 tokens freed vs 30k+ tokens cacheCreate). Below the pressure
 * floor, only prune when at least this many tokens are freed in one batch.
 */
export const MICROCOMPACT_MIN_FREED_TOKENS = 3000;
export const MICROCOMPACT_PRESSURE_FLOOR = 0.60;

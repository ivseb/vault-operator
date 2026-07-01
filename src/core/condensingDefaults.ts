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

/**
 * Per-conversation reasoning-effort override for the chat model picker.
 *
 * The chat-header picker lets a user pick a reasoning-effort level for the
 * current conversation. The control is revealed only when the thinking toggle
 * is On and the active model is effort-capable. The default is 'auto', which
 * sends no effort field at all, so untouched conversations are byte-identical
 * to before.
 *
 * This module owns only the pure decision logic so it stays unit-testable and
 * free of any Obsidian import.
 */

import type { EffortLevel } from '../../types/model-registry';
import type { ThinkingOverride } from './thinkingOverride';

/**
 * Per-conversation reasoning-effort override. 'auto' sends no effort field
 * (vendor default, byte-identical to today); every other value is a native
 * level for the active model family:
 *  - Claude: low, medium, high, xhigh, max
 *  - GPT-5 / o-series: minimal, low, medium, high
 */
export type EffortOverride = 'auto' | EffortLevel;

/** The default override: auto, i.e. no effort field is sent. */
export const DEFAULT_EFFORT_OVERRIDE: EffortOverride = 'auto';

/**
 * Whether the override is an explicit level (i.e. it should be applied to the
 * built model and a native effort field should be sent). 'auto' sends nothing.
 */
export function isExplicitEffortOverride(override: EffortOverride): boolean {
    return override !== 'auto';
}

/**
 * Resolve the effective reasoning-effort level for a conversation.
 *
 * 'auto' returns undefined, meaning "no override" so the provider layer sends
 * no effort field. Every other value returns the level verbatim.
 */
export function resolveEffectiveEffort(override: EffortOverride): EffortLevel | undefined {
    return override === 'auto' ? undefined : override;
}

/** What the picker should render for the reasoning-effort control. */
export type EffortControlVisibility = 'control' | 'none';

/**
 * Decide what the chat picker renders for reasoning effort.
 *  - 'control': the thinking toggle is On AND the active model/provider can
 *               send a native effort field
 *  - 'none'   : thinking is Off (effort would be inert), or the model cannot
 *               send effort (e.g. a local or Gemini model); render nothing
 *
 * Hiding the control when thinking is Off replaces the old within-pin coherence
 * collapse: a contradictory Thinking=Off + Effort=High pair can no longer be
 * expressed, so no runtime coherence rule is needed.
 */
export function effortControlVisibility(
    thinkingOn: boolean,
    effortCapable: boolean,
): EffortControlVisibility {
    return thinkingOn && effortCapable ? 'control' : 'none';
}

/**
 * Whether the binary thinking switch reads as On. The picker keeps the
 * tri-state ThinkingOverride internally for default preservation: only an
 * explicit 'off' reads as Off, both 'follow' (the byte-identical default) and
 * 'on' read as On. The switch sets an explicit 'on' or 'off' on click.
 */
export function thinkingSwitchIsOn(override: ThinkingOverride): boolean {
    return override !== 'off';
}

/** The ordered effort slider stops: 'auto' (leftmost, sends nothing) then the
 * model-native levels. With no native levels the slider has only 'auto', which
 * is why the caller hides the whole row in that case. */
export function effortStops(levels: EffortLevel[]): EffortOverride[] {
    return ['auto', ...levels];
}

/**
 * Map an effort override to its slider index within the given stops. An
 * override the stops do not contain (e.g. a stale level after the model
 * changed) clamps to 0 ('auto'), so the knob never lands off the track.
 */
export function effortIndexForOverride(stops: EffortOverride[], override: EffortOverride): number {
    const idx = stops.indexOf(override);
    return idx < 0 ? 0 : idx;
}

/**
 * Map a slider index back to its effort override, clamped into range so an
 * out-of-bounds index resolves to 'auto' rather than undefined.
 */
export function effortStopForIndex(stops: EffortOverride[], index: number): EffortOverride {
    if (!Number.isFinite(index)) return 'auto';
    const clamped = Math.min(Math.max(Math.trunc(index), 0), stops.length - 1);
    return stops[clamped] ?? 'auto';
}

/** A resolved (model id, provider type) pair the effort control reasons about. */
export interface EffortModelRef {
    modelId: string;
    providerType: string;
}

/**
 * Resolve the model the effort control should reason about.
 *
 * Effort now threads on every model-resolution path, so the control reflects
 * whatever model the turn actually runs on: the pinned chat-header model when
 * one is pinned (the router is off in that case), otherwise the default-active
 * model the main loop uses. Returns null when neither resolves, so the caller
 * renders no effort control.
 */
export function resolveEffectiveModelForEffort(
    pinned: EffortModelRef | null,
    defaultActive: EffortModelRef | null,
): EffortModelRef | null {
    return pinned ?? defaultActive;
}

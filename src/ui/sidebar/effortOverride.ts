/**
 * Per-conversation reasoning-effort override for the chat model picker.
 *
 * The chat-header picker lets a user pick a reasoning-effort level for the
 * current conversation, but only when a model has been pinned (router off).
 * The default is 'auto', which sends no effort field at all, so untouched
 * conversations are byte-identical to before.
 *
 * This module owns only the pure decision logic so it stays unit-testable and
 * free of any Obsidian import.
 */

import type { ThinkingOverride } from './thinkingOverride';

/**
 * Per-conversation reasoning-effort override.
 *  - 'auto'  : send no effort field (vendor default, byte-identical to today)
 *  - 'low'   : request low reasoning effort
 *  - 'medium': request medium reasoning effort
 *  - 'high'  : request high reasoning effort
 */
export type EffortOverride = 'auto' | 'low' | 'medium' | 'high';

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
export function resolveEffectiveEffort(
    override: EffortOverride,
): 'low' | 'medium' | 'high' | undefined {
    switch (override) {
        case 'low':
            return 'low';
        case 'medium':
            return 'medium';
        case 'high':
            return 'high';
        case 'auto':
        default:
            return undefined;
    }
}

/**
 * The coherent per-conversation override pair, after the effort-wins rule.
 *  - effort           : the explicit effort level, or undefined for auto
 *  - thinking         : the thinking override to actually apply
 *  - effortIsExplicit : whether a native effort field should be sent
 */
export interface ConversationOverrides {
    effort: 'low' | 'medium' | 'high' | undefined;
    thinking: ThinkingOverride;
    effortIsExplicit: boolean;
}

/**
 * Resolve the coherent effort + thinking pair for a conversation.
 *
 * Within-pin coherence: when an explicit effort level is set, the explicit
 * thinking on/off override must NOT also be applied. On Claude the effort dial
 * drives reasoning depth, so Thinking=Off plus Effort=High is contradictory.
 * Effort wins: any explicit thinking override is collapsed to 'follow' so the
 * model's own thinkingEnabled is kept and only the effort field is sent.
 *
 * When effort is 'auto' the thinking override passes through untouched, so the
 * existing thinking-only behavior is preserved byte-for-byte.
 */
export function resolveConversationOverrides(
    thinkingOverride: ThinkingOverride,
    effortOverride: EffortOverride,
): ConversationOverrides {
    const effortIsExplicit = isExplicitEffortOverride(effortOverride);
    return {
        effort: resolveEffectiveEffort(effortOverride),
        thinking: effortIsExplicit ? 'follow' : thinkingOverride,
        effortIsExplicit,
    };
}

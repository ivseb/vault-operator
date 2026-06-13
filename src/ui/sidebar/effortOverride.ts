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

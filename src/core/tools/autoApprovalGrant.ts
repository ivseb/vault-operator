/**
 * autoApprovalGrant (FIX-44-03b)
 *
 * The pure state transition behind the sidebar "Always allow" button, extracted
 * so it can be tested without a DOM. Granting a category from an approval card
 * must never silently re-arm OTHER categories that a past permissive session
 * left true and that the (currently off) master toggle was masking.
 */

import { AUTO_APPROVAL_CATEGORY_KEYS } from './toolEffects';

/**
 * Grant persistent auto-approval for a single category flag.
 *
 * When the master toggle is already on, the flag is simply added -- existing
 * grants are preserved. When the master is off, flipping it on would otherwise
 * reactivate every dormant flag at once, so all category flags are cleared first
 * and only `permKey` is set. The net effect: "from now on auto-approve THIS, and
 * only this".
 *
 * Mutates `cfg` in place (caller persists with a single saveSettings()).
 */
export function grantAutoApproval(cfg: Record<string, unknown>, permKey: string): void {
    if (cfg.enabled !== true) {
        for (const k of AUTO_APPROVAL_CATEGORY_KEYS) cfg[k] = false;
        cfg.enabled = true;
    }
    cfg[permKey] = true;
}

/** The three grant scopes a card can arm beyond a one-shot Allow. */
export type ApprovalGrantScope = 'run' | 'session' | 'standing';

/**
 * FIX-44-03b follow-up (adversarial review 2026-07-14): which scope grants
 * need an explicit destructive confirm before they are armed.
 *
 * Sandbox auto-approval means arbitrary agent-authored code writes the vault
 * without further prompts. The standing grant (settings toggle, "Always
 * allow") already requires a confirm on both surfaces; the session grant
 * lives until the plugin reloads -- days, in practice -- and is functionally
 * close to the standing grant, so it gets the same friction. The run grant
 * dies with the task and stays one click.
 */
export function scopeGrantNeedsConfirm(
    permKey: string | null,
    scope: ApprovalGrantScope,
): boolean {
    return permKey === 'sandbox' && scope !== 'run';
}

/**
 * FEAT-44-07 (kill switch, part a): what the plugin instance must offer so the
 * reset can revoke every approval scope. Structural (not the concrete plugin
 * class) so the transition stays testable without a DOM or an Obsidian app.
 */
export interface ApprovalKillSwitchHost {
    // `object`, not Record: the concrete AutoApprovalConfig interface has no
    // index signature, and the transition only Object.assigns into it.
    settings: { autoApproval: object };
    /** FEAT-44-02a session grants; cleared by the reset. */
    sessionApprovedGrants?: Set<string>;
    /** Bumped so per-task pipelines void their run grants lazily. */
    approvalRevocationEpoch?: number;
}

/**
 * One-click return to the fail-closed default (FEAT-44-07 part a):
 *
 * 1. apply the restrictive preset (master off, every category off) -- the
 *    preset is passed in by the caller (PRESETS.restrictive) to keep this
 *    module free of the UpdateSettingsTool dependency,
 * 2. clear all session-scope grants,
 * 3. bump the revocation epoch so every pipeline's run-scope grants are
 *    voided on its next approval check.
 *
 * Mutates the host in place; the caller persists settings and re-renders.
 * paranoidMode is deliberately NOT touched: turning the brake off is never
 * a side effect of pressing another brake.
 */
export function resetToDefaultDeny(
    host: ApprovalKillSwitchHost,
    restrictivePreset: Record<string, boolean>,
): void {
    Object.assign(host.settings.autoApproval, restrictivePreset);
    host.sessionApprovedGrants?.clear();
    host.approvalRevocationEpoch = (host.approvalRevocationEpoch ?? 0) + 1;
}

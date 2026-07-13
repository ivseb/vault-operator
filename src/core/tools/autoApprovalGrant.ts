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

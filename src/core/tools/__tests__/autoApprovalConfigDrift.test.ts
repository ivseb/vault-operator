/**
 * EPIC-44 drift contract: the auto-approval settings surface must stay in lockstep
 * with the effect registry that actually gates tool calls.
 *
 * This is the structural guard that stops the whole class of bug the 2026-07-13
 * audit found: a settings flag the gate never reads (a dead toggle that lies
 * about the security posture), or a policy that points at a config key that does
 * not exist (a silently-undefined -> always-ask, or worse). If someone adds a new
 * category, this test forces them to wire ALL of: the config key, the default,
 * the policy, and every preset -- or explain the exception here.
 */

import { describe, it, expect } from 'vitest';
import { EFFECT_POLICY, AUTO_APPROVAL_CATEGORY_KEYS } from '../toolEffects';
import { PRESETS } from '../agent/UpdateSettingsTool';
import { DEFAULT_SETTINGS } from '../../../types/settings';

// Keys that legitimately live on AutoApprovalConfig without gating anything:
// the master toggle, and deprecated keys kept optional ONLY so a one-time
// migration can read and drop a stored value (FIX-44-34 / FIX-44-35).
const NON_GATING_KEYS = new Set<string>([
    'enabled',
    'read', 'showMenuInChat', 'mode', 'question', 'todo', 'write',
]);

const gatingKeys = new Set(AUTO_APPROVAL_CATEGORY_KEYS);
const defaultKeys = Object.keys(DEFAULT_SETTINGS.autoApproval);

describe('AutoApprovalConfig <-> EFFECT_POLICY drift contract', () => {
    it('every default autoApproval key gates something or is explicitly non-gating', () => {
        const orphans = defaultKeys.filter(
            (k) => !gatingKeys.has(k) && !NON_GATING_KEYS.has(k),
        );
        expect(orphans, 'default keys with no policy and not whitelisted as non-gating').toEqual([]);
    });

    it('every EFFECT_POLICY key resolves to a real default config key', () => {
        const policyKeys = Object.values(EFFECT_POLICY)
            .map((p) => p.key)
            .filter((k): k is NonNullable<typeof k> => k !== null)
            .map((k) => k as string);
        const missing = policyKeys.filter((k) => !(k in DEFAULT_SETTINGS.autoApproval));
        expect(missing, 'policy keys that point at a non-existent config key').toEqual([]);
    });

    it('every gating key has a default value (no undefined-at-runtime for fresh installs)', () => {
        const missing = [...gatingKeys].filter((k) => !(k in DEFAULT_SETTINGS.autoApproval));
        expect(missing, 'gating keys missing from DEFAULT_SETTINGS.autoApproval').toEqual([]);
    });

    it('no dead key leaked back into the defaults', () => {
        const dead = ['read', 'showMenuInChat', 'mode', 'question', 'todo', 'write'];
        const present = dead.filter((k) => k in DEFAULT_SETTINGS.autoApproval);
        expect(present, 'dead keys must not be in DEFAULT_SETTINGS').toEqual([]);
    });

    it('every preset sets every gating key (FIX-44-25: no key can be silently omitted)', () => {
        for (const [name, preset] of Object.entries(PRESETS)) {
            const presetKeys = new Set(Object.keys(preset));
            const missing = [...gatingKeys].filter((k) => !presetKeys.has(k));
            expect(missing, `preset "${name}" omits gating keys`).toEqual([]);
        }
    });

    it('no preset sets a dead or non-existent key', () => {
        for (const [name, preset] of Object.entries(PRESETS)) {
            const bad = Object.keys(preset).filter(
                (k) => k !== 'enabled' && !gatingKeys.has(k),
            );
            expect(bad, `preset "${name}" sets keys that gate nothing`).toEqual([]);
        }
    });
});

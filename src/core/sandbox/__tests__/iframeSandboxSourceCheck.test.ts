/**
 * AUDIT-038 ISSUE-005 -- iframe postMessage source check.
 *
 * Pins the invariant for both the init handler (`sandbox-ready`) and
 * the steady-state handler so a future refactor cannot regress to
 * accepting messages from foreign sources.
 */

import { describe, it, expect } from 'vitest';
import { isFromOwnSandboxFrame } from '../iframeSandboxSourceCheck';

describe('isFromOwnSandboxFrame (AUDIT-038 ISSUE-005)', () => {
    it('accepts when the event source matches the expected iframe contentWindow', () => {
        const fakeContentWindow = { kind: 'mySandboxWindow' };
        const event = { source: fakeContentWindow };
        expect(isFromOwnSandboxFrame(event, fakeContentWindow)).toBe(true);
    });

    it('rejects when the event source is a different window', () => {
        const ours = { kind: 'mySandboxWindow' };
        const otherWindow = { kind: 'someOtherPluginWindow' };
        expect(isFromOwnSandboxFrame({ source: otherWindow }, ours)).toBe(false);
    });

    it('rejects when the event source is null', () => {
        const ours = { kind: 'mySandboxWindow' };
        expect(isFromOwnSandboxFrame({ source: null }, ours)).toBe(false);
    });

    it('rejects every message before the iframe exists (expected source null/undefined)', () => {
        const anySource = { kind: 'anything' };
        expect(isFromOwnSandboxFrame({ source: anySource }, null)).toBe(false);
        expect(isFromOwnSandboxFrame({ source: anySource }, undefined)).toBe(false);
    });

    it('rejects a forged sandbox-ready handshake from a sibling plugin', () => {
        // Reproduces the AUDIT-038 ISSUE-005 attack: another plugin in the
        // same renderer posts {type:'sandbox-ready'} from its own window
        // before our iframe has loaded. handleMessage already blocks this;
        // ensureReady must too.
        const ourFrame = { kind: 'vault-operator-iframe' };
        const attackerFrame = { kind: 'other-plugin' };
        const spoofed = { source: attackerFrame, data: { type: 'sandbox-ready' } };
        expect(isFromOwnSandboxFrame(spoofed, ourFrame)).toBe(false);
    });
});

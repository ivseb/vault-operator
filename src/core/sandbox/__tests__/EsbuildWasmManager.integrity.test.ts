/**
 * AUDIT 2026-07-14 (Codex) M-8: the sandbox package loader resolved model-chosen
 * npm packages via `latest` and TOFU-trusted the first download, then silently
 * re-trusted a NEW version's hash on the next `latest` shift. A compromised
 * freshly published version was accepted on first sight. These tests pin the
 * hardened behaviour: pin on first use, reject a silent version upgrade, reject
 * tampered content at the pinned version.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EsbuildWasmManager } from '../EsbuildWasmManager';
import type ObsidianAgentPlugin from '../../../main';

type ManifestEntry = { hash: string; version?: string; pinnedAt: string };

interface Internals {
    hashManifest: Record<string, ManifestEntry>;
    hashManifestLoaded: boolean;
    saveHashManifest: () => Promise<void>;
    verifyPackageIntegrity: (key: string, content: string, version?: string | null) => Promise<void>;
}

function makeManager() {
    const plugin = {} as unknown as ObsidianAgentPlugin;
    const mgr = new EsbuildWasmManager(plugin, '/tmp/does-not-matter');
    const internals = mgr as unknown as Internals;
    internals.hashManifestLoaded = true; // skip disk load
    internals.hashManifest = {};
    internals.saveHashManifest = vi.fn(async () => { /* no disk in test */ });
    return { mgr, internals };
}

describe('EsbuildWasmManager.verifyPackageIntegrity (M-8)', () => {
    let mgr: EsbuildWasmManager;
    let internals: Internals;

    beforeEach(() => {
        ({ mgr, internals } = makeManager());
    });

    it('pins hash + version on first use', async () => {
        await internals.verifyPackageIntegrity('left-pad', 'module.exports = 1', '1.3.0');
        expect(internals.hashManifest['left-pad'].version).toBe('1.3.0');
        expect(internals.hashManifest['left-pad'].hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('accepts an identical re-download of the pinned version', async () => {
        await internals.verifyPackageIntegrity('left-pad', 'SAME', '1.3.0');
        await expect(internals.verifyPackageIntegrity('left-pad', 'SAME', '1.3.0')).resolves.toBeUndefined();
    });

    it('rejects a silent version upgrade instead of re-trusting it', async () => {
        await internals.verifyPackageIntegrity('left-pad', 'v1 code', '1.3.0');
        // A shifted `latest` presents a new version + new content.
        await expect(
            internals.verifyPackageIntegrity('left-pad', 'v2 malicious code', '1.4.0'),
        ).rejects.toThrow(/auto-upgrade|pinned/i);
        // The original pin is untouched.
        expect(internals.hashManifest['left-pad'].version).toBe('1.3.0');
    });

    it('rejects tampered content at the pinned version', async () => {
        await internals.verifyPackageIntegrity('left-pad', 'original', '1.3.0');
        await expect(
            internals.verifyPackageIntegrity('left-pad', 'tampered', '1.3.0'),
        ).rejects.toThrow(/integrity check failed/i);
    });
});

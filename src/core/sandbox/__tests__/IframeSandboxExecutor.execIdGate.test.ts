/**
 * AUDIT 2026-07-14 (Codex) M-5 + review: the iframe message handler only serves
 * a bridge request while its issuing execution is live. A missing execId (a
 * hand-crafted parent.postMessage from untrusted sandbox code) or a stale execId
 * (delayed code running after execute() resolved) must be rejected.
 */

import { describe, it, expect } from 'vitest';
import { IframeSandboxExecutor } from '../IframeSandboxExecutor';
import type ObsidianAgentPlugin from '../../../main';

interface Internals {
    pending: Map<string, unknown>;
    isLiveBridgeRequest(execId: string | undefined): boolean;
}

function makeExecutor() {
    const plugin = { app: { vault: { configDir: '.obsidian' } }, settings: {} } as unknown as ObsidianAgentPlugin;
    const exec = new IframeSandboxExecutor(plugin);
    return exec as unknown as Internals;
}

describe('IframeSandboxExecutor.isLiveBridgeRequest (M-5)', () => {
    it('accepts a request whose execId is an active execution', () => {
        const exec = makeExecutor();
        exec.pending.set('exec-1', {});
        expect(exec.isLiveBridgeRequest('exec-1')).toBe(true);
    });

    it('rejects a request with a stale execId (execution already finished)', () => {
        const exec = makeExecutor();
        // pending is empty -> exec-1 is no longer active.
        expect(exec.isLiveBridgeRequest('exec-1')).toBe(false);
    });

    it('rejects a request with a MISSING execId (fail closed)', () => {
        const exec = makeExecutor();
        exec.pending.set('exec-1', {});
        expect(exec.isLiveBridgeRequest(undefined)).toBe(false);
    });
});

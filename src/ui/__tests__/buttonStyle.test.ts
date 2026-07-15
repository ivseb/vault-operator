import { describe, it, expect, vi } from 'vitest';
import { applyDestructiveStyle } from '../buttonStyle';

/**
 * The review bot fails the build on `obsidianmd/no-unsupported-api` when
 * `ButtonComponent.setDestructive()` is called against a manifest whose
 * minAppVersion predates 1.13. We keep the destructive look by feature-
 * detecting at runtime instead: newer Obsidian gets setDestructive, older
 * Obsidian gets the legacy setWarning, and neither is referenced statically.
 */
describe('applyDestructiveStyle', () => {
    it('uses setDestructive when the running Obsidian exposes it (1.13+)', () => {
        const setDestructive = vi.fn();
        const setWarning = vi.fn();

        applyDestructiveStyle({ setDestructive, setWarning });

        expect(setDestructive).toHaveBeenCalledOnce();
        expect(setWarning).not.toHaveBeenCalled();
    });

    it('falls back to setWarning on Obsidian below 1.13', () => {
        const setWarning = vi.fn();

        applyDestructiveStyle({ setWarning });

        expect(setWarning).toHaveBeenCalledOnce();
    });

    it('is a no-op when neither method exists, rather than throwing', () => {
        expect(() => applyDestructiveStyle({})).not.toThrow();
    });
});

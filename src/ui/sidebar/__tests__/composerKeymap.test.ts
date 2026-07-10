import { describe, it, expect } from 'vitest';
import { shouldSendOnEnter, type ComposerKeyState } from '../composerKeymap';

/**
 * Issue #54.1: Ctrl/Cmd+Enter must reliably send on both chat surfaces,
 * regardless of the sendWithEnter setting; plain Enter sends only when the
 * setting is on; Shift+Enter and IME composition never send.
 */

function key(partial: Partial<ComposerKeyState>): ComposerKeyState {
    return {
        key: 'Enter',
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        isComposing: false,
        ...partial,
    };
}

describe('shouldSendOnEnter', () => {
    it('sends on plain Enter when sendWithEnter is on', () => {
        expect(shouldSendOnEnter(key({}), true)).toBe(true);
    });

    it('does NOT send on plain Enter when sendWithEnter is off', () => {
        expect(shouldSendOnEnter(key({}), false)).toBe(false);
    });

    it('sends on Ctrl+Enter when sendWithEnter is off (Windows accelerator)', () => {
        expect(shouldSendOnEnter(key({ ctrlKey: true }), false)).toBe(true);
    });

    it('sends on Cmd+Enter when sendWithEnter is off (macOS accelerator)', () => {
        expect(shouldSendOnEnter(key({ metaKey: true }), false)).toBe(true);
    });

    it('sends on Ctrl+Enter even when sendWithEnter is on (universal accelerator)', () => {
        expect(shouldSendOnEnter(key({ ctrlKey: true }), true)).toBe(true);
    });

    it('never sends on Shift+Enter (newline), even with a modifier', () => {
        expect(shouldSendOnEnter(key({ shiftKey: true }), true)).toBe(false);
        expect(shouldSendOnEnter(key({ shiftKey: true, ctrlKey: true }), false)).toBe(false);
    });

    it('never sends while IME composition is active', () => {
        expect(shouldSendOnEnter(key({ isComposing: true }), true)).toBe(false);
        expect(shouldSendOnEnter(key({ isComposing: true, ctrlKey: true }), false)).toBe(false);
    });

    it('ignores non-Enter keys', () => {
        expect(shouldSendOnEnter(key({ key: 'a', ctrlKey: true }), true)).toBe(false);
        expect(shouldSendOnEnter(key({ key: 'Tab' }), true)).toBe(false);
    });
});

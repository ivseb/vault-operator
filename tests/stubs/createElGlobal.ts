/**
 * createEl global shim for node-env DOM-stub tests.
 *
 * The prefer-create-el refactor (commit 283f0180) switched the inline chat,
 * edit-review and picker UI from `containerEl.ownerDocument.createElement(tag)`
 * to Obsidian's GLOBAL `createEl(tag)`. Obsidian injects that global at runtime;
 * the vitest node environment does not, so the refactored code throws
 * `ReferenceError: createEl is not defined` under test.
 *
 * These tests each hand-roll their own fake document. Point the global helper at
 * that document's factory, so `createEl(tag)` returns the very fake node the
 * assertions inspect -- byte-for-byte the node `ownerDocument.createElement(tag)`
 * used to return. Test-only, lives under tests/ so the Review-Bot never scans it,
 * never bundled into main.js.
 *
 * Usage: call installCreateEl(doc) at the end of the test's beforeEach (once the
 * fake document exists) and clearCreateEl() in an afterEach so nothing leaks into
 * a test file that does not opt in.
 */

interface CreateElHost {
    createElement: (tag: string) => unknown;
}

export function installCreateEl(doc: CreateElHost): void {
    (globalThis as { createEl?: unknown }).createEl = (tag: string) => doc.createElement(tag);
}

export function clearCreateEl(): void {
    delete (globalThis as { createEl?: unknown }).createEl;
}

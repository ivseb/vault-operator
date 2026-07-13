/**
 * Minimal stub for the `obsidian` module — only covers what test files import.
 * Most production imports of `obsidian` are `import type`, so nothing runs at
 * test time. Exception: `normalizePath`, used by VaultDataFileAdapter.
 */
export class Vault {}
export class App {}
export class Plugin {}
export class TFile {}
export class TFolder {}

/** Notice constructor stub — production code does `new Notice(msg)`. */
export class Notice { constructor(_msg?: string, _timeout?: number) { /* no-op */ } }

/**
 * Mirrors Obsidian's getLanguage(): ISO code of the configured app language.
 * Tests that need a different locale mock the module or use the i18n test hook.
 */
export function getLanguage(): string {
    return 'en';
}

/** Ambient `requestUrl` stub so modules that import it at the top level load. */
export function requestUrl(_opts: unknown): Promise<unknown> {
    throw new Error('requestUrl stub called -- wire a mock in the test.');
}

/**
 * Mirrors Obsidian's normalizePath: collapses backslashes to forward slashes,
 * removes duplicate slashes, and trims leading/trailing slashes. The real
 * implementation also handles `..` and `.` segments; this stub keeps it simple
 * because the tests don't exercise those.
 */
export function normalizePath(p: string): string {
    return p
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/')
        .replace(/^\/+|\/+$/g, '');
}

/**
 * FIX-44-09: the frontmatter guard parses the resulting YAML block to decide
 * whether an edit would break the note. Obsidian exports parseYaml at runtime;
 * in tests we back it with the `yaml` package that is already on disk.
 */
export function parseYaml(yaml: string): unknown {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- test stub only, never bundled
    const { parse } = require('yaml') as { parse: (s: string) => unknown };
    return parse(yaml);
}

/**
 * FEAT-44-10: update_frontmatter resolves its result via parseYaml/stringifyYaml
 * so that the approval diff and the write come from the same code. Obsidian
 * exports both at runtime; in tests we back them with the `yaml` package.
 */
export function stringifyYaml(obj: unknown): string {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- test stub only, never bundled
    const { stringify } = require('yaml') as { stringify: (o: unknown) => string };
    return stringify(obj);
}

/**
 * Minimal Modal stub. FIX-44-14 needs to assert that closing the approval gate
 * with Esc / the X resolves its promise (it used to hang the agent loop), and
 * that requires driving the Obsidian Modal lifecycle in a test.
 */
export class Modal {
    app: unknown;
    contentEl: {
        empty: () => void;
        createDiv: () => unknown;
        appendChild: (n: unknown) => void;
        ownerDocument: unknown;
    };
    modalEl: { addClass: (c: string) => void };
    private closed = false;

    constructor(app: unknown) {
        this.app = app;
        this.contentEl = {
            empty: () => { /* no-op */ },
            createDiv: () => ({}),
            appendChild: () => { /* no-op */ },
            ownerDocument: globalThis.document,
        };
        this.modalEl = { addClass: () => { /* no-op */ } };
    }

    open(): void { this.onOpen(); }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.onClose();
    }

    onOpen(): void { /* subclass */ }
    onClose(): void { /* subclass */ }
}

export function setIcon(_el: unknown, _name: string): void { /* no-op */ }

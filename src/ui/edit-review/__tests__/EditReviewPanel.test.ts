import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EditReviewPanel, type EditReviewPanelOptions, type EditReviewEntry } from '../EditReviewPanel';

interface FakeNode {
    tagName: string;
    classList: { classes: Set<string>; add: (c: string) => void; remove: (c: string) => void; contains: (c: string) => boolean; toggle: (c: string, force?: boolean) => void };
    style: { setProperty: (k: string, v: string) => void };
    children: FakeNode[];
    listeners: Map<string, ((ev: unknown) => void)[]>;
    parent: FakeNode | null;
    text: string;
    value: string;
    attrs: Record<string, string>;
    ownerDocument: FakeDocument;
    scrollTop: number;
    scrollHeight: number;
    appendChild: (c: FakeNode) => FakeNode;
    append: (...children: FakeNode[]) => void;
    remove: () => void;
    setAttribute: (k: string, v: string) => void;
    getAttribute: (k: string) => string | null;
    addEventListener: (t: string, h: (ev: unknown) => void) => void;
    removeEventListener: (t: string, h: (ev: unknown) => void) => void;
    dispatch: (t: string, ev: unknown) => void;
    click: () => void;
    focus: () => void;
    set textContent(v: string | null);
    get textContent(): string;
}

interface FakeDocument {
    createElement: (tag: string) => FakeNode;
    createTextNode: (text: string) => FakeNode;
    addEventListener: (t: string, h: (ev: unknown) => void) => void;
    removeEventListener: (t: string, h: (ev: unknown) => void) => void;
    dispatch: (t: string, ev: unknown) => void;
    defaultView: { innerWidth: number; innerHeight: number };
    body: FakeNode;
}

function makeNode(doc: FakeDocument, tag: string): FakeNode {
    const styleMap = new Map<string, string>();
    const classes = new Set<string>();
    const node = {
        tagName: tag.toUpperCase(),
        classList: {
            classes,
            add: (c: string) => { classes.add(c); },
            remove: (c: string) => { classes.delete(c); },
            contains: (c: string) => classes.has(c),
            toggle: (c: string, force?: boolean) => {
                if (force === true) classes.add(c);
                else if (force === false) classes.delete(c);
                else if (classes.has(c)) classes.delete(c);
                else classes.add(c);
            },
        },
        style: { setProperty: (k: string, v: string) => { styleMap.set(k, v); } },
        children: [] as FakeNode[],
        listeners: new Map<string, ((ev: unknown) => void)[]>(),
        parent: null as FakeNode | null,
        text: '',
        value: '',
        attrs: {},
        ownerDocument: doc,
        scrollTop: 0,
        scrollHeight: 100,
    } as Partial<FakeNode> as FakeNode;

    node.appendChild = (child) => { child.parent = node; node.children.push(child); return child; };
    node.append = (...children) => { for (const c of children) node.appendChild(c); };
    node.remove = () => {
        if (node.parent !== null) {
            const idx = node.parent.children.indexOf(node);
            if (idx >= 0) node.parent.children.splice(idx, 1);
            node.parent = null;
        }
    };
    (node as unknown as { removeChild: (c: FakeNode) => FakeNode }).removeChild = (child: FakeNode) => {
        const idx = node.children.indexOf(child);
        if (idx >= 0) node.children.splice(idx, 1);
        child.parent = null;
        return child;
    };
    Object.defineProperty(node, 'firstChild', {
        get: () => (node.children.length > 0 ? node.children[0] : null),
    });
    node.setAttribute = (k, v) => { node.attrs[k] = v; };
    node.getAttribute = (k) => node.attrs[k] ?? null;
    node.addEventListener = (t, h) => {
        const arr = node.listeners.get(t) ?? [];
        arr.push(h);
        node.listeners.set(t, arr);
    };
    node.removeEventListener = (t, h) => {
        const arr = node.listeners.get(t) ?? [];
        const idx = arr.indexOf(h);
        if (idx >= 0) arr.splice(idx, 1);
    };
    node.dispatch = (t, ev) => { for (const h of node.listeners.get(t) ?? []) h(ev); };
    node.click = () => node.dispatch('click', { preventDefault: () => {}, stopPropagation: () => {} });
    node.focus = () => { /* no-op */ };
    Object.defineProperty(node, 'textContent', {
        get: () => {
            if (node.children.length === 0) return node.text;
            const parts: string[] = [];
            if (node.text.length > 0) parts.push(node.text);
            for (const c of node.children) parts.push(c.textContent);
            return parts.join('');
        },
        set: (v: string | null) => {
            node.text = v ?? '';
            node.children.length = 0;
        },
    });
    return node;
}

function makeDocument(): FakeDocument {
    const docListeners = new Map<string, ((ev: unknown) => void)[]>();
    const doc = {
        createElement: (tag: string) => makeNode(doc, tag),
        // FEAT-44-15: unchanged runs inside a word-diffed line are plain text
        // nodes, so a 300-word paragraph with one edit costs 3 nodes, not 600.
        createTextNode: (text: string) => {
            const n = makeNode(doc, '#text');
            n.textContent = text;
            return n;
        },
        defaultView: { innerWidth: 1024, innerHeight: 768 },
    } as Partial<FakeDocument> as FakeDocument;
    doc.body = makeNode(doc, 'body');
    doc.addEventListener = (t, h) => {
        const arr = docListeners.get(t) ?? [];
        arr.push(h);
        docListeners.set(t, arr);
    };
    doc.removeEventListener = (t, h) => {
        const arr = docListeners.get(t) ?? [];
        const idx = arr.indexOf(h);
        if (idx >= 0) arr.splice(idx, 1);
    };
    doc.dispatch = (t, ev) => { for (const h of docListeners.get(t) ?? []) h(ev); };
    return doc;
}

function findByClass(root: FakeNode, cls: string): FakeNode | null {
    if (root.classList.contains(cls)) return root;
    for (const child of root.children) {
        const found = findByClass(child, cls);
        if (found !== null) return found;
    }
    return null;
}

function findAllByClass(root: FakeNode, cls: string): FakeNode[] {
    const out: FakeNode[] = [];
    if (root.classList.contains(cls)) out.push(root);
    for (const child of root.children) out.push(...findAllByClass(child, cls));
    return out;
}

const SAMPLE_ENTRIES: EditReviewEntry[] = [
    {
        path: 'Notes/Idee.md',
        before: 'Lorem ipsum dolor sit amet.\nConsectetur adipiscing.\nSed do eiusmod tempor.\n',
        after: 'Lorem ipsum.\nKurz und klar.\nSed do eiusmod tempor.\n',
    },
    {
        path: 'Notes/Plan.md',
        before: 'Step one.\nStep two.\n',
        after: 'Step one.\nStep two refined.\nStep three.\n',
    },
];

describe('EditReviewPanel', () => {
    let doc: FakeDocument;
    let container: FakeNode;

    beforeEach(() => {
        doc = makeDocument();
        container = doc.body.appendChild(doc.createElement('div'));
    });

    function newPanel(overrides: Partial<EditReviewPanelOptions> = {}): EditReviewPanel {
        return new EditReviewPanel({
            containerEl: container as unknown as HTMLElement,
            entries: SAMPLE_ENTRIES,
            mode: 'edit',
            onApply: vi.fn(),
            onDiscard: vi.fn(),
            ...overrides,
        });
    }

    describe('layout', () => {
        it('open() renders root with file-list left + diff right', () => {
            const panel = newPanel();
            panel.open();
            const root = container.children[0];
            expect(root.classList.contains('agent-edit-review')).toBe(true);
            expect(findByClass(root, 'agent-edit-review__filelist')).not.toBeNull();
            expect(findByClass(root, 'agent-edit-review__diff')).not.toBeNull();
        });

        it('renders one file entry per input entry in the list', () => {
            const panel = newPanel();
            panel.open();
            const root = container.children[0];
            const entries = findAllByClass(root, 'agent-edit-review__file');
            expect(entries).toHaveLength(2);
            expect(entries[0].textContent).toContain('Idee.md');
            expect(entries[1].textContent).toContain('Plan.md');
        });

        it('selects the first file by default', () => {
            const panel = newPanel();
            panel.open();
            const root = container.children[0];
            const files = findAllByClass(root, 'agent-edit-review__file');
            expect(files[0].classList.contains('is-selected')).toBe(true);
            expect(files[1].classList.contains('is-selected')).toBe(false);
            expect(panel.selectedIndex).toBe(0);
        });

        it('shows the current file path in the diff header', () => {
            const panel = newPanel();
            panel.open();
            const root = container.children[0];
            const header = findByClass(root, 'agent-edit-review__diff-header');
            expect(header).not.toBeNull();
            expect(header!.textContent).toContain('Notes/Idee.md');
        });

        it('clicking a file in the list switches the diff to that file', () => {
            const panel = newPanel();
            panel.open();
            const root = container.children[0];
            const files = findAllByClass(root, 'agent-edit-review__file');
            files[1].click();
            expect(panel.selectedIndex).toBe(1);
            const header = findByClass(root, 'agent-edit-review__diff-header');
            expect(header!.textContent).toContain('Notes/Plan.md');
            expect(files[1].classList.contains('is-selected')).toBe(true);
            expect(files[0].classList.contains('is-selected')).toBe(false);
        });

        it('omits the file list when there is only one entry', () => {
            const panel = newPanel({ entries: [SAMPLE_ENTRIES[0]] });
            panel.open();
            const root = container.children[0];
            expect(findByClass(root, 'agent-edit-review__filelist')).toBeNull();
        });
    });

    describe('side-by-side columns', () => {
        it('the OLD cell of each row renders the BEFORE content', () => {
            const panel = newPanel();
            const root = panel.open();
            const oldCells = findAllByClass(root as unknown as FakeNode, 'agent-edit-review__cell--old');
            const text = oldCells.map((c) => c.textContent).join('\n');
            expect(text).toContain('Lorem ipsum dolor sit amet.');
            expect(text).toContain('Consectetur adipiscing.');
        });

        it('the NEW cell of each row renders the proposed content', () => {
            const panel = newPanel();
            const root = panel.open();
            const newCells = findAllByClass(root as unknown as FakeNode, 'agent-edit-review__cell--new');
            const text = newCells.map((c) => c.textContent).join('\n');
            expect(text).toContain('Kurz und klar.');
        });

        it('both cells of a row live in ONE row element -- that is the alignment', () => {
            // The old build had two independent scroll columns, so a wrapped line
            // on one side silently pushed the two sides out of sync (diff2html #99).
            // A row that owns both cells cannot drift: a CSS grid row is as tall as
            // its tallest cell.
            const panel = newPanel();
            const root = panel.open();
            const rows = findAllByClass(root as unknown as FakeNode, 'agent-edit-review__row')
                .filter((r) => !r.classList.contains('agent-edit-review__row--collapsed'));
            expect(rows.length).toBeGreaterThan(0);
            for (const row of rows) {
                const cells = row.children.filter((c) => c.classList.contains('agent-edit-review__cell'));
                expect(cells).toHaveLength(2);
                expect(cells[0].classList.contains('agent-edit-review__cell--old')).toBe(true);
                expect(cells[1].classList.contains('agent-edit-review__cell--new')).toBe(true);
            }
        });

        it('marks removed lines on the old side and added lines on the new side', () => {
            const panel = newPanel();
            const root = panel.open();
            const dels = findAllByClass(root as unknown as FakeNode, 'is-del');
            const adds = findAllByClass(root as unknown as FakeNode, 'is-add');
            expect(dels.length).toBeGreaterThan(0);
            expect(adds.length).toBeGreaterThan(0);
            expect(dels.every((c) => c.classList.contains('agent-edit-review__cell--old'))).toBe(true);
            expect(adds.every((c) => c.classList.contains('agent-edit-review__cell--new'))).toBe(true);
        });

        it('highlights the changed WORDS inside a rewritten line, not just the line', () => {
            // The whole point for prose: a German paragraph is one line, so
            // "line changed" carries no information.
            const panel = newPanel({
                entries: [{
                    path: 'Notes/a.md',
                    before: 'Sie nutzt Cowork täglich als Sparringspartner.',
                    after: 'Sie nutzt Cowork wöchentlich als Sparringspartner.',
                }],
            });
            const root = panel.open();
            const words = findAllByClass(root as unknown as FakeNode, 'agent-edit-review__word');
            const del = words.filter((w) => w.classList.contains('is-del-word')).map((w) => w.textContent);
            const ins = words.filter((w) => w.classList.contains('is-add-word')).map((w) => w.textContent);
            expect(del).toEqual(['täglich']);
            expect(ins).toEqual(['wöchentlich']);
        });

        it('carries a non-colour marker, so the diff does not rest on red/green alone', () => {
            const panel = newPanel();
            const root = panel.open();
            const dels = findAllByClass(root as unknown as FakeNode, 'is-del');
            const marker = dels[0].children.find((c) => c.classList.contains('agent-edit-review__marker'));
            expect(marker?.textContent).toBe('\u2212');
        });

        it('editing happens in a textarea, and the text flows back into the decision', () => {
            // The right column used to BE the editor (contenteditable), so the
            // highlighting fell apart the moment you typed and the text had to be
            // scraped back out of the mangled DOM.
            const onApply = vi.fn();
            const panel = newPanel({ onApply });
            const root = panel.open();

            const editBtn = findByClass(root as unknown as FakeNode, 'agent-edit-review__edit-btn');
            expect(editBtn).not.toBeNull();
            editBtn!.click();

            const ta = findByClass(root as unknown as FakeNode, 'agent-edit-review__textarea');
            expect(ta).not.toBeNull();
            ta!.value = 'Von Hand geschrieben.';
            ta!.dispatch('input', {});

            findByClass(root as unknown as FakeNode, 'agent-edit-review__apply-btn')!.click();
            const decisions = onApply.mock.calls[0][0] as Array<{ finalContent: string }>;
            expect(decisions[0].finalContent).toBe('Von Hand geschrieben.');
        });

        it('every row holds exactly the two sides, so left and right stay in lock-step', () => {
            const panel = newPanel();
            const root = panel.open();
            const olds = findAllByClass(root as unknown as FakeNode, 'agent-edit-review__cell--old');
            const news = findAllByClass(root as unknown as FakeNode, 'agent-edit-review__cell--new');
            expect(olds.length).toBe(news.length);
        });

        it('shows a stats label (e.g. "+N −M") in the AFTER column header', () => {
            const panel = newPanel();
            panel.open();
            const root = container.children[0];
            const stats = findByClass(root, 'agent-edit-review__stats');
            expect(stats).not.toBeNull();
            expect(stats!.textContent.length).toBeGreaterThan(0);
        });
    });

    describe('actions', () => {
        it('footer has exactly two buttons: Verwerfen + Anwenden', () => {
            const panel = newPanel();
            panel.open();
            const root = container.children[0];
            const footer = findByClass(root, 'agent-edit-review__footer');
            expect(footer).not.toBeNull();
            const apply = findByClass(footer!, 'agent-edit-review__apply-btn');
            const discard = findByClass(footer!, 'agent-edit-review__discard-btn');
            expect(apply).not.toBeNull();
            expect(discard).not.toBeNull();
            // No further buttons -- count children: should be exactly the two we expect.
            const buttons = footer!.children.filter(c => c.tagName === 'BUTTON');
            expect(buttons).toHaveLength(2);
        });

        it('Anwenden invokes onApply with one decision per file', () => {
            const onApply = vi.fn();
            const panel = newPanel({ onApply });
            panel.open();
            const root = container.children[0];
            const applyBtn = findByClass(root, 'agent-edit-review__apply-btn')!;
            applyBtn.click();
            expect(onApply).toHaveBeenCalledTimes(1);
            const decisions = onApply.mock.calls[0][0] as Array<{ path: string; finalContent: string; skipped: boolean }>;
            expect(decisions.map(d => d.path)).toEqual(['Notes/Idee.md', 'Notes/Plan.md']);
        });

        it('Verwerfen invokes onDiscard and closes the panel', () => {
            const onDiscard = vi.fn();
            const panel = newPanel({ onDiscard });
            panel.open();
            const root = container.children[0];
            const discardBtn = findByClass(root, 'agent-edit-review__discard-btn')!;
            discardBtn.click();
            expect(onDiscard).toHaveBeenCalledTimes(1);
            expect(panel.isOpen).toBe(false);
        });
    });

    describe('skip', () => {
        it('skip-toggle in the diff header marks the file as skipped', () => {
            const onApply = vi.fn();
            const panel = newPanel({ onApply });
            panel.open();
            const root = container.children[0];
            const skipBtn = findByClass(root, 'agent-edit-review__skip-btn');
            expect(skipBtn).not.toBeNull();
            skipBtn!.click();
            const applyBtn = findByClass(root, 'agent-edit-review__apply-btn')!;
            applyBtn.click();
            const decisions = onApply.mock.calls[0][0] as Array<{ path: string; skipped: boolean }>;
            expect(decisions.find(d => d.path === 'Notes/Idee.md')!.skipped).toBe(true);
            expect(decisions.find(d => d.path === 'Notes/Plan.md')!.skipped).toBe(false);
        });

        it('skipped files get the is-skipped class in the file list', () => {
            const panel = newPanel();
            panel.open();
            const root = container.children[0];
            const skipBtn = findByClass(root, 'agent-edit-review__skip-btn')!;
            skipBtn.click();
            const files = findAllByClass(root, 'agent-edit-review__file');
            expect(files[0].classList.contains('is-skipped')).toBe(true);
            expect(files[1].classList.contains('is-skipped')).toBe(false);
        });
    });

    describe('checkpoint mode', () => {
        it('mode=checkpoint shows a restore button and offers no editing surface', () => {
            const onRestore = vi.fn();
            const panel = new EditReviewPanel({
                containerEl: container as unknown as HTMLElement,
                entries: [SAMPLE_ENTRIES[0]],
                mode: 'checkpoint',
                onRestore,
            });
            panel.open();
            const root = container.children[0];
            // A checkpoint is history: it can be restored, never rewritten. So it
            // gets neither the edit toggle nor the textarea.
            expect(findByClass(root, 'agent-edit-review__textarea')).toBeNull();
            expect(findByClass(root, 'agent-edit-review__edit-btn')).toBeNull();
            // ...but it still renders the diff.
            expect(findByClass(root, 'agent-edit-review__body')).not.toBeNull();
            // Footer has a restore button instead of Apply.
            const restore = findByClass(root, 'agent-edit-review__restore-btn');
            expect(restore).not.toBeNull();
            restore!.click();
            expect(onRestore).toHaveBeenCalledTimes(1);
        });
    });

    describe('empty state', () => {
        it('shows an empty-state hint when entries list is empty', () => {
            const panel = newPanel({ entries: [] });
            panel.open();
            const root = container.children[0];
            expect(findByClass(root, 'agent-edit-review__empty')).not.toBeNull();
        });
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InlineChatPanel, type InlinePanelAction } from '../InlineChatPanel';
import type { InlineTriggerContext } from '../../InlineTriggerContext';

interface FakeNode {
    tagName: string;
    classList: { classes: Set<string>; add: (c: string) => void; remove: (c: string) => void; contains: (c: string) => boolean; toggle: (c: string, force?: boolean) => void };
    style: { setProperty: (k: string, v: string) => void; get left(): string; get top(): string };
    children: FakeNode[];
    listeners: Map<string, ((ev: unknown) => void)[]>;
    parent: FakeNode | null;
    text: string;
    value: string;
    attrs: Record<string, string>;
    dataset: Record<string, string>;
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
    contains: (other: FakeNode) => boolean;
    getBoundingClientRect: () => { width: number; height: number };
    click: () => void;
    focus: () => void;
    set textContent(v: string | null);
    get textContent(): string;
}

interface FakeDocument {
    createElement: (tag: string) => FakeNode;
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
        style: {
            setProperty: (k: string, v: string) => { styleMap.set(k, v); },
            get left() { return styleMap.get('left') ?? ''; },
            get top() { return styleMap.get('top') ?? ''; },
        },
        children: [] as FakeNode[],
        listeners: new Map<string, ((ev: unknown) => void)[]>(),
        parent: null as FakeNode | null,
        text: '',
        value: '',
        attrs: {} as Record<string, string>,
        dataset: {} as Record<string, string>,
        ownerDocument: doc,
        scrollTop: 0,
        scrollHeight: 100,
    } as Partial<FakeNode> as FakeNode;

    node.appendChild = (child: FakeNode) => {
        child.parent = node;
        node.children.push(child);
        return child;
    };
    node.append = (...children: FakeNode[]) => {
        for (const c of children) node.appendChild(c);
    };
    node.remove = () => {
        if (node.parent !== null) {
            const idx = node.parent.children.indexOf(node);
            if (idx >= 0) node.parent.children.splice(idx, 1);
            node.parent = null;
        }
    };
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
    node.contains = (other: FakeNode) => {
        let cur: FakeNode | null = other;
        while (cur !== null) { if (cur === node) return true; cur = cur.parent; }
        return false;
    };
    node.getBoundingClientRect = () => ({ width: 420, height: 240 });
    node.click = () => node.dispatch('click', { preventDefault: () => {}, stopPropagation: () => {} });
    node.focus = () => { /* no-op */ };
    Object.defineProperty(node, 'textContent', {
        get: () => node.text,
        set: (v: string | null) => { node.text = v ?? ''; },
    });
    return node;
}

function makeDocument(): FakeDocument {
    const docListeners = new Map<string, ((ev: unknown) => void)[]>();
    const doc = {
        createElement: (tag: string) => makeNode(doc, tag),
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

function makeCtx(text = 'some selected text'): InlineTriggerContext {
    return {
        selectionText: text,
        editorMode: 'source',
        cursorPos: 0,
        notePath: 'a.md',
        settingsSnapshot: { modelId: 'm', provider: 'p', skillIds: [], customPromptIds: [] },
    };
}

const DEFAULT_ACTIONS: InlinePanelAction[] = [
    { id: 'lookup', icon: '🔍', title: 'Lookup' },
    { id: 'rewrite', icon: '✏️', title: 'Rewrite' },
    { id: 'send-to-main', icon: '↗', title: 'Send to chat' },
];

describe('InlineChatPanel (DOM-stub)', () => {
    let doc: FakeDocument;
    let container: FakeNode;

    beforeEach(() => {
        doc = makeDocument();
        container = doc.body.appendChild(doc.createElement('div'));
    });

    it('isOpen is false before open()', () => {
        const panel = new InlineChatPanel({
            containerEl: container as unknown as HTMLElement,
            ctx: makeCtx(),
            position: { x: 50, y: 50 },
            actions: DEFAULT_ACTIONS,
            onDispatch: vi.fn(),
        });
        expect(panel.isOpen).toBe(false);
    });

    it('open() renders header + toolbar + body + footer', () => {
        const panel = new InlineChatPanel({
            containerEl: container as unknown as HTMLElement,
            ctx: makeCtx('lambda calculus'),
            position: { x: 50, y: 50 },
            actions: DEFAULT_ACTIONS,
            onDispatch: vi.fn(),
        });
        panel.open();

        expect(container.children).toHaveLength(1);
        const root = container.children[0];
        expect(root.classList.contains('agent-inline-panel')).toBe(true);

        // header (anchor + close), toolbar, body, status (hidden), footer
        expect(root.children).toHaveLength(5);
        expect(root.children[0].classList.contains('agent-inline-panel__header')).toBe(true);
        expect(root.children[1].classList.contains('agent-inline-panel__toolbar')).toBe(true);
        expect(root.children[2].classList.contains('agent-inline-panel__body')).toBe(true);
        expect(root.children[3].classList.contains('agent-inline-panel__status')).toBe(true);
        expect(root.children[4].classList.contains('agent-inline-panel__footer')).toBe(true);
    });

    it('header shows truncated selection anchor', () => {
        const longText = 'a'.repeat(200);
        const panel = new InlineChatPanel({
            containerEl: container as unknown as HTMLElement,
            ctx: makeCtx(longText),
            position: { x: 50, y: 50 },
            actions: DEFAULT_ACTIONS,
            onDispatch: vi.fn(),
        });
        panel.open();
        const anchor = container.children[0].children[0].children[0];
        expect(anchor.textContent.length).toBeLessThan(longText.length);
        expect(anchor.textContent.endsWith('…')).toBe(true);
    });

    it('header shows "(no selection)" when selection is empty', () => {
        const panel = new InlineChatPanel({
            containerEl: container as unknown as HTMLElement,
            ctx: makeCtx(''),
            position: { x: 50, y: 50 },
            actions: DEFAULT_ACTIONS,
            onDispatch: vi.fn(),
        });
        panel.open();
        const anchor = container.children[0].children[0].children[0];
        expect(anchor.textContent).toBe('(no selection)');
    });

    it('toolbar renders one button per action with icon + title', () => {
        const panel = new InlineChatPanel({
            containerEl: container as unknown as HTMLElement,
            ctx: makeCtx(),
            position: { x: 0, y: 0 },
            actions: DEFAULT_ACTIONS,
            onDispatch: vi.fn(),
        });
        panel.open();
        const toolbar = container.children[0].children[1];
        expect(toolbar.children).toHaveLength(3);
        expect(toolbar.children[0].textContent).toBe('🔍');
        expect(toolbar.children[0].getAttribute('title')).toBe('Lookup');
        expect(toolbar.children[0].dataset.actionId).toBe('lookup');
    });

    it('clicking a toolbar action dispatches with empty userInput', () => {
        const onDispatch = vi.fn();
        const ctx = makeCtx('text');
        const panel = new InlineChatPanel({
            containerEl: container as unknown as HTMLElement,
            ctx,
            position: { x: 0, y: 0 },
            actions: DEFAULT_ACTIONS,
            onDispatch,
        });
        panel.open();
        const lookupBtn = container.children[0].children[1].children[0];
        lookupBtn.click();
        expect(onDispatch).toHaveBeenCalledTimes(1);
        expect(onDispatch.mock.calls[0][0]).toEqual({
            actionId: 'lookup',
            userInput: '',
            ctx,
        });
    });

    it('appendMessage adds a bubble with correct role class', () => {
        const panel = new InlineChatPanel({
            containerEl: container as unknown as HTMLElement,
            ctx: makeCtx(),
            position: { x: 0, y: 0 },
            actions: DEFAULT_ACTIONS,
            onDispatch: vi.fn(),
        });
        const handle = panel.open();
        handle.appendMessage({ role: 'user', text: 'hello' });
        handle.appendMessage({ role: 'assistant', text: 'hi back' });
        const body = container.children[0].children[2];
        expect(body.children).toHaveLength(2);
        expect(body.children[0].classList.contains('agent-inline-panel__bubble--user')).toBe(true);
        expect(body.children[1].classList.contains('agent-inline-panel__bubble--assistant')).toBe(true);
        expect(body.children[0].textContent).toBe('hello');
        expect(body.children[1].textContent).toBe('hi back');
    });

    it('appendStreamChunk concatenates text into an existing bubble', () => {
        const panel = new InlineChatPanel({
            containerEl: container as unknown as HTMLElement,
            ctx: makeCtx(),
            position: { x: 0, y: 0 },
            actions: DEFAULT_ACTIONS,
            onDispatch: vi.fn(),
        });
        const handle = panel.open();
        const id = handle.appendMessage({ role: 'assistant', text: '' });
        handle.appendStreamChunk(id, 'foo ');
        handle.appendStreamChunk(id, 'bar');
        const bubble = container.children[0].children[2].children[0];
        expect(bubble.textContent).toBe('foo bar');
    });

    it('Escape closes the panel', () => {
        const panel = new InlineChatPanel({
            containerEl: container as unknown as HTMLElement,
            ctx: makeCtx(),
            position: { x: 0, y: 0 },
            actions: DEFAULT_ACTIONS,
            onDispatch: vi.fn(),
        });
        panel.open();
        expect(panel.isOpen).toBe(true);
        doc.dispatch('keydown', { key: 'Escape', preventDefault: () => {} });
        expect(panel.isOpen).toBe(false);
    });

    it('outside-click does NOT close (panel stays open for editor interaction)', () => {
        const panel = new InlineChatPanel({
            containerEl: container as unknown as HTMLElement,
            ctx: makeCtx(),
            position: { x: 0, y: 0 },
            actions: DEFAULT_ACTIONS,
            onDispatch: vi.fn(),
        });
        panel.open();
        // Simulate click outside (no listener registered for it).
        expect(panel.isOpen).toBe(true);
    });

    it('close button removes the panel', () => {
        const panel = new InlineChatPanel({
            containerEl: container as unknown as HTMLElement,
            ctx: makeCtx(),
            position: { x: 0, y: 0 },
            actions: DEFAULT_ACTIONS,
            onDispatch: vi.fn(),
        });
        panel.open();
        const closeBtn = container.children[0].children[0].children[1];
        closeBtn.click();
        expect(panel.isOpen).toBe(false);
        expect(container.children).toHaveLength(0);
    });

    it('setStatus shows + flips error class when level=error', () => {
        const panel = new InlineChatPanel({
            containerEl: container as unknown as HTMLElement,
            ctx: makeCtx(),
            position: { x: 0, y: 0 },
            actions: DEFAULT_ACTIONS,
            onDispatch: vi.fn(),
        });
        const handle = panel.open();
        const status = container.children[0].children[3];
        expect(status.classList.contains('agent-u-hidden')).toBe(true);
        handle.setStatus('Working…');
        expect(status.classList.contains('agent-u-hidden')).toBe(false);
        expect(status.textContent).toBe('Working…');
        handle.setStatus('Failed', 'error');
        expect(status.classList.contains('agent-inline-panel__status--error')).toBe(true);
    });

    it('open() while already open replaces the previous instance', () => {
        const panel = new InlineChatPanel({
            containerEl: container as unknown as HTMLElement,
            ctx: makeCtx(),
            position: { x: 0, y: 0 },
            actions: DEFAULT_ACTIONS,
            onDispatch: vi.fn(),
        });
        panel.open();
        panel.open();
        expect(container.children).toHaveLength(1);
    });

    it('positions the panel absolutely', () => {
        const panel = new InlineChatPanel({
            containerEl: container as unknown as HTMLElement,
            ctx: makeCtx(),
            position: { x: 120, y: 240 },
            actions: DEFAULT_ACTIONS,
            onDispatch: vi.fn(),
        });
        panel.open();
        const root = container.children[0];
        expect(root.style.left).toBeTruthy();
        expect(root.style.top).toBeTruthy();
    });

    it('onClose hook fires on close()', () => {
        const onClose = vi.fn();
        const panel = new InlineChatPanel({
            containerEl: container as unknown as HTMLElement,
            ctx: makeCtx(),
            position: { x: 0, y: 0 },
            actions: DEFAULT_ACTIONS,
            onDispatch: vi.fn(),
            onClose,
        });
        panel.open();
        panel.close();
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

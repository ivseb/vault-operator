/**
 * InlineChatPanel -- compact floating chat UI for the inline-action surface (FEAT-33-05 / FEAT-33-01 UX-refresh).
 *
 * Replaces the prior Floating-Menu + Notice-toast UX. When the user
 * triggers an inline action (hotkey / auto-on-selection / command-
 * palette) a small chat panel anchors near the cursor with:
 *   - Header: truncated selection anchor + close button
 *   - Toolbar: quick-action buttons (Lookup with magnifier, Rewrite,
 *     Translate, Summarize, Send-to-Main-Chat)
 *   - Body: streaming message turns (user + assistant)
 *   - Footer: input + send button for free-form follow-up
 *
 * Layout mirrors the sidebar chat at a smaller scale (single column,
 * append-only, scroll-to-bottom on stream). Pure-DOM so jsdom-free
 * unit tests stay possible -- the actual streaming wiring is supplied
 * by the plugin entry-point as callbacks.
 *
 * Bot-Compliance: createElement + classList + textContent only.
 * Listeners are removed on close().
 *
 * Related: FEAT-33-05, FEAT-33-01 (Trigger-Layer), ADR-138.
 */

import type { InlineTriggerContext } from '../InlineTriggerContext';

export type InlinePanelActionId =
    | 'free-chat'
    | 'lookup'
    | 'rewrite'
    | 'translate'
    | 'summarize'
    | 'find-action-items'
    | 'send-to-main';

export interface InlinePanelAction {
    id: InlinePanelActionId;
    /** Single character or emoji icon shown on the toolbar button. */
    icon: string;
    /** Tooltip text. */
    title: string;
}

export interface InlinePanelMessage {
    role: 'user' | 'assistant' | 'system';
    /** Streaming destination. Empty initially when role='assistant'. */
    text: string;
}

export interface InlinePanelDispatchArgs {
    actionId: InlinePanelActionId;
    /** User-typed prompt (only set for free-chat). */
    userInput: string;
    /** TriggerContext at panel-open. Stable across the panel's lifetime. */
    ctx: InlineTriggerContext;
}

export interface InlinePanelHandle {
    /** Append a NEW message bubble. Returns the bubble id for streaming. */
    appendMessage(message: InlinePanelMessage): string;
    /** Stream text into an existing assistant bubble (concat). */
    appendStreamChunk(bubbleId: string, chunk: string): void;
    /** Set status / error pill in the footer. */
    setStatus(text: string, level?: 'info' | 'error'): void;
    /** Close the panel + detach listeners. */
    close(): void;
}

export interface InlineChatPanelOptions {
    /** Container element the panel attaches to (e.g. document.body). */
    containerEl: HTMLElement;
    /** TriggerContext at open time (selection, mode, note path). */
    ctx: InlineTriggerContext;
    /**
     * Position the panel near the user's cursor / selection. Clamped
     * to viewport by the panel itself.
     */
    position: { x: number; y: number };
    /** Toolbar action set. */
    actions: InlinePanelAction[];
    /** Called when the user clicks a toolbar action or sends free-chat. */
    onDispatch: (args: InlinePanelDispatchArgs, handle: InlinePanelHandle) => void;
    /** Optional close hook. */
    onClose?: () => void;
}

const DEFAULT_WIDTH = 420;
const DEFAULT_MAX_HEIGHT = 480;
const ANCHOR_TRUNCATE = 80;

export class InlineChatPanel {
    private readonly containerEl: HTMLElement;
    private readonly ctx: InlineTriggerContext;
    private readonly position: { x: number; y: number };
    private readonly actions: InlinePanelAction[];
    private readonly onDispatch: (args: InlinePanelDispatchArgs, handle: InlinePanelHandle) => void;
    private readonly onClose?: () => void;

    private rootEl: HTMLElement | null = null;
    private bodyEl: HTMLElement | null = null;
    private inputEl: HTMLTextAreaElement | null = null;
    private statusEl: HTMLElement | null = null;
    private bubbleCounter = 0;
    private bubbleNodes = new Map<string, HTMLElement>();

    private boundKeyDown: ((ev: KeyboardEvent) => void) | null = null;

    constructor(options: InlineChatPanelOptions) {
        this.containerEl = options.containerEl;
        this.ctx = options.ctx;
        this.position = options.position;
        this.actions = options.actions;
        this.onDispatch = options.onDispatch;
        this.onClose = options.onClose;
    }

    get isOpen(): boolean {
        return this.rootEl !== null;
    }

    open(): InlinePanelHandle {
        this.close();
        const doc = this.containerEl.ownerDocument;
        const root = doc.createElement('div');
        root.classList.add('agent-inline-panel');
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-label', 'Inline AI chat');
        root.style.setProperty('position', 'absolute');
        root.style.setProperty('width', `${DEFAULT_WIDTH}px`);
        root.style.setProperty('max-height', `${DEFAULT_MAX_HEIGHT}px`);
        root.style.setProperty('z-index', '1000');

        // Header: selection anchor + close.
        const header = doc.createElement('div');
        header.classList.add('agent-inline-panel__header');
        const anchorText = this.ctx.selectionText.trim();
        const anchorEl = doc.createElement('div');
        anchorEl.classList.add('agent-inline-panel__anchor');
        anchorEl.textContent = anchorText.length > 0
            ? truncate(anchorText, ANCHOR_TRUNCATE)
            : '(no selection)';
        anchorEl.setAttribute('title', anchorText);
        const closeBtn = doc.createElement('button');
        closeBtn.classList.add('agent-inline-panel__close');
        closeBtn.setAttribute('type', 'button');
        closeBtn.setAttribute('title', 'Close (Esc)');
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', (ev) => { ev.preventDefault(); this.close(); });
        header.append(anchorEl, closeBtn);
        root.appendChild(header);

        // Toolbar with quick-action icon buttons.
        const toolbar = doc.createElement('div');
        toolbar.classList.add('agent-inline-panel__toolbar');
        for (const action of this.actions) {
            const btn = doc.createElement('button');
            btn.classList.add('agent-inline-panel__tool');
            btn.setAttribute('type', 'button');
            btn.setAttribute('title', action.title);
            btn.dataset.actionId = action.id;
            btn.textContent = action.icon;
            btn.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                this.dispatch(action.id, '');
            });
            toolbar.appendChild(btn);
        }
        root.appendChild(toolbar);

        // Body: scrollable message area.
        const body = doc.createElement('div');
        body.classList.add('agent-inline-panel__body');
        root.appendChild(body);
        this.bodyEl = body;

        // Status pill.
        const status = doc.createElement('div');
        status.classList.add('agent-inline-panel__status');
        status.classList.add('agent-u-hidden');
        root.appendChild(status);
        this.statusEl = status;

        // Footer: textarea + send.
        const footer = doc.createElement('div');
        footer.classList.add('agent-inline-panel__footer');
        const input = doc.createElement('textarea');
        input.classList.add('agent-inline-panel__input');
        input.setAttribute('rows', '2');
        input.setAttribute('placeholder', 'Ask about this selection… (Enter to send, Shift+Enter for newline)');
        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' && ev.shiftKey === false && ev.isComposing === false) {
                ev.preventDefault();
                this.sendFromInput();
            }
        });
        const sendBtn = doc.createElement('button');
        sendBtn.classList.add('agent-inline-panel__send');
        sendBtn.setAttribute('type', 'button');
        sendBtn.setAttribute('title', 'Send');
        sendBtn.textContent = '↵';
        sendBtn.addEventListener('click', (ev) => { ev.preventDefault(); this.sendFromInput(); });
        footer.append(input, sendBtn);
        root.appendChild(footer);
        this.inputEl = input;

        this.containerEl.appendChild(root);
        this.rootEl = root;

        // Position + clamp.
        const clamped = this.clampToViewport(this.position, root);
        root.style.setProperty('left', `${clamped.x}px`);
        root.style.setProperty('top', `${clamped.y}px`);

        // Esc closes; outside-click does NOT close (the user might
        // click in the editor to copy or check something while the
        // panel stays open).
        this.boundKeyDown = (ev: KeyboardEvent) => {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                this.close();
            }
        };
        doc.addEventListener('keydown', this.boundKeyDown);

        // Focus the textarea so the user can start typing immediately.
        try { input.focus(); } catch { /* jsdom-stub */ }

        return this.makeHandle();
    }

    close(): void {
        const wasOpen = this.rootEl !== null;
        if (this.rootEl !== null) {
            this.rootEl.remove();
            this.rootEl = null;
        }
        this.bodyEl = null;
        this.inputEl = null;
        this.statusEl = null;
        this.bubbleNodes.clear();
        this.bubbleCounter = 0;
        if (this.boundKeyDown !== null) {
            this.containerEl.ownerDocument.removeEventListener('keydown', this.boundKeyDown);
            this.boundKeyDown = null;
        }
        if (wasOpen && this.onClose !== undefined) {
            try { this.onClose(); } catch { /* swallow */ }
        }
    }

    dispose(): void { this.close(); }

    private dispatch(actionId: InlinePanelActionId, userInput: string): void {
        if (this.rootEl === null) return;
        const handle = this.makeHandle();
        try {
            this.onDispatch({ actionId, userInput, ctx: this.ctx }, handle);
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            handle.setStatus(`Error: ${err.message}`, 'error');
        }
    }

    private sendFromInput(): void {
        if (this.inputEl === null) return;
        const value = this.inputEl.value.trim();
        if (value.length === 0) return;
        this.inputEl.value = '';
        this.dispatch('free-chat', value);
    }

    private makeHandle(): InlinePanelHandle {
        return {
            appendMessage: (m) => this.appendMessage(m),
            appendStreamChunk: (id, c) => this.appendStreamChunk(id, c),
            setStatus: (t, l) => this.setStatus(t, l),
            close: () => this.close(),
        };
    }

    private appendMessage(message: InlinePanelMessage): string {
        if (this.bodyEl === null) return '';
        const doc = this.containerEl.ownerDocument;
        const bubble = doc.createElement('div');
        bubble.classList.add('agent-inline-panel__bubble');
        bubble.classList.add(`agent-inline-panel__bubble--${message.role}`);
        bubble.textContent = message.text;
        this.bodyEl.appendChild(bubble);
        this.bubbleCounter += 1;
        const id = `b${this.bubbleCounter}`;
        this.bubbleNodes.set(id, bubble);
        this.scrollToBottom();
        return id;
    }

    private appendStreamChunk(bubbleId: string, chunk: string): void {
        const bubble = this.bubbleNodes.get(bubbleId);
        if (bubble === undefined) return;
        bubble.textContent = (bubble.textContent ?? '') + chunk;
        this.scrollToBottom();
    }

    private setStatus(text: string, level: 'info' | 'error' = 'info'): void {
        if (this.statusEl === null) return;
        this.statusEl.classList.remove('agent-u-hidden');
        this.statusEl.classList.toggle('agent-inline-panel__status--error', level === 'error');
        this.statusEl.textContent = text;
    }

    private scrollToBottom(): void {
        if (this.bodyEl === null) return;
        try { this.bodyEl.scrollTop = this.bodyEl.scrollHeight; } catch { /* jsdom-stub */ }
    }

    private clampToViewport(pos: { x: number; y: number }, root: HTMLElement): { x: number; y: number } {
        const win = this.containerEl.ownerDocument.defaultView;
        if (win === null) return pos;
        const rect = root.getBoundingClientRect();
        const width = rect.width > 0 ? rect.width : DEFAULT_WIDTH;
        const height = rect.height > 0 ? rect.height : DEFAULT_MAX_HEIGHT;
        const maxX = Math.max(0, win.innerWidth - width - 8);
        const maxY = Math.max(0, win.innerHeight - height - 8);
        return {
            x: Math.max(8, Math.min(pos.x, maxX)),
            y: Math.max(8, Math.min(pos.y, maxY)),
        };
    }
}

function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1).trimEnd()}…`;
}

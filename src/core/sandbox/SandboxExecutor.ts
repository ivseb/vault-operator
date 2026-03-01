/**
 * SandboxExecutor
 *
 * Plugin-side manager for the sandboxed iframe. Creates the iframe lazily,
 * sends code for execution via postMessage, and routes bridge requests
 * (vault access, URL requests) through SandboxBridge.
 *
 * The iframe uses sandbox="allow-scripts" which provides Chromium's
 * OS-level process isolation — the primary security boundary.
 *
 * Part of Self-Development Phase 3: Sandbox + Dynamic Modules.
 */

import type ObsidianAgentPlugin from '../../main';
import { SandboxBridge } from './SandboxBridge';
import { SANDBOX_HTML } from './sandboxHtml';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingExecution {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// SandboxExecutor
// ---------------------------------------------------------------------------

export class SandboxExecutor {
    private iframe: HTMLIFrameElement | null = null;
    private ready = false;
    private readyPromise: Promise<void> | null = null;
    private pending = new Map<string, PendingExecution>();
    private bridge: SandboxBridge;
    private messageHandler: ((event: MessageEvent) => void) | null = null;

    constructor(private plugin: ObsidianAgentPlugin) {
        this.bridge = new SandboxBridge(plugin);
    }

    /**
     * Lazy initialization — iframe is created only when first needed (~50ms).
     */
    async ensureReady(): Promise<void> {
        if (this.ready) return;
        if (!this.readyPromise) {
            this.readyPromise = this.initialize();
        }
        return this.readyPromise;
    }

    /**
     * Execute compiled JavaScript in the sandbox.
     * Returns the result from the module's execute() function.
     */
    async execute(compiledJs: string, input: Record<string, unknown>): Promise<unknown> {
        await this.ensureReady();
        const id = this.generateId();

        return new Promise<unknown>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error('Sandbox execution timeout (30s)'));
            }, 30000);

            this.pending.set(id, { resolve, reject, timeout });

            this.iframe?.contentWindow?.postMessage(
                { type: 'execute', id, code: compiledJs, input },
                '*'
            );
        });
    }

    /**
     * Clean up the iframe and pending executions.
     */
    destroy(): void {
        if (this.messageHandler) {
            window.removeEventListener('message', this.messageHandler);
            this.messageHandler = null;
        }
        this.iframe?.remove();
        this.iframe = null;
        this.ready = false;
        this.readyPromise = null;

        for (const p of this.pending.values()) {
            clearTimeout(p.timeout);
            p.reject(new Error('Sandbox destroyed'));
        }
        this.pending.clear();
    }

    // -----------------------------------------------------------------------
    // Private
    // -----------------------------------------------------------------------

    private async initialize(): Promise<void> {
        this.iframe = document.createElement('iframe');
        this.iframe.sandbox.add('allow-scripts');
        // Review-Bot: CSS class instead of inline style
        this.iframe.addClass('agent-sandbox-iframe');
        this.iframe.srcdoc = SANDBOX_HTML;
        document.body.appendChild(this.iframe);

        // Wait for 'sandbox-ready' message from the iframe
        await new Promise<void>((resolve) => {
            const handler = (e: MessageEvent) => {
                if (e.data?.type === 'sandbox-ready') {
                    window.removeEventListener('message', handler);
                    this.ready = true;
                    resolve();
                }
            };
            window.addEventListener('message', handler);
        });

        // Global message handler for all sandbox communication
        this.messageHandler = (e: MessageEvent) => {
            void this.handleMessage(e);
        };
        window.addEventListener('message', this.messageHandler);
    }

    private async handleMessage(event: MessageEvent): Promise<void> {
        const msg = event.data;
        if (!msg?.type) return;

        // Execution result/error
        if (msg.type === 'result' || msg.type === 'error') {
            const p = this.pending.get(msg.id);
            if (!p) return;
            clearTimeout(p.timeout);
            this.pending.delete(msg.id);
            if (msg.type === 'error') {
                p.reject(new Error(msg.message));
            } else {
                p.resolve(msg.value);
            }
            return;
        }

        // Bridge requests from the iframe
        if (!msg.callId) return;

        try {
            let result: unknown;
            if (msg.type === 'vault-read') {
                result = await this.bridge.vaultRead(msg.path);
            } else if (msg.type === 'vault-read-binary') {
                result = await this.bridge.vaultReadBinary(msg.path);
            } else if (msg.type === 'vault-list') {
                result = await this.bridge.vaultList(msg.path);
            } else if (msg.type === 'vault-write') {
                await this.bridge.vaultWrite(msg.path, msg.content);
                result = true;
            } else if (msg.type === 'vault-write-binary') {
                await this.bridge.vaultWriteBinary(msg.path, msg.content);
                result = true;
            } else if (msg.type === 'request-url') {
                result = await this.bridge.requestUrlBridge(msg.url, msg.options);
            } else {
                return;
            }

            this.iframe?.contentWindow?.postMessage(
                { callId: msg.callId, result },
                '*'
            );
        } catch (e) {
            this.iframe?.contentWindow?.postMessage(
                {
                    callId: msg.callId,
                    error: e instanceof Error ? e.message : String(e),
                },
                '*'
            );
        }
    }

    private generateId(): string {
        return 'sx_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }
}

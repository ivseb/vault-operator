/**
 * RelayClient -- WebSocket client connecting to the remote Obsilo Relay.
 *
 * Establishes an outbound WebSocket connection to the Cloudflare relay.
 * Receives MCP JSON-RPC requests forwarded by the relay, dispatches them
 * to handleToolCall(), and sends responses back.
 *
 * Features: auto-reconnect (exponential backoff), keepalive pings.
 *
 * ADR-055: Remote MCP Relay
 * FEATURE-1403: Remote Transport
 */

import type ObsidianAgentPlugin from '../main';
import { handleToolCall } from './tools/index';

export class RelayClient {
    private ws: WebSocket | null = null;
    private reconnectDelay = 1000;
    private maxReconnectDelay = 30000;
    private keepaliveTimer: number | null = null;
    private _connected = false;
    private _connecting = false;
    private shouldReconnect = true;
    private relayUrl = '';
    private token = '';

    constructor(private plugin: ObsidianAgentPlugin) {}

    get connected(): boolean { return this._connected; }
    get connecting(): boolean { return this._connecting; }

    async connect(relayUrl: string, token: string): Promise<void> {
        this.relayUrl = relayUrl;
        this.token = token;
        this.shouldReconnect = true;
        await this.doConnect();
    }

    disconnect(): void {
        this.shouldReconnect = false;
        this.stopKeepalive();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this._connected = false;
        this._connecting = false;
    }

    private async doConnect(): Promise<void> {
        if (this._connected || this._connecting) return;
        this._connecting = true;

        try {
            // Build WebSocket URL
            const wsUrl = this.relayUrl
                .replace(/^https:\/\//, 'wss://')
                .replace(/^http:\/\//, 'ws://')
                .replace(/\/$/, '') + '/ws';

            console.debug(`[RelayClient] Connecting to ${wsUrl}`);

            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.debug('[RelayClient] Connected to relay');
                this._connected = true;
                this._connecting = false;
                this.reconnectDelay = 1000; // reset backoff

                // Send auth token as first message
                this.ws?.send(JSON.stringify({ type: 'auth', token: this.token }));

                this.startKeepalive();
            };

            this.ws.onmessage = (event) => {
                void this.handleMessage(String(event.data));
            };

            this.ws.onclose = () => {
                console.debug('[RelayClient] Disconnected from relay');
                this._connected = false;
                this._connecting = false;
                this.stopKeepalive();
                if (this.shouldReconnect) {
                    this.scheduleReconnect();
                }
            };

            this.ws.onerror = (event) => {
                console.warn('[RelayClient] WebSocket error:', event);
            };
        } catch (e) {
            console.warn('[RelayClient] Connection failed:', e);
            this._connecting = false;
            if (this.shouldReconnect) {
                this.scheduleReconnect();
            }
        }
    }

    private scheduleReconnect(): void {
        console.debug(`[RelayClient] Reconnecting in ${this.reconnectDelay}ms`);
        setTimeout(() => {
            void this.doConnect();
        }, this.reconnectDelay);

        // Exponential backoff
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    }

    private async handleMessage(data: string): Promise<void> {
        try {
            const request = JSON.parse(data) as { jsonrpc: string; method: string; id?: number | string; params?: Record<string, unknown> };

            // Notification (no id) -- process but don't respond
            if (request.id === undefined || request.id === null) {
                return;
            }

            // Dispatch to the same handler as the local HTTP server
            const mcpBridge = this.plugin.mcpBridge as { handleJsonRpc?: (req: unknown) => Promise<unknown> };
            let result: unknown;

            if (request.method === 'initialize') {
                result = {
                    protocolVersion: '2025-03-26',
                    capabilities: { tools: {}, prompts: {}, resources: {} },
                    serverInfo: { name: 'Obsilo', version: '1.0.0' },
                };
            } else if (request.method === 'tools/list') {
                // Get tools from McpBridge
                const bridge = this.plugin.mcpBridge as unknown as { getToolsWithContext?: () => unknown[] };
                result = { tools: bridge?.getToolsWithContext?.() ?? [] };
            } else if (request.method === 'tools/call') {
                const params = request.params as { name: string; arguments?: Record<string, unknown> } | undefined;
                if (params?.name) {
                    const toolResult = await handleToolCall(this.plugin, params.name, params.arguments ?? {});
                    result = { content: toolResult.content, isError: toolResult.isError };
                } else {
                    result = { content: [{ type: 'text', text: 'Missing tool name' }], isError: true };
                }
            } else if (request.method === 'resources/list') {
                const bridge = this.plugin.mcpBridge as unknown as { buildResourceList?: () => unknown[] };
                result = { resources: bridge?.buildResourceList?.() ?? [] };
            } else {
                result = {};
            }

            // Send response back to relay
            this.ws?.send(JSON.stringify({
                jsonrpc: '2.0',
                id: request.id,
                result,
            }));
        } catch (e) {
            console.warn('[RelayClient] Error handling message:', e);
            // Try to send error response
            try {
                const parsed = JSON.parse(data) as { id?: unknown };
                if (parsed.id !== undefined) {
                    this.ws?.send(JSON.stringify({
                        jsonrpc: '2.0',
                        id: parsed.id,
                        error: { code: -32603, message: e instanceof Error ? e.message : 'Internal error' },
                    }));
                }
            } catch { /* give up */ }
        }
    }

    private startKeepalive(): void {
        this.stopKeepalive();
        this.keepaliveTimer = window.setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30000);
    }

    private stopKeepalive(): void {
        if (this.keepaliveTimer) {
            window.clearInterval(this.keepaliveTimer);
            this.keepaliveTimer = null;
        }
    }
}

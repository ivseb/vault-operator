/**
 * RelayClient -- HTTP long-polling client connecting to the remote Obsilo Relay.
 *
 * Uses Obsidian's requestUrl (not WebSocket) to communicate with the relay.
 * This works within Obsidian's renderer CSP which blocks WebSocket to external servers.
 *
 * Flow:
 * 1. Poll GET /poll?token=xxx (long-poll, 25s timeout)
 * 2. Receive pending MCP requests from AI assistants
 * 3. Process each request via handleToolCall()
 * 4. Send results back via POST /respond?token=xxx
 * 5. Repeat
 *
 * ADR-055: Remote MCP Relay
 * FEATURE-1403: Remote Transport
 */

import { requestUrl } from 'obsidian';
import type ObsidianAgentPlugin from '../main';
import { handleToolCall } from './tools/index';

export class RelayClient {
    private polling = false;
    private _connected = false;
    private _connecting = false;
    private shouldReconnect = true;
    private reconnectDelay = 1000;
    private maxReconnectDelay = 30000;
    private relayUrl = '';
    private token = '';

    constructor(private plugin: ObsidianAgentPlugin) {}

    get connected(): boolean { return this._connected; }
    get connecting(): boolean { return this._connecting; }

    async connect(relayUrl: string, token: string): Promise<void> {
        this.relayUrl = relayUrl.replace(/\/$/, '');
        this.token = token;
        this.shouldReconnect = true;
        this.reconnectDelay = 1000;
        this.startPolling();
    }

    disconnect(): void {
        this.shouldReconnect = false;
        this.polling = false;
        this._connected = false;
        this._connecting = false;
    }

    private startPolling(): void {
        if (this.polling) return;
        this.polling = true;
        this._connecting = true;
        void this.pollLoop();
    }

    private async pollLoop(): Promise<void> {
        while (this.polling && this.shouldReconnect) {
            try {
                if (!this._connected) {
                    console.warn('[RelayClient] Poll URL:', this.relayUrl, '| token length:', this.token.length, '| token prefix:', this.token.slice(0, 6));
                    // One-time diagnostic: check if token arrives correctly at worker
                    try {
                        const diagResp = await requestUrl({ url: `${this.relayUrl}/diag?token=${this.token}` });
                        console.warn('[RelayClient] Diag:', diagResp.text);
                    } catch (e) {
                        console.warn('[RelayClient] Diag failed:', e instanceof Error ? e.message : String(e));
                    }
                }
                const response = await requestUrl({
                    url: `${this.relayUrl}/poll?token=${this.token}`,
                });

                // First successful poll means we're connected
                if (!this._connected) {
                    this._connected = true;
                    this._connecting = false;
                    this.reconnectDelay = 1000;
                    console.debug('[RelayClient] Connected to relay (polling)');
                }

                const data = response.json as { requests?: string[] };
                if (data.requests && data.requests.length > 0) {
                    for (const reqBody of data.requests) {
                        void this.handleRequest(reqBody);
                    }
                }

                // Short-poll interval: wait 2s before next poll
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (e) {
                if (!this.shouldReconnect) break;

                this._connected = false;
                this._connecting = true;
                console.warn('[RelayClient] Poll failed, retrying in', this.reconnectDelay, 'ms:', e instanceof Error ? e.message : String(e));

                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, this.reconnectDelay));
                this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
            }
        }

        this.polling = false;
        this._connected = false;
        this._connecting = false;
    }

    private async handleRequest(reqBody: string): Promise<void> {
        try {
            const request = JSON.parse(reqBody) as { jsonrpc: string; method: string; id?: number | string; params?: Record<string, unknown> };

            // Notification (no id) -- process but don't respond
            if (request.id === undefined || request.id === null) {
                return;
            }

            let result: unknown;

            if (request.method === 'initialize') {
                result = {
                    protocolVersion: '2025-03-26',
                    capabilities: { tools: {}, prompts: {}, resources: {} },
                    serverInfo: { name: 'Obsilo', version: '1.0.0' },
                };
            } else if (request.method === 'tools/list') {
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
            const responseBody = { jsonrpc: '2.0', id: request.id, result };
            await requestUrl({
                url: `${this.relayUrl}/respond?token=${this.token}`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(responseBody),
            });
        } catch (e) {
            console.warn('[RelayClient] Error handling request:', e);
            // Try to send error response
            try {
                const parsed = JSON.parse(reqBody) as { id?: unknown };
                if (parsed.id !== undefined && parsed.id !== null) {
                    await requestUrl({
                        url: `${this.relayUrl}/respond?token=${this.token}`,
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            jsonrpc: '2.0',
                            id: parsed.id,
                            error: { code: -32603, message: e instanceof Error ? e.message : 'Internal error' },
                        }),
                    });
                }
            } catch { /* give up */ }
        }
    }
}

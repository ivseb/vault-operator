/**
 * ManageMcpServerTool
 *
 * Allows the agent to self-configure MCP server connections at runtime.
 * Actions: add, remove, update, list, status, reconnect, test.
 *
 * Supports SSE and streamable-http transports only.
 * stdio is intentionally blocked — it spawns host processes outside the sandbox.
 *
 * Part of Self-Development Phase 1: Foundation.
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import type { McpClient } from '../../mcp/McpClient';
import type { McpServerConfig } from '../../../types/settings';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

interface ManageMcpServerInput {
    action: 'add' | 'remove' | 'update' | 'list' | 'status' | 'reconnect' | 'test';
    name?: string;
    type?: string;
    url?: string;
    headers?: Record<string, string>;
    timeout?: number;
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export class ManageMcpServerTool extends BaseTool<'manage_mcp_server'> {
    readonly name = 'manage_mcp_server' as const;
    readonly isWriteOperation = false;

    private mcpClient: McpClient;

    constructor(plugin: ObsidianAgentPlugin, mcpClient: McpClient) {
        super(plugin);
        this.mcpClient = mcpClient;
    }

    getDefinition(): ToolDefinition {
        return {
            name: this.name,
            description: 'Manage MCP (Model Context Protocol) server connections. Add, remove, update, list, test, or reconnect MCP servers. ' +
                'Supports two transport types: "sse" (Server-Sent Events over HTTP) and "streamable-http" (HTTP streaming). ' +
                'stdio is NOT supported — it would spawn host processes outside the sandbox. ' +
                'For servers that only support stdio (e.g. Playwright MCP), the user must start them externally ' +
                'with an HTTP bridge (e.g. "npx @playwright/mcp@latest --port 3001") and then connect via SSE or streamable-http.',
            input_schema: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        description: 'Action to perform.',
                        enum: ['add', 'remove', 'update', 'list', 'status', 'reconnect', 'test'],
                    },
                    name: {
                        type: 'string',
                        description: 'Server name (required for add/remove/update/status/reconnect/test).',
                    },
                    type: {
                        type: 'string',
                        description: 'Transport type (required for add/update). "sse" for Server-Sent Events, "streamable-http" for HTTP streaming.',
                        enum: ['sse', 'streamable-http'],
                    },
                    url: {
                        type: 'string',
                        description: 'Server URL (required for add, and for update if changing URL).',
                    },
                    headers: {
                        type: 'object',
                        description: 'Optional HTTP headers for authentication.',
                    },
                    timeout: {
                        type: 'number',
                        description: 'Connection timeout in seconds (default: 60).',
                    },
                },
                required: ['action'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const params = input as unknown as ManageMcpServerInput;
        const action = (params.action ?? '').trim();

        try {
            if (action === 'add') {
                await this.handleAdd(params, callbacks, context);
            } else if (action === 'remove') {
                await this.handleRemove(params, callbacks, context);
            } else if (action === 'update') {
                await this.handleUpdate(params, callbacks, context);
            } else if (action === 'list') {
                this.handleList(callbacks);
            } else if (action === 'status') {
                this.handleStatus(params, callbacks);
            } else if (action === 'reconnect') {
                await this.handleReconnect(params, callbacks);
            } else if (action === 'test') {
                await this.handleTest(params, callbacks);
            } else {
                callbacks.pushToolResult(this.formatError(`Unknown action: "${action}". Use: add, remove, update, list, status, reconnect, test`));
            }
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
        }
    }

    // -----------------------------------------------------------------------
    // Action handlers
    // -----------------------------------------------------------------------

    private async handleAdd(
        params: ManageMcpServerInput,
        callbacks: { pushToolResult(c: string): void },
        context: ToolExecutionContext,
    ): Promise<void> {
        if (!params.name) {
            callbacks.pushToolResult(this.formatError('Missing "name" for add action.'));
            return;
        }
        this.validateTransportType(params.type);

        if (!params.url) {
            callbacks.pushToolResult(this.formatError('Missing "url" for add action.'));
            return;
        }
        this.validateUrl(params.url);

        const config: McpServerConfig = {
            type: params.type as 'sse' | 'streamable-http',
            url: params.url,
            headers: params.headers,
            timeout: params.timeout ?? 60,
        };

        this.plugin.settings.mcpServers[params.name] = config;
        await this.plugin.saveSettings();
        await this.mcpClient.connect(params.name, config);

        const conn = this.mcpClient.getConnection(params.name);
        const toolCount = conn?.tools.length ?? 0;
        const status = conn?.status ?? 'unknown';

        if (status === 'connected') {
            callbacks.pushToolResult(this.formatSuccess(
                `Server "${params.name}" added and connected. ${toolCount} tool(s) available.`
            ));
        } else {
            callbacks.pushToolResult(this.formatSuccess(
                `Server "${params.name}" added but connection status: ${status}${conn?.error ? ' — ' + conn.error : ''}`
            ));
        }

        context.invalidateToolCache?.();
    }

    private async handleRemove(
        params: ManageMcpServerInput,
        callbacks: { pushToolResult(c: string): void },
        context: ToolExecutionContext,
    ): Promise<void> {
        if (!params.name) {
            callbacks.pushToolResult(this.formatError('Missing "name" for remove action.'));
            return;
        }
        if (!this.plugin.settings.mcpServers[params.name]) {
            callbacks.pushToolResult(this.formatError(`Server "${params.name}" not found.`));
            return;
        }
        if (this.plugin.settings.mcpServers[params.name].isBuiltIn) {
            callbacks.pushToolResult(this.formatError(`Server "${params.name}" is built-in and cannot be removed. You can disable it instead.`));
            return;
        }

        await this.mcpClient.disconnect(params.name);
        delete this.plugin.settings.mcpServers[params.name];
        await this.plugin.saveSettings();

        callbacks.pushToolResult(this.formatSuccess(`Server "${params.name}" removed.`));
        context.invalidateToolCache?.();
    }

    private async handleUpdate(
        params: ManageMcpServerInput,
        callbacks: { pushToolResult(c: string): void },
        context: ToolExecutionContext,
    ): Promise<void> {
        if (!params.name) {
            callbacks.pushToolResult(this.formatError('Missing "name" for update action.'));
            return;
        }
        const existing = this.plugin.settings.mcpServers[params.name];
        if (!existing) {
            callbacks.pushToolResult(this.formatError(`Server "${params.name}" not found.`));
            return;
        }

        const type = params.type ?? existing.type;
        this.validateTransportType(type);

        await this.mcpClient.disconnect(params.name);

        const url = params.url ?? existing.url;
        if (!url) {
            callbacks.pushToolResult(this.formatError('Missing "url" for update action.'));
            return;
        }
        this.validateUrl(url);

        const updatedConfig: McpServerConfig = {
            ...existing,
            type: type as 'sse' | 'streamable-http',
            url,
            headers: params.headers ?? existing.headers,
            timeout: params.timeout ?? existing.timeout,
        };

        this.plugin.settings.mcpServers[params.name] = updatedConfig;
        await this.plugin.saveSettings();
        await this.mcpClient.connect(params.name, updatedConfig);

        const conn = this.mcpClient.getConnection(params.name);
        callbacks.pushToolResult(this.formatSuccess(
            `Server "${params.name}" updated. Status: ${conn?.status ?? 'unknown'}, ${conn?.tools.length ?? 0} tool(s).`
        ));
        context.invalidateToolCache?.();
    }

    private handleList(callbacks: { pushToolResult(c: string): void }): void {
        const connections = this.mcpClient.getConnections();
        if (connections.length === 0) {
            callbacks.pushToolResult(this.formatSuccess('No MCP servers configured.'));
            return;
        }

        const lines = connections.map(c => {
            const status = c.status === 'connected' ? 'connected' : c.status;
            const error = c.error ? ` (${c.error})` : '';
            return `- ${c.name}: ${status}, ${c.tools.length} tool(s), type=${c.config.type}${error}`;
        });

        callbacks.pushToolResult(this.formatSuccess(
            `${connections.length} MCP server(s):\n${lines.join('\n')}`
        ));
    }

    private handleStatus(
        params: ManageMcpServerInput,
        callbacks: { pushToolResult(c: string): void },
    ): void {
        if (!params.name) {
            callbacks.pushToolResult(this.formatError('Missing "name" for status action.'));
            return;
        }
        const conn = this.mcpClient.getConnection(params.name);
        if (!conn) {
            callbacks.pushToolResult(this.formatError(`Server "${params.name}" not found.`));
            return;
        }

        const toolNames = conn.tools.map(t => t.name).join(', ') || '(none)';
        const lines = [
            `Server: ${conn.name}`,
            `Status: ${conn.status}`,
            `Type: ${conn.config.type}`,
            `URL: ${conn.config.url ?? '(none)'}`,
            `Tools: ${toolNames}`,
        ];
        if (conn.error) lines.push(`Error: ${conn.error}`);

        callbacks.pushToolResult(this.formatSuccess(lines.join('\n')));
    }

    private async handleReconnect(
        params: ManageMcpServerInput,
        callbacks: { pushToolResult(c: string): void },
    ): Promise<void> {
        if (!params.name) {
            callbacks.pushToolResult(this.formatError('Missing "name" for reconnect action.'));
            return;
        }
        await this.mcpClient.reconnect(params.name);
        const conn = this.mcpClient.getConnection(params.name);
        callbacks.pushToolResult(this.formatSuccess(
            `Server "${params.name}" reconnected. Status: ${conn?.status ?? 'unknown'}, ${conn?.tools.length ?? 0} tool(s).`
        ));
    }

    private async handleTest(
        params: ManageMcpServerInput,
        callbacks: { pushToolResult(c: string): void },
    ): Promise<void> {
        if (!params.name) {
            callbacks.pushToolResult(this.formatError('Missing "name" for test action.'));
            return;
        }
        const result = await this.mcpClient.testConnection(params.name);
        callbacks.pushToolResult(this.formatSuccess(result));
    }

    // -----------------------------------------------------------------------
    // Validation
    // -----------------------------------------------------------------------

    private validateTransportType(type: string | undefined): void {
        if (!type) throw new Error('Missing "type". Must be "sse" or "streamable-http".');
        if (type !== 'sse' && type !== 'streamable-http') {
            throw new Error(`Invalid type "${type}". Must be "sse" or "streamable-http". stdio is not supported — it spawns host processes.`);
        }
    }

    private validateUrl(url: string): void {
        try {
            new URL(url);
        } catch {
            throw new Error(`Invalid URL: "${url}"`);
        }
    }
}

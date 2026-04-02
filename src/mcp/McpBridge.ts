/**
 * McpBridge -- Hosts an MCP Server as a local HTTP endpoint.
 *
 * Runs an HTTP server on localhost (default port 27182) that speaks
 * MCP Streamable HTTP protocol. Claude Desktop connects via URL.
 * All tool calls are dispatched directly to Obsilo services (no IPC needed).
 *
 * Requires Obsidian to be running (the services live in the Renderer process).
 *
 * ADR-053: MCP Server Prozess-Architektur (revised: HTTP instead of stdio+IPC)
 * FEATURE-1400: MCP Server Core
 */

import type ObsidianAgentPlugin from '../main';
import type { McpToolDefinition } from './types';
import { handleToolCall } from './tools/index';
import { RelayClient } from './RelayClient';
import { buildPrompts } from './prompts/systemContext';

const DEFAULT_PORT = 27182;

/** Callback for tunnel URL changes (displayed in Settings UI). */
type TunnelUrlCallback = (url: string | null) => void;

// Tool definitions exposed to Claude
const TOOLS: McpToolDefinition[] = [
    {
        name: 'get_context',
        description: 'ALWAYS call this first. Returns user profile, memory, behavioral patterns, vault statistics, available skills, and rules. Essential context for every conversation.',
        inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'search_vault',
        description: 'Intelligent vault search: combines semantic similarity, keyword matching, graph expansion (Wikilinks + MOC), implicit connections, and cross-encoder reranking in one call. Returns rich results with excerpts, scores, and connection context.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Natural-language search query' },
                top_k: { type: 'number', description: 'Max results (default: 8)' },
                folder: { type: 'string', description: 'Restrict to folder (prefix match)' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags (any match)' },
            },
            required: ['query'],
        },
    },
    {
        name: 'read_notes',
        description: 'Read one or more vault files. Returns content with frontmatter, tags, and linked notes for each file.',
        inputSchema: {
            type: 'object',
            properties: {
                paths: { type: 'array', items: { type: 'string' }, description: 'File paths relative to vault root' },
            },
            required: ['paths'],
        },
    },
    {
        name: 'write_vault',
        description: 'Create, edit, or delete vault files. Supports batch operations.',
        inputSchema: {
            type: 'object',
            properties: {
                operations: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            type: { type: 'string', enum: ['create', 'edit', 'append', 'delete'] },
                            path: { type: 'string' },
                            content: { type: 'string' },
                        },
                        required: ['type', 'path'],
                    },
                },
            },
            required: ['operations'],
        },
    },
    {
        name: 'execute_vault_op',
        description: 'Execute specialized vault operations: generate_canvas, update_frontmatter, create_base, search_by_tag, get_daily_note, execute_command, get_linked_notes.',
        inputSchema: {
            type: 'object',
            properties: {
                operation: { type: 'string', description: 'Operation name' },
                params: { type: 'object', description: 'Operation-specific parameters' },
            },
            required: ['operation'],
        },
    },
    {
        name: 'sync_session',
        description: 'MANDATORY at end of EVERY conversation using Obsilo. Replicate the conversation into Obsidian\'s chat history. Simply copy each message from this conversation.',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'Short title (2-5 words)' },
                transcript: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            role: { type: 'string', enum: ['user', 'assistant'] },
                            text: { type: 'string', description: 'The exact message text' },
                        },
                        required: ['role', 'text'],
                    },
                    description: 'Copy every message from this conversation. User messages verbatim. Your responses as you wrote them. Simply replicate the chat.',
                },
                learnings: { type: 'string', description: 'Optional: anything to remember for next time' },
            },
            required: ['title', 'transcript'],
        },
    },
    {
        name: 'update_memory',
        description: 'Update persistent memory: user profile, behavioral patterns, known errors, or active projects.',
        inputSchema: {
            type: 'object',
            properties: {
                category: { type: 'string', enum: ['profile', 'patterns', 'errors', 'projects'] },
                content: { type: 'string', description: 'Content to append' },
            },
            required: ['category', 'content'],
        },
    },
];

// ---------------------------------------------------------------------------
// McpBridge -- HTTP-based MCP Server
// ---------------------------------------------------------------------------

export class McpBridge {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Node.js http.Server type
    private server: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Node.js ChildProcess type
    private tunnelProcess: any = null;
    private relayClient: RelayClient | null = null;
    private _running = false;
    private _tunnelUrl: string | null = null;
    private port = DEFAULT_PORT;
    private onTunnelUrl: TunnelUrlCallback | null = null;

    constructor(private plugin: ObsidianAgentPlugin) {}

    get tunnelUrl(): string | null { return this._tunnelUrl; }
    get remoteConnected(): boolean { return this.relayClient?.connected ?? false; }
    get remoteConnecting(): boolean { return this.relayClient?.connecting ?? false; }

    get running(): boolean { return this._running; }

    async start(): Promise<void> {
        if (this.server) return;

        // AUDIT-006 H-1: Ensure MCP server token exists (auto-generate on first run)
        if (!this.plugin.settings.mcpServerToken) {
            this.plugin.settings.mcpServerToken = crypto.randomUUID();
            await this.plugin.saveSettings();
        }
        this.writeMcpTokenFile();

        // eslint-disable-next-line @typescript-eslint/no-require-imports -- http only via dynamic require in Electron
        const http = require('http') as typeof import('http');

        this.server = http.createServer((req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
            void this.handleRequest(req, res);
        });

        await new Promise<void>((resolve, reject) => {
            this.server.listen(this.port, '127.0.0.1', () => {
                this._running = true;
                console.debug(`[McpBridge] MCP Server listening on http://127.0.0.1:${this.port}`);
                resolve();
            });
            this.server.on('error', (e: Error) => {
                console.warn(`[McpBridge] Failed to start HTTP server:`, e);
                reject(e);
            });
        });
    }

    /**
     * Write MCP server token to well-known file for mcp-server-worker (AUDIT-006 H-1).
     * The worker reads this file to authenticate HTTP requests to the local server.
     */
    private writeMcpTokenFile(): void {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports -- fs only via require in Electron
            const fs = require('fs') as typeof import('fs');
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const nodePath = require('path') as typeof import('path');
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const os = require('os') as typeof import('os');
            const tokenDir = nodePath.join(os.homedir(), '.obsidian-agent');
            if (!fs.existsSync(tokenDir)) fs.mkdirSync(tokenDir, { recursive: true });
            // mode 0o600: owner-only read/write on Unix; silently ignored on Windows
            // (Windows relies on user-profile directory ACLs for protection)
            fs.writeFileSync(
                nodePath.join(tokenDir, 'mcp-token'),
                this.plugin.settings.mcpServerToken,
                { mode: 0o600 },
            );
        } catch (e) {
            console.warn('[McpBridge] Failed to write MCP token file:', e);
        }
    }

    /** Connect to remote relay (if configured). */
    connectRelay(): void {
        // Stop any existing polling loop first
        this.disconnectRelay();

        const url = this.plugin.settings.relayUrl;
        const token = this.plugin.settings.relayToken;
        if (!url || !token) return;

        this.relayClient = new RelayClient(this.plugin);
        this.relayClient.connect(url, token);
    }

    /** Disconnect from remote relay. */
    disconnectRelay(): void {
        this.relayClient?.disconnect();
        this.relayClient = null;
    }

    stop(): void {
        this.disconnectRelay();
        this.stopTunnel();
        if (this.server) {
            this.server.close();
            this.server = null;
            this._running = false;
            console.debug('[McpBridge] MCP Server stopped');
        }
    }

    /**
     * Start a Cloudflare Tunnel to make the MCP server publicly accessible.
     * The tunnel URL (e.g. https://xxx.trycloudflare.com) is available via tunnelUrl getter.
     */
    startTunnel(onUrl?: TunnelUrlCallback): void {
        if (this.tunnelProcess) return;
        this.onTunnelUrl = onUrl ?? null;

        // eslint-disable-next-line @typescript-eslint/no-require-imports, security/detect-child-process -- child_process in Electron
        const cp = require('child_process') as typeof import('child_process');

        // Check if cloudflared is available
        try {
            const which = process.platform === 'win32' ? 'where' : 'which';
            cp.execSync(`${which} cloudflared`, { encoding: 'utf-8', timeout: 3000 });
        } catch {
            console.warn('[McpBridge] cloudflared not found. Install via: brew install cloudflared');
            return;
        }

        console.debug('[McpBridge] Starting Cloudflare Tunnel...');
        this.tunnelProcess = cp.spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${this.port}`], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        // Parse tunnel URL from cloudflared stderr output
        this.tunnelProcess.stderr?.on('data', (data: Buffer) => {
            const line = data.toString();
            const urlMatch = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
            if (urlMatch && !this._tunnelUrl) {
                this._tunnelUrl = urlMatch[0];
                console.debug(`[McpBridge] Tunnel URL: ${this._tunnelUrl}`);
                this.onTunnelUrl?.(this._tunnelUrl);
            }
        });

        this.tunnelProcess.on('exit', (code: number | null) => {
            console.debug(`[McpBridge] Tunnel exited with code ${code ?? 'null'}`);
            this.tunnelProcess = null;
            this._tunnelUrl = null;
            this.onTunnelUrl?.(null);
        });
    }

    stopTunnel(): void {
        if (this.tunnelProcess) {
            try { this.tunnelProcess.kill('SIGTERM'); } catch { /* already dead */ }
            this.tunnelProcess = null;
            this._tunnelUrl = null;
            console.debug('[McpBridge] Tunnel stopped');
        }
    }

    // -----------------------------------------------------------------------
    // HTTP Request Handler (Streamable HTTP MCP)
    // -----------------------------------------------------------------------

    private async handleRequest(req: import('http').IncomingMessage, res: import('http').ServerResponse): Promise<void> {
        // AUDIT-006 H-1: Restrict CORS (block browser cross-origin requests)
        res.setHeader('Access-Control-Allow-Origin', 'app://obsidian.md');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // AUDIT-006 H-1: Bearer token authentication
        const expectedToken = this.plugin.settings.mcpServerToken;
        if (expectedToken) {
            const authHeader = req.headers['authorization'] ?? '';
            if (!authHeader.startsWith('Bearer ') || authHeader.slice(7) !== expectedToken) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Unauthorized' } }));
                return;
            }
        }

        if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }

        // AUDIT-006 M-4: Read body with size limit (matches relay worker 1 MB limit)
        const MAX_BODY = 1_048_576;
        const body = await new Promise<string>((resolve, reject) => {
            let data = '';
            req.on('data', (chunk: Buffer) => {
                data += chunk.toString();
                if (data.length > MAX_BODY) {
                    res.writeHead(413, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Payload too large' } }));
                    req.destroy();
                    reject(new Error('Payload too large'));
                }
            });
            req.on('end', () => resolve(data));
        });

        try {
            const request = JSON.parse(body) as { jsonrpc: string; method: string; id?: number | string; params?: Record<string, unknown> };

            // JSON-RPC Notifications have no 'id' -- they don't expect a response
            if (request.id === undefined || request.id === null) {
                // Still process it (side effects like notifications/initialized) but don't respond
                void this.handleJsonRpc(request).catch(() => { /* notification errors are silent */ });
                res.writeHead(204);
                res.end();
                return;
            }

            const result = await this.handleJsonRpc(request);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                jsonrpc: '2.0',
                id: request.id,
                result,
            }));
        } catch (e) {
            // CodeQL #63: Sanitize error -- do not expose stack traces or internal paths
            const safeMessage = e instanceof Error ? e.message.split('\n')[0] : 'Internal server error';
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                jsonrpc: '2.0',
                id: 0,
                error: { code: -32603, message: safeMessage },
            }));
        }
    }

    // -----------------------------------------------------------------------
    // JSON-RPC Method Dispatch
    // -----------------------------------------------------------------------

    private async handleJsonRpc(request: { method: string; params?: Record<string, unknown> }): Promise<unknown> {
        switch (request.method) {
            case 'initialize':
                return {
                    protocolVersion: '2025-03-26',
                    capabilities: { tools: {}, prompts: {}, resources: {} },
                    serverInfo: { name: 'Obsilo', version: '1.0.0' },
                    instructions: 'You are connected to Obsilo, an intelligence backend for an Obsidian vault. '
                        + 'Your role: You think, plan, and decide. Obsilo searches, reads, writes, and remembers.\n\n'
                        + 'WORKFLOW (mandatory order):\n'
                        + '1. ALWAYS call get_context FIRST to load user profile, memory, preferences, and vault context.\n'
                        + '2. Use search_vault, read_notes, write_vault, execute_vault_op as needed.\n'
                        + '3. ALWAYS call sync_session as your LAST action to save the conversation to Obsidian.',
                };

            case 'tools/list':
                return {
                    tools: this.getToolsWithContext(),
                };

            case 'tools/call': {
                const params = request.params as { name: string; arguments?: Record<string, unknown> } | undefined;
                if (!params?.name) throw new Error('Missing tool name');
                const result = await handleToolCall(this.plugin, params.name, params.arguments ?? {});
                return { content: result.content, isError: result.isError };
            }

            case 'prompts/list':
                return {
                    prompts: [{
                        name: 'My profile and preferences',
                        description: 'Your user profile, communication preferences, behavioral patterns, and rules for working with this vault',
                    }, {
                        name: 'Available workflows',
                        description: 'Skill-based workflows for complex tasks (presentations, research, document creation)',
                    }],
                };

            case 'prompts/get': {
                const promptName = (request.params as { name?: string })?.name;
                const allPrompts = await buildPrompts(this.plugin);
                if (promptName === 'Available workflows') {
                    // Return only skills portion
                    const skillsText = allPrompts.find(p =>
                        typeof p.content === 'object' && p.content.text?.includes('Available Skills')
                    );
                    return { messages: skillsText ? [skillsText] : allPrompts };
                }
                return { messages: allPrompts };
            }

            case 'resources/list':
                return { resources: this.buildResourceList() };

            case 'resources/read': {
                const uri = (request.params as { uri?: string })?.uri;
                return { contents: await this.readResource(uri ?? '') };
            }

            case 'resources/templates/list':
                return {
                    resourceTemplates: [{
                        uriTemplate: 'vault://{path}',
                        name: 'Vault note',
                        description: 'Read any note from your Obsidian vault by path',
                        mimeType: 'text/markdown',
                    }],
                };

            case 'notifications/initialized':
            case 'ping':
                return {};

            default:
                throw new Error(`Unknown method: ${request.method}`);
        }
    }

    // -----------------------------------------------------------------------
    // Dynamic Tool Definitions (with vault context)
    // -----------------------------------------------------------------------

    getToolsWithContext() {
        const vault = this.plugin.app.vault;

        // Get top-level folders for write_vault description
        const folders = vault.getAllFolders()
            .map(f => f.path)
            .filter(p => !p.startsWith('.') && p.split('/').length <= 2)
            .sort()
            .slice(0, 30);

        const folderList = folders.length > 0
            ? `\n\nExisting vault folders: ${folders.join(', ')}. ALWAYS use existing folders when creating files.`
            : '';

        // Rules hint
        const rulesHint = '\n\nCall get_context to see user rules and preferences before writing.';

        // Get default new note folder from Obsidian settings
        let defaultFolder = '';
        try {
            const obsidianConfig = (this.plugin.app.vault as unknown as { config?: { newFileFolderPath?: string } }).config;
            if (obsidianConfig?.newFileFolderPath) {
                defaultFolder = `\n\nObsidian default folder for new notes: "${obsidianConfig.newFileFolderPath}". Use this when no specific folder is requested.`;
            }
        } catch { /* non-fatal */ }

        return TOOLS.map(t => {
            let description = t.description;
            if (t.name === 'write_vault') {
                description += folderList + defaultFolder + rulesHint;
            }
            if (t.name === 'search_vault') {
                description += `\n\nVault has ${vault.getMarkdownFiles().length} notes. Semantic index: ${this.plugin.semanticIndex?.isIndexed ? 'built' : 'not built'}.`;
            }
            return {
                name: t.name,
                description,
                inputSchema: t.inputSchema,
            };
        });
    }

    // -----------------------------------------------------------------------
    // Resources -- Vault notes as attachable context
    // -----------------------------------------------------------------------

    buildResourceList() {
        const vault = this.plugin.app.vault;
        const files = vault.getMarkdownFiles();
        // Return all markdown files as resources (Claude shows these in "Add from Obsilo")
        return files.map(f => {
            const name = f.path.split('/').pop()?.replace(/\.md$/, '') ?? f.path;
            return {
                uri: `vault://${f.path}`,
                name,
                description: f.path,
                mimeType: 'text/markdown',
            };
        });
    }

    private async readResource(uri: string) {
        // Decode URI components (Claude may encode spaces, special chars)
        const path = decodeURIComponent(uri.replace(/^vault:\/\//, ''));
        const vault = this.plugin.app.vault;
        const file = vault.getFileByPath(path);
        if (!file) return [];

        try {
            const content = await vault.cachedRead(file);
            return [{
                uri,
                mimeType: 'text/markdown',
                text: content,
            }];
        } catch {
            return [];
        }
    }
}

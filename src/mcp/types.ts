/**
 * IPC Message Types for MCP Server ↔ Plugin communication.
 *
 * The MCP Server runs as a separate Node.js process (child_process.spawn).
 * It handles stdio (MCP JSON-RPC) externally and IPC internally.
 *
 * ADR-053: MCP Server Prozess-Architektur
 * FEATURE-1400: MCP Server Core
 */

// ---------------------------------------------------------------------------
// Worker → Plugin (requests)
// ---------------------------------------------------------------------------

export type WorkerToPluginMessage =
    | { type: 'server-ready' }
    | { type: 'tool-call'; id: string; tool: string; args: Record<string, unknown> }
    | { type: 'get-prompts'; id: string }
    | { type: 'get-resources'; id: string }
    | { type: 'error'; message: string };

// ---------------------------------------------------------------------------
// Plugin → Worker (responses)
// ---------------------------------------------------------------------------

export type PluginToWorkerMessage =
    | { type: 'tool-result'; id: string; content: McpContent[]; isError?: boolean }
    | { type: 'prompt-result'; id: string; messages: McpPromptMessage[] }
    | { type: 'resource-result'; id: string; resources: McpResource[] }
    | { type: 'shutdown' };

// ---------------------------------------------------------------------------
// MCP Content Types
// ---------------------------------------------------------------------------

export interface McpContent {
    type: 'text';
    text: string;
}

export interface McpPromptMessage {
    role: 'user' | 'assistant';
    content: McpContent;
}

export interface McpResource {
    uri: string;
    name: string;
    description: string;
    mimeType: string;
    text: string;
}

// ---------------------------------------------------------------------------
// Tool Definitions (registered in the worker, dispatched via IPC)
// ---------------------------------------------------------------------------

export interface McpToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tool Handler (plugin-side, processes tool calls)
// ---------------------------------------------------------------------------

export interface McpToolResult {
    content: McpContent[];
    isError?: boolean;
}

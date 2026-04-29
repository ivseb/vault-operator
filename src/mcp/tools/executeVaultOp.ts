/**
 * execute_vault_op -- General-purpose tool dispatcher for MCP.
 *
 * Delegates to ANY registered Agent tool via ToolRegistry.
 * This is the "master key" that allows MCP clients to invoke
 * all Obsilo capabilities: vault_health_check, generate_canvas,
 * update_frontmatter, semantic_search, create_base, etc.
 */

import type ObsidianAgentPlugin from '../../main';
import type { McpToolResult } from '../types';
import type { ToolName } from '../../core/tools/types';
import { AGENT_INTERNAL_TOOLS } from '../McpBridge';

/**
 * AUDIT-013 C-1 + M-1 (interim hardening, 2026-04-29).
 *
 * `tool.execute()` is dispatched directly here, bypassing
 * `ToolExecutionPipeline` (no IgnoreService check, no approval, no schema
 * validation, no checkpoints, no operation log). Routing the call through
 * the pipeline is the proper fix; until then this allow/deny list is the
 * MCP boundary's last line of defence.
 *
 * Rule: any tool that mutates vault state, plugin state, or executes code
 * is blocked at the MCP handler. The agent loop can still call them
 * because that path goes through ToolExecutionPipeline. AGENT_INTERNAL_TOOLS
 * is also denied here so that switch_mode / new_task / update_settings
 * cannot be invoked by name even though the listing already filters them.
 */
const MCP_DENY_TOOLS: ReadonlySet<string> = new Set([
    // Vault mutations
    'write_file', 'edit_file', 'append_to_file', 'delete_file', 'move_file',
    'update_frontmatter', 'create_folder',
    // Office / canvas writers
    'create_pptx', 'create_docx', 'create_xlsx', 'create_base', 'update_base',
    'generate_canvas', 'create_excalidraw', 'plan_presentation',
    // Plugin / system mutation
    'update_settings', 'configure_model', 'manage_skill', 'manage_source',
    'manage_mcp_server', 'enable_plugin', 'call_plugin_api',
    // Code / recipe execution
    'evaluate_expression', 'execute_recipe', 'execute_command',
    'ingest_document',
]);

export async function handleExecuteVaultOp(
    plugin: ObsidianAgentPlugin,
    args: Record<string, unknown>,
): Promise<McpToolResult> {
    const operation = args.operation as string | undefined;
    const params = (args.params as Record<string, unknown>) ?? {};

    if (!operation) {
        return {
            content: [{ type: 'text', text: 'Error: operation parameter is required' }],
            isError: true,
        };
    }

    // AUDIT-013 C-1 + M-1: deny agent-internal and mutating tools at the
    // MCP boundary. The proper fix routes execute_vault_op through
    // ToolExecutionPipeline; this gate is the interim safety net.
    if (AGENT_INTERNAL_TOOLS.has(operation)) {
        return {
            content: [{ type: 'text', text: `Operation "${operation}" is agent-internal and not callable via MCP.` }],
            isError: true,
        };
    }
    if (MCP_DENY_TOOLS.has(operation)) {
        return {
            content: [{ type: 'text', text: `Operation "${operation}" is not permitted via execute_vault_op. Use the dedicated MCP tools (read_notes, search_vault, write_vault) for vault changes.` }],
            isError: true,
        };
    }

    // Look up the tool in the registry
    const tool = plugin.toolRegistry.getTool(operation as ToolName);
    if (!tool) {
        const available = plugin.toolRegistry.getAllTools().map(t => t.name).sort().join(', ');
        return {
            content: [{
                type: 'text',
                text: `Unknown operation: "${operation}". Available operations: ${available}`,
            }],
            isError: true,
        };
    }

    // Execute the tool with a simple callback collector
    const resultParts: string[] = [];
    const logParts: string[] = [];

    try {
        await tool.execute(params, {
            taskId: `mcp-vault-op-${Date.now()}`,
            mode: 'agent',
            callbacks: {
                pushToolResult(content: unknown): void {
                    if (typeof content === 'string') {
                        resultParts.push(content);
                    } else if (Array.isArray(content)) {
                        for (const block of content) {
                            if (typeof block === 'object' && block !== null && 'text' in block) {
                                resultParts.push((block as { text: string }).text);
                            }
                        }
                    }
                },
                handleError(_toolName: string, error: unknown): void {
                    const msg = error instanceof Error ? error.message : String(error);
                    resultParts.push(`Error: ${msg}`);
                },
                log(message: string): void {
                    logParts.push(message);
                },
            },
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
            content: [{ type: 'text', text: `Operation "${operation}" failed: ${msg}` }],
            isError: true,
        };
    }

    const result = resultParts.join('\n') || `Operation "${operation}" completed (no output).`;
    if (logParts.length > 0) {
        console.debug(`[MCP:execute_vault_op] ${operation}: ${logParts.join('; ')}`);
    }
    if (resultParts.length === 0) {
        console.warn(`[MCP:execute_vault_op] ${operation}: pushToolResult was never called -- tool may have silently failed`);
    }

    return {
        content: [{ type: 'text', text: result }],
        isError: false,
    };
}

/**
 * BaseTool - Abstract base class for all tools
 *
 * Adapted from Kilo Code's tool architecture.
 * All tools (internal and MCP) extend this class.
 */

import type { App } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import type {
    ToolName,
    ToolDefinition,
    ToolExecutionContext,
} from './types';

/**
 * Abstract base class for all tools
 */
export abstract class BaseTool<TName extends ToolName = ToolName> {
    /**
     * The unique name of this tool
     */
    abstract readonly name: TName;

    /**
     * Whether this tool performs write operations
     * (determines if approval and checkpoints are needed)
     */
    abstract readonly isWriteOperation: boolean;

    /**
     * Obsidian app instance
     */
    protected app: App;

    /**
     * Plugin instance
     */
    protected plugin: ObsidianAgentPlugin;

    constructor(plugin: ObsidianAgentPlugin) {
        this.plugin = plugin;
        this.app = plugin.app;
    }

    /**
     * Get the tool definition (schema) for the LLM
     */
    abstract getDefinition(): ToolDefinition;

    /**
     * Execute the tool with the given input
     *
     * @param input - Tool input parameters from LLM
     * @param context - Execution context
     */
    abstract execute(
        input: Record<string, unknown>,
        context: ToolExecutionContext
    ): Promise<void>;

    /**
     * Validate the tool input (optional)
     * Override this to add custom validation
     */
    protected validate(input: Record<string, unknown>): void {
        // Default: no validation
        // Subclasses can override to validate input
    }

    /**
     * Format an error message for the LLM
     */
    protected formatError(error: unknown): string {
        if (error instanceof Error) {
            return `<error>${error.message}</error>`;
        }
        return `<error>Unknown error: ${String(error)}</error>`;
    }

    /**
     * Format a success message for the LLM
     */
    protected formatSuccess(message: string): string {
        return `<success>${message}</success>`;
    }

    /**
     * Format content for the LLM
     *
     * AUDIT-034 L-15: attribute values are XML-escaped to prevent attribute
     * injection via crafted metadata coming from vault paths, search hits, or
     * external tool results.
     */
    protected formatContent(content: string, metadata?: Record<string, string>): string {
        const attrs = metadata
            ? Object.entries(metadata)
                  .map(([key, value]) => `${key}="${escapeXmlAttribute(value)}"`)
                  .join(' ')
            : '';

        return attrs ? `<content ${attrs}>\n${content}\n</content>` : content;
    }

    /**
     * Wrap untrusted content from external sources (web pages, document
     * parsers, MCP responses, semantic-search excerpts) in a boundary tag the
     * model recognises as user data, not as instructions.
     *
     * AUDIT-034 L-15 / L-16: aligns with wrapVaultContentForMcp at
     * McpBridge.ts:866. The system prompt's SECURITY BOUNDARY section
     * enumerates the recognised wrappers and how to treat them.
     *
     * @param source A short trust-domain label, e.g. "web", "mcp", "document".
     * @param content Raw text returned by the tool.
     * @param metadata Optional attribute map (url, server, tool, path).
     */
    protected formatUntrustedContent(
        source: string,
        content: string,
        metadata?: Record<string, string>
    ): string {
        const baseAttrs: Record<string, string> = {
            source,
            trust: 'user-data',
            ...(metadata ?? {}),
        };
        const attrs = Object.entries(baseAttrs)
            .map(([key, value]) => `${key}="${escapeXmlAttribute(value)}"`)
            .join(' ');
        return `<untrusted-content ${attrs}>\n${content}\n</untrusted-content>`;
    }
}

/**
 * XML-attribute-escape helper. Exported for unit tests and reuse by
 * subclasses that build their own boundary tags (WebFetchTool, UseMcpToolTool,
 * SemanticSearchTool).
 *
 * AUDIT-034 L-15.
 */
export function escapeXmlAttribute(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

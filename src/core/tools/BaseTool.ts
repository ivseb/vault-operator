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
     * Whether this tool writes vault FILES.
     *
     * Drives ONLY the pre-write checkpoint snapshot and read-cache invalidation.
     *
     * NOT the approval decision. That is made solely by the central effect
     * registry (ADR-153, `src/core/tools/toolEffects.ts`). The approval gate used
     * to hang off this flag, and because every tool declares it ABOUT ITSELF,
     * five tools with real side effects (update_settings, update_soul,
     * manage_mcp_server, mark_for_memory, get_daily_note) skipped the check
     * simply by having `false` here.
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
        return `<untrusted-content ${attrs}>\n${defangBoundaryTags(content)}\n</untrusted-content>`;
    }
}

/**
 * Boundary-wrapper tag names the agent loop emits (see securityBoundary.ts).
 * Kept in sync with that enumeration; `defangBoundaryTags` strips these from
 * untrusted bodies so a crafted document cannot pre-close the wrapper.
 */
const BOUNDARY_TAG_RE =
    /<\/?(?:untrusted-content|vault-content|vault_context|web_fetch|web_context|web_search|attached_document|attached_folder|mcp_response|history|selection)\b[^>]*>/gi;

/**
 * Neutralise literal boundary-wrapper tags inside untrusted content.
 *
 * AUDIT 2026-07-14 M-1: `formatUntrustedContent` only escaped attribute values,
 * so a body containing `</untrusted-content>` (or any other wrapper's closing
 * tag) could pre-close the trust boundary and inject fresh instructions into
 * the trusted prompt scope. The inline-action path already defends against this
 * (`escapeForPromptBlock`); this is the same defence for every tool-result path.
 * Exported for the non-BaseTool emitters (wrapVaultContentForMcp, AttachmentHandler).
 */
export function defangBoundaryTags(content: string): string {
    return content.replace(BOUNDARY_TAG_RE, '');
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

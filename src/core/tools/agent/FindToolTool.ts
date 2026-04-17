/**
 * FindToolTool — FEATURE-1600 (Deferred Tool Loading)
 *
 * Meta-tool for on-demand activation of deferred tools. Only core tools
 * (read / edit / search / agent-control) are in the default system prompt;
 * specialised tools (office formats, diagram creators, base queries,
 * self-development) live in DEFERRED_TOOL_NAMES and are loaded by this
 * tool the first time they are needed.
 *
 * Usage pattern from the LLM:
 *   find_tool({ query: "pptx" })
 *   -> matches create_pptx + plan_presentation, activates both, returns
 *      names + descriptions. Next turn the full schemas are in the prompt.
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import { DEFERRED_TOOL_NAMES, TOOL_METADATA } from '../toolMetadata';

const MAX_MATCHES = 5;

export class FindToolTool extends BaseTool<'find_tool'> {
    readonly name = 'find_tool' as const;
    readonly isWriteOperation = false;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'find_tool',
            description:
                'Discover and activate specialised tools not loaded in the default schema. '
                + 'Use this when the user asks for something the core tools do not cover '
                + '(office document creation, diagrams, base queries, expression evaluation, '
                + 'skill/source management, vault-health). The tool searches by keyword '
                + 'and injects the matching tool schemas for the rest of the session — '
                + 'after calling find_tool, the activated tools appear in the next turn\'s tool list.',
            input_schema: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Keyword(s) describing the capability you need, e.g. "pptx", "canvas", "diagram", "excel", "freshness". Case-insensitive substring match over tool names, labels, and descriptions.',
                    },
                },
                required: ['query'],
            },
        };
    }

    // eslint-disable-next-line @typescript-eslint/require-await -- BaseTool contract requires a Promise<void> return; this tool's work is CPU-bound only
    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const query = ((input.query as string) ?? '').trim().toLowerCase();

        if (!query) {
            callbacks.pushToolResult(this.formatError(new Error('query is required')));
            return;
        }

        // Score every deferred tool on how well the query matches its
        // name / label / description. Simple case-insensitive substring
        // ranking: name match > label match > description match.
        type Match = { name: string; label: string; description: string; score: number };
        const matches: Match[] = [];

        for (const name of DEFERRED_TOOL_NAMES) {
            const meta = TOOL_METADATA[name];
            if (!meta) continue;
            const nameLower = name.toLowerCase();
            const labelLower = (meta.label ?? '').toLowerCase();
            const descLower = (meta.description ?? '').toLowerCase();

            let score = 0;
            if (nameLower.includes(query)) score += 100;
            if (labelLower.includes(query)) score += 50;
            if (descLower.includes(query)) score += 10;

            if (score > 0) {
                matches.push({ name, label: meta.label, description: meta.description, score });
            }
        }

        matches.sort((a, b) => b.score - a.score);
        const top = matches.slice(0, MAX_MATCHES);

        if (top.length === 0) {
            callbacks.pushToolResult(
                `No deferred tools matched "${query}". If you need a capability that does not map to an available tool, ask the user to install the relevant Obsidian plugin, or try a core tool (read_file, edit_file, semantic_search).`,
            );
            return;
        }

        // Activate the matches for the rest of the session.
        if (!context.activateDeferredTool) {
            callbacks.pushToolResult(
                this.formatError(new Error('Tool activation callback not available — find_tool can only run inside a regular agent loop.')),
            );
            return;
        }

        for (const match of top) {
            context.activateDeferredTool(match.name);
        }

        const lines = top.map((m) => `- ${m.name}: ${m.description}`);
        callbacks.pushToolResult(
            this.formatSuccess(
                `Activated ${top.length} tool${top.length === 1 ? '' : 's'} for this session:\n`
                    + lines.join('\n')
                    + '\n\nTheir full schemas are now in the tool list — call them directly in your next step.',
            ),
        );
        callbacks.log(`find_tool: activated [${top.map((m) => m.name).join(', ')}] for query "${query}"`);
    }
}

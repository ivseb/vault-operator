/**
 * RunSkillScriptTool -- Generic executor for `scripts/{name}.js` inside a
 * self-authored skill folder. Replaces the previous `code_modules` /
 * `custom_*`-tool pattern (deprecated by FEAT-29-06 / ADR-126).
 *
 * Layout (FEAT-29-02 folder format):
 *   {agent-folder}/data/skills/{skill_name}/
 *     SKILL.md
 *     scripts/{script_name}.js   <-- this tool loads from here
 *
 * The script exports `async function execute(args) { ... }`. Return value
 * is JSON-serialized and pushed as tool_result.
 *
 * Path-traversal guard: skill_name and script_name are validated against an
 * alphanumeric-plus-dash whitelist before the path is joined. A malicious
 * `../` or `/` segment is rejected with a clear error.
 *
 * isWriteOperation=true because the script can mutate vault state, hit
 * external HTTP via the sandbox bridge, or write files. The approval gate
 * runs even for read-only scripts; that is the conservative default.
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import { getSelfAuthoredSkillsDir } from '../../utils/agentFolder';

const SAFE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_NAME_MAX_LEN = 200;

function isSafeName(s: string): boolean {
    return !!s && s.length <= SAFE_NAME_MAX_LEN && SAFE_NAME_PATTERN.test(s);
}

interface RunSkillScriptArgs {
    skill_name: string;
    script_name: string;
    args?: Record<string, unknown>;
}

export class RunSkillScriptTool extends BaseTool<'run_skill_script'> {
    readonly name = 'run_skill_script' as const;
    // Scripts can mutate state, do HTTP, write files. Treat as write op so
    // the approval gate is conservative.
    readonly isWriteOperation = true;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'run_skill_script',
            description:
                'Execute a JavaScript helper script that lives in a self-authored skill folder. '
                + 'Path: {agent-folder}/data/skills/{skill_name}/scripts/{script_name}.js. '
                + 'The script must export `async function execute(args)`; its return value is JSON-serialized '
                + 'back to the tool_result. Use this for deterministic, repeatable steps the agent should '
                + 'not have to hallucinate each time (data aggregation, API calls, format conversion).',
            input_schema: {
                type: 'object',
                properties: {
                    skill_name: {
                        type: 'string',
                        description: 'Folder name of the self-authored skill that owns the script.',
                    },
                    script_name: {
                        type: 'string',
                        description: 'File-name of the script inside scripts/, without the .js extension.',
                    },
                    args: {
                        type: 'object',
                        description: 'JSON-serializable arguments handed to the script\'s execute(args) function. Defaults to {}.',
                        additionalProperties: true,
                    },
                },
                required: ['skill_name', 'script_name'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const skillName = (input.skill_name as string ?? '').trim();
        const scriptName = (input.script_name as string ?? '').trim();
        const args = (input.args as Record<string, unknown> | undefined) ?? {};

        if (!skillName) {
            callbacks.pushToolResult(this.formatError(new Error('skill_name parameter is required')));
            return;
        }
        if (!scriptName) {
            callbacks.pushToolResult(this.formatError(new Error('script_name parameter is required')));
            return;
        }
        if (!isSafeName(skillName)) {
            callbacks.pushToolResult(
                this.formatError(new Error(`invalid skill_name (path-traversal guard): ${JSON.stringify(skillName)}`)),
            );
            return;
        }
        if (!isSafeName(scriptName)) {
            callbacks.pushToolResult(
                this.formatError(new Error(`invalid script_name (path-traversal guard): ${JSON.stringify(scriptName)}`)),
            );
            return;
        }

        const skillsDir = getSelfAuthoredSkillsDir(this.plugin);
        const scriptPath = `${skillsDir}/${skillName}/scripts/${scriptName}.js`;

        // Load script source
        let source: string;
        try {
            const adapter = this.plugin.app.vault.adapter;
            if (!(await adapter.exists(scriptPath))) {
                callbacks.pushToolResult(
                    this.formatError(new Error(`Script not found: ${scriptPath}`)),
                );
                return;
            }
            source = await adapter.read(scriptPath);
        } catch (e) {
            callbacks.pushToolResult(this.formatError(e));
            return;
        }

        // Compile via EsbuildWasm
        const esbuild = this.plugin.esbuildWasmManager;
        const sandbox = this.plugin.sandboxExecutor;
        if (!esbuild || !sandbox) {
            callbacks.pushToolResult(
                this.formatError(new Error('Sandbox executor or bundler unavailable in this build')),
            );
            return;
        }

        let compiled: string;
        try {
            // Use transform (no deps) for simple scripts. A future hint
            // could parse `// @deps: [...]` from the source header and
            // call build() instead. For now transform handles all current
            // scripts in production skills.
            compiled = await esbuild.transform(source);
        } catch (e) {
            callbacks.pushToolResult(
                this.formatError(new Error(`Script bundler error: ${(e as Error).message ?? String(e)}`)),
            );
            return;
        }

        // Execute in sandbox
        try {
            const result = await sandbox.execute(compiled, args);
            callbacks.pushToolResult(this.formatSuccess(JSON.stringify(result, null, 2)));
            callbacks.log(`Executed skill-script: ${skillName}/${scriptName}`);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            callbacks.pushToolResult(
                this.formatError(new Error(`Script execution error: ${msg}`)),
            );
        }
    }
}

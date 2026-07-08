/**
 * EvaluateExpressionTool
 *
 * Executes a one-off JavaScript/TypeScript expression in the sandbox.
 * Useful for data transformations, regex testing, calculations, etc.
 * No persistent tool is created — just immediate execution.
 *
 * Part of Self-Development Phase 3: Sandbox + Dynamic Modules.
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import type { ISandboxExecutor } from '../../sandbox/ISandboxExecutor';
import type { EsbuildWasmManager } from '../../sandbox/EsbuildWasmManager';
import { AstValidator } from '../../sandbox/AstValidator';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

interface EvaluateExpressionInput {
    expression: string;
    context?: Record<string, unknown>;
    dependencies?: string[];
}

/**
 * FIX-05-02-05: cap on the formatted return value. The result is pushed
 * 1:1 into the message history; without a cap, expressions returning file
 * contents (`return ctx.vault.read(path)`) pump arbitrarily large payloads
 * into the context until the 50k per-message truncation destroys the
 * agent's own earlier tool results. read_file has the equivalent guard at
 * MAX_CONTENT_CHARS with an offset-based continuation; here the correct
 * escape hatch is writing large data to the vault inside the expression.
 */
const MAX_RESULT_CHARS = 16_000;

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export class EvaluateExpressionTool extends BaseTool<'evaluate_expression'> {
    readonly name = 'evaluate_expression' as const;
    readonly isWriteOperation = false;

    constructor(
        plugin: ObsidianAgentPlugin,
        private sandboxExecutor: ISandboxExecutor,
        private esbuildManager: EsbuildWasmManager,
    ) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: this.name,
            description: 'Execute TypeScript/JavaScript in an isolated sandbox. Provides ctx.vault (read, readBinary, write, writeBinary, list) and ctx.requestUrl (HTTPS CDN-only). No Blob, Buffer, DOM, require, fetch available. Binary output: ArrayBuffer/Uint8Array (outputType:"arraybuffer"). npm packages via dependencies param (browser ESM from esm.sh). NEVER write Python. Return values are capped at 16000 chars -- NOT a file reader: to read vault files use read_file; for large computed data write to a vault file (ctx.vault.write) and return a short summary.',
            input_schema: {
                type: 'object',
                properties: {
                    expression: {
                        type: 'string',
                        description: 'The TypeScript/JavaScript expression or code to evaluate. Must return a value. Use ctx.vault for file I/O and ctx.requestUrl for HTTP.',
                    },
                    context: {
                        type: 'object',
                        description: 'Optional context variables available as "ctx" inside the expression.',
                    },
                    dependencies: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Optional npm package names to bundle (e.g. ["xlsx", "marked"]). When provided, packages are fetched from CDN and bundled with esbuild.',
                    },
                },
                required: ['expression'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const params = input as unknown as EvaluateExpressionInput;

        try {
            if (!params.expression) {
                throw new Error('Missing "expression".');
            }

            // AST validation (supplementary)
            const validation = AstValidator.validate(params.expression);
            if (!validation.valid) {
                throw new Error(`Expression validation failed:\n${validation.errors.join('\n')}`);
            }

            // Hoist import statements to module level (imports are invalid inside function bodies)
            const lines = params.expression.split('\n');
            const imports: string[] = [];
            const bodyLines: string[] = [];
            for (const line of lines) {
                // Match static imports (import X from 'y') but NOT dynamic import()
                if (/^\s*import\s+/.test(line) && !line.includes('import(')) {
                    imports.push(line);
                } else {
                    bodyLines.push(line);
                }
            }
            const bodyCode = bodyLines.join('\n');
            const hasReturn = bodyCode.includes('return');

            const wrappedSource = `
${imports.join('\n')}

export const definition = { name: '_eval', description: 'eval' };
export async function execute(input: Record<string, unknown>, ctx: { vault: any; requestUrl: any }): Promise<unknown> {
    const context = input.context || {};
    ${hasReturn ? bodyCode : `return (${bodyCode})`};
}
`;

            const compiledJs = (params.dependencies?.length)
                ? await this.esbuildManager.build(wrappedSource, params.dependencies)
                : await this.esbuildManager.transform(wrappedSource);
            const result = await this.sandboxExecutor.execute(compiledJs, {
                context: params.context ?? {},
            });

            let output = typeof result === 'string'
                ? result
                : JSON.stringify(result, null, 2);

            if (output.length > MAX_RESULT_CHARS) {
                output = output.slice(0, MAX_RESULT_CHARS)
                    + `\n[Truncated: result was ${output.length} chars, cap is ${MAX_RESULT_CHARS}. `
                    + 'Do NOT page through data via repeated evaluate_expression returns. '
                    + 'To read a vault file use read_file (offset= continues a truncated read). '
                    + 'For large computed data, write it to a vault file inside the expression '
                    + '(ctx.vault.write) and return only a short summary plus the file path.]';
            }

            callbacks.pushToolResult(this.formatSuccess(output));
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
        }
    }
}

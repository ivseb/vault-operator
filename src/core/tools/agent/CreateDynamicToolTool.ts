/**
 * CreateDynamicToolTool
 *
 * Allows the agent to create, update, delete, list, and test dynamic tools.
 * Dynamic tools are TypeScript modules compiled via esbuild-wasm and executed
 * in a sandboxed iframe.
 *
 * All dynamic tool names must start with "custom_" prefix.
 *
 * Part of Self-Development Phase 3: Sandbox + Dynamic Modules.
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import type { SandboxExecutor } from '../../sandbox/SandboxExecutor';
import type { EsbuildWasmManager } from '../../sandbox/EsbuildWasmManager';
import type { DynamicToolLoader } from '../dynamic/DynamicToolLoader';
import { DynamicToolFactory } from '../dynamic/DynamicToolFactory';
import { AstValidator } from '../../sandbox/AstValidator';
import type { DynamicToolDefinition, DynamicToolRecord } from '../dynamic/types';
import type { ToolRegistry } from '../ToolRegistry';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

interface CreateDynamicToolInput {
    action: 'create' | 'update' | 'delete' | 'list' | 'test';
    name?: string;
    description?: string;
    input_schema?: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
    source_code?: string;
    dependencies?: string[];
    is_write_operation?: boolean;
    test_input?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export class CreateDynamicToolTool extends BaseTool<'create_dynamic_tool'> {
    readonly name = 'create_dynamic_tool' as const;
    readonly isWriteOperation = false;

    constructor(
        plugin: ObsidianAgentPlugin,
        private sandboxExecutor: SandboxExecutor,
        private esbuildManager: EsbuildWasmManager,
        private dynamicToolLoader: DynamicToolLoader,
        private toolRegistry: ToolRegistry,
    ) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: this.name,
            description: 'Create, update, delete, list, or test dynamic tools. Dynamic tools are TypeScript modules that run in a sandboxed iframe. Names must start with "custom_". The source code must export a "definition" object and an "execute" function.',
            input_schema: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        description: 'Action to perform.',
                        enum: ['create', 'update', 'delete', 'list', 'test'],
                    },
                    name: {
                        type: 'string',
                        description: 'Tool name (must start with "custom_"). Required for create/update/delete/test.',
                    },
                    description: {
                        type: 'string',
                        description: 'Tool description (required for create).',
                    },
                    input_schema: {
                        type: 'object',
                        description: 'JSON Schema for tool input (required for create).',
                    },
                    source_code: {
                        type: 'string',
                        description: 'TypeScript source code. Must export definition and execute function (required for create/update).',
                    },
                    dependencies: {
                        type: 'array',
                        description: 'npm package names to bundle (e.g. ["pptxgenjs"]).',
                        items: { type: 'string' },
                    },
                    is_write_operation: {
                        type: 'boolean',
                        description: 'Whether this tool performs write operations (default: false).',
                    },
                    test_input: {
                        type: 'object',
                        description: 'Input for dry-run test (used with action="test").',
                    },
                },
                required: ['action'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const params = input as unknown as CreateDynamicToolInput;
        const action = (params.action ?? '').trim();

        try {
            if (action === 'create') {
                await this.handleCreate(params, callbacks, context);
            } else if (action === 'update') {
                await this.handleUpdate(params, callbacks, context);
            } else if (action === 'delete') {
                await this.handleDelete(params, callbacks, context);
            } else if (action === 'list') {
                await this.handleList(callbacks);
            } else if (action === 'test') {
                await this.handleTest(params, callbacks);
            } else {
                callbacks.pushToolResult(this.formatError(`Unknown action: "${action}".`));
            }
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
        }
    }

    // -----------------------------------------------------------------------
    // Action handlers
    // -----------------------------------------------------------------------

    private async handleCreate(
        params: CreateDynamicToolInput,
        callbacks: { pushToolResult(c: string): void },
        context: ToolExecutionContext,
    ): Promise<void> {
        if (!params.name) throw new Error('Missing "name".');
        if (!params.name.startsWith('custom_')) {
            throw new Error('Tool name must start with "custom_" prefix.');
        }
        if (!params.description) throw new Error('Missing "description".');
        if (!params.source_code) throw new Error('Missing "source_code".');
        if (!params.input_schema) throw new Error('Missing "input_schema".');

        // AST validation (supplementary)
        const validation = AstValidator.validate(params.source_code);
        if (!validation.valid) {
            throw new Error(`Source code validation failed:\n${validation.errors.join('\n')}`);
        }

        // Compile
        const compiledJs = await this.compile(params.source_code, params.dependencies);

        // AST validation on compiled output
        const outputValidation = AstValidator.validate(compiledJs);
        if (!outputValidation.valid) {
            throw new Error(`Compiled output validation failed:\n${outputValidation.errors.join('\n')}`);
        }

        // Dry-run test in sandbox
        await this.sandboxExecutor.execute(compiledJs, params.test_input ?? {});

        // Build definition
        const definition: DynamicToolDefinition = {
            name: params.name,
            description: params.description,
            input_schema: params.input_schema,
            isWriteOperation: params.is_write_operation ?? false,
            dependencies: params.dependencies,
        };

        // Save record
        const record: DynamicToolRecord = {
            definition,
            sourceTs: params.source_code,
            compiledJs,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await this.dynamicToolLoader.save(record);

        // Register in ToolRegistry
        const tool = DynamicToolFactory.create(definition, compiledJs, this.sandboxExecutor, this.plugin);
        this.toolRegistry.register(tool);

        callbacks.pushToolResult(this.formatSuccess(
            `Dynamic tool "${params.name}" created and registered. It is now available for use.`
        ));
        context.invalidateToolCache?.();
    }

    private async handleUpdate(
        params: CreateDynamicToolInput,
        callbacks: { pushToolResult(c: string): void },
        context: ToolExecutionContext,
    ): Promise<void> {
        if (!params.name) throw new Error('Missing "name".');
        if (!params.source_code) throw new Error('Missing "source_code" for update.');

        // Validate
        const validation = AstValidator.validate(params.source_code);
        if (!validation.valid) {
            throw new Error(`Source code validation failed:\n${validation.errors.join('\n')}`);
        }

        // Compile
        const compiledJs = await this.compile(params.source_code, params.dependencies);

        // Build definition
        const definition: DynamicToolDefinition = {
            name: params.name,
            description: params.description ?? params.name,
            input_schema: params.input_schema ?? { type: 'object', properties: {} },
            isWriteOperation: params.is_write_operation ?? false,
            dependencies: params.dependencies,
        };

        // Save + re-register
        const record: DynamicToolRecord = {
            definition,
            sourceTs: params.source_code,
            compiledJs,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await this.dynamicToolLoader.save(record);

        const tool = DynamicToolFactory.create(definition, compiledJs, this.sandboxExecutor, this.plugin);
        this.toolRegistry.register(tool);

        callbacks.pushToolResult(this.formatSuccess(`Dynamic tool "${params.name}" updated.`));
        context.invalidateToolCache?.();
    }

    private async handleDelete(
        params: CreateDynamicToolInput,
        callbacks: { pushToolResult(c: string): void },
        context: ToolExecutionContext,
    ): Promise<void> {
        if (!params.name) throw new Error('Missing "name".');

        await this.dynamicToolLoader.remove(params.name);
        this.toolRegistry.unregister(params.name as import('../types').ToolName);

        callbacks.pushToolResult(this.formatSuccess(`Dynamic tool "${params.name}" deleted.`));
        context.invalidateToolCache?.();
    }

    private async handleList(callbacks: { pushToolResult(c: string): void }): Promise<void> {
        const names = await this.dynamicToolLoader.listNames();
        if (names.length === 0) {
            callbacks.pushToolResult(this.formatSuccess('No dynamic tools found.'));
            return;
        }
        callbacks.pushToolResult(this.formatSuccess(
            `${names.length} dynamic tool(s):\n${names.map(n => `- ${n}`).join('\n')}`
        ));
    }

    private async handleTest(
        params: CreateDynamicToolInput,
        callbacks: { pushToolResult(c: string): void },
    ): Promise<void> {
        if (!params.name) throw new Error('Missing "name".');
        if (!params.source_code && !params.test_input) {
            throw new Error('Provide "source_code" to compile+test, or "test_input" to test an existing tool.');
        }

        if (params.source_code) {
            const compiledJs = await this.compile(params.source_code, params.dependencies);
            const result = await this.sandboxExecutor.execute(compiledJs, params.test_input ?? {});
            const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
            callbacks.pushToolResult(this.formatSuccess(`Test result:\n${output}`));
        } else {
            // Test existing tool
            const tool = this.toolRegistry.getTool(params.name as import('../types').ToolName);
            if (!tool) throw new Error(`Tool "${params.name}" not found.`);
            callbacks.pushToolResult(this.formatSuccess(`Tool "${params.name}" exists and is registered.`));
        }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private async compile(source: string, dependencies?: string[]): Promise<string> {
        if (dependencies && dependencies.length > 0) {
            return await this.esbuildManager.build(source, dependencies);
        }
        return await this.esbuildManager.transform(source);
    }
}

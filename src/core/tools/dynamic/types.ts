/**
 * Dynamic Tool Types
 *
 * Shared types for the dynamic tool system.
 */

export interface DynamicToolDefinition {
    name: string;
    description: string;
    input_schema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
    isWriteOperation?: boolean;
    dependencies?: string[];
}

export interface DynamicToolRecord {
    definition: DynamicToolDefinition;
    sourceTs: string;
    compiledJs: string;
    createdAt: string;
    updatedAt: string;
}

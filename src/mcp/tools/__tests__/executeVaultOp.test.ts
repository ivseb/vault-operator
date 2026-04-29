/**
 * AUDIT-013 C-1 + M-1 regression tests.
 *
 * Verifies that execute_vault_op rejects agent-internal tools and any
 * write/mutation tool at the MCP handler boundary, before the registry
 * lookup happens.
 */

import { describe, it, expect } from 'vitest';
import { handleExecuteVaultOp } from '../executeVaultOp';

function makePlugin(): unknown {
    return {
        toolRegistry: {
            getTool: () => undefined,
            getAllTools: () => [],
        },
    };
}

describe('handleExecuteVaultOp -- MCP deny gate (AUDIT-013 C-1 + M-1)', () => {
    it.each([
        'switch_mode',
        'new_task',
        'update_todo_list',
        'update_settings',
        'manage_skill',
        'enable_plugin',
        'call_plugin_api',
    ])('rejects agent-internal tool %s as not callable via MCP', async (op) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await handleExecuteVaultOp(makePlugin() as any, { operation: op });
        expect(result.isError).toBe(true);
        const text = (result.content[0] as { text: string }).text;
        expect(text).toContain('agent-internal');
    });

    it.each([
        'write_file',
        'edit_file',
        'append_to_file',
        'delete_file',
        'move_file',
        'update_frontmatter',
        'create_folder',
        'create_pptx',
        'create_docx',
        'create_xlsx',
        'evaluate_expression',
        'execute_recipe',
        'execute_command',
        'ingest_document',
    ])('rejects mutating / executing tool %s', async (op) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await handleExecuteVaultOp(makePlugin() as any, { operation: op });
        expect(result.isError).toBe(true);
        const text = (result.content[0] as { text: string }).text;
        // Tools that are both agent-internal AND mutating (e.g. execute_recipe)
        // hit the agent-internal gate first; either message is acceptable.
        expect(text).toMatch(/(agent-internal|not permitted)/);
    });

    it('returns error when operation is missing', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await handleExecuteVaultOp(makePlugin() as any, {});
        expect(result.isError).toBe(true);
    });

    it('falls through to registry lookup for read-style tools (returns "Unknown" since registry is empty)', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await handleExecuteVaultOp(makePlugin() as any, { operation: 'read_file' });
        expect(result.isError).toBe(true);
        const text = (result.content[0] as { text: string }).text;
        // The deny gate did NOT fire; the empty registry produced the unknown-op error.
        expect(text).toContain('Unknown operation');
    });
});

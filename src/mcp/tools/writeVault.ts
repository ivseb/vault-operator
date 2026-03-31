/**
 * write_vault -- Create, edit, append, or delete vault files.
 * Batch operations supported. Each write is logged.
 */

import { TFile } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import type { McpToolResult } from '../types';

interface WriteOp {
    type: 'create' | 'edit' | 'append' | 'delete';
    path: string;
    content?: string;
}

export async function handleWriteVault(
    plugin: ObsidianAgentPlugin,
    args: Record<string, unknown>,
): Promise<McpToolResult> {
    const operations = args.operations as WriteOp[] | undefined;
    if (!operations || !Array.isArray(operations) || operations.length === 0) {
        return { content: [{ type: 'text', text: 'Error: operations parameter is required' }], isError: true };
    }

    if (operations.length > 20) {
        return { content: [{ type: 'text', text: 'Error: max 20 operations per call' }], isError: true };
    }

    const results: string[] = [];
    const vault = plugin.app.vault;

    for (const op of operations) {
        try {
            switch (op.type) {
                case 'create': {
                    if (!op.content) { results.push(`${op.path}: Error -- content required for create`); break; }
                    // Ensure parent folder exists
                    const dir = op.path.substring(0, op.path.lastIndexOf('/'));
                    if (dir) {
                        const folderExists = vault.getAbstractFileByPath(dir);
                        if (!folderExists) await vault.createFolder(dir);
                    }
                    await vault.create(op.path, op.content);
                    results.push(`${op.path}: Created`);
                    break;
                }
                case 'edit': {
                    if (!op.content) { results.push(`${op.path}: Error -- content required for edit`); break; }
                    const file = vault.getAbstractFileByPath(op.path);
                    if (!(file instanceof TFile)) { results.push(`${op.path}: Error -- file not found`); break; }
                    await vault.modify(file, op.content);
                    results.push(`${op.path}: Modified`);
                    break;
                }
                case 'append': {
                    if (!op.content) { results.push(`${op.path}: Error -- content required for append`); break; }
                    const appendFile = vault.getAbstractFileByPath(op.path);
                    if (!(appendFile instanceof TFile)) { results.push(`${op.path}: Error -- file not found`); break; }
                    await vault.append(appendFile, op.content);
                    results.push(`${op.path}: Appended`);
                    break;
                }
                case 'delete': {
                    const delFile = vault.getAbstractFileByPath(op.path);
                    if (!(delFile instanceof TFile)) { results.push(`${op.path}: Error -- file not found`); break; }
                    await vault.trash(delFile, true);
                    results.push(`${op.path}: Deleted (moved to trash)`);
                    break;
                }
                default:
                    results.push(`${op.path}: Error -- unknown operation type: ${op.type}`);
            }
        } catch (e) {
            results.push(`${op.path}: Error -- ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    return { content: [{ type: 'text', text: results.join('\n') }] };
}

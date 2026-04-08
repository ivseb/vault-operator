/**
 * VaultHealthCheckTool -- Run vault health checks and report findings.
 *
 * Executes SQL-based health checks (orphaned notes, missing backlinks,
 * broken links, weak clusters, inconsistent tags) and returns findings
 * formatted for the agent to suggest fixes.
 *
 * ADR-067: Lint Architecture
 * FEATURE-1901: Vault Health Check
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

export class VaultHealthCheckTool extends BaseTool<'vault_health_check'> {
    readonly name = 'vault_health_check' as const;
    readonly isWriteOperation = false;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'vault_health_check',
            description:
                'Run structural health checks on the vault: orphaned notes (no incoming links), missing backlinks (one-directional MOC links), broken links (target does not exist), weak clusters (semantically similar but not linked), inconsistent tags (spelling variants). Returns findings with suggested fixes. Use this proactively to maintain vault quality.',
            input_schema: {
                type: 'object',
                properties: {},
            },
        };
    }

    async execute(_input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;

        const healthService = this.plugin.vaultHealthService;
        if (!healthService) {
            callbacks.pushToolResult('Vault health check is not available. The semantic index must be built first (Settings > Embeddings > Build Index).');
            return;
        }

        try {
            const findings = await healthService.runChecks();
            const formatted = healthService.formatFindings(findings);

            callbacks.pushToolResult(formatted);
            callbacks.log(`Vault health check: ${findings.length} finding(s)`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
        }
    }
}

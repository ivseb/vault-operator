/**
 * MCP Path Validation -- Governance checks for MCP tool handlers (AUDIT-006 H-2).
 *
 * Applies the same path safety rules as the internal tool pipeline:
 * - Path traversal prevention (SandboxBridge pattern)
 * - IgnoreService checks (agentignore / agentprotected)
 * - configDir protection
 */

import type ObsidianAgentPlugin from '../../main';

export interface McpPathValidation {
    allowed: boolean;
    reason?: string;
}

/**
 * Validate a vault path for MCP access.
 * @param plugin Plugin instance (for vault.configDir and IgnoreService)
 * @param path Vault-relative path
 * @param isWrite Whether this is a write operation
 */
export function validateMcpVaultPath(
    plugin: ObsidianAgentPlugin,
    path: string,
    isWrite: boolean,
): McpPathValidation {
    // 1. Path traversal check. MCP-5: normalize-then-verify by splitting on both
    // separators and rejecting any `.`/`..` segment (plus absolute paths),
    // instead of a `.includes('..')` substring denylist that also mis-rejects
    // legitimate names like `foo..bar.md` and is brittle for non-normalized
    // callers.
    const segments = path.split(/[/\\]/);
    if (path.startsWith('/') || path.startsWith('\\') || segments.some((s) => s === '.' || s === '..')) {
        return { allowed: false, reason: 'Invalid path: traversal or absolute path rejected' };
    }

    // 2. configDir protection (writes only)
    if (isWrite) {
        const configDir = plugin.app.vault.configDir;
        const normalized = path.replace(/\\/g, '/');
        if (normalized.startsWith(`${configDir}/`) || normalized === configDir) {
            return { allowed: false, reason: `Write blocked: ${configDir}/ is protected` };
        }
    }

    // 3. IgnoreService checks
    const ignoreService = plugin.ignoreService;
    if (ignoreService) {
        if (ignoreService.isIgnored(path)) {
            return { allowed: false, reason: 'Path is ignored by .obsidian-agentignore' };
        }
        if (isWrite && ignoreService.isProtected(path)) {
            return { allowed: false, reason: 'Path is write-protected by .obsidian-agentprotected' };
        }
    }

    return { allowed: true };
}

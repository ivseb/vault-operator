/**
 * IgnoreService - File access governance (Sprint 1.6)
 *
 * Reads `.obsidian-agentignore` (gitignore syntax) and `.obsidian-agentprotected`
 * from the vault root to control which paths the agent can access.
 *
 * - Ignored paths: not accessible at all (like .gitignore)
 * - Protected paths: accessible for reading but NEVER writable (even with approval)
 *
 * Always blocks: .obsidian/ internals (except plugin files), .git/
 */

import type { Vault } from 'obsidian';
import { safeRegex } from '../utils/safeRegex';
import { isProtectedAgentConfigPath, isAgentSecretPath } from './agentFolderGuard';

export class IgnoreService {
    private vault: Vault;
    private ignorePatterns: string[] = [];
    private protectedPatterns: string[] = [];
    private loaded = false;

    /** Paths always blocked regardless of config (built from vault.configDir) */
    private alwaysBlocked: string[];

    /**
     * FIX-44-24: vault-relative agent folder root. When set, the agent's own
     * config zone (settings.json, mcp config, provenance manifest, cache -- i.e.
     * everything under the agent folder except skills/ and skill-data/) is
     * write-protected, so no vault tool can let the agent rewrite its own
     * settings and self-escalate. Empty string disables the check.
     */
    private agentRoot: string;

    /** Paths always write-protected regardless of config */
    private static readonly ALWAYS_PROTECTED: string[] = [
        '.obsidian-agentignore',
        '.obsidian-agentprotected',
    ];

    /** Vault config dir (`.obsidian`), lower-cased once for case-safe matching. */
    private readonly configDirLower: string;

    constructor(vault: Vault, agentRoot = '') {
        this.vault = vault;
        this.agentRoot = agentRoot;
        const configDir = vault.configDir;
        this.configDirLower = configDir.toLowerCase();
        this.alwaysBlocked = [
            '.git/',
        ];
    }

    /** FIX-44-24: bind (or update) the agent folder root for config protection. */
    setAgentRoot(agentRoot: string): void {
        this.agentRoot = agentRoot;
    }

    /**
     * Load (or reload) ignore and protected patterns from vault root files.
     * Called at plugin start and can be re-called if files change.
     */
    async load(): Promise<void> {
        this.ignorePatterns = await this.readPatternFile('.obsidian-agentignore');
        this.protectedPatterns = await this.readPatternFile('.obsidian-agentprotected');
        this.loaded = true;
    }

    /**
     * Check if a path is completely blocked (agent cannot access it at all).
     * Returns true if the path should be denied.
     */
    isIgnored(path: string): boolean {
        if (!this.loaded) return true; // fail-closed: deny all until rules are loaded
        const normalPath = this.normalize(path);

        // BYP-2 (AUDIT 2026-07-14): normalize() does not collapse `..`, so a
        // path like `Inbox/../.obsidian/...` would slip the deny-zone here while
        // the adapter resolves it into configDir. Reject any `..` segment
        // fail-closed rather than relying on each tool to strip traversal.
        if (normalPath.split('/').some((seg) => seg === '..')) return true;

        // H-1/H-2 (AUDIT 2026-07-14): configDir (.obsidian) is an absolute
        // read+write deny-zone for vault tools and MCP. It holds every plugin's
        // data.json (credentials) and main.js (arbitrary code executed on the
        // next Obsidian reload); no agent tool has a legitimate reason to touch
        // it. Case-insensitive so a `.Obsidian/...` variant cannot slip past on
        // case-insensitive filesystems (H-3). This mirrors the sandbox bridge,
        // which already blocks configDir symmetrically.
        const lower = normalPath.toLowerCase();
        if (lower === this.configDirLower || lower.startsWith(`${this.configDirLower}/`)) {
            return true;
        }

        // H-2: the agent's own secret zone (settings.json, data/ DBs, cache,
        // provenance manifest) is off-limits for reads as well as writes;
        // skills/, skill-data/ and tmp/ stay accessible.
        if (isAgentSecretPath(normalPath, this.agentRoot)) return true;

        // Always-blocked paths
        for (const blocked of this.alwaysBlocked) {
            if (normalPath === blocked || normalPath.startsWith(blocked)) return true;
        }

        // User-defined ignore patterns
        return this.matchesAnyPattern(normalPath, this.ignorePatterns);
    }

    /**
     * Check if a path is protected from writing.
     * Protected paths can be read but never written/deleted/moved.
     */
    isProtected(path: string): boolean {
        if (!this.loaded) return true; // fail-closed: protect all until rules are loaded
        const normalPath = this.normalize(path);

        // Always-protected governance files
        for (const p of IgnoreService.ALWAYS_PROTECTED) {
            if (normalPath === p) return true;
        }

        // FIX-44-24: the agent's own config zone is never writable by a tool.
        if (isProtectedAgentConfigPath(normalPath, this.agentRoot)) return true;

        // User-defined protected patterns
        return this.matchesAnyPattern(normalPath, this.protectedPatterns);
    }

    /**
     * Get user-facing description of why a path is blocked.
     *
     * When the blocked path looks like an attempt to reach a skill definition by
     * filesystem path, the message redirects to the by-name skill tools. The
     * skills folder is hidden and per-install configurable (default
     * `.vault-operator/data/skills/`, but overridable and even absolute), so a
     * constructed path is fragile -- an agent that guesses `.obsidian/plugins/
     * .../skills/...` hits this deny-zone. read_skill / write_skill resolve the
     * real path from the skill NAME, so the agent never needs to know it.
     */
    getDenialReason(path: string): string {
        const base = this.isProtected(path)
            ? `"${path}" is protected (.obsidian-agentprotected). Cannot write to protected files.`
            : this.isIgnored(path)
                ? `"${path}" is excluded (.obsidian-agentignore). Add it to the ignore list to allow access.`
                : `"${path}" is blocked by system defaults.`;

        if (looksLikeSkillDefinitionPath(this.normalize(path))) {
            return base
                + ' If you meant to read or revise an installed skill, do not target its files by '
                + 'path -- use read_skill or write_skill with the skill NAME; they resolve the '
                + 'hidden, per-install skills folder for you.';
        }
        return base;
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private async readPatternFile(filename: string): Promise<string[]> {
        try {
            const file = this.vault.getAbstractFileByPath(filename);
            if (!file) return [];
            const content = await this.vault.adapter.read(filename);
            return content
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line.length > 0 && !line.startsWith('#'));
        } catch {
            return [];
        }
    }

    private normalize(path: string): string {
        // Remove leading slash, normalize separators
        return path.replace(/\\/g, '/').replace(/^\//, '');
    }

    /**
     * Minimal gitignore-style pattern matching:
     * - `*` matches any characters except `/`
     * - `**` matches anything including `/`
     * - Trailing `/` means directory match
     * - Leading `!` means negation (not yet supported — skip)
     */
    private matchesAnyPattern(path: string, patterns: string[]): boolean {
        for (const pattern of patterns) {
            if (pattern.startsWith('!')) continue; // negation not supported yet
            if (this.matchPattern(path, pattern)) return true;
        }
        return false;
    }

    private matchPattern(path: string, pattern: string): boolean {
        // Normalize pattern
        const p = pattern.replace(/\\/g, '/').replace(/^\//, '');

        // Directory pattern: "folder/" matches "folder/anything"
        if (p.endsWith('/')) {
            return path.startsWith(p) || path === p.slice(0, -1);
        }

        // M-2: Reject pathologically long or complex patterns to prevent ReDoS
        if (p.length > 200) return false;
        if (/(\*\*){3,}/.test(p)) return false;

        // Convert glob to regex (escape backslashes first to prevent double-escaping)
        const regexStr = p
            .replace(/\\/g, '\\\\') // escape backslashes first
            .replace(/\./g, '\\.') // escape dots
            .replace(/\*\*/g, '§DOUBLESTAR§')
            .replace(/\*/g, '[^/]*')
            .replace(/§DOUBLESTAR§/g, '.*');

        try {
            // AUDIT-007 M-1: Use safeRegex() to prevent ReDoS from glob patterns
            // Pattern without slash: match basename or full path
            if (!p.includes('/')) {
                const basenameRegex = safeRegex(`(^|/)${regexStr}($|/)`);
                return basenameRegex.test(path);
            }
            // Pattern with slash: match from root
            const fullRegex = safeRegex(`^${regexStr}($|/)`);
            return fullRegex.test(path);
        } catch {
            // Invalid regex — fall back to exact match
            return path === p || path.startsWith(p + '/');
        }
    }
}

/**
 * Heuristic: does a (normalised, vault-relative) path look like an attempt to
 * reach a skill DEFINITION by filesystem path? Signals: a `SKILL.md` basename,
 * or a `skills/<name>/` segment (the skill workspace, under any parent -- the
 * real `.vault-operator/data/skills/` OR a wrongly-guessed
 * `.obsidian/plugins/.../skills/`). Only advisory: it merely enriches the
 * message of an already-denied path, so a false positive (e.g. a user note
 * folder literally named `skills`) costs nothing.
 */
function looksLikeSkillDefinitionPath(path: string): boolean {
    return /(^|\/)SKILL\.md$/i.test(path) || /(^|\/)skills\/[^/]+(\/|$)/i.test(path);
}

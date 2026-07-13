/**
 * agentFolderGuard (FIX-44-22 / FIX-44-24)
 *
 * One predicate, two callers. The agent's own folder holds the security-critical
 * configuration -- settings.json (autoApproval flags, provider apiKeys), the MCP
 * config, the provenance manifest, the cache. Neither the sandbox bridge nor the
 * ordinary vault write tools may touch it, or the agent could grant itself every
 * permission by writing its own settings file.
 *
 * The two exceptions belong to the skill workspace, which the agent legitimately
 * owns: `skills/` (skill-creator authors definitions there) and `skill-data/`
 * (a skill's persistent runtime state). A forged `source: pro` inside skills/ is
 * not a trust hole -- trust comes from the provenance manifest, not the file
 * (FIX-44-05).
 *
 * Keeping this in one place means SandboxBridge and IgnoreService cannot drift
 * into disagreeing about what "the config zone" is.
 */

/**
 * True when `safePath` lives inside the agent folder but outside the skill
 * workspace -- i.e. it is agent configuration that must not be written (and, for
 * the sandbox, not read either).
 *
 * @param safePath  a normalised, traversal-free vault-relative path
 * @param agentRoot the vault-relative agent folder root (e.g. `.vault-operator`)
 */
export function isProtectedAgentConfigPath(safePath: string, agentRoot: string): boolean {
    if (!agentRoot) return false;
    if (safePath !== agentRoot && !safePath.startsWith(`${agentRoot}/`)) return false;

    const rel = safePath.slice(agentRoot.length).replace(/^\//, '');
    // Segment-exact so `skills` never matches inside `skill-data`.
    const isSkillWorkspace =
        /(^|\/)skill-data(\/|$)/.test(rel) || /(^|\/)skills(\/|$)/.test(rel);
    return !isSkillWorkspace;
}

/**
 * spawnAllowlist -- centralised child_process wrapper with a hard binary allowlist.
 *
 * Every `child_process.spawn` and `spawnSync` call in the plugin must go through
 * this module. Direct `cp.spawn(...)`, `cp.spawnSync(...)`, and especially
 * `cp.exec(...)`, `cp.execSync(...)` are forbidden outside this file and its tests.
 *
 * The allowlist lists the basenames of all binaries the plugin is allowed to
 * launch. Resolved full paths (`/usr/local/bin/node`) are accepted as long as
 * their `path.basename` matches the allowlist.
 *
 * `shell: true` is rejected. `cp.exec`/`cp.execSync` are not re-exported -- they
 * accept a shell string and have no place in a sandboxed agent plugin.
 *
 * See REVIEWER_NOTES.md and FEAT-27-02-spawn-allowlist.md for the threat model.
 */

/* eslint-disable @typescript-eslint/no-require-imports, security/detect-child-process -- this is the *one* file that owns the child_process module wrapper; all other call sites go through this wrapper */

import type * as CpModule from 'child_process';
import * as path from 'path';

let cpImpl: typeof CpModule | null = null;
function cp(): typeof CpModule {
    if (!cpImpl) {
        cpImpl = require('child_process') as typeof CpModule;
    }
    return cpImpl;
}

/**
 * Binaries the plugin is allowed to spawn. Adding a new entry is a deliberate
 * decision and must be reviewed.
 */
export const ALLOWED_BINARIES: Readonly<Record<string, { reason: string }>> = Object.freeze({
    // AUDIT 2026-07-26 M-10: the reason used to name the sandbox worker
    // process, which no longer exists. node stays because stdio MCP servers
    // are launched with it (STDIO_ALLOWED_COMMANDS, FEAT-04-13).
    node: { reason: 'stdio MCP servers launched via node (FEAT-04-13)' },
    'node.exe': { reason: 'stdio MCP servers on Windows (FEAT-04-13)' },
    npx: { reason: 'stdio MCP servers launched via npx (FEAT-04-13, MVP: node/npx only)' },
    'npx.cmd': { reason: 'npx on Windows (stdio MCP servers, FEAT-04-13)' },
    which: { reason: 'Binary discovery on Unix' },
    where: { reason: 'Binary discovery on Windows' },
    'where.exe': { reason: 'Binary discovery on Windows' },
    git: { reason: 'Shadow git for vault checkpoints (GitCheckpointService)' },
    'git.exe': { reason: 'Shadow git on Windows' },
    soffice: { reason: 'LibreOffice headless conversion (pptxRenderer)' },
    'soffice.exe': { reason: 'LibreOffice headless conversion on Windows' },
    'soffice.bin': { reason: 'LibreOffice headless conversion (Linux variant)' },
    libreoffice: { reason: 'LibreOffice headless conversion alias' },
    'libreoffice.exe': { reason: 'LibreOffice headless conversion alias on Windows' },
    cloudflared: { reason: 'Remote MCP tunnel (McpBridge.startTunnel)' },
    'cloudflared.exe': { reason: 'Remote MCP tunnel on Windows' },
    pandoc: { reason: 'Pandoc document conversion (ExecuteRecipeTool built-in recipes)' },
    'pandoc.exe': { reason: 'Pandoc on Windows' },
});

const SHELL_METACHARS = /[;&|`$<>(){}\\\n\r]/;

/**
 * AUDIT-034 R2/R3: the commands a stdio MCP server may launch (FEAT-04-13 MVP).
 * A strict subset of ALLOWED_BINARIES: node/npx only. Kept here (not in
 * McpClient) so the restriction is one source of truth and the stdio path and
 * the child_process wrapper cannot drift apart.
 */
export const STDIO_ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
    'node', 'node.exe', 'npx', 'npx.cmd',
]);

export class SpawnNotAllowed extends Error {
    constructor(
        public readonly attemptedBinary: string,
        public readonly allowedBinaries: string[],
    ) {
        super(
            `spawnAllowlist: binary "${attemptedBinary}" is not allowed. ` +
            `Allowed: ${allowedBinaries.join(', ')}`,
        );
        this.name = 'SpawnNotAllowed';
    }
}

function checkCommand(command: string): string {
    if (typeof command !== 'string' || command.length === 0) {
        throw new SpawnNotAllowed(String(command), Object.keys(ALLOWED_BINARIES));
    }
    if (SHELL_METACHARS.test(command)) {
        throw new SpawnNotAllowed(command, Object.keys(ALLOWED_BINARIES));
    }
    const base = path.basename(command);
    if (!(base in ALLOWED_BINARIES)) {
        throw new SpawnNotAllowed(command, Object.keys(ALLOWED_BINARIES));
    }
    return command;
}

/**
 * AUDIT-034 R2/R3: gate the command of a stdio MCP server. This path spawns via
 * the MCP SDK's StdioClientTransport (cross-spawn, shell:false), NOT through
 * spawnAllowed, so this guard is what enforces the policy the SDK spawn cannot:
 *
 * - the command must be one of STDIO_ALLOWED_COMMANDS (node/npx MVP), a strict
 *   subset of the general allowlist -- an allowlisted-but-unrelated binary
 *   (git, soffice, ...) is NOT a valid stdio command;
 * - the command must be a bare name with NO path separator, so a basename spoof
 *   like `/tmp/evil/node` (R3) cannot pass by matching only the basename;
 * - no shell metacharacters, mirroring checkCommand for defence in depth.
 *
 * Args are intentionally NOT metachar-filtered: the SDK spawns with shell:false,
 * so args are literal argv (a URL arg may legitimately contain `&`, `?`, `$`).
 * Throws SpawnNotAllowed on violation; returns void on success.
 */
export function assertStdioCommandAllowed(command: string): void {
    const allowed = [...STDIO_ALLOWED_COMMANDS];
    if (typeof command !== 'string' || command.trim().length === 0) {
        throw new SpawnNotAllowed(String(command), allowed);
    }
    if (SHELL_METACHARS.test(command)) {
        throw new SpawnNotAllowed(command, allowed);
    }
    // Reject any path separator: the command must be a bare binary name resolved
    // via PATH, never a caller-chosen absolute/relative path (R3 basename spoof).
    if (/[\\/]/.test(command)) {
        throw new SpawnNotAllowed(command, allowed);
    }
    if (!STDIO_ALLOWED_COMMANDS.has(command.toLowerCase())) {
        throw new SpawnNotAllowed(command, allowed);
    }
}

function forceNoShell<T extends CpModule.SpawnOptions | CpModule.SpawnSyncOptions>(options: T | undefined): T {
    const opts = { ...(options ?? ({} as T)) } as T & { shell?: boolean | string };
    if (opts.shell) {
        throw new SpawnNotAllowed('<shell:true forbidden>', Object.keys(ALLOWED_BINARIES));
    }
    opts.shell = false;
    return opts;
}

/**
 * Allowed wrapper around `child_process.spawn`. Throws SpawnNotAllowed if the
 * binary is not in the allowlist, the command contains shell metacharacters,
 * or `shell: true` is requested.
 */
export function spawnAllowed(command: string, args: readonly string[] = [], options?: CpModule.SpawnOptions): CpModule.ChildProcess {
    return cp().spawn(checkCommand(command), [...args], forceNoShell(options));
}

/**
 * Allowed wrapper around `child_process.spawnSync`. Same restrictions as
 * spawnAllowed.
 */
export function spawnAllowedSync(command: string, args: readonly string[] = [], options?: CpModule.SpawnSyncOptions): CpModule.SpawnSyncReturns<Buffer | string> {
    return cp().spawnSync(checkCommand(command), [...args], forceNoShell(options));
}

/** Test-only: list current allowlist. */
export function _allowedForTest(): string[] {
    return Object.keys(ALLOWED_BINARIES);
}

/* eslint-enable @typescript-eslint/no-require-imports, security/detect-child-process -- end of spawnAllowlist file scope (review-bot Tier 4: both disabled rules need matching enable) */

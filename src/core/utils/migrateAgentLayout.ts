/**
 * migrateAgentLayout -- consolidate plugin storage into {vault}/.vault-operator/.
 *
 * Background (FEAT-29-01, ADR-119 third iteration 2026-05-20):
 *
 * Plugin storage drifted across four roots over multiple naming waves:
 *   - {vault}/.obsidian-agent/                Legacy (telemetry remains)
 *   - {vault}/.obsilo-vault/                  vault-local agent data
 *   - {vault}/.vault-operator/                vault-local optional asset cache
 *   - {vault-parent}/obsilo-shared/           cross-vault shared data + cache
 *
 * This service consolidates all four into:
 *   - {vault}/.vault-operator/data/           persistent user state
 *   - {vault}/.vault-operator/cache/          regenerable artefacts
 *
 * Cross-vault sharing is provided by a separate backup-export tool
 * (FEAT-29-12 Welle 4), not by a vault-parent root anymore.
 *
 * Phase order (idempotent, resumable via settings._layoutMigrationStatus):
 *   1. backup            full snapshot outside iCloud-synced vault tree
 *   2. data-vault        .obsilo-vault/* (data files)     -> .vault-operator/data/*
 *   3. cache-vault       .vault-operator/{assets,runtime} -> .vault-operator/cache/*
 *   4. data-shared       obsilo-shared/{history,memory,...} -> .vault-operator/data/*
 *   5. cache-shared      obsilo-shared/{checkpoints,...}  -> .vault-operator/cache/*
 *   6. skills-resolve    drift-merge skills/ from two sources (mtime precedence)
 *   7. cleanup           remove emptied legacy roots
 *   8. settings          flip agentFolderPath default, remove chatHistoryFolder
 *  10. report            write migration-report.json
 *
 * Phase 9 (chatHistoryFolder removal notice) lives in the trigger (plugin.onload)
 * because it requires a UI-modal that the pure migration service does not own.
 * The service returns a flag indicating whether the notice should fire.
 *
 * Strategy per file: fs.rename (atomic, same partition) with copy+delete
 * fallback on EXDEV / EPERM / EBUSY. Pattern adapted from
 * migratePluginDataDirs (FIX-28-00-03).
 *
 * Desktop-only: rawFs require would crash on Mobile. Caller must gate with
 * Platform.isDesktop (plugin currently isDesktopOnly anyway).
 */

/* eslint-disable @typescript-eslint/no-require-imports -- rawFs needed for
 * destinations outside the vault and for atomic renames; same pattern as
 * migratePluginDataDirs and GitCheckpointService.
 */
const rawFs = require('fs') as typeof import('fs');
import * as pathModule from 'path';

// ─────────────────────────────────────────────────────────────────────────
// Status flag for resume
// ─────────────────────────────────────────────────────────────────────────

export type LayoutMigrationStatus =
    | 'pending'
    | 'backup-done'
    | 'data-vault-done'
    | 'cache-vault-done'
    | 'data-shared-done'
    | 'cache-shared-done'
    | 'skills-resolved'
    | 'cleanup-done'
    | 'settings-done'
    | 'complete';

const PHASE_ORDER: LayoutMigrationStatus[] = [
    'pending',
    'backup-done',
    'data-vault-done',
    'cache-vault-done',
    'data-shared-done',
    'cache-shared-done',
    'skills-resolved',
    'cleanup-done',
    'settings-done',
    'complete',
];

function isPhaseDone(current: LayoutMigrationStatus, phase: LayoutMigrationStatus): boolean {
    return PHASE_ORDER.indexOf(current) >= PHASE_ORDER.indexOf(phase);
}

// ─────────────────────────────────────────────────────────────────────────
// Report shape
// ─────────────────────────────────────────────────────────────────────────

export interface PhaseEntry {
    phase: LayoutMigrationStatus;
    /** Items processed in this phase (paths or skill names). */
    items: Array<{
        from: string;
        to: string;
        status: 'renamed' | 'copied' | 'skipped-no-source' | 'skipped-destination-populated' | 'failed';
        error?: string;
    }>;
    /** Wall-clock duration in milliseconds. */
    durationMs: number;
}

export interface LayoutMigrationReport {
    /** Final status the service reached. */
    status: LayoutMigrationStatus;
    /** When the migration started (ISO timestamp). */
    startedAt: string;
    /** When the migration finished (ISO timestamp). */
    finishedAt: string;
    /** Backup snapshot path, written in phase 1. */
    backupPath: string | null;
    /** Per-phase report. */
    phases: PhaseEntry[];
    /** True iff the chatHistoryFolder setting had a non-empty value before
     * migration. Caller (trigger) uses this to fire the removal-notice modal. */
    chatHistoryFolderHadValue: string | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Input contract
// ─────────────────────────────────────────────────────────────────────────

export interface AgentLayoutMigrationInput {
    /** Absolute filesystem path to the vault root. */
    vaultBasePath: string;
    /** Absolute filesystem path to the vault parent (one level up). */
    vaultParent: string;
    /** Absolute filesystem path to the Obsidian plugin data directory
     * (outside the vault). Backups are written here so iCloud-sync of the
     * vault does not replicate them across devices. */
    pluginDataDir: string;
    /** Current value of settings.agentFolderPath. Default is .vault-operator. */
    agentFolderPath: string;
    /** Current value of settings.chatHistoryFolder. May be empty. */
    chatHistoryFolder: string;
    /** Current status flag from settings._layoutMigrationStatus. */
    currentStatus: LayoutMigrationStatus;
    /** Callback to persist the status flag after each phase. */
    setStatus: (status: LayoutMigrationStatus) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────
// Filesystem helpers (lifted from migratePluginDataDirs, kept private)
// ─────────────────────────────────────────────────────────────────────────

async function pathExists(p: string): Promise<boolean> {
    try {
        await rawFs.promises.access(p);
        return true;
    } catch {
        return false;
    }
}

async function isDirEmpty(p: string): Promise<boolean> {
    try {
        const entries = await rawFs.promises.readdir(p);
        return entries.length === 0;
    } catch {
        return true;
    }
}

async function copyRecursive(src: string, dest: string): Promise<void> {
    const stat = await rawFs.promises.stat(src);
    if (stat.isDirectory()) {
        await rawFs.promises.mkdir(dest, { recursive: true });
        const entries = await rawFs.promises.readdir(src, { withFileTypes: true });
        for (const entry of entries) {
            const s = pathModule.join(src, entry.name);
            const d = pathModule.join(dest, entry.name);
            await copyRecursive(s, d);
        }
    } else {
        await rawFs.promises.mkdir(pathModule.dirname(dest), { recursive: true });
        await rawFs.promises.copyFile(src, dest);
    }
}

/**
 * Move a single source path to destination. Strategy:
 *   1. fs.rename (atomic on same partition)
 *   2. on EXDEV/EPERM/EBUSY/ENOTEMPTY: copy + delete
 *
 * Returns one of the documented status values. Never throws.
 */
async function moveOne(from: string, to: string): Promise<{
    status: PhaseEntry['items'][0]['status'];
    error?: string;
}> {
    if (!(await pathExists(from))) {
        return { status: 'skipped-no-source' };
    }
    if ((await pathExists(to)) && !(await isDirEmpty(to))) {
        return { status: 'skipped-destination-populated' };
    }
    await rawFs.promises.mkdir(pathModule.dirname(to), { recursive: true });
    if (await pathExists(to)) {
        try { await rawFs.promises.rmdir(to); } catch { /* tolerate */ }
    }
    try {
        await rawFs.promises.rename(from, to);
        return { status: 'renamed' };
    } catch (e) {
        const code = (e as NodeJS.ErrnoException)?.code ?? '';
        if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'EBUSY' && code !== 'ENOTEMPTY') {
            return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
        }
    }
    try {
        await copyRecursive(from, to);
        await rawFs.promises.rm(from, { recursive: true, force: true });
        return { status: 'copied' };
    } catch (e) {
        return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 1: Backup snapshot
// ─────────────────────────────────────────────────────────────────────────

interface BackupResult {
    backupPath: string;
    bytesCopied: number;
}

/**
 * Create a backup snapshot of all four legacy roots under the Obsidian
 * plugin data directory (outside the vault, outside iCloud sync). Returns
 * the absolute backup path. Skips silently when a source root does not exist.
 *
 * Naming: vault-operator-backup-{ISO-timestamp}/{root-name}/...
 */
async function phaseBackup(input: AgentLayoutMigrationInput): Promise<BackupResult> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupRoot = pathModule.join(input.pluginDataDir, `vault-operator-backup-${timestamp}`);
    await rawFs.promises.mkdir(backupRoot, { recursive: true });

    const sources = [
        { label: 'obsidian-agent', from: pathModule.join(input.vaultBasePath, '.obsidian-agent') },
        { label: 'obsilo-vault', from: pathModule.join(input.vaultBasePath, '.obsilo-vault') },
        { label: 'vault-operator', from: pathModule.join(input.vaultBasePath, '.vault-operator') },
        { label: 'obsilo-shared', from: pathModule.join(input.vaultParent, 'obsilo-shared') },
    ];

    let bytesCopied = 0;
    for (const src of sources) {
        if (!(await pathExists(src.from))) continue;
        const dest = pathModule.join(backupRoot, src.label);
        await copyRecursive(src.from, dest);
        // approximate byte count via du-like recursive sum
        bytesCopied += await sumBytes(dest);
    }

    return { backupPath: backupRoot, bytesCopied };
}

async function sumBytes(p: string): Promise<number> {
    try {
        const stat = await rawFs.promises.stat(p);
        if (!stat.isDirectory()) return stat.size;
        let total = 0;
        const entries = await rawFs.promises.readdir(p, { withFileTypes: true });
        for (const entry of entries) {
            total += await sumBytes(pathModule.join(p, entry.name));
        }
        return total;
    } catch {
        return 0;
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 2: Data-Move vault-local (.obsilo-vault/* -> .vault-operator/data/*)
// ─────────────────────────────────────────────────────────────────────────

interface DataVaultMoveEntry {
    /** Folder or file name relative to .obsilo-vault/ */
    name: string;
}

/**
 * Items moved in phase 2. Drift Note: skills/ is intentionally NOT in this
 * list because phase 6 resolves it from two sources. plugin-skills/ stays in
 * this phase because FEAT-29-02 (Plugin-Skill-Format-Migration) is a
 * follow-up; here we only move bytes, not format.
 *
 * tmp/ and soak-reports/ go to cache/ in phase 3, not here.
 */
const DATA_VAULT_ENTRIES: DataVaultMoveEntry[] = [
    { name: 'knowledge.db' },
    { name: 'knowledge.db.bak' },
    { name: '.bak' },
    { name: 'plugin-skills' },
    { name: 'vault-dna.json' },
];

async function phaseDataVault(input: AgentLayoutMigrationInput): Promise<PhaseEntry['items']> {
    const sourceRoot = pathModule.join(input.vaultBasePath, '.obsilo-vault');
    const destRoot = pathModule.join(input.vaultBasePath, '.vault-operator', 'data');
    await rawFs.promises.mkdir(destRoot, { recursive: true });

    const results: PhaseEntry['items'] = [];
    for (const entry of DATA_VAULT_ENTRIES) {
        const from = pathModule.join(sourceRoot, entry.name);
        const to = pathModule.join(destRoot, entry.name);
        const r = await moveOne(from, to);
        results.push({ from, to, ...r });
    }
    return results;
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 3: Cache-Move vault-local
//   .vault-operator/{assets, runtime}    -> .vault-operator/cache/{assets, runtime}
//   .obsilo-vault/{tmp, soak-reports}    -> .vault-operator/cache/{tmp, soak-reports}
// ─────────────────────────────────────────────────────────────────────────

async function phaseCacheVault(input: AgentLayoutMigrationInput): Promise<PhaseEntry['items']> {
    const vaultOperatorRoot = pathModule.join(input.vaultBasePath, '.vault-operator');
    const cacheRoot = pathModule.join(vaultOperatorRoot, 'cache');
    const obsiloVaultRoot = pathModule.join(input.vaultBasePath, '.obsilo-vault');
    await rawFs.promises.mkdir(cacheRoot, { recursive: true });

    // Restructure inside .vault-operator/: assets and runtime move into cache/
    const inPlace: Array<{ name: string }> = [{ name: 'assets' }, { name: 'runtime' }];
    // Move throwaway data from .obsilo-vault into cache/
    const fromVault: Array<{ name: string }> = [{ name: 'tmp' }, { name: 'soak-reports' }];

    const results: PhaseEntry['items'] = [];
    for (const entry of inPlace) {
        const from = pathModule.join(vaultOperatorRoot, entry.name);
        const to = pathModule.join(cacheRoot, entry.name);
        const r = await moveOne(from, to);
        results.push({ from, to, ...r });
    }
    for (const entry of fromVault) {
        const from = pathModule.join(obsiloVaultRoot, entry.name);
        const to = pathModule.join(cacheRoot, entry.name);
        const r = await moveOne(from, to);
        results.push({ from, to, ...r });
    }
    return results;
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 4: Data-Move shared
//   obsilo-shared/{history, history.db[.bak], memory, memory.db[.bak],
//   memory-v1-backup, episodes, logs, rules, workflows, pending-extractions.json}
//     -> .vault-operator/data/*
// ─────────────────────────────────────────────────────────────────────────

const DATA_SHARED_ENTRIES: Array<{ name: string }> = [
    { name: 'history' },
    { name: 'history.db' },
    { name: 'history.db.bak' },
    { name: 'memory' },
    { name: 'memory.db' },
    { name: 'memory.db.bak' },
    { name: 'memory-v1-backup' },
    { name: 'episodes' },
    { name: 'logs' },
    { name: 'rules' },
    { name: 'workflows' },
    { name: 'pending-extractions.json' },
];

async function phaseDataShared(input: AgentLayoutMigrationInput): Promise<PhaseEntry['items']> {
    const sourceRoot = pathModule.join(input.vaultParent, 'obsilo-shared');
    const destRoot = pathModule.join(input.vaultBasePath, '.vault-operator', 'data');
    await rawFs.promises.mkdir(destRoot, { recursive: true });

    const results: PhaseEntry['items'] = [];
    for (const entry of DATA_SHARED_ENTRIES) {
        const from = pathModule.join(sourceRoot, entry.name);
        const to = pathModule.join(destRoot, entry.name);
        const r = await moveOne(from, to);
        results.push({ from, to, ...r });
    }
    return results;
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 5: Cache-Move shared
//   obsilo-shared/{checkpoints, dev-env, tmp, .bak}
//     -> .vault-operator/cache/{checkpoints, dev-env, tmp-shared, .bak-shared}
// (tmp and .bak get the -shared suffix to avoid collision with vault-local
//  counterparts that already moved in phase 3 and phase 2 respectively.)
// ─────────────────────────────────────────────────────────────────────────

const CACHE_SHARED_ENTRIES: Array<{ name: string; destName?: string }> = [
    { name: 'checkpoints' },
    { name: 'dev-env' },
    { name: 'tmp', destName: 'tmp-shared' },
    { name: '.bak', destName: '.bak-shared' },
];

async function phaseCacheShared(input: AgentLayoutMigrationInput): Promise<PhaseEntry['items']> {
    const sourceRoot = pathModule.join(input.vaultParent, 'obsilo-shared');
    const destRoot = pathModule.join(input.vaultBasePath, '.vault-operator', 'cache');
    await rawFs.promises.mkdir(destRoot, { recursive: true });

    const results: PhaseEntry['items'] = [];
    for (const entry of CACHE_SHARED_ENTRIES) {
        const from = pathModule.join(sourceRoot, entry.name);
        const to = pathModule.join(destRoot, entry.destName ?? entry.name);
        const r = await moveOne(from, to);
        results.push({ from, to, ...r });
    }
    return results;
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 6: skills-resolve  (deferred to dedicated module in PLAN-27 Task 11)
//
// Phase 7: Legacy cleanup
//   Remove emptied .obsidian-agent/, .obsilo-vault/, obsilo-shared/ folders.
//   Telemetry inside .obsidian-agent/ is first moved to .vault-operator/data/
//   telemetry/. obsilo-shared/settings.json is evaluated separately (left in
//   place for now; FEAT-29-01 follow-up decides merge vs legacy-backup).
// ─────────────────────────────────────────────────────────────────────────

async function phaseCleanup(input: AgentLayoutMigrationInput): Promise<PhaseEntry['items']> {
    const results: PhaseEntry['items'] = [];

    // 7a: Move .obsidian-agent/telemetry to .vault-operator/data/telemetry
    const legacyAgent = pathModule.join(input.vaultBasePath, '.obsidian-agent');
    const telemetrySrc = pathModule.join(legacyAgent, 'telemetry');
    const telemetryDest = pathModule.join(input.vaultBasePath, '.vault-operator', 'data', 'telemetry');
    if (await pathExists(telemetrySrc)) {
        const r = await moveOne(telemetrySrc, telemetryDest);
        results.push({ from: telemetrySrc, to: telemetryDest, ...r });
    }

    // 7b: Remove emptied legacy roots
    const candidateRoots = [
        pathModule.join(input.vaultBasePath, '.obsidian-agent'),
        pathModule.join(input.vaultBasePath, '.obsilo-vault'),
        pathModule.join(input.vaultParent, 'obsilo-shared'),
    ];
    for (const root of candidateRoots) {
        if (!(await pathExists(root))) continue;
        // Ignore .DS_Store when checking emptiness on macOS
        const entries = await rawFs.promises.readdir(root);
        const meaningful = entries.filter((e) => e !== '.DS_Store');
        if (meaningful.length === 0) {
            try {
                // Best-effort remove; .DS_Store will be cleaned up too
                await rawFs.promises.rm(root, { recursive: true, force: true });
                results.push({ from: root, to: '(removed)', status: 'renamed' });
            } catch (e) {
                results.push({
                    from: root,
                    to: '(remove failed)',
                    status: 'failed',
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        } else {
            results.push({
                from: root,
                to: '(left in place)',
                status: 'skipped-destination-populated',
                error: `remaining entries: ${meaningful.join(', ')}`,
            });
        }
    }
    return results;
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 8: Settings update (run inline by caller via setStatus + return flag)
// Phase 10: Report write
// ─────────────────────────────────────────────────────────────────────────

async function writeReport(
    input: AgentLayoutMigrationInput,
    report: LayoutMigrationReport,
): Promise<void> {
    const reportPath = pathModule.join(
        input.vaultBasePath,
        '.vault-operator',
        'data',
        'migration-report.json',
    );
    await rawFs.promises.mkdir(pathModule.dirname(reportPath), { recursive: true });
    await rawFs.promises.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────

/**
 * Run the layout migration. Resumes from input.currentStatus if a prior run
 * was interrupted. Always returns a report; never throws.
 *
 * NOTE: Phases 3-7 are placeholders; this commit only covers phases 1+2+10.
 * The full ten-phase implementation lands in follow-up commits as PLAN-27
 * progresses.
 */
export async function migrateAgentLayout(
    input: AgentLayoutMigrationInput,
): Promise<LayoutMigrationReport> {
    const startedAt = new Date().toISOString();
    const phases: PhaseEntry[] = [];
    let backupPath: string | null = null;
    let status = input.currentStatus;
    const chatHistoryFolderHadValue = input.chatHistoryFolder?.trim() || null;

    // Phase 1: Backup snapshot (always runs unless already past)
    if (!isPhaseDone(status, 'backup-done')) {
        const t0 = Date.now();
        const backup = await phaseBackup(input);
        backupPath = backup.backupPath;
        phases.push({
            phase: 'backup-done',
            items: [{ from: '(all legacy roots)', to: backup.backupPath, status: 'copied' }],
            durationMs: Date.now() - t0,
        });
        status = 'backup-done';
        await input.setStatus(status);
    }

    // Phase 2: Data-Move vault-local
    if (!isPhaseDone(status, 'data-vault-done')) {
        const t0 = Date.now();
        const items = await phaseDataVault(input);
        phases.push({ phase: 'data-vault-done', items, durationMs: Date.now() - t0 });
        status = 'data-vault-done';
        await input.setStatus(status);
    }

    // Phase 3: Cache-Move vault-local
    if (!isPhaseDone(status, 'cache-vault-done')) {
        const t0 = Date.now();
        const items = await phaseCacheVault(input);
        phases.push({ phase: 'cache-vault-done', items, durationMs: Date.now() - t0 });
        status = 'cache-vault-done';
        await input.setStatus(status);
    }

    // Phase 4: Data-Move shared (vault-parent -> vault-local)
    if (!isPhaseDone(status, 'data-shared-done')) {
        const t0 = Date.now();
        const items = await phaseDataShared(input);
        phases.push({ phase: 'data-shared-done', items, durationMs: Date.now() - t0 });
        status = 'data-shared-done';
        await input.setStatus(status);
    }

    // Phase 5: Cache-Move shared (vault-parent -> vault-local)
    if (!isPhaseDone(status, 'cache-shared-done')) {
        const t0 = Date.now();
        const items = await phaseCacheShared(input);
        phases.push({ phase: 'cache-shared-done', items, durationMs: Date.now() - t0 });
        status = 'cache-shared-done';
        await input.setStatus(status);
    }

    // Phase 6: skills-resolve  (PLAN-27 Task 11, follow-up commit)

    // Phase 7: cleanup
    if (!isPhaseDone(status, 'cleanup-done')) {
        const t0 = Date.now();
        const items = await phaseCleanup(input);
        phases.push({ phase: 'cleanup-done', items, durationMs: Date.now() - t0 });
        status = 'cleanup-done';
        await input.setStatus(status);
    }

    // Phase 8: settings-update  (PLAN-27 Task 4 trigger, follow-up commit)
    // Phase 9: chatHistoryFolder removal notice  (PLAN-27 Task 10, follow-up)

    // Phase 10: Report (always runs at the end of whatever phases ran)
    const finishedAt = new Date().toISOString();
    const report: LayoutMigrationReport = {
        status,
        startedAt,
        finishedAt,
        backupPath,
        phases,
        chatHistoryFolderHadValue,
    };

    try {
        await writeReport(input, report);
    } catch {
        // report-write failure is non-fatal; the in-memory report is the
        // primary handoff to the trigger
    }

    return report;
}

/* eslint-enable @typescript-eslint/no-require-imports -- end of file scope */

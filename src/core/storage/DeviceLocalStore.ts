/**
 * DeviceLocalStore -- persistence that is neither Obsidian-synced nor
 * cross-vault-global (FEAT-04-13, ADR-168).
 *
 * Where and why: the file lives under `~/.obsidian-agent/devices/<deviceId>/`
 * in the user HOME. HOME is NOT part of the vault, so Obsidian Sync never
 * touches it (FEATURE-1508 deliberately moved shared data AWAY from HOME to the
 * vault-parent precisely because HOME does not sync). THIS is the load-bearing
 * defense against the sync-RCE threat: a config cannot travel to another device
 * via Obsidian Sync at all.
 *
 * The per-device subfolder, keyed by a locally generated UUID, additionally
 * scopes the data by device. NOTE (AUDIT-034 R5, 2026-07-23): the UUID lives in
 * `<baseDir>/device-id`, INSIDE the same HOME tree, so a full manual clone of
 * HOME copies both the device-id and the devices/<uuid>/ folder and thus
 * inherits the trust. The UUID subfolder is therefore an organizational scope,
 * not a defense against a full-HOME clone; the actual protection is that HOME
 * does not sync. A full-HOME clone is out-of-scope local access (an attacker who
 * can do that already runs as the user).
 *
 * What it holds: stdio MCP-server configs (a stdio config is an arbitrary shell
 * command; ADR-168 forbids letting it travel via synced or cross-vault
 * settings) plus per-device trust flags (a stdio server must be trusted on THIS
 * device before its first spawn).
 *
 * Deliberately standalone: it does NOT go through GlobalFileService /
 * VaultDataFileAdapter and is never merged into data.json. Mixing it into the
 * settings merge is exactly the class of bug that leaks values across the
 * sync boundary (GlobalFS boot-race lesson).
 */

import * as safeFs from '../security/safeFs';
import type { McpServerConfig } from '../../types/settings';
import { encryptStdioEnvInPlace, type SafeStorageLike } from '../security/stdioEnvCrypto';

// Injected so tests can drive the store without touching the real HOME.
export interface DeviceLocalStoreDeps {
    /** Absolute path to the base directory (real: os.homedir()/.obsidian-agent). */
    baseDir: string;
    readFileSync: (p: string) => string | null;
    writeFileSync: (p: string, data: string) => void;
    mkdirSync: (p: string) => void;
    existsSync: (p: string) => boolean;
    /** UUID generator (real: crypto.randomUUID). */
    randomUUID: () => string;
    join: (...parts: string[]) => string;
    /** At-rest crypto for secret env values (real: SafeStorageService). */
    crypter: SafeStorageLike;
}

interface DeviceLocalData {
    /** stdio server configs keyed by server name. */
    stdioServers: Record<string, McpServerConfig>;
    /** server names trusted for spawning on THIS device. */
    trusted: string[];
    /** Mirrors data.json: false when secrets were persisted in plaintext
     *  because the OS keychain was unavailable (diagnosability). */
    _encrypted?: boolean;
}

const DATA_FILE = 'stdio-mcp.json';
const DEVICE_ID_FILE = 'device-id';

function emptyData(): DeviceLocalData {
    return { stdioServers: {}, trusted: [] };
}

export class DeviceLocalStore {
    private readonly deps: DeviceLocalStoreDeps;
    private deviceId: string | null = null;

    constructor(deps: DeviceLocalStoreDeps) {
        this.deps = deps;
    }

    /**
     * Stable per-device id. Generated once and persisted at
     * `<baseDir>/device-id`; a freshly generated UUID, NOT an OS machine
     * identifier (no cross-app fingerprint leak).
     */
    getDeviceId(): string {
        if (this.deviceId) return this.deviceId;
        const { baseDir, join, existsSync, readFileSync, writeFileSync, mkdirSync, randomUUID } = this.deps;
        const idPath = join(baseDir, DEVICE_ID_FILE);
        if (existsSync(idPath)) {
            const stored = readFileSync(idPath)?.trim();
            if (stored) {
                this.deviceId = stored;
                return stored;
            }
        }
        const id = randomUUID();
        if (!existsSync(baseDir)) mkdirSync(baseDir);
        writeFileSync(idPath, id);
        this.deviceId = id;
        return id;
    }

    private dataFilePath(): string {
        const { baseDir, join } = this.deps;
        return join(baseDir, 'devices', this.getDeviceId(), DATA_FILE);
    }

    private load(): DeviceLocalData {
        const { existsSync, readFileSync } = this.deps;
        const p = this.dataFilePath();
        if (!existsSync(p)) return emptyData();
        try {
            const raw = readFileSync(p);
            if (!raw) return emptyData();
            const parsed = JSON.parse(raw) as Partial<DeviceLocalData>;
            // Secret env stays ENCRYPTED here on purpose; it is decrypted only
            // at spawn time (McpClient.buildStdioTransport). No decrypt pass.
            return {
                stdioServers: parsed.stdioServers ?? {},
                trusted: Array.isArray(parsed.trusted) ? parsed.trusted : [],
                _encrypted: parsed._encrypted,
            };
        } catch {
            // Corrupt file: fail safe to empty (never crash boot over it).
            return emptyData();
        }
    }

    private save(data: DeviceLocalData): void {
        const { mkdirSync, writeFileSync, join, baseDir, existsSync, crypter } = this.deps;
        const dir = join(baseDir, 'devices', this.getDeviceId());
        if (!existsSync(dir)) mkdirSync(dir);
        // Encrypt secret env on a CLONE so the caller's in-memory config object
        // is not mutated to ciphertext (same rationale as the settings encrypt
        // pass in GlobalSettingsService). Idempotent via isEncrypted, so trust
        // toggles that re-persist an already-encrypted config are free.
        const out: DeviceLocalData = (typeof structuredClone === 'function'
            ? structuredClone(data)
            : JSON.parse(JSON.stringify(data))) as DeviceLocalData;
        for (const cfg of Object.values(out.stdioServers)) {
            encryptStdioEnvInPlace(cfg, crypter);
        }
        out._encrypted = crypter.isAvailable();
        writeFileSync(this.dataFilePath(), JSON.stringify(out, null, 2));
    }

    /** All stdio server configs known on this device. */
    listStdioServers(): Record<string, McpServerConfig> {
        return this.load().stdioServers;
    }

    /** Add or replace a stdio server config (does NOT grant trust). */
    upsertStdioServer(name: string, config: McpServerConfig): void {
        const data = this.load();
        data.stdioServers[name] = config;
        this.save(data);
    }

    /** Remove a stdio server config and any trust it held. */
    removeStdioServer(name: string): void {
        const data = this.load();
        delete data.stdioServers[name];
        data.trusted = data.trusted.filter((n) => n !== name);
        this.save(data);
    }

    /** True if the named server has been trusted for spawning on this device. */
    isTrusted(name: string): boolean {
        return this.load().trusted.includes(name);
    }

    /** Grant spawn trust for the named server on this device. */
    grantTrust(name: string): void {
        const data = this.load();
        if (!data.trusted.includes(name)) {
            data.trusted.push(name);
            this.save(data);
        }
    }

    /** Revoke spawn trust for the named server on this device. */
    revokeTrust(name: string): void {
        const data = this.load();
        data.trusted = data.trusted.filter((n) => n !== name);
        this.save(data);
    }
}

/**
 * Production factory: wires the store to the real HOME via safeFs. Kept
 * separate from the class so the class stays free of Node/Obsidian imports
 * and is trivially unit-testable with in-memory deps.
 */
export function createDeviceLocalStore(crypter: SafeStorageLike): DeviceLocalStore {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- path/os are pure helpers, only available via require in the Electron renderer
    const nodePath = require('path') as typeof import('path');
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- os.homedir is a pure helper
    const os = require('os') as typeof import('os');
    const baseDir = nodePath.join(os.homedir(), '.obsidian-agent');
    return new DeviceLocalStore({
        baseDir,
        crypter,
        join: (...parts: string[]) => nodePath.join(...parts),
        existsSync: (p: string) => safeFs.existsSync(p),
        mkdirSync: (p: string) => { safeFs.mkdirSync(p, { recursive: true }); },
        readFileSync: (p: string) => {
            try { return safeFs.readFileSync(p, 'utf-8'); } catch { return null; }
        },
        writeFileSync: (p: string, data: string) => { safeFs.writeFileSync(p, data, { mode: 0o600 }); },
        randomUUID: () => crypto.randomUUID(),
    });
}

/**
 * FEATURE-2201 / ADR-075: regression tests for the one-time migration of
 * user skills from `.obsilo-sync/skills/` to the configurable agent folder.
 */

import { describe, it, expect } from 'vitest';
import { migrateLegacySkillsIfNeeded } from '../SkillMigration';
import {
    LEGACY_SELF_AUTHORED_SKILLS_DIR,
    DEFAULT_AGENT_FOLDER,
} from '../../utils/agentFolder';

type MockStat = { type: 'file' | 'folder'; size: number; ctime: number; mtime: number };

interface MockAdapter {
    files: Map<string, string>;
    binaries: Map<string, ArrayBuffer>;
    dirs: Set<string>;
    exists: (p: string) => Promise<boolean>;
    read: (p: string) => Promise<string>;
    write: (p: string, data: string) => Promise<void>;
    readBinary: (p: string) => Promise<ArrayBuffer>;
    writeBinary: (p: string, data: ArrayBuffer) => Promise<void>;
    mkdir: (p: string) => Promise<void>;
    list: (p: string) => Promise<{ files: string[]; folders: string[] }>;
    stat: (p: string) => Promise<MockStat | null>;
}

function createMockAdapter(): MockAdapter {
    const files = new Map<string, string>();
    const binaries = new Map<string, ArrayBuffer>();
    const dirs = new Set<string>();

    function isDirectChild(parent: string, candidate: string): boolean {
        if (!candidate.startsWith(parent + '/')) return false;
        const rest = candidate.slice(parent.length + 1);
        return !rest.includes('/');
    }

    return {
        files,
        binaries,
        dirs,
        exists: (p) => Promise.resolve(files.has(p) || binaries.has(p) || dirs.has(p)),
        read: (p) => {
            const c = files.get(p);
            if (c === undefined) return Promise.reject(new Error(`not found: ${p}`));
            return Promise.resolve(c);
        },
        write: (p, data) => { files.set(p, data); return Promise.resolve(); },
        readBinary: (p) => {
            const b = binaries.get(p);
            if (b) return Promise.resolve(b);
            const txt = files.get(p);
            if (txt !== undefined) return Promise.resolve(new TextEncoder().encode(txt).buffer);
            return Promise.reject(new Error(`not found: ${p}`));
        },
        writeBinary: (p, data) => { binaries.set(p, data); return Promise.resolve(); },
        mkdir: (p) => { dirs.add(p); return Promise.resolve(); },
        list: (p) => {
            const allPaths = [...files.keys(), ...binaries.keys()];
            const fileChildren = allPaths.filter(f => isDirectChild(p, f));
            const folderChildren = [...dirs].filter(d => isDirectChild(p, d));
            // Also return implicit folders from nested files
            const implicitFolders = new Set<string>();
            for (const f of allPaths) {
                if (f.startsWith(p + '/')) {
                    const rest = f.slice(p.length + 1);
                    const firstSlash = rest.indexOf('/');
                    if (firstSlash > -1) {
                        implicitFolders.add(`${p}/${rest.slice(0, firstSlash)}`);
                    }
                }
            }
            for (const imp of implicitFolders) folderChildren.push(imp);
            return Promise.resolve({
                files: fileChildren,
                folders: [...new Set(folderChildren)],
            });
        },
        stat: (p) => {
            if (files.has(p)) return Promise.resolve({ type: 'file', size: (files.get(p) ?? '').length, ctime: 0, mtime: 0 });
            if (binaries.has(p)) return Promise.resolve({ type: 'file', size: (binaries.get(p) ?? new ArrayBuffer(0)).byteLength, ctime: 0, mtime: 0 });
            if (dirs.has(p)) return Promise.resolve({ type: 'folder', size: 0, ctime: 0, mtime: 0 });
            return Promise.resolve(null);
        },
    };
}

function makePlugin(adapter: MockAdapter, agentFolderPath?: string) {
    return {
        app: { vault: { adapter: adapter as unknown as import('obsidian').DataAdapter } },
        settings: { agentFolderPath: agentFolderPath ?? DEFAULT_AGENT_FOLDER },
    } as unknown as import('../../../main').default;
}

describe('migrateLegacySkillsIfNeeded', () => {
    it('returns null when the legacy dir does not exist', async () => {
        const adapter = createMockAdapter();
        const plugin = makePlugin(adapter);

        const result = await migrateLegacySkillsIfNeeded(plugin);

        expect(result).toBeNull();
    });

    it('copies skill folders from legacy to the configured agent folder', async () => {
        const adapter = createMockAdapter();
        const legacy = LEGACY_SELF_AUTHORED_SKILLS_DIR;
        const target = `${DEFAULT_AGENT_FOLDER}/skills`;

        adapter.dirs.add(legacy);
        adapter.dirs.add(`${legacy}/research-synthesis`);
        adapter.files.set(`${legacy}/research-synthesis/SKILL.md`, '---\nname: research-synthesis\ndescription: test\n---\nBody');

        const plugin = makePlugin(adapter);

        const result = await migrateLegacySkillsIfNeeded(plugin);

        expect(result).not.toBeNull();
        expect(result?.migratedSlugs).toEqual(['research-synthesis']);
        expect(result?.errors).toHaveLength(0);
        expect(adapter.binaries.has(`${target}/research-synthesis/SKILL.md`)).toBe(true);
        // Original remains in place (defensive copy).
        expect(adapter.files.has(`${legacy}/research-synthesis/SKILL.md`)).toBe(true);
    });

    it('writes a .migrated marker so a second call is a no-op', async () => {
        const adapter = createMockAdapter();
        const legacy = LEGACY_SELF_AUTHORED_SKILLS_DIR;

        adapter.dirs.add(legacy);
        adapter.dirs.add(`${legacy}/foo`);
        adapter.files.set(`${legacy}/foo/SKILL.md`, 'x');

        const plugin = makePlugin(adapter);

        const first = await migrateLegacySkillsIfNeeded(plugin);
        expect(first?.migratedSlugs).toEqual(['foo']);
        expect(adapter.files.has(`${legacy}/.migrated`)).toBe(true);

        const second = await migrateLegacySkillsIfNeeded(plugin);
        expect(second).toBeNull();
    });

    it('skips slugs whose destination already exists', async () => {
        const adapter = createMockAdapter();
        const legacy = LEGACY_SELF_AUTHORED_SKILLS_DIR;
        const target = `${DEFAULT_AGENT_FOLDER}/skills`;

        adapter.dirs.add(legacy);
        adapter.dirs.add(`${legacy}/shared`);
        adapter.files.set(`${legacy}/shared/SKILL.md`, 'old version');

        adapter.dirs.add(target);
        adapter.dirs.add(`${target}/shared`);
        adapter.files.set(`${target}/shared/SKILL.md`, 'newer version');

        const plugin = makePlugin(adapter);

        const result = await migrateLegacySkillsIfNeeded(plugin);

        expect(result?.migratedSlugs).toEqual([]);
        expect(result?.skippedSlugs).toEqual(['shared']);
        expect(adapter.files.get(`${target}/shared/SKILL.md`)).toBe('newer version');
    });

    it('returns null if source and target resolve to the same dir', async () => {
        const adapter = createMockAdapter();
        adapter.dirs.add(LEGACY_SELF_AUTHORED_SKILLS_DIR);
        // Configure an agent folder that resolves to the legacy dir parent
        const plugin = makePlugin(adapter, '.obsilo-sync');

        const result = await migrateLegacySkillsIfNeeded(plugin);

        expect(result).toBeNull();
    });

    it('copies nested subdirectories (scripts/ references/) recursively', async () => {
        const adapter = createMockAdapter();
        const legacy = LEGACY_SELF_AUTHORED_SKILLS_DIR;
        const target = `${DEFAULT_AGENT_FOLDER}/skills`;

        adapter.dirs.add(legacy);
        adapter.dirs.add(`${legacy}/rich`);
        adapter.dirs.add(`${legacy}/rich/scripts`);
        adapter.files.set(`${legacy}/rich/SKILL.md`, 'top');
        adapter.files.set(`${legacy}/rich/scripts/helper.ts`, 'console.log("x")');

        const plugin = makePlugin(adapter);

        const result = await migrateLegacySkillsIfNeeded(plugin);

        expect(result?.migratedSlugs).toEqual(['rich']);
        expect(adapter.binaries.has(`${target}/rich/SKILL.md`)).toBe(true);
        expect(adapter.binaries.has(`${target}/rich/scripts/helper.ts`)).toBe(true);
    });
});

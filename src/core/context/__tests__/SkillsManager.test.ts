import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SkillsManager } from '../SkillsManager';
import type { FileAdapter } from '../../storage/types';

class MemoryFileAdapter implements FileAdapter {
    private files = new Map<string, string>();
    private dirs = new Set<string>(['']);

    async exists(path: string): Promise<boolean> {
        return this.files.has(path) || this.dirs.has(path);
    }
    async read(path: string): Promise<string> {
        const c = this.files.get(path);
        if (c === undefined) throw new Error(`ENOENT: ${path}`);
        return c;
    }
    async write(path: string, data: string): Promise<void> {
        this.files.set(path, data);
        let parent = path.substring(0, path.lastIndexOf('/'));
        while (parent) {
            this.dirs.add(parent);
            const cut = parent.lastIndexOf('/');
            parent = cut === -1 ? '' : parent.substring(0, cut);
        }
    }
    async mkdir(path: string): Promise<void> {
        this.dirs.add(path);
    }
    async list(path: string): Promise<{ files: string[]; folders: string[] }> {
        const files: string[] = [];
        const folders = new Set<string>();
        const prefix = path === '' ? '' : `${path}/`;
        for (const f of this.files.keys()) {
            if (!f.startsWith(prefix)) continue;
            const rest = f.slice(prefix.length);
            if (!rest.includes('/')) {
                files.push(f);
            } else {
                folders.add(`${prefix}${rest.split('/')[0]}`);
            }
        }
        for (const d of this.dirs) {
            if (!d.startsWith(prefix) || d === path) continue;
            const rest = d.slice(prefix.length);
            if (!rest.includes('/')) folders.add(d);
        }
        return { files, folders: [...folders] };
    }
    async remove(path: string): Promise<void> {
        this.files.delete(path);
        this.dirs.delete(path);
    }
    async append(path: string, data: string): Promise<void> {
        this.files.set(path, (this.files.get(path) ?? '') + data);
    }
    async stat(path: string): Promise<{ mtime: number; size: number } | null> {
        const c = this.files.get(path);
        return c === undefined ? null : { mtime: 0, size: c.length };
    }
}

describe('SkillsManager.discoverSkills', () => {
    let fs: MemoryFileAdapter;
    let mgr: SkillsManager;

    beforeEach(() => {
        fs = new MemoryFileAdapter();
        mgr = new SkillsManager(fs);
    });

    it('parses a single-line description', async () => {
        await fs.write(
            'skills/my-skill/SKILL.md',
            `---\nname: my-skill\ndescription: A simple skill for testing.\n---\n\nBody.`,
        );

        const skills = await mgr.discoverSkills();

        expect(skills).toHaveLength(1);
        expect(skills[0].name).toBe('my-skill');
        expect(skills[0].description).toBe('A simple skill for testing.');
    });

    it('parses a YAML folded block scalar description (description: >)', async () => {
        await fs.write(
            'skills/folded/SKILL.md',
            [
                '---',
                'name: folded',
                'description: >',
                '  Agentic Fabrik mit 125+ Spezialisten,',
                '  7-Phasen-Modell und Schwarmprognosen.',
                '  IMMER verwenden bei Strategieberatung, Business Case.',
                '---',
                '',
                'Body.',
            ].join('\n'),
        );

        const skills = await mgr.discoverSkills();

        expect(skills).toHaveLength(1);
        expect(skills[0].name).toBe('folded');
        expect(skills[0].description).toContain('Agentic Fabrik');
        expect(skills[0].description).toContain('Strategieberatung');
        expect(skills[0].description).not.toMatch(/^>/);
    });

    it('parses a YAML literal block scalar description (description: |)', async () => {
        await fs.write(
            'skills/literal/SKILL.md',
            [
                '---',
                'name: literal',
                'description: |',
                '  Erste Zeile.',
                '  Zweite Zeile.',
                '---',
                '',
                'Body.',
            ].join('\n'),
        );

        const skills = await mgr.discoverSkills();

        expect(skills).toHaveLength(1);
        expect(skills[0].description).toContain('Erste Zeile.');
        expect(skills[0].description).toContain('Zweite Zeile.');
        expect(skills[0].description).not.toMatch(/^\|/);
    });

    it('collapses folded (>) scalars into a single space-joined line', async () => {
        await fs.write(
            'skills/joined/SKILL.md',
            [
                '---',
                'name: joined',
                'description: >',
                '  alpha',
                '  beta',
                '---',
            ].join('\n'),
        );

        const skills = await mgr.discoverSkills();

        expect(skills[0].description).toBe('alpha beta');
    });

    it('stops the block scalar at the closing --- fence', async () => {
        await fs.write(
            'skills/fenced/SKILL.md',
            [
                '---',
                'name: fenced',
                'description: >',
                '  desc line',
                '---',
                '',
                '# This heading is body, not description.',
            ].join('\n'),
        );

        const skills = await mgr.discoverSkills();

        expect(skills[0].description).toBe('desc line');
        expect(skills[0].description).not.toContain('heading');
    });

    it('stops the block scalar at the next top-level key', async () => {
        await fs.write(
            'skills/keyed/SKILL.md',
            [
                '---',
                'description: >',
                '  the description',
                'name: keyed',
                'trigger: /foo/',
                '---',
            ].join('\n'),
        );

        const skills = await mgr.discoverSkills();

        expect(skills[0].description).toBe('the description');
        expect(skills[0].name).toBe('keyed');
        expect(skills[0].trigger).toBe('/foo/');
    });

    it('skips a skill with no description', async () => {
        await fs.write(
            'skills/nodesc/SKILL.md',
            `---\nname: nodesc\n---\n\nBody.`,
        );

        const skills = await mgr.discoverSkills();

        expect(skills).toHaveLength(0);
    });
});

describe('SkillsManager discover cache TTL', () => {
    let fs: MemoryFileAdapter;
    let mgr: SkillsManager;

    beforeEach(() => {
        vi.useFakeTimers();
        fs = new MemoryFileAdapter();
        mgr = new SkillsManager(fs);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shares one scan across near-simultaneous callers (FIX-PERF-32)', async () => {
        await fs.write('skills/a/SKILL.md', `---\nname: a\ndescription: A.\n---`);
        const listSpy = vi.spyOn(fs, 'list');

        const [first, second] = await Promise.all([mgr.discoverSkills(), mgr.discoverSkills()]);

        expect(first).toHaveLength(1);
        expect(second).toHaveLength(1);
        expect(listSpy).toHaveBeenCalledTimes(1);
    });

    it('picks up an externally added SKILL.md after the TTL expires', async () => {
        await fs.write('skills/a/SKILL.md', `---\nname: a\ndescription: A.\n---`);
        expect(await mgr.discoverSkills()).toHaveLength(1);

        // Simulate a manual copy into the skills folder (no plugin write path).
        await fs.write('skills/b/SKILL.md', `---\nname: b\ndescription: B.\n---`);

        // Within the TTL the cache still answers.
        expect(await mgr.discoverSkills()).toHaveLength(1);

        vi.advanceTimersByTime(31_000);

        expect(await mgr.discoverSkills()).toHaveLength(2);
    });

    it('invalidateCache() bypasses the TTL immediately', async () => {
        await fs.write('skills/a/SKILL.md', `---\nname: a\ndescription: A.\n---`);
        expect(await mgr.discoverSkills()).toHaveLength(1);

        await fs.write('skills/b/SKILL.md', `---\nname: b\ndescription: B.\n---`);
        mgr.invalidateCache();

        expect(await mgr.discoverSkills()).toHaveLength(2);
    });
});

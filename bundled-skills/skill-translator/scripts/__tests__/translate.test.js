/**
 * Tests for skill-translator translate / validate / write
 * (FEAT-29-08 Task C).
 *
 * Translation itself is done by the agent's main loop (Frontier LLM
 * call per source file). This script post-processes the produced JS:
 * validates against sandbox-unsafe patterns, builds the manifest, and
 * writes everything atomically. The tests pin those three layers.
 */

import { describe, it, expect } from 'vitest';
import { validateJs, buildManifest, writeTranslation } from '../translate.js';

describe('validateJs (sandbox safety scan)', () => {
    it('passes clean code with no forbidden patterns', () => {
        const src = `
export async function execute(args, ctx) {
    const file = await ctx.vault.read(args.path);
    return JSON.parse(file);
}
        `;
        expect(validateJs(src)).toEqual({ ok: true, issues: [] });
    });

    it('flags eval()', () => {
        const out = validateJs("const x = eval('1+1');");
        expect(out.ok).toBe(false);
        expect(out.issues.some((i) => i.pattern.includes('eval'))).toBe(true);
    });

    it('flags new Function', () => {
        const out = validateJs('const f = new Function("return 1");');
        expect(out.ok).toBe(false);
        expect(out.issues.some((i) => /new Function/i.test(i.pattern))).toBe(true);
    });

    it('flags require()', () => {
        const out = validateJs('const fs = require("fs");');
        expect(out.ok).toBe(false);
    });

    it('flags __proto__ assignment', () => {
        const out = validateJs('obj.__proto__ = {};');
        expect(out.ok).toBe(false);
    });

    it('flags process.env access', () => {
        const out = validateJs('const k = process.env.SECRET;');
        expect(out.ok).toBe(false);
    });

    it('flags fs direct access', () => {
        const out = validateJs('fs.writeFileSync(p, "x");');
        expect(out.ok).toBe(false);
    });

    it('reports the line number of the offending pattern', () => {
        const out = validateJs('a\nb\neval(c)\nd');
        expect(out.ok).toBe(false);
        expect(out.issues[0].line).toBe(3);
    });

    it('rejects empty source', () => {
        expect(validateJs('').ok).toBe(false);
        expect(validateJs(null).ok).toBe(false);
    });

    it('does not flag the substring "evaluation" (regex needs word boundary)', () => {
        const out = validateJs('const evaluation = compute();');
        expect(out.ok).toBe(true);
    });
});

describe('buildManifest (audit manifest schema)', () => {
    it('produces the canonical schema with defaults', () => {
        const m = buildManifest({
            sourceRepo: 'https://github.com/anthropics/skills',
            sourcePath: 'tmp/pdf',
            sourceVersion: 'abc123',
            targetPath: '.vault-operator/data/skills/pdf',
            files: [{ source: 'extract.py', target: 'extract.js' }],
            dryRunSummary: { mappableCount: 2, partialCount: 1, unmappableCount: 0 },
            partialMarkers: ['pandas'],
            translator: 'claude-opus-4-7',
            now: '2026-05-21T16:00:00.000Z',
        });
        expect(m).toEqual({
            schemaVersion: 1,
            translationDate: '2026-05-21T16:00:00.000Z',
            translator: 'claude-opus-4-7',
            source: {
                repo: 'https://github.com/anthropics/skills',
                path: 'tmp/pdf',
                version: 'abc123',
            },
            target: {
                path: '.vault-operator/data/skills/pdf',
            },
            files: [{ source: 'extract.py', target: 'extract.js', lines: null }],
            dryRun: {
                mappableCount: 2,
                partialCount: 1,
                unmappableCount: 0,
            },
            partialMarkers: ['pandas'],
        });
    });

    it('uses sensible defaults for missing optional fields', () => {
        const m = buildManifest({});
        expect(m.schemaVersion).toBe(1);
        expect(m.translator).toBe('unknown');
        expect(m.source.repo).toBe(null);
        expect(m.dryRun).toEqual({ mappableCount: 0, partialCount: 0, unmappableCount: 0 });
        expect(m.partialMarkers).toEqual([]);
        expect(m.files).toEqual([]);
    });

    it('throws when inputs is missing', () => {
        expect(() => buildManifest()).toThrow(/inputs object/);
    });
});

describe('writeTranslation (orchestrated write)', () => {
    function makeCtx() {
        const files = new Map();
        return {
            files,
            vault: {
                write: async (p, c) => { files.set(p, c); },
                read: async (p) => {
                    if (!files.has(p)) throw new Error(`not found: ${p}`);
                    return files.get(p);
                },
            },
        };
    }

    it('writes valid JS files, SKILL.md, and TRANSLATION.json in order', async () => {
        const ctx = makeCtx();
        const out = await writeTranslation(
            {
                sourceRepo: 'https://github.com/anthropics/skills',
                sourcePath: 'tmp/pdf',
                sourceVersion: 'abc',
                targetPath: '.vault-operator/data/skills/pdf',
                files: [{
                    source: 'extract.py',
                    target: 'extract.js',
                    content: 'export async function execute(args, ctx) { return await ctx.vault.read(args.path); }',
                }],
                skillMd: '---\nname: pdf\ndescription: PDF skill\n---\n# pdf',
                dryRunSummary: { mappableCount: 1, partialCount: 0, unmappableCount: 0 },
                partialMarkers: [],
                translator: 'claude-opus-4-7',
            },
            ctx,
        );
        expect(out.ok).toBe(true);
        expect(out.failed).toEqual([]);
        expect(out.written).toContain('.vault-operator/data/skills/pdf/extract.js');
        expect(out.written).toContain('.vault-operator/data/skills/pdf/SKILL.md');
        expect(out.written).toContain('.vault-operator/data/skills/pdf/TRANSLATION.json');
        const manifest = JSON.parse(ctx.files.get('.vault-operator/data/skills/pdf/TRANSLATION.json'));
        expect(manifest.source.repo).toBe('https://github.com/anthropics/skills');
        expect(manifest.files[0].lines).toBeGreaterThan(0);
    });

    it('refuses to write a script that contains forbidden patterns', async () => {
        const ctx = makeCtx();
        const out = await writeTranslation(
            {
                targetPath: '.vault-operator/data/skills/bad',
                files: [{ source: 'a.py', target: 'a.js', content: 'eval("hi")' }],
                skillMd: '# bad',
                translator: 'x',
            },
            ctx,
        );
        expect(out.ok).toBe(false);
        expect(out.failed).toEqual(['a.js']);
        expect(out.validationIssues[0].file).toBe('a.js');
        // No SKILL.md and no manifest should have been written.
        expect(ctx.files.has('.vault-operator/data/skills/bad/SKILL.md')).toBe(false);
        expect(ctx.files.has('.vault-operator/data/skills/bad/TRANSLATION.json')).toBe(false);
    });

    it('does NOT write the manifest when any script failed', async () => {
        const ctx = makeCtx();
        const out = await writeTranslation(
            {
                targetPath: '.vault-operator/data/skills/mixed',
                files: [
                    { source: 'ok.py', target: 'ok.js', content: 'export async function execute() { return 1; }' },
                    { source: 'bad.py', target: 'bad.js', content: 'eval("x")' },
                ],
                skillMd: '# mixed',
                translator: 'x',
            },
            ctx,
        );
        expect(out.ok).toBe(false);
        expect(out.manifestPath).toBe(null);
        // The good file was written before validation knew the batch was bad;
        // accept that. But manifest must NOT signal completeness.
        expect(ctx.files.has('.vault-operator/data/skills/mixed/TRANSLATION.json')).toBe(false);
    });

    it('throws on missing targetPath', async () => {
        const ctx = makeCtx();
        await expect(writeTranslation({}, ctx)).rejects.toThrow(/targetPath/);
    });

    it('throws on missing ctx.vault', async () => {
        await expect(writeTranslation({ targetPath: 'foo' }, {})).rejects.toThrow(/ctx.vault/);
    });
});

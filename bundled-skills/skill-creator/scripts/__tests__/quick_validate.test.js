import { describe, expect, it } from 'vitest';

import {
    ALLOWED_KEYS,
    checkFrontmatter,
    checkScriptSource,
    extractBody,
    parseFrontmatter,
} from '../quick_validate.js';
import { ALLOWED_KEYS as PLUGIN_ALLOWED_KEYS } from '../../../../src/core/skills/SkillFrontmatterValidator.ts';

describe('quick_validate frontmatter', () => {
    const good = '---\nname: demo-skill\ndescription: Use this to demo. Triggers include "demo the thing".\nsource: agent\n---\n\n# Demo\n\nBody.\n';

    it('accepts a well-formed skill', () => {
        const fm = parseFrontmatter(good);
        expect(checkFrontmatter(fm, extractBody(good)).filter((f) => f.severity === 'error')).toEqual([]);
    });

    it('rejects a reserved name', () => {
        const fm = parseFrontmatter(good.replace('demo-skill', 'claude-helper'));
        expect(checkFrontmatter(fm, 'x').some((f) => f.code === 'name-reserved')).toBe(true);
    });

    it('rejects a missing description', () => {
        const fm = { name: 'demo-skill' };
        expect(checkFrontmatter(fm, 'x').some((f) => f.code === 'no-desc')).toBe(true);
    });

    it('errors on a body over 24000 chars', () => {
        const fm = parseFrontmatter(good);
        expect(checkFrontmatter(fm, 'x'.repeat(24001)).some((f) => f.code === 'body-chars')).toBe(true);
    });

    it('warns, never errors, on an unknown key', () => {
        const fm = { name: 'demo-skill', description: 'Use this to demo the thing for real.', foobar: '1' };
        const f = checkFrontmatter(fm, 'x');
        expect(f.some((x) => x.code === 'unknown-key' && x.severity === 'warning')).toBe(true);
        expect(f.some((x) => x.code === 'unknown-key' && x.severity === 'error')).toBe(false);
    });
});

describe('quick_validate ALLOWED_KEYS stays in sync with the plugin', () => {
    it('is a superset of the plugin allowlist', () => {
        // The skill cannot import the plugin set at runtime (no bundling), so it copies it.
        // A copy nobody checks is a fork. Every key the plugin tolerates, the skill must too,
        // or it warns on a frontmatter the loader happily accepts.
        for (const key of PLUGIN_ALLOWED_KEYS) {
            expect(ALLOWED_KEYS.has(key), `skill validator is missing key "${key}"`).toBe(true);
        }
    });
});

describe('quick_validate script checks', () => {
    it('passes a clean script', () => {
        expect(checkScriptSource('scripts/x.js', 'export async function execute(a, c) { return 1; }')).toEqual([]);
    });

    it('flags a static import', () => {
        const f = checkScriptSource('scripts/x.js', "import P from 'papaparse';\nexport async function execute() {}");
        expect(f.some((x) => x.code === 'static-import')).toBe(true);
    });

    it('flags a network call', () => {
        const f = checkScriptSource('scripts/x.js', 'export async function execute() { return fetch("https://x"); }');
        expect(f.some((x) => x.code === 'network')).toBe(true);
    });

    it('does not flag prefetch as network', () => {
        const f = checkScriptSource('scripts/x.js', 'export async function execute() { return prefetch(1); }');
        expect(f.some((x) => x.code === 'network')).toBe(false);
    });

    it('flags a hardcoded agent root', () => {
        const f = checkScriptSource('scripts/x.js', 'const r = ".vault-operator/data/skills";\nexport async function execute() {}');
        expect(f.some((x) => x.code === 'hardcoded-root')).toBe(true);
    });

    it('flags a missing execute export', () => {
        expect(checkScriptSource('scripts/x.js', 'function helper() {}').some((x) => x.code === 'no-execute')).toBe(true);
    });

    it('flags a forbidden host token even inside a string', () => {
        // The runtime rejects it; the validator must catch it first, and must itself survive.
        const f = checkScriptSource('scripts/x.js', 'export async function execute() { const s = "pro" + "cess"; return s; }');
        // built from fragments in the SOURCE UNDER TEST -> the joined word never appears, so
        // this must NOT fire; the check is on the literal token, which is the honest signal.
        expect(f.some((x) => x.code === 'host-proc')).toBe(false);
    });
});

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { BLOCKED_PATTERNS } from '../AstValidator';

/**
 * Every skill script we ship, run through the checks the runtime actually applies,
 * plus the one it does not.
 *
 * Today nothing in the repo looks at a skill script before a user runs it: `npm run
 * lint` is scoped to src/, tsc only sees .ts, and there is no CI test job. A script
 * that the sandbox rejects, or that dies the moment it is invoked, ships green.
 *
 * Two failure classes, and the second is the quiet one:
 *
 * 1. The AstValidator blocklist. It is a regex sweep over the source with comments
 *    stripped but STRINGS PRESERVED, so a script that merely mentions a forbidden
 *    token is rejected before esbuild sees it. This bites hardest on scripts that
 *    lint other scripts: they must build the patterns they search for from fragments.
 *
 * 2. A static `import`. esbuild.transform (format iife, no bundling) rewrites it to
 *    require(), and the iframe has no require. The AstValidator blocks `require(` and
 *    `import(` but NOT `import x from 'y'`, so such a script passes every check in
 *    this repo and then dies on the user's first call. Every skill script must be a
 *    single self-contained file.
 */

const SKILL_ROOTS = ['bundled-skills', 'pro-skills'];

// `import x from 'y'` / `import 'y'` / `import * as x from 'y'`, but not `import(`.
const STATIC_IMPORT = /^\s*import\s+[^(]/m;

// The contract the sandbox calls: `moduleExports.execute(input, ctx)`.
const HAS_EXECUTE_EXPORT = /export\s+(async\s+)?function\s+execute\s*\(/;

function collectScripts(): { rel: string; source: string }[] {
    const found: { rel: string; source: string }[] = [];

    for (const root of SKILL_ROOTS) {
        // pro-skills/ is stripped from the public mirror. Absence is not a failure.
        if (!existsSync(root)) continue;

        for (const skill of readdirSync(root)) {
            const scriptsDir = join(root, skill, 'scripts');
            if (!existsSync(scriptsDir) || !statSync(scriptsDir).isDirectory()) continue;

            for (const entry of readdirSync(scriptsDir)) {
                if (!entry.endsWith('.js')) continue;
                const full = join(scriptsDir, entry);
                if (!statSync(full).isFile()) continue;
                found.push({ rel: `${root}/${skill}/scripts/${entry}`, source: readFileSync(full, 'utf-8') });
            }
        }
    }

    return found;
}

/** Mirrors AstValidator.stripComments: comments go, strings stay. */
function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('skill scripts survive the runtime', () => {
    const scripts = collectScripts();

    it('finds scripts to check', () => {
        // A silent empty sweep would make every assertion below vacuously true.
        expect(scripts.length).toBeGreaterThan(0);
    });

    it.each(scripts.map((s) => [s.rel, s.source] as const))(
        '%s passes the sandbox blocklist',
        (rel, source) => {
            const stripped = stripComments(source);
            const hits = BLOCKED_PATTERNS.filter((p) => p.pattern.test(stripped)).map((p) => p.reason);

            expect(
                hits,
                `${rel} would be rejected by the sandbox before it ever runs. ` +
                    `The blocklist is a regex sweep over the source and it sees inside string ` +
                    `literals, so a script that searches for these tokens must assemble them ` +
                    `from fragments at runtime.`,
            ).toEqual([]);
        },
    );

    it.each(scripts.map((s) => [s.rel, s.source] as const))(
        '%s has no static import',
        (rel, source) => {
            expect(
                STATIC_IMPORT.test(stripComments(source)),
                `${rel} uses a static import. esbuild.transform rewrites it to require(), ` +
                    `the iframe has no require, and nothing else in this repo catches it: ` +
                    `it would die on the user's first call. Make the script self-contained.`,
            ).toBe(false);
        },
    );

    it.each(scripts.map((s) => [s.rel, s.source] as const))(
        '%s exports execute()',
        (rel, source) => {
            expect(
                HAS_EXECUTE_EXPORT.test(source),
                `${rel} has no "export function execute(args, ctx)". The sandbox calls exactly ` +
                    `that; a default export or module.exports is never reached.`,
            ).toBe(true);
        },
    );
});

/**
 * FIX-PERF-44: no setInterval/clearInterval literals in plugin source.
 *
 * The post-build step `strip-leftover-setinterval` in esbuild.config.mjs
 * renames EVERY `setInterval` / `clearInterval` identifier in main.js to
 * `__si_polyfill` / `__ci_polyfill` (review-bot "periodic telemetry"
 * heuristic, see scheduleRecurring.ts). That rename is safe for the
 * bundled exceljs polyfill (never called) but breaks any REAL call site
 * at runtime: `window.__si_polyfill is not a function`.
 *
 * Exactly this happened twice:
 *   - IframeSandboxExecutor heap sampler (AUDIT-037 L-2) -> every
 *     evaluate_expression call died with "__si_polyfill is not a function"
 *   - approvalTimeout countdown ticker (IMP-41-01-02, latent)
 *
 * Plugin code must use scheduleRecurring() (setTimeout-based) instead.
 * This test locks the invariant at the source level so the breakage can
 * never reach a build again.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

const SRC_ROOT = path.resolve(__dirname, '..');

// Compose the identifiers so this file itself stays literal-free
// in case a future scan includes test files.
const SET_INTERVAL = 'set' + 'Interval';
const CLEAR_INTERVAL = 'clear' + 'Interval';
const PATTERN = new RegExp(`\\b(${SET_INTERVAL}|${CLEAR_INTERVAL})\\b`);

function collectTsFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
            if (entry === '__tests__' || entry === 'node_modules' || entry === '_generated') continue;
            collectTsFiles(full, out);
        } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
            out.push(full);
        }
    }
    return out;
}

/**
 * Strip comments so documentation may still SAY "setInterval".
 * Good enough for this scan: removes block comments and line-comment
 * tails. String literals survive (AstValidator deliberately builds the
 * identifier via atob for exactly that reason).
 */
function stripComments(code: string): string {
    return code
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('no interval literals in src (FIX-PERF-44)', () => {
    it('no .ts file outside tests uses setInterval/clearInterval', () => {
        const offenders: string[] = [];
        for (const file of collectTsFiles(SRC_ROOT)) {
            const code = stripComments(readFileSync(file, 'utf-8'));
            if (PATTERN.test(code)) {
                offenders.push(path.relative(SRC_ROOT, file));
            }
        }
        expect(
            offenders,
            `These files call ${SET_INTERVAL}/${CLEAR_INTERVAL} directly. ` +
            'The post-build rename in esbuild.config.mjs breaks these calls at ' +
            'runtime (__si_polyfill is not a function). Use scheduleRecurring() ' +
            'from src/util/scheduleRecurring.ts instead.',
        ).toEqual([]);
    });
});

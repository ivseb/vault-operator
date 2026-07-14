/**
 * AUDIT 2026-07-14 BYP-1: the drift test for path-tool governance.
 *
 * ToolExecutionPipeline.validatePaths runs isIgnored/isProtected only for the
 * `path` input key OR keys registered in PATH_INPUT_KEYS. A tool that carries a
 * vault path under a differently-named key (source_path, output_path,
 * source_uri, ...) and is NOT registered bypasses the .obsidian-agentignore /
 * .obsidian-agentprotected governance entirely -- and re-opens the configDir /
 * agent-secret deny-zone whenever the tool writes via the adapter.
 *
 * This happened twice already (FIX-44-51 note_path, then the ingest/create tools
 * in this audit). This test scans every tool source for path-shaped schema keys
 * and fails if one is neither `path` nor covered by PATH_INPUT_KEYS.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ToolExecutionPipeline } from '../ToolExecutionPipeline';

const TOOLS_DIR = join(__dirname, '..', '..', 'tools');

// Property names that look like a vault path and therefore need governance.
const PATH_KEY_RE = /(^|_)(path|uri|folder|dir)$|^(source|destination|target)$/;

// Path-shaped keys that are intentionally NOT vault paths (URLs, ids, config
// values). Adding to this list is a deliberate "this key is not a vault path".
const NON_VAULT_PATH_KEYS = new Set<string>([
    'url', 'server_url', 'base_url',        // web / provider URLs
    'skill_path', 'script_path',            // resolved inside the sandbox root
    'config_path',                          // never a vault write target
    'strip_root_folder',                    // a boolean flag, not a path
]);

function collectToolFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === '__tests__') continue;
            out.push(...collectToolFiles(full));
        } else if (entry.name.endsWith('Tool.ts')) {
            out.push(full);
        }
    }
    return out;
}

/** All keys registered anywhere in PATH_INPUT_KEYS, plus the default `path`. */
function coveredKeys(): Set<string> {
    const s = new Set<string>(['path']);
    for (const entries of Object.values(ToolExecutionPipeline.PATH_INPUT_KEYS)) {
        for (const e of entries) s.add(e.key);
    }
    return s;
}

describe('BYP-1: PATH_INPUT_KEYS covers every path-shaped tool input', () => {
    it('no tool schema declares an ungoverned vault-path key', () => {
        const covered = coveredKeys();
        const files = collectToolFiles(TOOLS_DIR);
        expect(files.length).toBeGreaterThan(20); // sanity: we actually scanned

        const offenders: string[] = [];
        for (const file of files) {
            const src = readFileSync(file, 'utf-8');
            // Match input_schema property declarations: `key: {` inside a
            // `properties: {` block. Keep it simple: any `word: {` at property
            // indentation whose name is path-shaped.
            for (const m of src.matchAll(/^\s{2,}([a-z_]+):\s*\{/gm)) {
                const key = m[1];
                if (!PATH_KEY_RE.test(key)) continue;
                if (NON_VAULT_PATH_KEYS.has(key)) continue;
                if (covered.has(key)) continue;
                offenders.push(`${key}  (${file.split('/tools/')[1]})`);
            }
        }

        expect(
            [...new Set(offenders)].sort(),
            `These path-shaped schema keys are neither \`path\` nor registered in ` +
            `ToolExecutionPipeline.PATH_INPUT_KEYS, so validatePaths never runs ` +
            `IgnoreService for them (BYP-1). Register them or add to ` +
            `NON_VAULT_PATH_KEYS if genuinely not a vault path:\n  ${offenders.join('\n  ')}`,
        ).toEqual([]);
    });
});

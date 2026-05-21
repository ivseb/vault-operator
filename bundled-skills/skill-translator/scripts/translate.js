/**
 * skill-translator translate / validate / write -- FEAT-29-08 Task C.
 *
 * The actual Python-to-JavaScript LLM call is done at the agent layer
 * (SKILL.md body orchestrates one call per source file via the
 * Frontier-routed main loop). This script:
 *
 *   1. validates the produced JS for sandbox-unsafe patterns
 *   2. builds the TRANSLATION.json audit manifest
 *   3. writes both atomically into the target skill folder via ctx.vault
 *
 * Smoke-test of the produced JS is done at the SKILL.md body level
 * via a follow-up run_skill_script call on the new file with minimal
 * args; surfaces a clear error to the user when the import fails.
 */

const FORBIDDEN_PATTERNS = [
    { pattern: /\beval\s*\(/, label: 'eval() call' },
    { pattern: /\bnew\s+Function\s*\(/, label: 'new Function()' },
    { pattern: /\bFunction\s*\(\s*["'`]/, label: 'Function() constructor with code string' },
    { pattern: /\b__proto__\s*[:=]/, label: '__proto__ assignment' },
    { pattern: /\brequire\s*\(/, label: 'CommonJS require() (sandbox uses ESM imports)' },
    { pattern: /\bprocess\.(env|exit|kill)\b/, label: 'process.env / process.exit / process.kill' },
    { pattern: /\bchild_process\b/, label: 'child_process (subprocess in sandbox)' },
    { pattern: /\bfs\.(write|read|unlink|readdir)/, label: 'direct fs access (use ctx.vault)' },
    { pattern: /\bglobalThis\s*\.\s*[a-zA-Z_$][\w$]*\s*=/, label: 'globalThis property assignment' },
];

/**
 * Scan a JavaScript source string for sandbox-unsafe patterns. Returns
 * `{ ok, issues }` where `issues` is a list of `{ pattern, line }` hits.
 * Comments are not stripped before scanning to keep the check defensive
 * (a determined attacker can hide intent in comments, but the pattern
 * still matches the surrounding code).
 */
export function validateJs(source) {
    if (!source || typeof source !== 'string') {
        return { ok: false, issues: [{ pattern: 'empty source', line: 0 }] };
    }
    const issues = [];
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const { pattern, label } of FORBIDDEN_PATTERNS) {
            if (pattern.test(line)) {
                issues.push({ pattern: label, line: i + 1 });
            }
        }
    }
    return { ok: issues.length === 0, issues };
}

/**
 * Build the audit manifest for a translation. Pure shape function so
 * tests pin the schema.
 *
 * Inputs:
 *   sourceRepo    -- string, e.g. "https://github.com/anthropics/skills"
 *   sourcePath    -- string, vault-relative path of the source skill
 *   sourceVersion -- string | null, the commit SHA or git tag if known
 *   targetPath    -- string, vault-relative path of the translated skill
 *   files         -- [{ source: "...py", target: "...js", lines: number }]
 *   dryRunSummary -- { mappableCount, partialCount, unmappableCount }
 *   partialMarkers-- string[]; module names that were translated with
 *                    limitations or rerouted to built-in tools
 *   translator    -- string, identifier of the agent/model that did it
 */
export function buildManifest(inputs) {
    if (!inputs || typeof inputs !== 'object') {
        throw new Error('buildManifest requires an inputs object');
    }
    const now = inputs.now ?? new Date().toISOString();
    return {
        schemaVersion: 1,
        translationDate: now,
        translator: inputs.translator ?? 'unknown',
        source: {
            repo: inputs.sourceRepo ?? null,
            path: inputs.sourcePath ?? null,
            version: inputs.sourceVersion ?? null,
        },
        target: {
            path: inputs.targetPath ?? null,
        },
        files: (inputs.files ?? []).map((f) => ({
            source: f.source,
            target: f.target,
            lines: f.lines ?? null,
        })),
        dryRun: {
            mappableCount: inputs.dryRunSummary?.mappableCount ?? 0,
            partialCount: inputs.dryRunSummary?.partialCount ?? 0,
            unmappableCount: inputs.dryRunSummary?.unmappableCount ?? 0,
        },
        partialMarkers: inputs.partialMarkers ?? [],
    };
}

/**
 * Write the translated skill into the target folder. Each file is
 * validated before being written; the manifest is written last so that
 * a partial validation failure does not leave a half-written skill
 * advertising itself as complete.
 *
 *   args.sourceRepo, args.sourcePath, args.sourceVersion -- audit info
 *   args.targetPath        -- vault-relative target folder
 *   args.files             -- [{ source, target, content }] with translated JS
 *   args.dryRunSummary     -- pass-through from the dry-run pass
 *   args.partialMarkers    -- pass-through from the dry-run pass
 *   args.translator        -- agent identifier
 *   args.skillMd           -- the rewritten SKILL.md body (already Python-free)
 *
 * Returns { ok, written: [], failed: [], manifestPath, validationIssues: [] }.
 */
export async function writeTranslation(args, ctx) {
    if (!args || typeof args !== 'object') throw new Error('args required');
    if (!ctx || !ctx.vault) throw new Error('ctx.vault required');
    const targetPath = args.targetPath;
    if (!targetPath || typeof targetPath !== 'string') {
        throw new Error('args.targetPath required');
    }
    const files = Array.isArray(args.files) ? args.files : [];
    const written = [];
    const failed = [];
    const validationIssues = [];

    for (const f of files) {
        const { ok, issues } = validateJs(f.content);
        if (!ok) {
            validationIssues.push({ file: f.target, issues });
            failed.push(f.target);
            continue;
        }
        try {
            const out = `${targetPath}/${f.target}`;
            await ctx.vault.write(out, f.content);
            written.push(out);
        } catch (e) {
            failed.push(`${f.target} (write failed: ${e instanceof Error ? e.message : String(e)})`);
        }
    }

    // Rewrite SKILL.md only after all script writes succeeded.
    if (args.skillMd && failed.length === 0) {
        try {
            await ctx.vault.write(`${targetPath}/SKILL.md`, args.skillMd);
            written.push(`${targetPath}/SKILL.md`);
        } catch (e) {
            failed.push(`SKILL.md (write failed: ${e instanceof Error ? e.message : String(e)})`);
        }
    }

    const manifest = buildManifest({
        sourceRepo: args.sourceRepo,
        sourcePath: args.sourcePath,
        sourceVersion: args.sourceVersion,
        targetPath,
        files: files.map((f) => ({ source: f.source, target: f.target, lines: countLines(f.content) })),
        dryRunSummary: args.dryRunSummary,
        partialMarkers: args.partialMarkers,
        translator: args.translator,
    });
    const manifestPath = `${targetPath}/TRANSLATION.json`;
    let manifestWritten = false;
    if (failed.length === 0) {
        try {
            await ctx.vault.write(manifestPath, JSON.stringify(manifest, null, 2));
            manifestWritten = true;
            written.push(manifestPath);
        } catch (e) {
            failed.push(`TRANSLATION.json (write failed: ${e instanceof Error ? e.message : String(e)})`);
        }
    }

    return {
        ok: failed.length === 0,
        written,
        failed,
        manifestPath: manifestWritten ? manifestPath : null,
        validationIssues,
    };
}

function countLines(content) {
    if (!content || typeof content !== 'string') return 0;
    return content.split('\n').length;
}

/**
 * Runtime entry for run_skill_script. Thin wrapper around
 * writeTranslation so the agent can call this directly with the
 * structured payload.
 */
export async function execute(args, ctx) {
    return writeTranslation(args, ctx);
}

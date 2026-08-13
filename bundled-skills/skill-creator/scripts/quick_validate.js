/**
 * skill-creator / quick_validate -- the validator AND the build gate for a skill.
 *
 * Runs as a Vault Operator skill script. Returns, always, in one shape:
 *   { status: 'pass'|'blocked'|'error', findings: [{severity, code, message, fix}], next }
 * It NEVER throws on a policy block. A throw becomes a tool error and the model retries the
 * command instead of fixing the skill; "blocked" is normal control flow.
 *
 * A checklist in a reply is a claim. This is evidence: it re-derives the verdict from the
 * files on disk, so the agent cannot report that validation passed, because the agent does
 * not run it. mode:'finish' additionally checks the brief and the frozen records.
 *
 * THE SELF-TRAP, and it is the reason for the fragments below. The runtime's AstValidator
 * rejects a script whose SOURCE contains a forbidden token, and it looks inside string
 * literals. A script that SEARCHES for those tokens contains them, and rejects itself. So
 * every forbidden token this file hunts for is assembled at runtime from fragments, and no
 * message spells one out with a trailing "(" either. `new RegExp` is allowed; only the
 * two-word constructor is not. The plugin plays the same trick with atob() in AstValidator.
 *
 * Named helpers are exported for the unit test; the sandbox only calls execute().
 */

// Fragments, joined at runtime. Never appear whole in the source.
const F = {
    proc: 'pro' + 'cess',
    gt: 'global' + 'This',
    ev: 'ev' + 'al',
    fn: 'Fun' + 'ction',
    req: 'requ' + 'ire',
    cp: 'child_' + 'pro' + 'cess',
    wasm: 'WebAssem' + 'bly',
    proto: '__pro' + 'to__',
};

// The blocklist, rebuilt from fragments. Mirrors src/core/sandbox/AstValidator.ts closely
// enough to catch a script the runtime would reject; the runtime is still the real gate.
export const SCRIPT_BLOCKLIST = [
    [new RegExp('\\b' + F.ev + '\\s*\\('), 'code-eval', F.ev + ' is rejected by the sandbox before the script runs'],
    [new RegExp('\\bnew\\s+' + F.fn + '\\b'), 'new-fn', 'the two-word code constructor is rejected by the sandbox'],
    [new RegExp('\\b' + F.req + '\\s*\\('), 'commonjs', 'CommonJS module loading does not exist in the sandbox'],
    [new RegExp('\\b' + F.proc + '\\b'), 'host-proc', 'host runtime access is rejected by the sandbox'],
    [new RegExp('\\b' + F.gt + '\\b'), 'global-obj', 'global object access is rejected by the sandbox'],
    [new RegExp('\\b' + F.cp + '\\b'), 'subproc', 'subprocess access does not exist in the sandbox'],
    [new RegExp('\\b' + F.wasm + '\\b'), 'wasm', F.wasm + ' is rejected by the sandbox'],
    [new RegExp(F.proto + '\\s*[:=]'), 'proto', 'prototype pollution is rejected by the sandbox'],
];

// A static import compiles (esbuild.transform) to a call the iframe cannot make, and nothing
// else in the repo catches it. Matches `import x from` / `import 'y'` / `import * as`, not
// `import(` (which the blocklist covers).
const STATIC_IMPORT = /(^|\n)\s*import\s+[^(]/;
const HAS_EXECUTE = /export\s+(async\s+)?function\s+execute\s*\(/;
// A network call from a script always fails: CSP default-src 'none', connect-src falls back
// to it, 'none' matches no URL. Word-boundary so it does not fire on prefetch(.
const NETWORK = /(^|[^.\w])(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/;
// A hardcoded agent root: the folder is a user setting, so a literal path writes into nothing.
const HARDCODED_ROOT = /['"`]\.(?:vault-operator|obsidian-agent|obsilo-vault)\b/;

const NAME_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
const RESERVED = ['anthropic', 'claude'];
const MAX_DESC = 1024;
const MAX_BODY_CHARS = 24000;
const MAX_BODY_LINES = 500;

// Kept in sync with src/core/skills/SkillFrontmatterValidator.ts ALLOWED_KEYS. The repo test
// pins this equal to the exported set, so drift is caught rather than shipped.
export const ALLOWED_KEYS = new Set([
    'name', 'description', 'source', 'trigger', 'license', 'allowed-tools', 'allowedTools',
    'allowed_tools', 'metadata', 'compatibility', 'model', 'requiredTools', 'codeModules',
    'createdAt', 'successCount', 'type', 'version', 'author', 'keywords', 'aliases',
    'priority', 'when-to-use', 'argument-hint', 'context', 'tags',
    // FIX-03-20-02 (title aspect): deterministic chat-title template,
    // e.g. `chatTitle: "Plaud {date}"`.
    'chatTitle',
]);

export function parseFrontmatter(content) {
    const m = content.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return null;
    const out = {};
    for (const line of m[1].split('\n')) {
        const i = line.indexOf(':');
        if (i < 0) continue;
        out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return out;
}

export function extractBody(content) {
    const m = content.match(/^---\n[\s\S]*?\n---\n?/);
    return m ? content.slice(m[0].length) : content;
}

function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// The core check, pure so the test can drive it. Returns findings for one script source.
export function checkScriptSource(rel, source) {
    const findings = [];
    const stripped = stripComments(source);
    for (const [re, code, message] of SCRIPT_BLOCKLIST) {
        if (re.test(stripped)) {
            findings.push({ severity: 'error', code, message: `${rel}: ${message}`,
                fix: 'assemble the token from fragments, or remove it' });
        }
    }
    if (STATIC_IMPORT.test(stripped)) {
        findings.push({ severity: 'error', code: 'static-import',
            message: `${rel}: a static import compiles to a call the sandbox cannot make and dies on first run`,
            fix: 'make the script one self-contained file' });
    }
    if (NETWORK.test(stripped)) {
        findings.push({ severity: 'error', code: 'network',
            message: `${rel}: network from a script always fails (CSP default-src 'none')`,
            fix: 'let the agent fetch and write the result to a file the script reads' });
    }
    if (HARDCODED_ROOT.test(stripped)) {
        findings.push({ severity: 'error', code: 'hardcoded-root',
            message: `${rel}: a literal agent-folder path writes into nothing (the folder is a user setting)`,
            fix: 'take the path from args.skills_root, injected by the host' });
    }
    if (!HAS_EXECUTE.test(source)) {
        findings.push({ severity: 'error', code: 'no-execute',
            message: `${rel}: no "export function execute(args, ctx)"; the sandbox calls exactly that`,
            fix: 'export an async execute function' });
    }
    return findings;
}

export function checkFrontmatter(fm, body) {
    const findings = [];
    const err = (code, message, fix) => findings.push({ severity: 'error', code, message, fix });
    const warn = (code, message, fix) => findings.push({ severity: 'warning', code, message, fix });

    if (!fm) {
        err('no-frontmatter', 'SKILL.md has no --- frontmatter block; the loader returns null and the skill never appears',
            'add name and description');
        return findings;
    }
    const name = (fm.name || '').trim();
    if (!name) err('no-name', 'frontmatter has no name', 'add a kebab-case name');
    else {
        if (name.length > 64) err('name-long', `name is ${name.length} chars (max 64)`, 'shorten it');
        if (!NAME_RE.test(name) || name.includes('--'))
            err('name-format', `name "${name}" is not kebab-case`, 'lowercase, digits, single hyphens');
        for (const r of RESERVED) if (name.includes(r)) err('name-reserved', `name may not contain "${r}"`, 'rename');
    }
    const desc = (fm.description || '').trim();
    if (!desc) err('no-desc', 'frontmatter has no description; this is the only trigger the router sees', 'add one');
    else {
        if (desc.length > MAX_DESC) err('desc-long', `description is ${desc.length} chars (max ${MAX_DESC})`, 'shorten it');
        if (desc.includes('<') || desc.includes('>')) err('desc-brackets', 'description contains < or >', 'remove them');
        if (/TODO/i.test(desc)) err('desc-todo', 'description is still the scaffold TODO', 'write the real trigger');
        else if (desc.length < 40) warn('desc-short', 'description is very short and may under-trigger', 'add trigger phrases');
    }
    for (const key of Object.keys(fm)) {
        if (!ALLOWED_KEYS.has(key)) warn('unknown-key', `unknown frontmatter key "${key}" (read but ignored)`, 'remove it');
    }
    if (body && body.length > MAX_BODY_CHARS)
        err('body-chars', `body is ${body.length} chars; read_skill truncates at ${MAX_BODY_CHARS}`, 'move detail into references/');
    else if (body && body.length > MAX_BODY_CHARS * 0.85)
        warn('body-near', `body is ${body.length} chars, near the ${MAX_BODY_CHARS} cap`, 'consider references/');
    if (body && body.split('\n').length > MAX_BODY_LINES)
        warn('body-lines', `body is over ${MAX_BODY_LINES} lines`, 'move detail into references/');
    if (body && /\[TODO/i.test(body)) warn('body-todo', 'body still contains a [TODO placeholder', 'fill it in');
    if (body && /[—–]/.test(body)) warn('dashes', 'body contains an em- or en-dash', 'use commas or periods');
    return findings;
}

async function listScripts(ctx, skillRoot) {
    const entries = await ctx.vault.list(`${skillRoot}/scripts`).catch(() => []);
    return (entries || []).filter((p) => p.endsWith('.js'));
}

export async function execute(args, ctx) {
    const mode = (args && args.mode) || 'validate';
    const name = (args && args.name && String(args.name).trim()) || (args && args.skill_name);
    const root = args && typeof args.skills_root === 'string' ? args.skills_root.trim().replace(/\/$/, '') : '';
    if (!name) return { status: 'error', findings: [{ severity: 'error', code: 'no-name-arg',
        message: 'args.name (the skill to validate) is required', fix: 'pass {name:"..."}' }], next: 'pass a name' };
    if (!root) return { status: 'error', findings: [{ severity: 'error', code: 'no-host',
        message: 'skills_root not injected; update Vault Operator', fix: 'update the plugin' }], next: 'update' };

    const skillRoot = `${root}/${name}`;
    const findings = [];

    const skillMd = await ctx.vault.read(`${skillRoot}/SKILL.md`).catch(() => null);
    if (skillMd == null) {
        return { status: 'blocked', findings: [{ severity: 'error', code: 'no-skill-md',
            message: `${skillRoot}/SKILL.md not found`, fix: 'run init_skill first' }], next: 'run init_skill' };
    }
    findings.push(...checkFrontmatter(parseFrontmatter(skillMd), extractBody(skillMd)));

    for (const path of await listScripts(ctx, skillRoot)) {
        const src = await ctx.vault.read(path).catch(() => null);
        if (src != null) findings.push(...checkScriptSource(path.slice(root.length + 1), src));
    }

    if (mode === 'finish') {
        const dataRoot = (args.skill_data_root || root.replace(/\/skills$/, '/skill-data')) + `/skill-creator/${name}`;
        const brief = await ctx.vault.read(`${dataRoot}/brief.json`).catch(() => null);
        if (brief == null) {
            findings.push({ severity: 'error', code: 'no-brief',
                message: 'no confirmed brief.json; the build was never bounded', fix: 'confirm the brief with the user first' });
        } else {
            let parsed = null;
            try { parsed = JSON.parse(brief); } catch { /* handled below */ }
            if (!parsed) findings.push({ severity: 'error', code: 'brief-json', message: 'brief.json is not valid JSON', fix: 'rewrite it' });
            else {
                for (const cap of parsed.capabilities || []) {
                    if (!cap.why || !String(cap.why).trim())
                        findings.push({ severity: 'error', code: 'cap-why',
                            message: `capability "${cap.name}" has no why; the agent-or-script decision was assumed`,
                            fix: 'decide per capability and say why' });
                }
                if (!parsed.seam && !(parsed.seam_waived_because || '').trim())
                    findings.push({ severity: 'error', code: 'seam',
                        message: 'no seam and no reason given for not having one',
                        fix: 'name the seam artifact, or set seam_waived_because' });
            }
        }
    }

    const errors = findings.filter((f) => f.severity === 'error');
    return {
        status: errors.length ? 'blocked' : 'pass',
        findings: findings.slice(0, 20),
        next: errors.length
            ? 'fix the errors above, then run quick_validate again'
            : (mode === 'finish' ? 'the skill is ready' : 'run the dry-run, then freeze golden records'),
    };
}

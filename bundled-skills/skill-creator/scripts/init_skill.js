/**
 * skill-creator / init_skill -- scaffold a new skill folder, scaled to its shape.
 *
 * Runs as a Vault Operator skill script: `run_skill_script({skill_name:"skill-creator",
 * script_name:"init_skill", args:{...}})`. There is no argv, no stdout, no __dirname. The
 * only channel to the agent is the returned value, JSON-stringified. A thrown error becomes
 * "Script execution error: {message}", so every throw carries its own recovery step.
 *
 * The host injects `skills_root`, `skill_data_root` and `skill_name`; a script cannot derive
 * them (the agent folder is a free-form user setting and the sandbox has no __dirname).
 * Hardcoding a path was the old bug: it wrote into a folder nobody scans the moment a user
 * renamed their agent folder. Refuse rather than guess.
 *
 * Named helpers are exported so the unit test can exercise them without the sandbox. The
 * sandbox only ever calls execute().
 */

const NAME_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
const RESERVED = ['anthropic', 'claude'];
const SHAPES = ['recipe', 'workflow', 'knowledge'];

export function validateName(name) {
    if (!name || typeof name !== 'string') {
        throw new Error('args.name is required (kebab-case, e.g. "angebots-check").');
    }
    const n = name.trim();
    if (n.length > 64) throw new Error(`name too long (${n.length} > 64): ${n}`);
    if (!NAME_RE.test(n) || n.includes('--')) {
        throw new Error(
            `name "${n}" must be kebab-case: lowercase letters, digits and single hyphens, ` +
            `no leading/trailing/double hyphen.`,
        );
    }
    for (const r of RESERVED) {
        if (n.includes(r)) throw new Error(`name "${n}" may not contain "${r}".`);
    }
    return n;
}

export function skillRootOf(args, name) {
    const root = args && typeof args.skills_root === 'string' ? args.skills_root.trim() : '';
    if (!root) {
        throw new Error(
            'skills_root was not provided by the host. This Vault Operator build is too old ' +
            'for this skill: it must inject skills_root into run_skill_script. Update the ' +
            'plugin, then run this again.',
        );
    }
    return `${root.replace(/\/$/, '')}/${name}`;
}

export function skillDataRootOf(args, name) {
    const dr = args && typeof args.skill_data_root === 'string' ? args.skill_data_root.trim() : '';
    // The brief must survive the materializer, which wipes a pro skill's own folder on every
    // bundle change; so it lives under skill-data, not under the skill. Derive it from
    // skills_root if the host is old enough to lack the dedicated key.
    const base = dr ||
        (args && args.skills_root ? args.skills_root.replace(/\/$/, '').replace(/\/skills$/, '/skill-data') : '');
    if (!base) {
        throw new Error('neither skill_data_root nor skills_root was provided by the host.');
    }
    return `${base.replace(/\/$/, '')}/skill-creator/${name}`;
}

export function renderSkillMd(name, shape, description) {
    const title = name.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const desc = (description || '').trim() ||
        `TODO: what this skill does and WHEN to use it, with concrete trigger phrases.`;
    const shapeNote = {
        recipe: 'One deterministic operation. The script does the work; the body just points at it.',
        workflow: 'Several steps with a seam between judgement and computation. Fill the final check.',
        knowledge: 'No scripts. The rules in this body are the skill.',
    }[shape];
    return (
        `---\n` +
        `name: ${name}\n` +
        `description: ${desc}\n` +
        `source: agent\n` +
        `---\n\n` +
        `# ${title}\n\n` +
        `${shapeNote}\n\n` +
        `## Overview\n\n` +
        `TODO: one or two sentences on what this enables.\n\n` +
        `## Steps\n\n` +
        `TODO: the actual procedure, or the decision rules for a knowledge skill.\n\n` +
        `## Known-good run\n\n` +
        `TODO: after the dry-run, one example and the expected result.\n`
    );
}

// The final check for a workflow skill. Called at the end of every run to prove it is
// complete and correct, including side steps that never reach the deliverable. It cannot
// drive the process (a script has no agent tools); it checks and refuses. The stub blocks on
// purpose, and the dry-run runs it, so an unfilled check cannot leave the build.
export function renderFinalCheck(name, snake) {
    return (
        `/**\n` +
        ` * Final check for ${name}. Fill SEAM, OUTPUTS and domainChecks from the brief.\n` +
        ` *\n` +
        ` * Runs as: run_skill_script({skill_name:"${name}", script_name:"${snake}_check",\n` +
        ` *   args:{run:{...the run's produced artifacts...}}}). Returns {status, findings}.\n` +
        ` * Never throws on a domain failure: a throw reads as a tool error and the model retries\n` +
        ` * instead of fixing. Return {status:"blocked"} for "not correct yet".\n` +
        ` */\n\n` +
        `// The seam artifact this skill produces (a plain object passed in via args.run), or null.\n` +
        `const SEAM = null;\n` +
        `// Keys of args.run that a correct run must contain.\n` +
        `const OUTPUTS = [];\n\n` +
        `export function domainChecks(run, findings) {\n` +
        `    // One block per condition the brief named. Example:\n` +
        `    //   if ((run.summe_eur || 0) < 0) findings.push(['negative Summe', 'neu rechnen']);\n` +
        `    //\n` +
        `    // This stub BLOCKS on purpose. A check that checks nothing reports the work as\n` +
        `    // verified when it was not, which is worse than no check. The dry-run runs this, so\n` +
        `    // it cannot ship unfilled.\n` +
        `    findings.push(['the domain checks are not written yet', 'fill domainChecks() in ${snake}_check.js']);\n` +
        `    void SEAM;\n` +
        `}\n\n` +
        `export async function execute(args) {\n` +
        `    const run = (args && args.run) || {};\n` +
        `    const findings = [];\n` +
        `    for (const key of OUTPUTS) {\n` +
        `        if (!(key in run)) findings.push([\`missing output: \${key}\`, 'the run is incomplete']);\n` +
        `    }\n` +
        `    domainChecks(run, findings);\n` +
        `    return {\n` +
        `        status: findings.length ? 'blocked' : 'ok',\n` +
        `        findings: findings.slice(0, 20).map(([error, fix]) => ({ error, fix })),\n` +
        `    };\n` +
        `}\n`
    );
}

export function planSchemaStub() {
    return JSON.stringify(
        {
            $comment: 'The seam schema. additionalProperties:false and closed enums make it a real gate.',
            type: 'object',
            properties: {},
            required: [],
            additionalProperties: false,
        },
        null,
        2,
    ) + '\n';
}

// Two-pass: render everything, then write. A half-written skill that advertises itself as
// complete is worse than a clean failure. mkdir first, because ctx.vault.write does NOT
// create parent folders in the sandbox.
export async function execute(args, ctx) {
    const name = validateName(args && args.name);
    const shape = (args && args.shape) || 'workflow';
    if (!SHAPES.includes(shape)) {
        throw new Error(`args.shape must be one of ${SHAPES.join(', ')}, got "${shape}".`);
    }

    const skillRoot = skillRootOf(args, name);
    const snake = name.replace(/-/g, '_');

    const existing = await ctx.vault.list(skillRoot).catch(() => null);
    if (existing && existing.length > 0) {
        throw new Error(
            `skill folder already exists at ${skillRoot}. Recovery: delete it with ` +
            `delete_folder("${skillRoot}"), then run init_skill again. Do NOT write SKILL.md ` +
            `to any other path; only ${skillRoot}/SKILL.md is discovered by the loader.`,
        );
    }

    // Pass 1: render.
    const files = { [`${skillRoot}/SKILL.md`]: renderSkillMd(name, shape, args && args.description) };
    if (shape === 'workflow') {
        files[`${skillRoot}/scripts/${snake}_check.js`] = renderFinalCheck(name, snake);
        files[`${skillRoot}/references/${name}-plan.schema.json`] = planSchemaStub();
    }

    // Pass 2: write. Folders first.
    await ctx.vault.mkdir(skillRoot);
    if (shape === 'workflow') {
        await ctx.vault.mkdir(`${skillRoot}/scripts`);
        await ctx.vault.mkdir(`${skillRoot}/references`);
    }
    const written = [];
    for (const [path, content] of Object.entries(files)) {
        await ctx.vault.write(path, content);
        written.push(path);
    }

    const briefRoot = skillDataRootOf(args, name);
    if (args && args.brief) {
        await ctx.vault.mkdir(briefRoot).catch(() => {});
        await ctx.vault.write(`${briefRoot}/brief.json`, JSON.stringify(args.brief, null, 2));
        written.push(`${briefRoot}/brief.json`);
    }

    const next = shape === 'workflow'
        ? [
            `Fill SEAM, OUTPUTS and domainChecks in ${skillRoot}/scripts/${snake}_check.js`,
            `Write the seam schema in ${skillRoot}/references/${name}-plan.schema.json`,
            `Write the SKILL.md body, then run quick_validate {name:"${name}"}`,
        ]
        : [
            `Write the SKILL.md body`,
            `Then run quick_validate {name:"${name}"}`,
        ];

    return { ok: true, name, shape, path: skillRoot, files_written: written, next_steps: next };
}

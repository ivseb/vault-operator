/**
 * init_skill -- creates a new self-authored skill folder under
 * {skills_root}/{name}/ with a SKILL.md template and empty
 * scripts/ / references/ / assets/ folders.
 *
 * Run via:
 *   run_skill_script(skill_name: "skill-creator", script_name: "init_skill",
 *                    args: { name: "my-skill" })
 *
 * Refuses to overwrite an existing folder. The name is validated against
 * the same rules the discovery layer enforces (kebab-case, max 64,
 * no reserved words). Errors come back as a thrown error -- the
 * RunSkillScriptTool serialises them into the tool_result.
 */

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
const RESERVED = ['anthropic', 'claude'];
const MAX_NAME_LEN = 64;

function validateName(name) {
    if (typeof name !== 'string' || name.length === 0) {
        throw new Error('args.name is required (kebab-case skill name)');
    }
    if (name.length > MAX_NAME_LEN) {
        throw new Error(`name too long (${name.length} chars, max ${MAX_NAME_LEN})`);
    }
    if (!NAME_PATTERN.test(name)) {
        throw new Error(
            `name must be kebab-case (lowercase letters, digits, hyphens), no leading or trailing hyphen, no double hyphens. Got: ${JSON.stringify(name)}`,
        );
    }
    if (name.includes('--')) {
        throw new Error('name cannot contain consecutive hyphens');
    }
    const lower = name.toLowerCase();
    for (const word of RESERVED) {
        if (lower.includes(word)) {
            throw new Error(`name cannot contain the reserved word "${word}"`);
        }
    }
}

function defaultDescription(name) {
    return `[TODO: One paragraph that says WHAT ${name} does and WHEN to use it. Include explicit trigger phrases so the agent picks it up from the user wording.]`;
}

function renderSkillMd(name) {
    const title = name
        .split('-')
        .map((s) => (s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s))
        .join(' ');
    return [
        '---',
        `name: ${name}`,
        `description: ${defaultDescription(name)}`,
        // FEAT-29-13: skill-creator output is tagged `agent` so the
        // SkillsTab can distinguish quality-gated agent-authored skills
        // from manually imported/copied/written ones (which stay `user`).
        'source: agent',
        '---',
        '',
        `# ${title}`,
        '',
        '## Overview',
        '',
        '[TODO: 1-2 sentences explaining what this skill enables.]',
        '',
        '## Workflow',
        '',
        '[TODO: Step-by-step procedure. Choose the structure that fits:',
        '',
        '- Sequential -- numbered steps for a fixed order.',
        '- Conditional -- decision-tree for branching logic.',
        '- Task-based -- one section per operation the skill exposes.',
        '- Reference -- standards and specifications.',
        '',
        'Delete this guidance block when done.]',
        '',
        '## Resources',
        '',
        '[TODO: List and link to the scripts/, references/, assets/ files this',
        'skill uses. Resources that are not linked are invisible to the agent.]',
        '',
    ].join('\n');
}


/**
 * The skill folder, taken from the host.
 *
 * A sandboxed script has no __dirname and cannot see the settings, and the agent
 * folder is a free-form user setting (settings.agentFolderPath), so it cannot be
 * guessed either. RunSkillScriptTool resolves the path and passes it in as
 * `skills_root`. Hardcoding '.vault-operator/data/skills' silently writes into a
 * folder nobody scans the moment a user renames their agent folder, and the skill
 * then never appears. Refuse rather than guess.
 */
function skillRootOf(args, name) {
    const root = args && typeof args.skills_root === 'string' ? args.skills_root.trim() : '';
    if (!root) {
        throw new Error(
            'skills_root was not provided by the host. This Vault Operator build is ' +
            'too old for this skill: it must pass skills_root into run_skill_script. ' +
            'Update the plugin, then run this again.',
        );
    }
    return `${root}/${name}`;
}

export async function execute(args, ctx) {
    // The agent may pass the skill name as either `name` or `skill_name`
    // (both are intuitive). Accept either to reduce friction in the
    // multi-turn dialog the skill-creator workflow runs.
    const name = ((args && (args.name || args.skill_name)) || '').trim();
    validateName(name);

    const skillRoot = skillRootOf(args, name);
    const skillMdPath = `${skillRoot}/SKILL.md`;

    // Refuse to overwrite. The agent must consciously delete or rename the
    // existing skill before re-running init. The error message names the
    // exact recovery sequence so the agent does not "fall back" to writing
    // the skill at a wrong path -- that was the failure mode observed in
    // FEAT-29-05 live testing.
    const existing = await ctx.vault.list(skillRoot).catch(() => null);
    if (existing && (existing.length > 0)) {
        throw new Error(
            `skill folder already exists at ${skillRoot}. ` +
            `Recovery: 1) call delete_folder("${skillRoot}") to clear the stale entry, ` +
            `2) re-run run_skill_script(skill_name: "skill-creator", script_name: "init_skill", args: { name: "${name}" }). ` +
            `DO NOT write SKILL.md to any other path -- only ${skillRoot}/SKILL.md is discovered by the loader.`,
        );
    }

    // Create the folder tree explicitly -- adapter.write does NOT
    // auto-create parents for hidden paths.
    await ctx.vault.mkdir(skillRoot);
    await ctx.vault.mkdir(`${skillRoot}/scripts`);
    await ctx.vault.mkdir(`${skillRoot}/references`);
    await ctx.vault.mkdir(`${skillRoot}/assets`);

    const content = renderSkillMd(name);
    await ctx.vault.write(skillMdPath, content);

    // Marker files so the empty folders survive. The agent or the user
    // replaces them when adding the first real resource.
    await ctx.vault.write(`${skillRoot}/scripts/.gitkeep`, '');
    await ctx.vault.write(`${skillRoot}/references/.gitkeep`, '');
    await ctx.vault.write(`${skillRoot}/assets/.gitkeep`, '');

    return {
        ok: true,
        name,
        path: skillRoot,
        next_steps: [
            'Edit SKILL.md: replace TODO placeholders with the real description and workflow.',
            'Add scripts/, references/, assets/ files as needed. Delete unused folders.',
            `Validate with run_skill_script(skill_name: "skill-creator", script_name: "quick_validate", args: { name: "${name}" }).`,
        ],
    };
}

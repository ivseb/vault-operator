---
name: skill-creator
description: Guide for creating effective Vault Operator skills. Use when the user wants to build a new skill (or refine an existing one) that captures a repeatable workflow, a domain expertise, or a tool-integration recipe. Triggers include phrases like "build me a skill", "kannst du das automatisieren", "create a skill", "neuer skill", "make this repeatable".
---

# Skill Creator

This skill guides the agent through creating a Vault Operator skill that another agent run can pick up and execute reliably. It is the basic authoring flow: initialize, edit, validate.

**If the `skill-creator-pro` skill is available, prefer it for anything beyond a trivial one-step skill.** The Pro flow adds a guided requirements dialog (it interviews the user when they cannot state exactly what they need), a feasibility check against the actual plugin runtime and sandbox limits, a confirmed skill brief before any file is written, and a dry-run. This basic flow stays fully usable on its own; the Pro flow is the upgrade for designing non-trivial skills reliably.

## Binding rules (read first, no exceptions)

1. **You never write the on-disk path yourself.** Three tools own every skill I/O: `init_skill` (create), `write_skill` (change SKILL.md OR any file under `scripts/`, `references/`, `assets/`), `read_skill` (load). They resolve the path from the host. Any `create_folder` / `write_file` with a path like `data/skills/...`, `.vault-operator/data/skills/...`, `<agent-folder>/data/skills/...`, `skills/...`, `Notes/skills/...` or a vault-root guess is a bug: `<agent-folder>` is a placeholder for a user setting you cannot see, and a wrong-path skill is invisible to the discovery layer.
2. **`init_skill` is the ONLY way to seed a new folder.** Do NOT call `create_folder` or `write_file` to seed a new skill manually. Even when you "know" the layout, route through `init_skill` so the validator stays happy and the source-frontmatter is correct.
   - **Adding a new file to an existing skill goes through `write_skill` too.** A new `scripts/foo.js`, `references/bar.md` or `assets/baz.png` is a `write_skill {name, content, file:"scripts/foo.js"}` call, not a `write_file` at a guessed path. `write_skill` accepts new sub-file paths, resolves the skill folder for you, and snapshots the old version.
   - **Revising an existing skill.** When the user wants to change a skill that already exists ("improve this skill", a named defect), do NOT scaffold and do NOT guess a filesystem path. Read it with `read_skill <name>`, then write the change back by name with `write_skill {name, content}` (or `file:"references/x.md"` for a resource).
3. **Existing artifacts at the wrong path are NOT proof the task is done.** If you find a half-finished `weekly-meeting-summary` under `Tools & Settings/Skills/`, `Inbox/Orphans/`, the vault-root `data/skills/`, or any similar place, treat it as garbage from a previous broken run. Delete it. The real skill lives where `init_skill` put it; the discovery layer scans one root only.
4. **`quick_validate` is mandatory before declaring done.** Step 5 is not optional. A skill that "looks right" but was never validated is not finished.
5. **Do not short-circuit by reusing a similar-sounding existing skill.** When the user asks to BUILD a new skill, build a new one. Reuse means edit-and-save under the same name -- different name means new skill, even if the domain overlaps with something that already exists.

## About Vault Operator skills

A Vault Operator skill is a folder under `<agent-folder>/data/skills/{skill_name}/` that contains:

- `SKILL.md` -- the only required file. YAML frontmatter (`name`, `description`) plus markdown body.
- `scripts/` -- optional JavaScript helpers executable via `run_skill_script`.
- `references/` -- optional markdown files the agent loads on demand.
- `assets/` -- optional binary files the skill emits as output.

The frontmatter `description` is the trigger. The agent picks the skill based on description alone, never reads the body until the skill activates.

## Core principles

### Concise wins

Context window is a shared resource. Only add information the agent does not already have. Every paragraph must justify its tokens. Prefer one concrete example over a paragraph of theory.

### Match freedom to fragility

Pick the right level of detail for each step:

- **High freedom (text instructions)** -- many valid approaches, agent decides.
- **Medium freedom (pseudocode, parametrized scripts)** -- preferred pattern with variation room.
- **Low freedom (specific scripts, few parameters)** -- fragile or sequence-critical work.

A narrow bridge with cliffs needs guardrails. An open field allows many routes.

### Progressive disclosure

Keep `SKILL.md` under 500 lines. When a section grows past that, move it into a `references/` file and link to it from the body. Reference files load on demand; the body loads on every skill activation.

## Anatomy of a skill folder

```
<agent-folder>/data/skills/{skill_name}/
├── SKILL.md            (required)
├── scripts/            (optional)
│   └── *.js            (executable via run_skill_script)
├── references/         (optional, load on demand via read_file)
│   └── *.md
└── assets/             (optional, copied into output)
    └── *
```

### Frontmatter rules (binding)

Only two fields are written:

```yaml
---
name: my-skill
description: One concise paragraph that explains WHAT the skill does and WHEN to use it. Include explicit triggers so the agent picks it up from the user phrasing.
---
```

Hard constraints enforced by the validator:

- `name` is kebab-case (`[a-z0-9-]+`), max 64 characters, no leading or trailing hyphen, no double hyphens.
- `name` cannot contain the reserved words `anthropic` or `claude`.
- `description` is max 1024 characters, no angle brackets, single line.
- Allowed-only properties: `name`, `description`. Adding extra keys triggers a warning in the discovery layer.

### Anti-patterns

Do NOT create the following in a skill folder:

- `README.md` -- the skill body already tells the agent everything it needs.
- `INSTALLATION_GUIDE.md`, `QUICK_REFERENCE.md`, `CHANGELOG.md` -- meta-noise.
- `tests/` or `examples/` -- the skill is the test surface; put input/output pairs in references/ if needed.
- Wrapper files that just re-export from `references/` -- link directly.

A skill folder only contains files the agent reads at runtime.

## Skill creation workflow

Follow these six steps in order. Skip only when the reason is explicit.

### Step 1: Understand the skill with concrete examples

If usage patterns are unclear, ask the user 1-2 questions at a time:

- "What user requests should trigger this skill?"
- "Give me one concrete example end-to-end of the skill being used."
- "What should the agent return at the end?"

Continue until the functionality is clearly bounded. Avoid asking ten questions at once -- the user drowns.

### Step 2: Plan the reusable contents

For each concrete example, ask:

1. Does this step rewrite the same code each time? -> candidate for `scripts/`
2. Does this step need looked-up schemas or domain knowledge? -> candidate for `references/`
3. Does the output reuse a template? -> candidate for `assets/`

List the planned scripts, references, and assets before initializing.

### Step 3: Initialize the skill folder (MANDATORY before any write)

Call the `init_skill` helper script. This is the only valid way to
seed the folder. It creates the folder at a location it takes from
the host and stamps `source: user` into the frontmatter, plus empty
`scripts/`, `references/`, `assets/` folders and a SKILL.md template.
You do not need to know or type the path.

NEVER substitute manual `write_file` calls for this step, and NEVER
guess a path from the placeholder text. `<agent-folder>` is a user
setting you cannot see; typing `data/skills/{name}/` writes into the
vault root, where the discovery layer never scans. The skill then
does not exist even though a file was written.

```
run_skill_script({
  skill_name: "skill-creator",
  script_name: "init_skill",
  args: { "name": "my-new-skill" }
})
```

`args.name` is the kebab-case folder name the new skill will get. The
script accepts `args.skill_name` as an alias too if that feels more
natural. Validation errors (kebab-case, reserved words, name conflict)
come back in the tool_result with a clear message. Existing folders
are NOT overwritten -- the script refuses if the target exists.

### Step 4: Edit the skill

Now fill out the SKILL.md body and write the resources you planned.
Every write goes through `write_skill` -- by name, not by path. The
tool resolves the folder and snapshots the previous version.

```
write_skill {name: "my-new-skill", content: "<full SKILL.md body>"}
write_skill {name: "my-new-skill", content: "<file body>", file: "scripts/foo.js"}
write_skill {name: "my-new-skill", content: "<file body>", file: "references/bar.md"}
```

Do NOT use `write_file` with any path that looks like the skill's
folder -- neither `data/skills/...`, `.vault-operator/...`, nor a
guess at `<agent-folder>`. `write_skill` is the sink for SKILL.md and
for every sub-file under `scripts/`, `references/`, `assets/`, new or
existing.

Writing guidelines:

- Use imperative or infinitive form ("Read the file", not "You should read the file").
- Source code blocks use fenced JavaScript blocks for scripts, fenced text blocks for examples.
- Reference the resources from the SKILL.md body so the agent knows they exist. Resources that are not linked might as well not exist.

When writing `scripts/*.js`:

- Export `async function execute(args, ctx)`. Both parameters are positional: `args` is the JSON-serializable args dict from `run_skill_script`, `ctx` is the sandbox bridge with `ctx.vault.read/write/list/readBinary/writeBinary` and `ctx.requestUrl`. The return value is JSON-serialized into the tool_result.
- The bare global `ctx` is NOT available -- declare it as the second parameter of execute.
- No `require`, no `fetch`, no DOM, no Node Buffer. Use `TextEncoder` for string-to-bytes.
- Time out at 30 seconds. Heap cap 128 MB. See `sandbox-environment` skill for details.

When writing `references/*.md`:

- One topic per file. The agent reads it via `read_file` on demand.
- Keep individual files under 200 lines. For longer files, include a table of contents at the top.

### Step 5: Validate

Run the `quick_validate` helper. It checks frontmatter shape and allowed-only properties.

```
run_skill_script({
  skill_name: "skill-creator",
  script_name: "quick_validate",
  args: { "name": "my-skill" }
})
```

Returns `{ valid: boolean, errors: string[], warnings: string[] }`. Fix any errors before declaring the skill done. Warnings (TODO placeholder still in description, unexpected frontmatter keys, anti-pattern files) do not block but should be cleaned up.

### Step 6: Iterate

Use the skill on a real task. Notice friction. Update SKILL.md or resources. Re-validate. Repeat.

After two-three real uses the rough edges usually surface. Refactor then, not before.

## Patterns library

For deeper guidance on body structure and output format, the agent loads these on demand:

- `references/workflows.md` -- sequential and conditional workflow patterns.
- `references/output-patterns.md` -- template and example patterns for consistent output.
- `references/composability.md` -- invoke_skill / invoke_mcp_server: how to call other skills or MCP-server tools as building blocks from inside a skill body.

Link these from the new skill's SKILL.md only when the new skill itself follows the pattern.

## Where the skill lands

`init_skill` writes the skill into a folder the host resolves and stamps `source: agent` into the frontmatter. You do not need to know the exact path -- `read_skill`, `write_skill` and the Settings UI all find it by name. The agent never writes into `builtin/` (maintainer-managed) or under a plugin-id source (VaultDNA-managed) -- the validator rejects that.

The Source column in Settings -> Skills distinguishes three categories:

- **Built-in**: ships with the plugin (materialized from `bundled-skills/`).
- **Agent**: created via this skill-creator workflow (quality-gated by `init_skill` + `quick_validate`).
- **User**: manually written, copied, or imported by the user (no quality gate).

If a skill-creator-authored skill conflicts with a builtin or plugin skill of the same name, the agent version wins on every plugin reload (the materializer skips overwrite).

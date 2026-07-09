---
name: skill-creator-pro
description: Design and build a Vault Operator skill together with the user through a guided requirements dialog, a feasibility check against the real plugin runtime, and a confirmed skill brief before any file is written. The Pro authoring flow: use this whenever the user wants to create, design, refine, or automate a repeatable workflow, a domain expertise, or a tool recipe as a skill, especially when they cannot yet state exactly what they need. Prefer this over the basic skill-creator for anything beyond a trivial one-step skill. Triggers include "build me a skill", "create a skill", "neuer skill", "skill erstellen", "make this repeatable", "kannst du das automatisieren", "ich brauche einen workflow fuer", "verbessere diesen skill".
source: pro
---

# Skill Creator

This skill turns a rough intent into a working, validated Vault Operator skill. The user rarely knows the exact shape up front, so the skill does the business-analysis and requirements-engineering part first: it interviews the user, checks every planned capability against what the plugin and Obsidian can actually do, shows a skill brief for confirmation, and only then writes and validates the skill.

This is the entry point to everything Vault Operator can do, so treat it with care. A skill that looks right but does not run in the sandbox, writes to a path Obsidian nulls, or never triggers is worse than no skill.

## The loop (copy this checklist and track it)

Complex builds skip steps silently unless the progress is visible. For any non-trivial skill, copy this list into your reply and check items off as you go.

```
[ ] 0. Classify: recipe, workflow, or knowledge skill (sets dialog depth)
[ ] 1. Requirements dialog: interview until the job is bounded
[ ] 2. Feasibility: check every planned capability against the runtime; probe scripts live
[ ] 3. Skill brief: show it in chat, wait for the user to confirm or change it
[ ] 4. init_skill: seed the folder (the only valid way)
[ ] 5. Build: write SKILL.md body and the planned resources
[ ] 6. quick_validate: mandatory, fix all errors
[ ] 7. Dry-run: run the new skill on the user example, show the result
[ ] 8. Iterate: capture the known-good run and any gotchas, offer refinement
```

Steps 1 through 3 are the part that used to be missing. Do not shortcut to init_skill before the brief is confirmed.

## Binding rules (no exceptions)

1. **The skill folder lives ONLY at `.vault-operator/data/skills/{skill_name}/`.** Any other path (`Tools & Settings/Skills/`, `Notes/skills/`, vault root) is invisible to the discovery layer. A skill written elsewhere does not exist.
2. **`init_skill` is the ONLY way to create the folder.** Never `create_folder` or `write_file` to seed a new skill. Route through `init_skill` so the source marker and layout are correct.
3. **Existing artifacts at the wrong path are NOT proof the task is done.** A half-finished skill under a wrong path is garbage from a broken run. Delete it after the real skill lands at `data/skills/{name}/`.
4. **`quick_validate` is mandatory before declaring done.** A skill that "looks right" but was never validated is not finished.
5. **Build new means build new.** When the user asks to BUILD a new skill, build a new one. Reuse means edit-and-save under the same name. A different name is a new skill, even if the domain overlaps.
6. **Confirm the brief before you build.** The user cannot picture a skill from a one-line request. Show the brief (step 3), let them correct it, then build.

## Step 0: Classify the skill

Before any deep questions, run a quick trigger probe to find the shape. Ask at most two of these, then classify:

- "When should this skill fire, and what should exist in the vault when it is done?"
- "Walk me through one real example, start to finish."

Three shapes, three depths:

- **Recipe** (one clear operation, fixed sequence, little branching): rename a batch of notes, convert a file, apply a template. Short dialog: one or two questions, then brief. Model example: the minimalist skills like `knowledge-rename`.
- **Workflow** (multi-step, data flows between steps, writes to the vault, branches): ingest a source into linked notes, summarize a meeting into anchored blocks, build a dashboard. Full requirements dialog and a strong feasibility pass, because these are where runtime limits bite.
- **Knowledge** (no tool orchestration, the skill is expertise the agent applies): design rules, a classification canon, a style guide. Dialog focuses on scoping the domain and the decision rules. Model example: `presentation-design`.

State the shape you picked and why in one sentence, so the user can correct you early.

## Step 1: Requirements dialog

Read `references/requirements-dialog.md` for the question ladders and the skill-brief template.

The goal is to bound the job, not to collect ten answers. Ask one question per turn with `ask_followup_question` (or AskUserQuestion in Claude Code), give two to four concrete options, lead with a recommendation when you have one, and explain the trade-off in each option. Front-loading a wall of questions makes the user guess; a focused choice with real options draws out what they actually want.

For a workflow skill, cover, adaptively: the trigger and user intent, the current vault state the skill reads (as-is), the vault state it produces (to-be), what "done and correct" looks like (success criteria), what it must NOT do (exclusions), and the data flow between steps. For a recipe, the trigger and the one operation are usually enough. For a knowledge skill, pin down the decision rules and the output format.

Stop asking when you can describe the skill back to the user in a brief without hand-waving.

## Step 2: Feasibility against the runtime

This is the step that keeps a skill from promising what Vault Operator cannot deliver. For every capability the skill needs, decide HOW it runs before you write a word of it. The user should never discover after the fact that a script cannot render a PPTX or that the sandbox cannot reach an API.

Three references carry the runtime facts. Read the ones the planned skill touches:

- `references/runtime-capabilities.md`: the tool catalog. Which tools exist, what each does, and the hard split between what the SKILL body can call and what a `run_skill_script` helper can call. This split is the single most common source of broken skills.
- `references/sandbox-and-limits.md`: what a `scripts/*.js` helper can and cannot do. The `ctx` API surface, the hard limits (30s, 128 MB, 10 MB per write, rate limits, the four-host network allowlist), the blocked language patterns, and the review-bot rules that any generated code must follow.
- `references/obsidian-constraints.md`: where files may live, the dot-path nulling trap, the read-window cap, desktop-only, language and English fallback, why `model:` frontmatter does nothing, and why the sandbox cannot reach MCP servers.

Decision matrix for each capability:

1. **A built-in tool already does it** (for example `create_pptx`, `set_block_anchors`, `ingest_document`, `semantic_search`): the SKILL body calls that tool. Prefer this. Do not reimplement a tool inside a sandbox script.
2. **No tool, but the sandbox can compute it** (data transform, text munging, a small generated file): a `scripts/*.js` helper via `run_skill_script`. Confirm it fits the sandbox surface first.
3. **Neither**: redesign the step, or tell the user plainly that this part is not possible in Vault Operator and offer the closest thing that is.

**Live probe.** For any planned script step, do not trust that it will run. Write the smallest version of its core logic and run it through `evaluate_expression` against a scratch path under `.vault-operator/cache/` before you commit it to `scripts/`. Confirm the library bundles, the `ctx.vault` calls behave, and the output shape is what you expect. A ten-second probe now saves a debug cascade later.

## Step 3: Skill brief and confirm gate

Assemble everything into a skill brief and show it in the chat. The template is in `references/requirements-dialog.md`. It states, in the user's terms: the name and one-line description, the trigger, the intent, the as-is and to-be, the success criteria, the exclusions, the feasibility verdict per capability (tool, script, or not possible), the planned `scripts/` `references/` `assets/`, and one concrete example run.

Then stop. Ask the user to confirm or change it. Do not call `init_skill` until they confirm. This is the one gate that turns a vague request into a shared, correct spec.

## Step 4: Initialize the folder

Call `init_skill`. This is the only valid way to seed the folder. It creates the layout under `.vault-operator/data/skills/{name}/` with a SKILL.md template plus empty `scripts/` `references/` `assets/` folders, and stamps `source: agent` into the frontmatter.

```
run_skill_script({
  skill_name: "skill-creator-pro",
  script_name: "init_skill",
  args: { "name": "my-new-skill" }
})
```

`args.name` is the kebab-case folder name (`args.skill_name` is accepted as an alias). Validation errors (kebab-case, reserved words, name conflict) come back in the tool result. The script refuses to overwrite an existing folder.

## Step 5: Build the skill

Fill out the SKILL.md body and write the resources from the brief. Read `references/workflows.md` for body structure, `references/output-patterns.md` for output templates, and `references/composability.md` when the skill calls other skills or MCP tools.

Writing guidelines that matter most:

- **Description is the trigger, and it must be pushy.** State what the skill does and when to use it, in the third person, with concrete trigger phrases and, where useful, "even if the user does not say X". Claude under-triggers by default; a vague description means the skill never fires. Keep it declarative, not a question, so it does not misfire recipe matching. Max 1024 characters, single line, no angle brackets.
- **Concise wins.** Assume the agent is capable. Every paragraph must earn its tokens. Do not explain what the agent already knows. One concrete example beats a paragraph of theory.
- **Explain why, do not command.** Reframe "ALWAYS" and "NEVER" into the reason behind them. A rule with its rationale generalizes to cases you did not list; a bare command gets forgotten or misapplied.
- **Match freedom to fragility.** High freedom (prose) for open tasks, medium (parametrized scripts) for a known pattern, low (exact scripts) for fragile, sequence-critical work. A narrow bridge needs guardrails; an open field allows many routes.
- **Progressive disclosure.** Keep SKILL.md under 500 lines. Move anything larger into a `references/` file and link it directly from the body. References load on demand; the body loads on every activation. Keep references one hop from SKILL.md, never a chain.
- **Prefer built-in tools to generated code**, and prefer a bundled script to code the agent writes fresh each run. Say explicitly whether a script is to be executed or read as reference.
- **Document known gotchas at the end.** Concrete failure modes ("scanned PDFs return empty, check page type first"), not "be careful".

When writing `scripts/*.js`, follow the contract in `references/sandbox-and-limits.md`: `export async function execute(args, ctx)`, `ctx` is the second parameter (there is no bare global `ctx`), only `ctx.vault.*` and `ctx.requestUrl` exist, and none of `require`, `fetch`, DOM, `Buffer`, `eval`, or `new Function` is available.

Read `references/anti-patterns.md` before you finish. It lists the recurring failure classes that have actually shipped broken skills, plus the mandatory house rules (English UI strings, no em-dashes or double-hyphen separators, no emojis, no internal IDs in user-facing text, source-only default for ingest, neutral MCP wire).

## Step 6: Validate

Run `quick_validate`. It checks the frontmatter shape and now also lints the body for the common quality defects (oversized body, em-dashes, emojis, a still-generic description, leftover placeholders, anti-pattern files).

```
run_skill_script({
  skill_name: "skill-creator-pro",
  script_name: "quick_validate",
  args: { "name": "my-skill" }
})
```

Returns `{ valid, errors, warnings }`. Fix every error before declaring done. Clear the warnings too unless you have a reason to keep one.

## Step 7: Dry-run

A skill that validated is not a skill that works. Run the new skill against the concrete example from the brief.

- For a workflow or recipe skill, invoke it with `invoke_skill` (or run its script with `run_skill_script`) on the user's example inputs, and show the result and any files it produced. Watch for the failure modes in `references/anti-patterns.md`: a plausible-looking completion that did the wrong thing, a silent empty write, a step skipped.
- For a knowledge skill, feed it a representative case and check that the output follows the rules the brief promised.

If the dry-run surfaces friction, fix the SKILL.md or the resources and re-validate before showing the result again.

## Step 8: Iterate and capture

Record what a good run looks like so future runs and future edits have a baseline. Keep it compact: add a short `## Known-good run` section to the new skill's SKILL.md with the trigger phrase and the expected end state, and a `## Known gotchas` section with any failure mode you hit. For a complex skill with several scenarios, put these in `references/known-good-runs.md` instead and link it.

Then offer the user a real-use round: use the skill on an actual task, bring back the friction, refine. The rough edges usually surface after two or three real uses. Refactor then, not before.

## Reference index

Load these on demand, only when the skill you are building touches them:

- `references/requirements-dialog.md`: the adaptive question ladders (recipe, workflow, knowledge) and the skill-brief template. Read at step 1.
- `references/runtime-capabilities.md`: the Vault Operator tool catalog and the body-versus-script split. Read at step 2.
- `references/sandbox-and-limits.md`: the sandbox `ctx` API, the hard limits, the blocked patterns, and the review-bot rules for generated code. Read at step 2 and when writing scripts.
- `references/obsidian-constraints.md`: storage layout, dot-path nulling, read-window cap, desktop-only, language, ineffective `model:` frontmatter, MCP boundary. Read at step 2.
- `references/anti-patterns.md`: the recurring skill-bug classes and the mandatory house rules. Read at step 5.
- `references/workflows.md`: sequential, conditional, and state-machine body patterns. Read at step 5.
- `references/output-patterns.md`: strict and flexible output templates. Read at step 5 for skills that produce structured output.
- `references/composability.md`: `invoke_skill` and `invoke_mcp_server` as building blocks. Read at step 5 for skills that call other skills.

## Where the skill lands

Skills created here land at `.vault-operator/data/skills/{name}/` with `source: agent` written by `init_skill`. The agent never writes into `builtin/` (Sebastian-managed) or under a plugin-id source (VaultDNA-managed); the validator rejects that.

The Source column in Settings, Skills distinguishes: **Built-in** (ships with the plugin), **Agent** (created here, quality-gated by `init_skill` plus `quick_validate`), and **User** (hand-written or imported, no quality gate). If an agent skill and a built-in skill share a name, the agent version wins on every reload (the materializer skips overwrite).

# Anti-patterns and house rules

The failure classes that have actually shipped broken skills, and the house rules every skill must follow. Read this before finishing a build. Each recurring bug is written as the trap, then the fix, because a rule with its reason generalizes and a bare command does not.

## Contents

- Recurring skill-bug classes
- Anti-pattern files
- Mandatory house rules
- The description failure modes

## Recurring skill-bug classes

**A skill reads its own body in the sandbox.** The SKILL.md body is already in the system prompt when the skill runs. A script that does `ctx.vault.read("skills/.../SKILL.md")` doubles the tokens and triggers debug cascades. Never make a skill read its own body or references from the sandbox. If a script needs a value from the body, the body passes it in via `args`.

**Byte-exact matching against messy text.** A skill that ran `text.indexOf(anchor)` against garbled transcript text spun through fifteen debug rounds and tens of thousands of output tokens in one run. Anything that anchors, replaces, or locates a passage in imperfect text must use fuzzy or normalized matching. Use `set_block_anchors` (three-layer fuzzy match) or `edit_file`'s normalized matching, not a hand-rolled indexOf.

**Writing user data to dot-paths.** Files under a dot-prefixed folder get nulled by the post-task review path, and `append_to_file` / `create_folder` fail on them outright. Keep skill state under `.vault-operator/data/skill-data/{name}/` written through hidden-aware atomic writes, and put user output in a normal visible folder. See `obsidian-constraints.md`.

**Assuming sub-skill inheritance.** A skill invoked via `invoke_skill` does not inherit the parent's settings. If a sub-skill needs a setting value, the parent passes it explicitly in `args`. Do not write a sub-skill body that expects `${settings.x}` to be resolved for it.

**evaluate_expression as an orchestrator.** Using sandbox code to sequence native tool calls is an abuse that hits the 16000-character return cap and burns tokens. Native tools (`read_file`, `edit_file`, `update_frontmatter`, `set_block_anchors`) do the orchestration in the body. Reserve `evaluate_expression` and scripts for genuine computation: data transforms, small file generation, math.

**Question-shaped descriptions firing recipes.** A description written as a question ("what is...", "how to...", "warum...") has misfired recipe matching. Keep the description declarative ("Integrate a folder of notes into linked concept notes"), not interrogative.

**Oversized body.** A SKILL.md over 500 lines loads as system-prompt payload on every activation turn, independent of the model. The current worst case is a 1368-line body that should have been split. Anything past 500 lines moves into `references/{topic}.md` and gets linked from the body.

**Wrong folder path.** A skill written anywhere other than `.vault-operator/data/skills/{name}/` is invisible to discovery. `init_skill` is the only valid seed. A half-finished skill at a wrong path is garbage from a broken run; delete it after the real one lands.

## Anti-pattern files

Do not create these inside a skill folder:

- `README.md`: the body already tells the agent everything.
- `INSTALLATION_GUIDE.md`, `QUICK_REFERENCE.md`, `CHANGELOG.md`: meta-noise.
- `tests/` or `examples/` at the skill root: the skill is the test surface. Script tests, if any, go under `scripts/__tests__/`.
- Wrapper files that re-export from `references/`: link the reference directly.

A skill folder contains only files the agent reads or executes at runtime.

## Mandatory house rules

Every skill this creator produces follows these, because parts of the body and its outputs reach the user and the wire:

- **English UI strings.** The description, trigger phrases, `ask_followup_question` text, and `attempt_completion` result are English. A user's own private skill body may be another language, but the description stays English for trigger consistency.
- **No em-dashes, en-dashes, or double-hyphen separators.** Use commas, parentheses, periods, colons, "and", or "but". This applies to the body, the description, and any user-facing string, because they flow into the system prompt and partly to the user.
- **No emojis.** Anywhere: body, description, scripts, references, user-facing text.
- **No internal IDs in user-facing text.** No FEAT, EPIC, ADR, or FIX identifiers in a description, a question, or a completion message.
- **Source-only default for ingest.** A skill that ingests content (PDF, URL, document) defaults to writing the source note only. Take-aways go into the chat; detailed downstream notes are opt-in, not automatic.
- **Neutral MCP wire.** A skill that calls an MCP tool via `invoke_mcp_server` puts no urgency words, no personal names or PII, and no persona fragments into the tool description or arguments. Everything crossing the MCP wire is untrusted-out.

## The description failure modes

The description is the router. It is the one piece of the skill always in context, and it decides whether the skill ever fires. The dominant failure is under-triggering from a vague description ("Helps with documents", "TDD stuff"), which fires at a fraction of the intended cases. The fixes:

- State what the skill does and when to use it, both, in the third person.
- Add concrete trigger phrases, including near-synonyms the user might actually type, in the languages they use.
- Be pushy where the intent is often implicit: "use this even if the user does not say X".
- Keep it declarative, under 1024 characters, single line, no angle brackets.

To test triggering properly, imagine ten queries that should fire it and ten near-misses that should not (adjacent tasks that share keywords but want a different skill). The near-misses are the important half; they catch over-triggering. Tighten the description until it separates the two sets.

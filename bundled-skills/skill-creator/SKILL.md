---
name: skill-creator
description: Design and build a Vault Operator skill together with the user. When they have a pain or a wish but no solution yet, work out the problem with them first, then run a requirements dialog, a feasibility check against the real runtime (tools, sandbox, vault), and a confirmed brief before any file is written. Every build passes a validation script whose verdict is a tool result, not a claim. Use this whenever the user wants to create, refine or automate a repeatable workflow, a domain expertise or a tool recipe as a skill; when something costs them time weekly and they cannot name the solution; and when they ask for a recurring deliverable, because the cadence is the signal, not the verb. Also use this to diagnose and fix a skill that misbehaves, even when the user only names the symptom. Triggers include "create a skill", "build me a skill", "make this repeatable", "neuer Skill", "kannst du das automatisieren", "improve this skill", "der Skill macht X falsch", "warum verschwindet die Skill", "fix this skill".
source: builtin
---

# Skill Creator

This turns a rough intent into a working, validated Vault Operator skill. The user rarely knows the exact shape up front, so the skill does the problem-understanding first: it interviews, checks every planned capability against what the sandbox and the tools can actually do, shows a brief for confirmation, and only then scaffolds, builds, validates and dry-runs.

A skill that looks right but tries to fetch from a sandbox script, or import an npm package into `scripts/`, is worse than no skill, because it passes every check and dies on the user's first call. This skill exists to catch that before the user does.

## How you talk to the user

Everything below is machinery. The user must never see it. Read `references/dialogue.md`; it is the most important reference here, because the first turn decides whether the rest works.

**Never say out loud:** the step numbers, the internal categories ("deine Anfrage ist ein Wunsch"), the name of the phase ("ich starte den Discovery-Dialog"), or any build artifact (the brief, the seam, golden records, the shape). Classify silently, then ask a question a colleague would ask.

Two rules that carry most of it:

- **Ask only what changes something.** Before any question: what would I do differently depending on the answer? If nothing, it is a form field and the user feels it.
- **One ask per turn**, and a question mark is not the unit. Two interrogatives behind one `?` are two asks. Ask, then stop; what the user says next is worth more than your second question.

For a decision, do not ask an open question. Use the decision block in `references/dialogue.md`: two to four options, each with a Dafür and a Dagegen, your recommendation first, and the user's own answer always a visible option. Vault Operator HAS `ask_followup_question`, so render the block through it; the reference says how.

## First fork: build, revise, or diagnose

Before the lifecycle, decide which of three you are in.

- **Build:** a NEW skill. Everything below builds from nothing.
- **Revise:** a change to an existing skill where you already know WHAT to change. "erweitere den Skill um Y", "ändere Schritt 3", "andere Trigger". Jump to "Revising an existing skill"; do not run the greenfield lifecycle or touch `init_skill`.
- **Diagnose:** an existing skill that MISBEHAVES, where the fix is not yet known. "der Skill macht X falsch", "die Skill tut nicht was sie soll", "das Ergebnis stimmt nicht", "warum verschwindet die Skill". Here the trap is jumping to a fix before the cause is found. Go to "Diagnosing a skill that misbehaves" FIRST; it ends by handing a known change to the revise path.

The line between revise and diagnose is whether the cause is known. "Trigger auf Y erweitern" is revise. "Die Skill schreibt Müll in die Note" is diagnose, because the reason (wrong data source? wrong script? wrong tool call?) is a hypothesis until checked. Guessing the cause and revising on the guess is the failure this fork exists to prevent.

## The lifecycle

Copy this into your reply and check items off. The checklist is a claim; `quick_validate` is the evidence.

```
[ ] 0a. Frame: a request, a pain, or a wish? (references/dialogue.md)
[ ] 0b. Discovery, only for a pain or a wish (references/problem-discovery.md)
[ ] 0c. Classify: recipe, workflow, or knowledge
[ ] 1. Requirements dialog: interview until the job is bounded
[ ] 2. Feasibility: agent vs tool vs script per capability; verify external data shapes on a real sample; name the seam (references/determinism.md)
[ ] 3. Brief: show it, wait for confirmation, then write brief.json
[ ] 4. init_skill: scaffold for the shape
[ ] 5. Build: SKILL.md body, resources, and the final check for a workflow
[ ] 6. Validate: quick_validate; fix every error
[ ] 7. Dry-run, then freeze golden records with the user
[ ] 8. finish, then Settings, Skills, Reload skills
```

Steps 0a through 3 are where a wrong skill gets prevented. Do not shortcut to `init_skill` before the brief is confirmed.

## Diagnosing a skill that misbehaves

A misbehaving skill is a bug, and a bug is found before it is fixed. The dominant failure mode here is reflexive repair: the agent reads the complaint, forms a guess, rewrites the body on the guess, the symptom persists, and it rewrites again. Two or three rounds of that burn tokens and erode the user's trust without touching the cause. Resist it. Look first.

1. **Reproduce the claim against reality, not against the body.** The SKILL.md tells you what the skill was MEANT to do; it is not evidence of what happened. Get the real artifacts: `read_file` the note or output the skill produced, `search_history` for the run where it went wrong, `read_file` any sink/scratch file the skill left behind. If the skill calls a tool or an MCP server, look at what that call actually RETURNED, not what the body assumed it returns. A wrong assumption about a data shape is the single most common root cause, and it is invisible until you see one real payload.

2. **State the root cause as a causal chain before proposing any fix.** "Problem: X. Root cause: Y. Chain: step 1, step 2, error." If you cannot write the chain, you have not found the cause, and a fix is still a guess. Say so and keep looking. When the cause is a mismatch between what the skill assumed and what the runtime delivers, name both sides explicitly.

3. **Separate "wrong file on disk" from "stale in memory".** A skill that VANISHED (gone from `/`, not firing) is usually not a broken file, it is the loader holding an old state. A skill that produces WRONG OUTPUT is a real defect in the body or a script. Check which one you are in before editing: `read_skill <name>` shows what the loader currently holds; compare it to the file. If the file is fine but the skill misbehaves or is missing, the fix is a reload, not an edit (tell the user: Settings, Vault Operator, Skills, Reload skills), and a reload is also needed after any change that did not go through `write_skill`.

4. **Only once the chain is written, hand off to revise.** The diagnosis produces a known, bounded change. Now the revise path applies it (through `write_skill`, snapshot, validate, reload). Do not skip validation because "it was only a small fix"; a small fix that breaks the frontmatter makes the skill vanish, which reads as a new bug.

5. **Fix the assumption at its source, not just the symptom.** If a script silently accepted the wrong data shape, harden it to FAIL LOUDLY on that shape (a clear error beats a silently wrong note), and re-check the data-form feasibility in step 2 of the lifecycle so the same class cannot recur. A test-first repair (a fixture of the real bad payload, a check that now fails, then the fix) turns the bug into a regression guard.

## Revising an existing skill

A revision has a known target, so it does not re-interview the whole skill and it does not scaffold. `init_skill` refuses to overwrite an existing folder anyway. The path is read, change, write, validate, reload.

1. **Load the real content.** `read_skill <name>` for the body. If the change touches a resource, read that file too (`read_file` on the path from the skill's inventory), so you edit what is there, not a memory of it.
2. **Bound the change.** One focused question about what should be different. If there are options, use the decision block from `references/dialogue.md`. Do not run the full requirements dialog; you already have a skill.
3. **Write it back by name.** `write_skill` resolves the on-disk path itself and snapshots the old version first, so a bad edit is revertable. Never guess a filesystem path and never reach for `write_file` with `.vault-operator/...`; that path-guessing is exactly what fails.

   ```
   write_skill {name:"<name>", content:"<the revised SKILL.md body>"}
   ```

   For a resource, pass the relative `file`:

   ```
   write_skill {name:"<name>", content:"<full file>", file:"references/x.md"}
   write_skill {name:"<name>", content:"<full file>", file:"scripts/y.js"}
   ```

   For SKILL.md, `content` is the body; the tool keeps the frontmatter. To change the one-line description (the trigger), add `description:"..."`.
4. **Validate.** `run_skill_script skill-creator/quick_validate {name:"<name>"}`. Same gate as a build; fix every error.
5. **Re-check the seam.** If the skill has golden records, re-run the dry-run and its final check. A body change can break an assertion.
6. **Reload.** Tell the user: "Settings, Vault Operator, Skills, dann **Reload skills**."

A binding rule still holds: a change is whole or it is not made. Do not leave a skill half-rewritten.

**Editing a shipped skill.** The Source column says where a skill came from, not what it may do: `builtin` ships with the plugin and is the only trusted tier, `registry` was installed from the public skill registry, `agent` is what this workflow stamps on what it creates, `user` is everything written, copied or imported by hand. `write_skill` will edit a `builtin` or `registry` skill, but doing so turns it into a local user copy: the `source` flips to `user` so the edit survives the next bundle update, and the skill loses its trusted status (its instructions no longer override tool selection). Tell the user this plainly before you do it. To change a shipped skill for everyone, its source in the repo is edited, not the installed copy.

## Binding rules

1. **A skill script is ONE self-contained file.** No `import`, no `require`. A static import compiles to a call the sandbox cannot make and dies on the first run, and nothing else in the repo catches it. Everything the script needs is in that one file or in `ctx`.
2. **You never write the on-disk path yourself.** `init_skill` seeds a new folder, `write_skill` writes SKILL.md AND any sub-file (`scripts/x.js`, `references/y.md`, `assets/z.png`), `read_skill` loads by name. All three take the path from the host. `write_file` with a guessed path -- `data/skills/...`, `.vault-operator/...`, or an expanded `<agent-folder>` -- writes into a place the discovery layer does not scan, and the skill silently does not exist.
3. **`quick_validate` is the gate.** You do not run the validator and report the result; the script runs it, so a reported pass is real. Its verdict is `{status, findings, next}`, and a block is normal, not an error.
4. **Confirm the brief before you build.** The user cannot picture a skill from a one-liner. Show the brief, let them correct it, then build.
5. **A skill is not always the answer, but half a skill never is.** The lifecycle may end at 0a or 0b with nothing built: a one-off you do now, or a process the user should change. Say so. But when you build, build it whole.
6. **Prefer a tool, then a script, then the agent.** See step 2.
7. **Revise with `write_skill`, never `init_skill`.** Editing an existing skill goes by name through `write_skill`, which resolves the path and snapshots the old version. `init_skill` is for a folder that does not exist yet; it refuses to overwrite.
8. **Adding a new sub-file uses `write_skill` too.** A new `scripts/foo.js` or `references/bar.md` on an already-scaffolded skill is `write_skill {name, content, file:"scripts/foo.js"}`, not a `write_file` at a guessed path. `write_skill` accepts new sub-files.

## What each shape ships

Nothing is mandatory for a skill that does not need it. A file-renamer forced to carry a schema and ten records is a skill whose author quietly skips all of it, and skipped machinery is worse than none, because it claims verification that did not happen.

| | recipe | workflow | knowledge |
|---|---|---|---|
| Seam artifact plus schema | no | yes | no, waived with a reason |
| Final check (`scripts/<snake>_check.js`) | no: the op script's return is the check | yes, generated | no scripts at all |
| Golden records | 1, file checks plus rubric | 2 to 3, code plus rubric | 1 to 2, rubric-only |
| Extra questions to the user | 1 | 1 | 1 |

## Step 0a: Frame the request

Read the opening message and decide which of three realities you are in. This gate decides which first question is even sensible; asking one the user's own sentence makes absurd loses the conversation in a turn.

- **A request** names both the OBJECT and the RESULT ("bau mir einen Skill, der die Dateien nach Datum umbenennt"). A named defect on an existing thing IS a result. A domain with no result ("ich brauche einen Workflow für die Angebotsprüfung") is a pain in a request's clothes; run 0b. For a real request, do not interview: ask the one question whose answer changes the build (usually "was machst du mit dem Ergebnis?"), then go to 0c.
- **A pain** describes an existing task that costs time, no solution named. Run 0b.
- **A wish** names something the user wants and does not have ("ich benötige ein Daily Briefing"). There is no last time and no duration; asking what it costs today is nonsense. Open with content: "Briefing worüber? Erzähl mir, was heute früh drin gestanden hätte, wenn du es schon gehabt hättest."

The rule that outranks the categories: look for the as-is of the NEED, not of the artifact. And before any move, check it fits: "erzähl mir vom letzten Mal" needs a last time to exist. Classify silently. The user can override with "direkt bauen".

## Step 0b: Discovery

Read `references/problem-discovery.md` and run its four beats: what it costs today (with the embedding, because almost no task is an island), one how-might-we, two or three ways forward with one that is not a skill, and the abort signal. And the as-is check: ask "warum" up to three times before automating a step, so you do not freeze a broken process into code.

Four verdicts, three of which build nothing: no skill (a twice-a-year task), several skills (name them, build the most valuable first), no solution yet (keep going), or yes.

## Step 0c: Classify

- **Recipe:** a deterministic task, little reasoning, the agent only coordinates. One script does the work. Test: is there any point where the agent has to DECIDE? No, then recipe.
- **Workflow:** a mix of determinism and reasoning. Multi-step, a seam between judgement and computation. Test: is there a handover between judgement and computation? Yes, then workflow, and that handover is the seam.
- **Knowledge:** only the LLM. No scripts. The rules are the skill. Test: would it work whole without a line of code? Yes.

The shape is a diagnosis, not a straitjacket. The moment a knowledge skill wants a deterministic check, it has become a workflow.

## Step 1: Requirements dialog

Read `references/requirements-dialog.md`. If 0b ran, do not ask again what it already answered: name what you have, then ask only for the gaps. Stop when you can describe the skill back without hand-waving.

## Step 2: Feasibility, and the three venues

Read `references/determinism.md` and `references/runtime-capabilities.md`. For every capability, decide HOW it runs, first answer wins:

1. **Does Vault Operator already have a tool for it?** `read_document` parses PDF, DOCX, XLSX, PPTX, CSV, XML, JSON. `create_pptx/docx/xlsx` write Office files. `semantic_search`, `web_fetch`, `get_frontmatter`. If yes, use the tool: the source skill wrote a script only because ITS platform had none. This is the most-missed answer.
2. **Is the output fully determined by the input, and computable with plain JS?** Arithmetic, sorting, matching, a fixed sequence over `ctx.vault`. Then a sandbox **script**. A calculation the agent does can silently change; one in code is the same every time.
3. **Everything else is the agent**, whose judgement no script can replace.

A script cannot call a tool, reach the network, or import a package. If a step needs a web page, the agent fetches it with `web_fetch` and writes it to a file the script reads. If it needs an npm package, that is an `evaluate_expression` call the agent makes, never a `scripts/*.js`. Read `references/sandbox-and-limits.md` for the hard wall.

**Verify the data SHAPE, not just the tool, before a script depends on it.** Knowing a tool EXISTS is not knowing what it RETURNS. When a capability consumes data from an MCP server, an external API, or any tool whose output you are inferring rather than reading, get ONE real sample first: call the tool once and look at the actual payload (sink it to a scratch file and `read_file` it). A script built on an assumed shape passes every check and dies on the first real call, or worse, succeeds silently on the wrong data (a summary where a transcript was assumed) and writes a plausible but wrong result. The sample must answer two things: what fields are really there (names, nesting, encoding, a JSON string inside a string?), and does the SAME tool return different shapes for different inputs (template-dependent fields, empty vs populated blocks). If the shape varies, the script detects the wrong shape and fails loudly, never coerces it. This one check would have prevented the most expensive skill bug shipped so far.

**Do not guess a tool's capability; read its definition.** When the build hinges on whether a tool supports some option (does `ask_followup_question` take a multi-select flag?), the tool definition is the authority, not memory and not a reflex rewrite. `references/runtime-capabilities.md` lists what the agent has; if a flag is still in question, check the tool's own schema before building on it. Reactively rewriting around a capability you never confirmed is how a build spirals.

Then name the seam: the smallest machine-readable file that captures the agent's decisions before the first script runs. In Vault Operator this is best a **note with frontmatter**: the user sees it, can edit it, and it lives in the graph. If there is no seam, set `seam_waived_because` and tell the user what it costs.

**Trigger mode.** Vault Operator has no scheduler. A recurring deliverable ("jeden Montag") is still built as a skill the user invokes; there is no routine to run it unattended. Say so plainly; do not promise automation the platform cannot give.

## Step 3: Brief and confirm

Assemble the brief and show it in the user's language. Then stop and ask them to confirm. Write the confirmed brief as JSON via `init_skill`'s `brief` arg; it lands under `skill-data`, not in the skill folder, because the materializer wipes a pro skill's folder on every bundle change. Fields: `name`, `shape`, `intent`, `inputs`, `outputs`, `exclusions`, `seam` or `seam_waived_because`, `capabilities` (each `name`, `mode`, non-empty `why`), `planned_scripts`, `example_run`.

## Step 4: Scaffold

```
run_skill_script skill-creator/init_skill {name:"<name>", shape:"recipe|workflow|knowledge", brief:{...}}
```

It refuses to overwrite, and it fails loudly if the host did not inject `skills_root`. A workflow also gets `scripts/<snake>_check.js` and a plan schema stub. Then:

```
run_skill_script skill-creator/quick_validate {name:"<name>"}
```

## Step 5: Build

Write the SKILL.md body and the resources. Read `references/output-patterns.md` and `references/workflows.md` for structure, `references/anti-patterns.md` before you finish. For a workflow, fill `scripts/<snake>_check.js`: set SEAM, OUTPUTS and the domain checks. The stub blocks on purpose and the dry-run runs it, so an empty check cannot ship.

House rules for the body: the description is the trigger, be concise, explain why rather than command, keep the body under 24000 characters (`read_skill` truncates there), keep references one level deep. Every runtime claim in this skill was re-derived from Vault Operator's code; do not copy runtime facts from another platform's skill.

## Step 6: Validate

```
run_skill_script skill-creator/quick_validate {name:"<name>"}
```

It checks the frontmatter contract, every script against the sandbox blocklist plus static-import plus network, and the body budget. Fix every error. An invalid skill does not load disabled; the loader rejects it and it never appears.

## Step 7: Dry-run, then freeze

Run the skill on the concrete example from the brief. For a workflow, run the final check on the output and get `status: ok`. Then freeze, because now is the only moment the person who knows what "correct" means is here. Ask one question: "woran erkennst DU, dass dieses Ergebnis stimmt?" Then:

```
run_skill_script skill-creator/golden_records {mode:"freeze", skill:"<name>", artifact:{...the seam object...}, model:"<the model this session runs>", prompt:"<what the user typed>"}
```

It derives the assertions from the artifact rather than letting you invent them, and refuses to code-grade anything with a space in it. Read the derived list back to the user; cut any they do not recognise. Read `references/golden-records.md`. Golden records are opt-in and only for a workflow with a seam; a recipe's records are its op script's return, a knowledge skill's are a human reading two outputs side by side.

## Step 8: Finish

```
run_skill_script skill-creator/quick_validate {name:"<name>", mode:"finish"}
```

`finish` re-checks everything fresh and additionally checks the brief. Then tell the user, in words: "Settings, Vault Operator, Skills, dann **Reload skills** klicken." Opening the tab does nothing; the button is what makes the loader pick up the new skill. `run_skill_script` on the new skill works immediately (it reads from disk), but triggering and `read_skill` need the reload.

There is no packaging step and no install. `init_skill` wrote the folder into the one root the discovery layer scans; that folder IS the skill. To share it, Settings exports a ZIP; the recipient imports it there.

## Composability

Vault Operator HAS `invoke_skill`: a skill can call another as a sub-agent. See `references/composability.md`. When a discovery ends in "several skills", build the first and note that the others can chain.

## Reference index

Load on demand, only what the skill you are building touches:

- `references/dialogue.md`: how you talk, the decision block, `ask_followup_question`. Read at 0a.
- `references/problem-discovery.md`: the four beats and the methods. Read at 0b.
- `references/requirements-dialog.md`: the question ladders and the brief template. Read at 1.
- `references/determinism.md`: the three venues and the seam. Read at 2.
- `references/runtime-capabilities.md`: the tools the agent has. Read at 2.
- `references/sandbox-and-limits.md`: what a script can and cannot do. Read at 2 and when writing scripts.
- `references/obsidian-constraints.md`: where skills live, the materializer, the reload. Read at 2.
- `references/anti-patterns.md`: the Vault Operator bug classes. Read at 5.
- `references/output-patterns.md`, `references/workflows.md`: body structure. Read at 5.
- `references/golden-records.md`: the record format and who runs them. Read at 7.
- `references/composability.md`: chaining skills. Read when a build splits.

## What not to include

A skill folder holds only files the agent reads or runs. Golden records and their fixtures qualify; a `__tests__/` folder for developing the skill does not (it is stripped from the bundle). No README, CHANGELOG, or wrapper files. The body is the documentation.

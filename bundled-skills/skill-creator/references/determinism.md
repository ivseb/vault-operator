# Determinism: what belongs to a tool, a script, and the agent

The decision that most affects how reliable a skill is. A calculation the agent performs can quietly come out differently tomorrow; the same calculation in code is the same every time, and it can be checked without a model. So push into code everything the input already determines, and leave the agent only what genuinely needs judgement. But do not overshoot: a skill that scripts a step whose value was the agent's judgement has traded reliability for uselessness.

Vault Operator has three venues, and the order matters.

## Contents

- The three venues, in order
- Where the two halves meet: the seam
- The counterweight
- Worked examples

## The three venues, in order

Per capability, first answer wins.

**1. Does Vault Operator already have a tool for it?** This is the first question and the most commonly missed, because the source skill you may be porting wrote a script precisely because ITS platform had no such tool. Vault Operator has many:

- Reading structured input: `read_document` parses PDF, DOCX, XLSX, PPTX, CSV, XML and JSON natively, no package. `read_file` for text and markdown.
- Writing Office output: `create_pptx`, `create_docx`, `create_xlsx` (with cell formulas).
- Finding things: `search_files` (regex), `semantic_search` (a full pipeline; synthesize from its excerpts, do not re-read every hit), `search_by_tag`, `find_notes_by_type`.
- The vault graph: `get_frontmatter`, `update_frontmatter`, `get_linked_notes`.
- The web: `web_fetch` returns a page as markdown; `web_search`.

If a tool does it, use the tool. Do not write a script that reimplements a parser Vault Operator ships.

**2. Is the output fully determined by the input, and computable in plain JS?** Arithmetic, sorting, matching, a fixed sequence of vault reads and writes. Then a sandbox **script** (`scripts/*.js`, run via `run_skill_script`). Give it few parameters. This is where a calculation earns its keep: an agent doing arithmetic is a number that can drift; a script doing it is the same result every time.

But remember what a script is: one self-contained file, `export async function execute(args, ctx)`, with `ctx.vault` and `ctx.requestUrl` and nothing else. No tool, no network, no npm import. If the step needs any of those, it is not a script, it is the agent (venue 3), or a tool (venue 1).

**3. Everything else is the agent.** Unstructured reading, judgement about quality or tone, prose, or anything that needs a tool. No script replaces this, and pretending otherwise produces a script that dies on first use.

## Where the two halves meet: the seam

A workflow mixes judgement and computation, so it needs a place where the judgement is written down before the computation runs: the seam. It is what a script can check and what a golden record can assert on, and without it the skill cannot be verified after a model change.

In Vault Operator the best seam is a **note with frontmatter**, not a hidden JSON file. The agent writes the note; the user can see it and correct it; it lives in the graph; and `get_frontmatter` reads it back. The final check and the golden records both work against it.

If there is no seam (the output is prose), that is allowed, but as a decision. Set `seam_waived_because` and tell the user: "Dieser Skill hat keinen prüfbaren Zwischenstand. Prüfen lässt sich später nur, dass die Notiz existiert und die geforderten Abschnitte hat."

## The counterweight

"As deterministic as possible" is wrong as a slogan. Calibrate each step. A step whose value is that the user SEES it happen belongs to the agent even if a script could do it, and "the user needs to see the change" is a legitimate entry in the Why column next to the technical reasons.

## Worked examples

**Rename notes by date.** One tool-or-script step: the agent lists files, a script computes the new names and calls `ctx.vault.write`. Recipe. No seam.

**Offers against a price list.** Read the PDFs: `read_document` (venue 1). Extract the line items: agent judgement, written into a seam note. Compare against the price list and compute deltas: script (venue 2), arithmetic. Check nothing is missing: script. Write the summary: agent, prose. The seam note is where the two halves meet.

**Apply the brand guideline to a text.** All agent. No deterministic half, no seam, nothing to compute. Knowledge skill.

Write the venue down per capability, in the user's language, and carry it into the brief. An empty Why means the decision was assumed, and an assumed decision is the one that turns out wrong.

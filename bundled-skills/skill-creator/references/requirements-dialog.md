# Requirements dialog and skill brief

The part of skill creation the user cannot do alone. By the time you are here the outcome is agreed, either because the user stated it or because discovery worked it out with them; what is missing is the shape a skill needs. This file holds the question ladders per skill shape and the brief template that ends the dialog.

If discovery ran, you already have the as-is walkthrough, the intent, the baseline number and the first success criterion. Do not ask for any of them again. Name what you have, then ask only for the gaps.

## Contents

- Principles for the dialog
- Ladder A: recipe skill
- Ladder B: workflow skill
- Ladder C: knowledge skill
- The skill brief template
- Outcome, not mechanism
- Turning the brief into a build plan

## Principles for the dialog

- **One question per turn, and at most one DECISION per turn.** Never make the user settle the shape and the trigger mode and the output format in the same breath: a person weighs one trade-off at a time, and three at once produces three careless answers. When two decisions are pending, ask the one the other depends on and let the answer narrow the second.
- **Open when you are still learning, a decision block when a decision is due.** An open question at a fork hands the work back to the user; a menu offered too early anchors them on your first guess. The block and its two renderings (the `AskUserQuestion` tool when the session has one, a numbered list otherwise) are specified in `SKILL.md` under "The decision block".
- **Every option carries a Dagegen.** An option without a downside is a lie, and the user finds the downside later, without you. This is also the fastest way to make a recommendation credible.
- **The user's own answer is always on the list.** Never as a footnote, always as a visible option they can pick. Your options are proposals from someone who has known their world for ten minutes; theirs comes from someone who has lived in it for years, and it is the branch that tells you what you missed. When an `AskUserQuestion` tool renders the choice, it appends the free-text escape itself; in a text rendering you write it out.
- **Reflect back.** After two or three answers, say the skill in one sentence and let the user correct it. Cheap course-correction beats a wrong brief.
- **Stop when the job is bounded.** You are done interviewing when you can write the brief without hand-waving, not when you have asked every possible question.
- Do not choose the mechanism during the interview. The shape of the solution was settled before the interview and the interview bounds it; the feasibility step decides how it runs. When the user names a mechanism ("mit einem Makro"), write down the outcome it is meant to produce and let feasibility pick the mechanism.
- Ask in the user's language. German-speaking users often phrase requests in German; mirror that.

## Ladder A: recipe skill

One clear operation, fixed sequence. Keep it to one or two questions.

1. Trigger and operation: "What should the user say to start this, and what is the single thing it does?"
2. Boundaries and end state: "What does the finished result look like, and is there anything it should leave untouched?"

That is usually enough. Go to the brief.

## Ladder B: workflow skill

Multi-step, data flows between steps, produces files, may branch. This is where a missed requirement or a runtime limit costs the most, so cover these adaptively (skip what the user already made obvious):

1. Trigger and intent: what fires the skill, and what the user is actually trying to achieve (the outcome, not the steps).
2. Inputs (as-is): what the skill reads. Which files, which formats, where they are.
3. Outputs (to-be): what exists after a successful run. New files, edited files, a deck, a report, a spreadsheet.
4. Data flow: how each step feeds the next. Where the source is, what the intermediate shape is, where the output lands. This is where feasibility surprises hide (a missing library, a network call, a here-doc).
5. Success criteria: how the user judges a run correct. Be concrete ("every slide uses a corporate master layout and the deck opens without repair"), not "a good deck".
6. Exclusions: what the skill must NOT do. Which files never to touch, what to leave for the user.
7. Failure handling: what should happen when a step cannot complete (missing input, an optional tool absent, an empty result).

## Ladder C: knowledge skill

No script orchestration. The skill is expertise the agent applies. Pin down:

1. Domain and trigger: what area of judgement, and when the agent should reach for it.
2. Decision rules: the actual heuristics, with examples. These are the whole value of the skill.
3. Output format: what the agent produces when it applies the skill.
4. Boundaries: where the rules stop applying, so the agent does not overreach.

## The skill brief template

Present this in the chat at step 3, in the user's language. Keep it in the user's terms, not in code. Then ask them to confirm or change it.

Render only what you actually have. An empty field is left out, never filled in to look complete. A brief that grows into a form gets nodded through, and a nodded-through brief is worth nothing.

```
## Skill brief: {skill-name}

**Problem (today):** {the as-is process, with the number: how often, how long}
**How might we:** {the one question, if discovery ran}
**Who else:** {who does the same thing, if it matters for hard-wiring paths}
**Worth it:** {baseline today} -> {target}
**Abort signal:** {what would make the user stop using it}

**Description (the trigger):** {one line, with the phrases that should activate it}
**Shape:** recipe | workflow | knowledge
**Intent:** {what the user achieves by running it}
**Triggered by:** the user asks for it | a routine, {when}

**Inputs (reads):** {what must exist beforehand}
**Outputs (produces):** {what exists after a good run}

**Success criteria**
| # | The run is correct when | Checked by |
|---|---|---|
| 1 | {concrete, checkable statement} | dry-run, step 7 |
| 2 | {concrete, checkable statement} | real use, step 8 |

**Exclusions (must not do)**
- {boundary}. Reason: {why, in one clause}

**How each step runs**
| Step | Who | Why |
|---|---|---|
| {step} | agent | {unstructured, judgement, prose, or an agent tool} |
| {step} | script | {determined by the input, or a check on an artifact} |
| {step} | NOT possible in the sandbox | closest alternative: {...} |

**Planned resources:**
- scripts/: {list or none}
- references/: {list or none}
- assets/: {list or none}

**Example run:**
Trigger: "{what the user types}"
Result: {what the skill produces, step by step, ending in the outputs}
```

If any step is "NOT possible", say so before the user confirms. It is far better to redesign the brief now than to ship a skill that cannot do what its description promises.

## Outcome, not mechanism

A success criterion names a result the user can observe. It does not name how the result is produced, because that is the feasibility question and it is answered in the "How each step runs" table. Keeping the two apart is what lets you change the mechanism later without touching what "correct" means.

| The user says | The success criterion is | The mechanism goes to |
|---|---|---|
| "mit einem Python-Skript die Summen prüfen" | "jede Summe in der Excel stimmt mit den Einzelposten überein" | script (arithmetic) |
| "das Ganze als Makro" | "der Bericht liegt fertig im Workspace, ohne Handarbeit" | the step table |
| "per Regex die Nummern rausziehen" | "jede Artikelnummer steht mit ihrer Quelle in der Tabelle" | script (matching) |

The mechanism word is not deleted, it is moved. It was the user telling you something real about how they think the job gets done, and the feasibility step is where that belongs.

## Turning the brief into a build plan

Once confirmed, the brief maps directly onto the build:

- The description line becomes the frontmatter `description`, tightened for triggering.
- Each success criterion becomes something the dry-run at step 7 checks.
- Each feasibility entry decides whether a step is an agent action in the body or a script in `scripts/`.
- The example run becomes the known-good run captured at step 7.

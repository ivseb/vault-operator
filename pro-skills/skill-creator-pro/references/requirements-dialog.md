# Requirements dialog and skill brief

The part of skill creation that the user cannot do alone. They know the outcome they want, not the shape a skill needs. This file holds the question ladders per skill shape and the brief template that ends the dialog.

## Contents

- Principles for the dialog
- Ladder A: recipe skill
- Ladder B: workflow skill
- Ladder C: knowledge skill
- The skill brief template
- Turning the brief into a build plan

## Principles for the dialog

- One question per turn. Use `ask_followup_question` (Vault Operator) or AskUserQuestion (Claude Code) with two to four concrete options. Bundling questions forces the user to hold a model in their head and gives worse answers.
- Lead with a recommendation when you have one, and label it. Put the trade-off in each option so the choice is informed, not a guess.
- Reflect back. After two or three answers, say the skill in one sentence and let the user correct it. Cheap course-correction beats a wrong brief.
- Stop when the job is bounded. You are done interviewing when you can write the brief without hand-waving, not when you have asked every possible question.
- Do not design the solution during the interview. Capture what the user wants; the feasibility step decides how it runs.

## Ladder A: recipe skill

One clear operation, fixed sequence. Keep it to one or two questions.

1. Trigger and operation: "What should the user say to start this, and what is the single thing it does?"
2. Boundaries and end state: "What does the finished result look like, and is there anything it should leave untouched?"

That is usually enough. Go to the brief.

## Ladder B: workflow skill

Multi-step, data flows between steps, writes to the vault, may branch. This is where a missed requirement or a runtime limit costs the most, so cover these adaptively (skip what the user already made obvious):

1. Trigger and intent: what fires the skill, and what is the user actually trying to achieve (the outcome, not the steps).
2. As-is: what already exists in the vault that the skill reads. Which notes, which folders, which frontmatter, which format.
3. To-be: what exists after a successful run. New notes, edited notes, anchors, frontmatter, a dashboard, an exported file.
4. Data flow: how each step feeds the next. Where the source is, what the intermediate shape is, where the output lands. This is where feasibility surprises hide.
5. Success criteria: how the user judges a run correct. Be concrete ("every action item becomes a task with an owner and a date"), not "a good summary".
6. Exclusions: what the skill must NOT do. Which folders never to touch, which content never to overwrite, what to leave for the user.
7. Failure handling: what should happen when a step cannot complete (missing source, ambiguous match, empty result).

## Ladder C: knowledge skill

No tool orchestration. The skill is expertise the agent applies. Pin down:

1. Domain and trigger: what area of judgement, and when the agent should reach for it.
2. Decision rules: the actual heuristics. "If the data is a time series, use a line chart; if it is parts of a whole, use a stacked bar." Draw these out with examples, because they are the whole value of the skill.
3. Output format: what the agent produces when it applies the skill (a rewritten passage, a chosen layout, a structured recommendation).
4. Boundaries: where the rules stop applying, so the agent does not overreach.

## The skill brief template

Emit this in the chat at step 3. Keep it in the user's terms, not in code. Then ask them to confirm or change it.

```
## Skill brief: {skill-name}

**Description (the trigger):** {one line, third person, with the phrases that should activate it}

**Shape:** recipe | workflow | knowledge

**Intent:** {what the user achieves by running it}

**As-is (reads):** {what must exist in the vault beforehand}
**To-be (produces):** {what exists after a good run}

**Success criteria:**
- {concrete, checkable statement}
- {concrete, checkable statement}

**Exclusions (must not do):**
- {boundary}

**Feasibility per capability:**
- {capability} -> built-in tool `{tool_name}`
- {capability} -> sandbox script `scripts/{name}.js` (probed OK)
- {capability} -> NOT possible in Vault Operator; closest alternative: {...}

**Planned resources:**
- scripts/: {list or none}
- references/: {list or none}
- assets/: {list or none}

**Example run:**
Trigger: "{what the user types}"
Result: {what the skill produces, step by step, ending in the to-be state}
```

If any capability in the feasibility block is "NOT possible", say so before the user confirms. It is far better to redesign the brief now than to ship a skill that cannot do what its description promises.

## Turning the brief into a build plan

Once confirmed, the brief maps directly onto the build:

- The description line becomes the frontmatter `description`, tightened for triggering (see the pushy-description guidance in the main body).
- Each success criterion becomes something the dry-run at step 7 checks.
- Each feasibility entry decides whether a step is a tool call in the body or a script in `scripts/`.
- The example run becomes the known-good run captured at step 8.

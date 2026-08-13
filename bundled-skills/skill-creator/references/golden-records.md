# Golden records

The question they answer: after the user swaps the model behind Vault Operator, does this skill still work? Nobody notices the answer is no until a deliverable goes out wrong. A golden record is one run, frozen: what the user asked, what the skill produced, and what about the output made it right.

This matters more in Vault Operator than in a single-model product, because the user picks and changes the model themselves, across seven providers, on any Tuesday. And it comes with an honest limit: **nothing here runs the records for you.** There is no hook on the model switch and no scheduler. The freeze happens in the one moment someone is present who knows what "correct" means; the grading is a thing a person does, deliberately, after changing the model.

## Contents

- What is asserted, and what cannot be
- The format
- Freezing with the user
- Grading after a model change
- Which shapes get records

## What is asserted, and what cannot be

Assertions target the seam artifact: the note or object the agent writes before the scripts run. Numbers, counts, ids, enums, structure. Those are exact, and an exact comparison is arithmetic, which does not drift when the model does.

Prose cannot be asserted this way. A correct answer in different words is still correct, so a string comparison over a sentence tests the model's phrasing, not its judgement. Free text becomes a **rubric** assertion, recorded and reported and never blocking. This is why determinism pays for itself: the deterministic half of a skill is the half that can be checked without a model.

Six ops: `equals`, `count`, `same` (a multiset unless the record sets `ordered`), `absent`, `file_exists`, `has_keys`. No `schema_valid`: a skill script cannot import a schema library.

## The format

```
{skills_root}/{skill}/references/{skill}-golden-records.json
{skills_root}/{skill}/references/{skill}-expected/gr-1.json    the frozen artifact
```

```json
{
  "records_version": 1,
  "engine": "skill-creator",
  "skill": "angebots-check",
  "seam": "plan.json",
  "baseline_model": "claude-sonnet-5",
  "records": [{
    "id": "gr-1",
    "prompt": "Prüfe das Angebot gegen die Preisliste.",
    "expected": "references/angebots-check-expected/gr-1.json",
    "assertions": [
      {"check": "code", "op": "has_keys", "value": ["positionen", "summe_eur"]},
      {"check": "code", "op": "count",  "path": "positionen[*]", "value": 3},
      {"check": "code", "op": "equals", "path": "summe_eur", "value": 12400},
      {"check": "code", "op": "same",   "path": "positionen[*].artikelnummer"},
      {"check": "rubric", "text": "Die fehlende Bauzeit steht als offener Punkt, nicht als Fehler."}
    ]
  }]
}
```

`"engine": "skill-creator"` matters: grading needs this skill's `golden_records.js`. If someone imports a shared skill without skill-creator installed, the field tells them why grading fails. `baseline_model` is mandatory; a baseline that does not say which model produced it cannot be compared later.

## Freezing with the user

Do not let the agent invent assertions. An invented one is either trivially true or subtly wrong, and a file of those reports green while the skill rots. `golden_records.js freeze` derives them from the artifact the dry-run actually produced: numbers, booleans, enums and array lengths become code assertions; timestamps, uuids and paths are dropped; anything with a space becomes a rubric candidate, because a value with a space is a sentence.

Ask the user exactly one question, right after the dry-run: "woran erkennst DU, dass dieses Ergebnis stimmt?" Then read the derived assertions back in their language and let them cut or add. An assertion the user does not recognise is one they will not trust when it goes red.

## Grading after a model change

The user swaps the model in Vault Operator's settings, then runs the skill on the frozen prompts, then:

```
run_skill_script skill-creator/golden_records {mode:"grade", skill:"<name>", model:"<the new model>", run:{gr-1:{...the produced seam object...}}}
```

Three outcomes, not two. A record that produced no artifact did not disagree, it failed to happen (a timeout, a cancelled turn): that is INCONCLUSIVE, never FAIL, and it blocks the verdict rather than guessing it. A suite that cries wolf once is never read again.

Every skill with records carries a `## Regression check` section in its own SKILL.md with the literal call to copy, and a first line that grading needs skill-creator.

## Which shapes get records

Only a **workflow with a seam**, and opt-in, offered once after a good dry-run. A recipe's check is its op script's return value (`{ok:false}` is a failure); it needs no engine. A knowledge skill has no deterministic half, so its "records" are a human reading the old and the new output side by side, which is a `## Known-good run` note, not JSON pretending to be a suite.

If in six months no one has ever graded a skill, delete the records rather than defend them. A suite nobody runs is the manufactured confidence this method exists to prevent.

---
name: office-workflow
description: Professional workflow for creating Office documents (PPTX, DOCX, XLSX) with structured process, design principles, and quality standards
trigger: pr[aä]sentation.*erstell|erstell.*pr[aä]sentation|presentation.*creat|creat.*presentation|folie.*erstell|erstell.*folie|deck.*erstell|powerpoint|pptx|dokument.*erstell|erstell.*dokument|document.*creat|docx|word.*erstell|spreadsheet|tabelle.*erstell|xlsx|excel
source: bundled

---

# Office Document Workflow

Follow these 6 steps IN ORDER for presentations. Do NOT skip steps.

## Step 1: CONTEXT (ASK and STOP)

Ask the user:
- **Goal**: What should the audience learn, decide, or do?
- **Audience**: Who? What do they know?
- **Deck mode**: Speaker [S] (max 25 words/slide) or Reading [R] (max 170 words/slide)?
- **Material**: Which note or document contains the source content?

STOP. Wait for answer.

## Step 2: TEMPLATE

Ask: "Welches Design? **Executive** (dunkel), **Modern** (hell), **Minimal** (SW). Oder eigene Corporate-Vorlage?"

- Default theme -> adhoc mode (HTML slides), skip to Step 3
- Corporate .pptx -> check if theme exists:
  - Theme exists: continue to Step 3
  - Theme missing: run ingest_template (derive theme_name from filename, recommend render_previews: true)

## Step 3: PLAN (THE KEY STEP)

**For corporate templates: ALWAYS call plan_presentation.**

```
plan_presentation(
  source: "path/to/source-note.md",
  template: "acme",
  deck_mode: "reading",
  goal: "from Step 1",
  audience: "from Step 1"
)
```

The tool reads the source material, loads the template catalog, and generates a complete deck plan
with content for EVERY shape on EVERY slide via an internal LLM call.

Show the resulting plan table to the user. Wait for feedback.
On change requests: describe the adjustments and call plan_presentation again.

**For default themes (adhoc mode):** Plan the slides yourself using the presentation-design skill.

## Step 4: GENERATE

**Corporate template:** Copy the JSON block from the plan_presentation output directly into create_pptx.
Do NOT modify the plan's content or choose different shapes -- the plan was generated and validated.

```
create_pptx(
  output_path: "presentations/output.pptx",
  template: "acme",
  slides: [... from plan ...]
)
```

**Adhoc mode:** Write HTML slides on 1280x720 canvas with data-object elements.

## Step 5: DELIVER

Present the result. Offer DOCX handout for reading decks. Ask if adjustments needed.

## Anti-Patterns (NEVER)

- Skipping plan_presentation and calling create_pptx directly with corporate templates
- Modifying the plan's JSON before passing to create_pptx
- Using adhoc HTML mode when a corporate template was requested
- Leaving placeholder text ("Your slide title", "42%") from examples
- Same slide type twice in a row

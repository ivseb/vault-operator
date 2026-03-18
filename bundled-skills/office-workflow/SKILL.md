---
name: office-workflow
description: Professional workflow for creating Office documents (PPTX, DOCX, XLSX) with structured process, design principles, and quality standards
trigger: pr[aä]sentation.*erstell|erstell.*pr[aä]sentation|presentation.*creat|creat.*presentation|folie.*erstell|erstell.*folie|deck.*erstell|powerpoint|pptx|dokument.*erstell|erstell.*dokument|document.*creat|docx|word.*erstell|spreadsheet|tabelle.*erstell|xlsx|excel
source: bundled
requiredTools: [create_pptx, create_docx, create_xlsx, analyze_pptx_template, get_composition_details, render_presentation, check_presentation_quality]
---

# Office Document Workflow

Follow these 6 steps IN ORDER. Do NOT skip any step.

## Step 1: CONTEXT (mandatory -- ASK and STOP)

Ask the user:
- **Goal**: What should the audience learn, decide, or do?
- **Audience**: Who? What do they know?
- **Deck mode** (presentations): Speaker [S] (max 25 words/slide) or Reading [R] (max 170 words/slide)?
- **Time** (speaker decks): Minutes? (~1 slide/min)
- **Material**: Existing data, documents, notes?

STOP. Wait for answer before continuing.

## Step 2: TEMPLATE (mandatory -- ASK and STOP)

Ask: "Welches Design? **Executive** (dunkel), **Modern** (hell, Blau/Orange), **Minimal** (Schwarz/Weiss). Eigene Corporate-Vorlage? Lade die .pptx in den Vault."

STOP. Wait for answer.

- "Executive" / "Modern" / "Minimal" -> template=lowercase, go to Step 4
- Corporate .pptx mentioned -> go to Step 3
- Multiple files (Style Guide, Icons, How-to-Use) -> collect ALL file paths, go to Step 3

## Step 3: TEMPLATE SKILL (corporate .pptx only)

```
Matching template skill in <available_skills>?
YES -> use it, go to Step 4
NO  -> call analyze_pptx_template(template_path, additional_files)
        Pass ALL corporate design files:
        - Main template as template_path
        - Style Guide, Icon Gallery, How-to-Use as additional_files
          (role auto-detected, or specify explicitly)
        This generates SKILL.md + compositions.json automatically.
        NEVER use manage_skill to create template skills manually.
        STOP. Wait for analysis to complete.
```

If multimodal analysis is deactivated: ask user to enable Visual Intelligence via update_settings, then re-run analyze_pptx_template.

If analysis fails: report the error. Do NOT work around it.

### Using the Template Skill

Before creating slides: call `get_composition_details` for each composition you plan to use.
Check `recommended_pipeline` per composition to decide clone vs html mode.

Corporate rules (clone mode):
- Use `template_file` + `template_slide` + `content`
- Content keys = shape names/aliases from get_composition_details
- Respect max_chars and font_size_pt limits

Corporate rules (html mode with scaffolding):
- Use `template_file` + `html` + `composition_id`
- Design HTML within `content_area` bounds using `style_guide` colors/fonts
- Scaffold (header, footer, logo, deko) is auto-injected per composition
- Optional: Use `html_skeleton` from get_composition_details as starting point

## Step 4: PLAN (mandatory -- share and STOP)

Share structure table for approval:
- Corporate: # | Composition | Pipeline (clone/html) | Content Summary | Why
- Default: # | Visual Pattern | Content Type | Narrative Function

Planning rules:
- Storytelling Framework from presentation-design skill FIRST
- Max 30% text slides [S], 50% [R]. Rest = structured visual layouts
- Never same slide type consecutively (Two-Slide-Buffer)
- Decision Tree: numbers->KPI/chart, sequence->process, comparison->matrix
- Design Reasoning per slide: "3 steps -> chevrons. Emotion: clarity/momentum"

STOP. Wait for approval.

## Step 5: CREATE

### Content Rules (corporate templates)
1. **Fill EVERY shape** -- unfilled shapes appear blank
2. **Transform content** -- bullets max 8 words [S], full sentences [R]. Never copy verbatim
3. **Match composition to content** -- classify first, then find layout
4. **Never invent data** -- all numbers from source material
5. **Reload get_composition_details** when switching template slides
6. **Customize footer_text** -- never leave template defaults
7. **Image placeholders** -- ask user for images OR use text-only composition
8. **Color accents** -- place most important content at accent position

### Pipeline Selection

**Default: HTML mode** with per-composition scaffolding for content slides.

| Slide Type | Mode | Why |
|---|---|---|
| Title, section divider, closing | template_slide + content | Exact branding, <=2 shapes |
| All content slides (KPI, process, comparison, chart) | html + composition_id | Scaffold auto-injected, creative freedom |
| Content fitting template shapes exactly | template_slide + content | Pixel-perfect fallback |
| Default themes (no template) | html | Full control |

Per-composition scaffolding:
- Call `get_composition_details` -> read `content_area`, `style_guide`, `layout_hint`
- Design HTML within `content_area` bounds, use `style_guide` colors/fonts
- Scaffold (header, footer, logo, deko) auto-injected per composition
- Pick icons from Available Icons catalog (if available) instead of inheriting fixed ones
- Optional: Use `html_skeleton` as starting point

Deko elements (logo, accent bars) are auto-injected -- do NOT place manually.

### Pre-Flight
Run Section O self-check from presentation-design skill before calling create_pptx.

## Step 6: QUALITY CHECK

If Visual Intelligence enabled: call check_presentation_quality.
- "pass" -> inform user
- "needs_revision" -> fix, recreate, recheck (max 2 rounds)
- Fallback: call render_presentation for manual inspection

## Anti-Patterns (NEVER)

- Title-only slides / wall of text (>5 bullets [S], >170 words [R])
- Same visual pattern consecutively
- Unfilled shapes / copy-pasted source text / hallucinated data
- Template placeholder images without asking / default footers unchanged
- Using manage_skill for template skills (always use analyze_pptx_template)

## After Creation

Offer DOCX handout (for presentations). Ask if adjustments needed.

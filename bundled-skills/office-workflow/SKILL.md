---
name: office-workflow
description: Professional workflow for creating Office documents (PPTX, DOCX, XLSX) with structured process, design principles, and quality standards
trigger: pr[aä]sentation.*erstell|erstell.*pr[aä]sentation|presentation.*creat|creat.*presentation|folie.*erstell|erstell.*folie|deck.*erstell|powerpoint|pptx|dokument.*erstell|erstell.*dokument|document.*creat|docx|word.*erstell|spreadsheet|tabelle.*erstell|xlsx|excel
source: bundled
requiredTools: [create_pptx, create_docx, create_xlsx]
---

# Office Document Workflow

Apply this workflow whenever creating professional Office documents (PPTX, DOCX, XLSX).

## 1. Mandatory Workflow

Follow these steps IN ORDER for every document creation:

### Step 1: CONTEXT
Ask about:
- **Goal**: What should the audience learn, decide, or do?
- **Audience**: Who are they? What do they already know?
- **Setting** (presentations): Live presentation (speaker-led, max 25 words/slide) or read deck (self-explanatory, max 170 words/slide)?
- **Time budget** (presentations): How many minutes? (~1 slide per minute for live)
- **Material**: Does the user have data, documents, or notes to incorporate?

### Step 2: TEMPLATE
Ask about template/theme. Send a regular text message (NOT ask_followup_question) and STOP your turn.

For presentations:
"Bevor ich die Praesentation erstelle: Welches Design soll ich verwenden? **Executive** (dunkel, serioes), **Modern** (hell, Blau/Orange), **Minimal** (Schwarz/Weiss). Falls du eine eigene Corporate-Vorlage nutzen moechtest, lade die .pptx-Datei in den Vault -- ich analysiere sie und erstelle einen Design-Skill daraus."

NEVER skip this question. NEVER assume a template from memory.

User responds: "Executive"/"Modern"/"Minimal" -> lowercase as template parameter. Corporate template -> proceed to ANALYZE step.

### Step 3: ANALYZE (Corporate Templates only)

If the user provides a corporate PPTX template:

1. **Check for existing Template Skill**: Look for a matching user skill (e.g. `skills/acme-template/SKILL.md`). If found, skip analysis -- load the skill directly.

2. **First-time analysis**: If no Template Skill exists, run `analyze_pptx_template` with `generate_skill: true`:
   - This extracts the Element Catalog, Brand-DNA, and Slide Compositions
   - Generates a Template Skill (SKILL.md) saved as a user skill
   - Takes ~30-60 seconds for large templates (100+ slides)

3. **Use the Template Skill**: Once available, the Template Skill provides:
   - **Brand-DNA**: Colors, fonts, spacing for brand consistency
   - **Element Catalog**: All unique design elements (chevrons, KPI cards, pyramids etc.)
   - **Slide Compositions**: Which slides use which elements, with Shape-Name mappings
   - **Shape-Names as content keys**: Use `"TextBox 5": "new content"` instead of text-based keys

**Corporate template mode rules:**
- Use `template_file` + `template_slide` + `content` instead of `html`. NEVER use the `html` field.
- The Template Skill provides the slide catalog with ALL available slide types.
- Apply the Content Classification Framework from the presentation-design skill (Part A) to match content types to template slide compositions.
- Use the RICH slide types from the template (KPIs, process flows, SWOT, pyramids, org charts, etc.). NEVER build an entire deck from only text slides.
- Content keys in the `content` object must use **Shape-Names** from the Template Skill (e.g. `"Title 1"`, `"TextBox 5"`).

Draft the document structure and share with user for approval:
- Presentations (corporate template): Use the Content Classification Framework (presentation-design skill Part A) to classify each content block. Then map to matching slide compositions from the Template Skill. Present a table with # | Template Slide # | Slide Type | Action Title | Content Summary | Why This Type
- Presentations (default themes): Table with # | Visual Pattern | Action Title | Content Type | Narrative Function
- Documents: Outline with headings and section descriptions
- Spreadsheets: Column definitions and data structure

**Corporate template planning rules:**
- Max 30% of content slides may be plain text. The rest MUST use structured visual layouts.
- Never use the same slide type on consecutive slides.
- Apply the Visualization Decision Tree: numbers -> KPI/chart, sequence -> process, comparison -> matrix/two-column.
- The plan MUST show the template slide number for every slide.

### Step 5: CREATE
- **Corporate template:** Call create_pptx with `template_file` and slides using `template_slide` + `content` fields. Use Shape-Names from the Template Skill as content keys.
- **Default themes:** Call create_pptx with slides using the `html` field (see presentation-design skill Part B for HTML format and patterns).

## 2. Content Principles

### Action Titles (presentations)
Every title is a CONCLUSION, not a topic.
- BAD: "Marktueberblick" / "Financial Results"
- GOOD: "Marktanteil verdoppelt sich in Q3" / "Revenue grew 34% year-over-year"

### Content Density
- One message per slide: If you need >5 bullets, split into 2 slides
- Max 75 words per slide (excluding speaker notes)
- Visual hierarchy: chart/kpi > table > bullets > body text -- always choose the MOST VISUAL format

### Speaker Notes (presentations)
- On EVERY slide (2-3 sentences talking points)
- Interpret data: "This means..." / "The implication is..."

### Design Assets
If MCP icon/image tools are available, use them for visual enhancement.

## 3. Layout Strategy (presentations)

- NEVER use the same visual pattern on consecutive slides -- vary the visual rhythm
- Title slide: Opener + Closer only
- Section dividers between major topics (3-5 slides per section)
- Use different layout patterns: title, content+bullets, KPI grid, process flow, chart, table, two-column, section divider
- Alternate dark-bg and light-bg slides for contrast

## 4. Storytelling Framework

Choose a Storytelling Framework from the presentation-design skill (Part A: "Storytelling Frameworks"). The framework determines the slide sequence and narrative arc -- apply it BEFORE selecting individual slide types.

## 5. Anti-Patterns (NEVER do these)

- Title-only slides (every slide needs body/bullets/table/chart/kpis)
- Wall of text (>5 bullets or >75 words per slide)
- Generic titles ("Ueberblick", "Naechste Schritte", "Zusammenfassung" without assertion)
- Same visual pattern repeated on consecutive slides
- Charts without interpretation in speaker notes
- Skipping the template/theme question

## 6. After Creation

- Offer matching DOCX handout (for presentations)
- Offer to save template preference in memory
- Ask if adjustments are needed before finalizing

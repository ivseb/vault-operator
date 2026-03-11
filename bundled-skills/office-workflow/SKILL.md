---
name: office-workflow
description: Professional workflow for creating Office documents (PPTX, DOCX, XLSX) with structured process, design principles, and quality standards
trigger: praesentation.*erstell|presentation.*creat|folie.*erstell|deck.*erstell|powerpoint|pptx|dokument.*erstell|document.*creat|docx|word.*erstell|spreadsheet|tabelle.*erstell|xlsx|excel
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
"Bevor ich die Praesentation erstelle: Welches Design soll ich verwenden? **Executive** (dunkel, serioes), **Modern** (hell, Blau/Orange), **Minimal** (Schwarz/Weiss). Falls du eine Corporate-Vorlage nutzen moechtest (z.B. Acme), nenne den Namen -- ich verwende dann den passenden Design-Skill."

NEVER skip this question. NEVER assume a template from memory.

User responds: "Executive"/"Modern"/"Minimal" -> lowercase as template parameter. Corporate name (e.g. "Acme") -> the matching corporate presentation skill provides all design tokens.

### Step 3: PLAN
Draft the document structure and share with user for approval:
- Presentations: Table with # | Visual Pattern | Action Title | Content Type | Narrative Function
  - Plan the HTML layout mentally: which patterns (title, content, KPI grid, process, chart, etc.)
- Documents: Outline with headings and section descriptions
- Spreadsheets: Column definitions and data structure

### Step 5: CREATE
Call the creation tool with full content data. Use the `html` field per slide for full layout control (see presentation-design skill for HTML format and patterns).

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

## 4. Storytelling Framework (choose based on context)

- **Strategy/Decision**: Situation -> Complication -> Resolution
- **Pitch/Proposal**: Problem -> Solution -> Evidence -> CTA
- **Status/Report**: What happened -> Why it matters -> What's next
- **Data/Analysis**: Key Finding -> Evidence -> Implications

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

---
name: office-workflow
description: Professional workflow for creating Office documents (PPTX, DOCX, XLSX) with structured process, design principles, and quality standards
trigger: pr[aä]sentation.*erstell|erstell.*pr[aä]sentation|presentation.*creat|creat.*presentation|folie.*erstell|erstell.*folie|deck.*erstell|powerpoint|pptx|dokument.*erstell|erstell.*dokument|document.*creat|docx|word.*erstell|spreadsheet|tabelle.*erstell|xlsx|excel
source: bundled
requiredTools: [create_pptx, create_docx, create_xlsx, analyze_pptx_template, get_composition_details, render_presentation, check_presentation_quality]
---

# Office Document Workflow

Apply this workflow whenever creating professional Office documents (PPTX, DOCX, XLSX).

## 1. Mandatory Workflow

Follow these steps IN ORDER for every document creation:

### Step 1: CONTEXT
Ask about:
- **Goal**: What should the audience learn, decide, or do?
- **Audience**: Who are they? What do they already know?
- **Deck Mode** (presentations): Speaker deck (live, max 25 words/slide) or reading deck (self-explanatory, max 170 words/slide)?
- **Time budget** (speaker decks): How many minutes? (~1 slide per minute)
- **Material**: Does the user have data, documents, or notes to incorporate?

Carry the deck mode (Speaker [S] / Reading [R]) into ALL subsequent design decisions. Apply [S] or [R] rules from presentation-design skill accordingly.

### Step 2: TEMPLATE
Ask about template/theme. Send a regular text message (NOT ask_followup_question) and STOP your turn.

For presentations:
"Bevor ich die Praesentation erstelle: Welches Design soll ich verwenden? **Executive** (dunkel, serioes), **Modern** (hell, Blau/Orange), **Minimal** (Schwarz/Weiss). Falls du eine eigene Corporate-Vorlage nutzen moechtest, lade die .pptx-Datei in den Vault -- ich analysiere sie und erstelle einen Design-Skill daraus."

NEVER skip this question. NEVER assume a template from memory.

User responds: "Executive"/"Modern"/"Minimal" -> lowercase as template parameter, proceed to Step 4.
User mentions a corporate .pptx template -> proceed to Step 3.

### Step 3: TEMPLATE SKILL (Corporate Templates only)

#### A. Check for existing Template Skill
Look in `<available_skills>` for a matching template skill. If found, skip to "C. Use the Template Skill".

#### B. Guide the user through template analysis

**B1. Locate the template**
If the user already mentioned a .pptx path, use it. Otherwise ask:
"Wo liegt die .pptx-Datei im Vault? (z.B. `Templates/MeineVorlage.pptx`)"
STOP and wait.

**B2. Run structural + multimodal analysis**
Call `analyze_pptx_template` with the template path. The tool automatically extracts Brand-DNA, compositions, shape mappings, runs multimodal analysis if enabled, and generates SKILL.md + compositions.json.

**If multimodal analysis is deactivated**, ask the user to enable Visual Intelligence. If they agree, use `update_settings` to enable it, then re-run `analyze_pptx_template`.

**B3. Visual analysis fallback**
Only if multimodal analysis could not run. Use `render_presentation` to render slides, visually inspect them, then enrich `compositions.json` via `edit_file` with semantic meanings and constraints.

If Visual Intelligence is NOT available, offer LibreOffice installation or PDF export as alternatives.

**B4. Failure Recovery**
If ANY analysis step fails: report the exact error to the user. NEVER manually create SKILL.md files for templates. NEVER work around a failed tool by recreating its output. Always use `analyze_pptx_template`.

STOP and wait before proceeding.

#### C. Use the Template Skill
The Template Skill provides Brand-DNA, Compositions (semantic meaning, usage rules, capacity limits), and Shape-Mappings (via `get_composition_details`).

**Before creating slides:** Call `get_composition_details` for compositions you plan to use. This returns shape names, text capacities, shape types, fill colors, and constraints.

**Corporate template rules:**
- Use `template_file` + `template_slide` + `content`. NEVER use `html`.
- Think in **compositions** (semantic meaning), not slide numbers
- Content keys must use shape names/aliases from `get_composition_details`
- Respect capacity limits (max_chars, font_size_pt per shape)

### Step 4: PLAN

**Resolve ambiguities first.** Send a text message and STOP when:
- Source material is incomplete, contradictory, or unclear
- Multiple compositions could work equally well (present 2-3 options)
- Content must be heavily condensed and you are unsure what to cut
- Numbers or data lack context (units, time period, baseline)

Draft the document structure and share for approval:
- **Corporate template**: Table with # | Composition | Template Slide # | Action Title | Content Summary | Why This Composition
- **Default themes**: Table with # | Visual Pattern | Action Title | Content Type | Narrative Function
- Documents: Outline with headings and sections
- Spreadsheets: Column definitions and data structure

**Planning rules (presentations):**
- Choose a Storytelling Framework from presentation-design skill FIRST
- Max 30% text slides [S], max 50% [R]. Rest MUST use structured visual layouts
- Never same slide type consecutively. Apply Two-Slide-Buffer Rule
- Apply Visualization Decision Tree: numbers -> KPI/chart, sequence -> process, comparison -> matrix
- Templates are a design vocabulary, not a rigid script. Vary layouts: alternate data-heavy with visual-light, analytical with emotional
- For EVERY slide, document Design Reasoning + target emotion:
  - BAD: "Passt zum Inhalt"
  - GOOD: "3 sequential steps -> process chevrons (Comp: chevron-kette, Slide 64). Emotion: clarity/momentum"

### Step 5: CREATE

#### 5a: Content Transformation (corporate templates -- MANDATORY)

Before calling create_pptx, transform source content into slide-ready content. NEVER copy source text verbatim.

**Rule 1: Fill EVERY shape.**
`get_composition_details` lists ALL shapes. Your `content` must include EVERY shape. Unfilled shapes are CLEARED and appear blank.

**Rule 2: Transform, don't copy.**
- Paragraph -> 3-5 bullets (max 8 words each [S], full sentences allowed [R])
- Facts/numbers -> KPI cards or table
- Steps -> chevron labels (1-3 words) + descriptions
- Comparison -> two-column with parallel structure

**Rule 3: Match composition to content, not content to composition.**
Classify content first (Decision Tree), then find matching composition.

**Rule 4: No chart slides without matching data.**
Embedded charts show static template data. Only use when content matches the chart type.

**Rule 5: NEVER invent data.**
All numbers, percentages, dates MUST come from source material. If a shape needs a number and source has none, use qualitative text or different composition.

**Rule 6: Reload composition details when switching template slides.**
Each composition has different shape names. Switching without reloading = empty slides.

**Rule 7: Design Reasoning for EVERY slide.**
Apply Visualization Decision Tree + ask "What should the audience FEEL?" and "Does this repeat a recent layout?"

**Rule 8: Adapt all footers and headers.**
Template footers (e.g. "Folienbibliothek | Stand November 2025") are PLACEHOLDERS. Use the `footer_text` parameter in create_pptx. Replace with: presentation title, author/company, actual date. NEVER leave template default footers.

**Rule 9: Image decision -- ask or avoid.**
If a composition has image placeholders (`shape_type: image` in composition details): ASK the user for relevant images OR choose a text-only composition. NEVER silently use template placeholder images.

**Rule 10: Color accents mark the focal point.**
If a composition has colored accent elements (`fill_color` in composition details), place the MOST IMPORTANT content (result, key finding, climax) at the accent position. NOT random content.

#### 5b: Pre-Flight Gate
Run the Pre-Flight Self-Check from presentation-design skill (Section O) before calling create_pptx. All 10 items must pass. Fix failures first.

#### 5c: Choose pipeline and generate

**Corporate template -- two modes:**

- **Template mode** (`template_slide` + `content`): Pixel-perfect cloning. Use for simple text replacement where the template composition matches content exactly (title slides, section dividers, straightforward content).

- **HTML mode** (`html` + `template_file` for reference): Full creative freedom. PREFERRED when you need to design -- move elements, emphasize with color, vary layouts, create charts, build custom visualizations. Use Brand-DNA from `get_composition_details` (colors, fonts, canvas size) to stay on-brand. Think like a designer who knows the brand guidelines, not a machine copying coordinates. Use template compositions as **inspiration for layout patterns**, not pixel-perfect blueprints. Deko elements (logo, accent bars) are auto-injected by the pipeline -- do NOT place them manually in HTML.

| Slide Type | Mode | Why |
|---|---|---|
| Title, section divider | Template | Simple text, exact branding |
| Content fitting template shapes | Template | Fast, pixel-perfect |
| KPI dashboards, process flows, comparisons | HTML | Creative layout, color semantics |
| Charts, data visualizations | HTML | Native editable charts |
| Anything needing design creativity | HTML | Full control |

- **Default themes:** Call create_pptx with slides using the `html` field.

### Step 6: QUALITY CHECK (if Visual Intelligence enabled)
1. Call `check_presentation_quality` with the created PPTX
2. **If "pass":** Inform user
3. **If "needs_revision":** Apply fixes, re-create, re-check. Max 2 rounds.
4. **If "critical":** Inform user, suggest alternatives
5. **Feedback Loop**: Update `compositions.json` with learned constraints (corrected max_chars, line break behavior, font sizes)

**Fallback** (without Visual Intelligence): Call `render_presentation` for manual inspection.

## 2. Anti-Patterns (NEVER do these)

- Title-only slides (every slide needs substantive content)
- Wall of text (>5 bullets or >75 words [S], >170 words [R])
- Generic titles ("Ueberblick", "Zusammenfassung" without assertion)
- Same visual pattern on consecutive slides
- Unfilled shapes (EVERY shape MUST have content)
- Copy-pasted source text (ALWAYS transform)
- Chart slides with wrong content type
- Hallucinated numbers/data (EVERY data point traceable to source)
- Template placeholder images used without asking
- Template default footers left unchanged
- Color accents on random content instead of focal point

## 3. After Creation

Offer matching DOCX handout (for presentations). Ask if adjustments are needed.

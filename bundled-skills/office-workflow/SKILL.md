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
- **Setting** (presentations): Live presentation (speaker-led, max 25 words/slide) or read deck (self-explanatory, max 170 words/slide)?
- **Time budget** (presentations): How many minutes? (~1 slide per minute for live)
- **Material**: Does the user have data, documents, or notes to incorporate?

### Step 2: TEMPLATE
Ask about template/theme. Send a regular text message (NOT ask_followup_question) and STOP your turn.

For presentations:
"Bevor ich die Praesentation erstelle: Welches Design soll ich verwenden? **Executive** (dunkel, serioes), **Modern** (hell, Blau/Orange), **Minimal** (Schwarz/Weiss). Falls du eine eigene Corporate-Vorlage nutzen moechtest, lade die .pptx-Datei in den Vault -- ich analysiere sie und erstelle einen Design-Skill daraus."

NEVER skip this question. NEVER assume a template from memory.

User responds: "Executive"/"Modern"/"Minimal" -> lowercase as template parameter, proceed to Step 4 (PLAN).
User mentions a corporate .pptx template -> proceed to Step 3 (TEMPLATE SKILL).

### Step 3: TEMPLATE SKILL (Corporate Templates only)

If the user wants to use a corporate PPTX template:

#### A. Check for existing Template Skill
Look in `<available_skills>` for a matching template skill (e.g. "acme-template"). If found, skip to "Use the Template Skill" below.

#### B. No Template Skill? Guide the user through template analysis

This is a multi-step guided process. Send clear messages at each step and STOP to wait for the user.

**B1. Locate the template**
If the user already mentioned a .pptx file path, use it. Otherwise send:
"Ich sehe, dass fuer diese Vorlage noch kein Template-Skill existiert. Kein Problem -- ich kann die Vorlage analysieren und einen erstellen. Wo liegt die .pptx-Datei im Vault? (z.B. `Templates/MeineVorlage.pptx`)"
STOP and wait for the user's response.

**B2. Run structural + multimodal analysis**
Call `analyze_pptx_template` with the template path. The tool automatically:
- Extracts Brand-DNA, slide compositions, shape mappings
- Renders slides via LibreOffice (if Visual Intelligence enabled)
- Runs multimodal analysis via Claude Vision (if approved) -- generates semantic aliases, usage rules, capacity limits
- Generates **SKILL.md** (auto-installed as user skill) and **compositions.json** (v2 with aliases)

**IMPORTANT: If the tool reports that multimodal analysis is deactivated**, proactively ask the user:
"Die multimodale Template-Analyse ist deaktiviert. Diese Funktion nutzt Claude Vision, um die Folien visuell zu analysieren -- das ergibt deutlich bessere Shape-Beschreibungen, Nutzungsregeln und Kapazitaetslimits. Soll ich sie aktivieren?"

If the user agrees, use `update_settings` to set `visualIntelligence.enabled` = true and `visualIntelligence.multimodalAnalysisApproved` = true, then re-run `analyze_pptx_template`.

**B3. Visual analysis (fallback only -- when multimodal analysis was NOT available)**
This step is only needed if multimodal analysis could not run (e.g. LibreOffice not installed, user declined). If multimodal analysis completed successfully, skip to B4.

**If Visual Intelligence is enabled but multimodal was skipped:**
1. Call `render_presentation` with the template PPTX file to render all slides as images
2. Visually inspect the rendered slide images and identify for each composition:
   - Semantic meaning: What does this visual form communicate? (e.g. "linear progress", "comparison of two options")
   - Usage rules: When to use this composition, when NOT to use it
   - Text constraints: Estimate max characters per shape from the visual layout
3. Update `compositions.json` via `edit_file` with enriched data (bedeutung, einsetzen_wenn, nicht_einsetzen_wenn, max_chars)
4. Update the SKILL.md composition descriptions with the semantic meanings

After enrichment, send:
"Die Template-Analyse ist abgeschlossen. Ich habe [N] Kompositionen gefunden und visuell analysiert -- mit Bedeutung, Einsatzregeln und Textkapazitaeten. Der Template-Skill ist jetzt einsatzbereit.

Soll ich mit der Praesentation weitermachen?"

**If Visual Intelligence is NOT enabled:**
Send this message and STOP:
"Die strukturelle Analyse ist fertig -- ich habe [N] Kompositionen gefunden. Um die Vorlage aber wirklich gut nutzen zu koennen, muss ich die Slides auch visuell sehen. Dafuer gibt es zwei Optionen:

**Option 1 (empfohlen):** Aktiviere **Visual Intelligence** in den Obsilo-Settings (Settings > Visual Intelligence). Dafuer muss LibreOffice installiert sein (kostenlos). Dann kann ich die Vorlage selbst rendern und analysieren.

**Option 2:** Exportiere die Vorlage als PDF (PowerPoint: Datei > Exportieren > PDF) und speichere sie im Vault. Dann schick mir den Pfad."
STOP and wait for the user's response.

If user enables Visual Intelligence: proceed with `render_presentation` as above.
If user provides a PDF path: Use `read_document` to read the PDF visually, then enrich as described above.

#### B4. Failure Recovery (MANDATORY)
If ANY step in the template analysis pipeline fails:
- **render_presentation fails or returns fewer slides than expected:** Report the exact error to the user. Do NOT proceed with incomplete visual data. Do NOT fabricate composition meanings.
- **get_composition_details cannot find the file:** Verify the template name matches exactly (the tool normalizes to lowercase with hyphens). Report the available templates from the error message.
- **NEVER manually create or edit SKILL.md files for templates.** Always use `analyze_pptx_template`. The structural analysis pipeline generates shape mappings from the actual OOXML -- manual creation will use wrong shape names and produce broken presentations.
- **NEVER work around a failed tool by manually recreating its output.** Report the error to the user and let them fix the underlying issue (install LibreOffice, install poppler-utils, etc.).

STOP and wait for the user's response before proceeding to Step 4.

#### C. Use the Template Skill
The Template Skill (Visual Design Language Document) provides:
- **Brand-DNA**: Colors, fonts, visual tone
- **Compositions**: Available visual forms with semantic meaning, usage rules, and capacity limits
- **Shape-Mappings**: Load on-demand via `get_composition_details` -- provides exact Shape-Names and constraints per composition

**Before creating slides:** Call `get_composition_details` with the template name and the composition IDs you plan to use. This returns the shape names, text capacities, and constraints you need for the `content` field.

**Corporate template mode rules:**
- Use `template_file` + `template_slide` + `content` instead of `html`. NEVER use the `html` field.
- Think in **compositions** (semantic meaning), not slide numbers. Choose the composition whose MEANING matches your content, then use its slide number and shape mapping.
- Apply Design Reasoning from the presentation-design skill: What is the message? What cognitive operation? Which visual form?
- Use the RICH compositions from the template (KPIs, process flows, SWOT, pyramids, org charts, etc.). NEVER build an entire deck from only text slides.
- Content keys in the `content` object must use **Shape-Names** (the OOXML `name` attribute) from the composition's shape mapping.
  - Shape-Name (USE THIS as content key): `"Titel 1"`, `"TextBox 5"`, `"Inhaltsplatzhalter 3"`
  - Placeholder text (NEVER use as content key): `"Klicken Sie hier, um Text einzugeben"`, `"Title goes here"`
  - The shape name is the TECHNICAL identifier from the XML. The placeholder text is the VISIBLE default content shown in PowerPoint. They are NOT the same thing.
- Respect **capacity limits** from `get_composition_details` (max_chars, font_size_pt per shape).

### Step 4: PLAN

**Before drafting:** Resolve ambiguities with the user. Send a regular text message and STOP your turn whenever:
- Source material is incomplete, contradictory, or unclear
- Multiple compositions could work equally well for a content block (present 2-3 options with reasoning)
- Content must be heavily condensed and you are unsure what to cut
- Numbers or data lack context (units, time period, baseline)
- The narrative arc or slide order is not obvious from the source
- You are uncertain whether content should be a separate slide or merged with another

Do NOT guess silently. A short clarification question now prevents a wrong slide later.

Draft the document structure and share with user for approval:
- Presentations (corporate template): Use Design Reasoning + Content Classification from presentation-design skill to classify each content block. Then map to matching compositions from the Template Skill based on semantic meaning. Present a table with # | Composition | Template Slide # | Action Title | Content Summary | Why This Composition
- Presentations (default themes): Table with # | Visual Pattern | Action Title | Content Type | Narrative Function
- Documents: Outline with headings and section descriptions
- Spreadsheets: Column definitions and data structure

**Corporate template planning rules:**
- Max 30% of content slides may be plain text. The rest MUST use structured visual layouts.
- Never use the same slide type on consecutive slides.
- Apply the Visualization Decision Tree: numbers -> KPI/chart, sequence -> process, comparison -> matrix/two-column, parallel aspects -> cards/cycle, convergence -> funnel.
- The plan MUST show the template slide number for every slide.
- For EVERY slide, document your Design Reasoning in the "Why This Composition" column:
  - BAD: "Passt zum Inhalt" / "Text slide for overview"
  - GOOD: "3 sequential steps -> Decision Tree: sequence -> process chevrons (Comp. ID: chevron-kette, Slide 64)"
  - GOOD: "4 parallel KPIs with numbers -> Decision Tree: metrics -> KPI cards (Comp. ID: kpi-dashboard, Slide 32)"

### Step 5: CREATE

#### 5a: Content Transformation (corporate templates -- MANDATORY)

Before calling create_pptx, transform source content into slide-ready content. NEVER copy source text verbatim into shapes.

**Rule 1: Fill EVERY shape in the composition.**
When you load a composition via `get_composition_details`, the response lists ALL shapes for that slide. Your `content` object MUST include a key for EVERY listed shape. Unfilled shapes with placeholder text are CLEARED by the template cloner -- they appear as blank empty areas on the slide.

BAD (only 2 of 10+ shapes filled -- rest will be empty):
```json
{ "template_slide": 64, "content": { "Titel 1": "Pipeline", "TextBox 1": "Schritt 1" } }
```

GOOD (ALL shapes filled with meaningful content):
```json
{ "template_slide": 64, "content": { "Titel 1": "Technische Pipeline", "TextBox 1": "Erfassung", "TextBox 2": "Verarbeitung", "TextBox 3": "Analyse", "TextBox 4": "Ergebnis", "TextBox 5": "Bericht", "Textplatzhalter 6": "Daten sammeln\nQuellen anbinden", "Textplatzhalter 7": "Normalisierung\nBereinigung", "Textplatzhalter 8": "Muster erkennen\nAbweichungen detektieren", "Textplatzhalter 9": "Aenderungen visualisieren\nFarbcodierung", "Textplatzhalter 10": "Ergebnisse exportieren\nChange-Log erstellen" } }
```

**Rule 2: Transform, don't copy.**
Source text is NEVER slide-ready. Always restructure:
- Long paragraph → 3-5 bullet points (max 8 words each)
- List of facts → KPI cards or table
- Sequential steps → process chevron labels (1-3 words) + descriptions (1 sentence)
- Comparison → two-column layout with parallel structure
- Quote → max 200 characters, keep the punch line

BAD (copy-paste from source):
```
"Inhaltsplatzhalter 3": "Manuelle Planvergleiche sind bei grossen Projekten mit vielen Revisionen extrem zeitintensiv. Besonders bei komplexen Industrieplaenen mit Hunderten Seiten pro Revision."
```

GOOD (transformed for slide):
```
"Inhaltsplatzhalter 3": "Zeitaufwand\nHunderte Seiten pro Revision\nManuelle Vergleiche extrem zeitintensiv\n\nFehleranfaelligkeit\nAenderungen werden uebersehen\nRueckschleifenkosten steigen"
```

**Rule 3: Match composition to content, not content to composition.**
Do NOT pick a text slide and force all content into it. Instead:
1. Classify each content block (numbers? sequence? comparison? hierarchy?)
2. Find the composition whose VISUAL FORM matches (use Visualization Decision Tree from presentation-design skill)
3. Reshape the content to fit that composition's shapes

**Rule 4: No chart slides without matching data.**
Some template slides contain STATIC embedded charts (bar charts, pie charts, waterfall diagrams). These charts show the template's sample data and CANNOT be replaced via text content. Only use chart slides when your content semantically matches the chart type.

**Rule 5: NEVER invent data.**
All numbers, percentages, dates, names, and facts in slide content MUST come directly from the source material. If a shape requires a KPI/number and the source has none:
- Use a qualitative description instead ("Deutliche Verbesserung" not "25,3%")
- Or choose a different composition that doesn't need numeric data
- NEVER generate plausible-sounding numbers -- they are hallucinations and destroy the presentation's credibility
- "Transform" means restructure the FORMAT (paragraph -> bullets), not fabricate new DATA

**Rule 6: ALWAYS reload composition details when switching template slides.**
Each composition has different shapes with different names. When you switch from one template_slide to another, you MUST call `get_composition_details` again for the new composition. Using shape names from a previous composition WILL result in empty slides.

**Rule 7: Use Design Reasoning for EVERY slide.**
Before choosing a composition, apply the Visualization Decision Tree from the presentation-design skill:
- BAD: "This content is about our process" -> picks first available text slide
- GOOD: "This content describes 4 sequential steps" -> Decision Tree: sequence -> process flow -> picks chevron composition with 4 shapes

**Rule 8: Ask when unsure -- never assume.**
During content transformation, ask the user via regular text message and STOP when:
- A shape requires a specific fact, name, or number not present in the source material
- You are unsure whether a bullet point is important enough to keep or should be cut
- The tone is ambiguous (formal corporate vs. casual internal vs. motivational)
- Visual emphasis is unclear (which KPI is the hero number? which step is the critical one?)
- You need to split content across slides and the grouping is not obvious
Keep questions concise and actionable: present your best option and ask for confirmation rather than open-ended questions.

#### 5b: Generate the document

- **Corporate template:** Call create_pptx with `template_file` and slides using `template_slide` + `content` fields. Use Shape-Names from `get_composition_details` as content keys.
- **Default themes:** Call create_pptx with slides using the `html` field (see "HTML Slide Format" section in presentation-design skill).

### Step 6: QUALITY CHECK (if Visual Intelligence enabled)
1. Call `check_presentation_quality` with the created PPTX file
2. The tool renders all slides and performs automated visual analysis, checking:
   - Text overflow or truncation
   - Empty shapes that should have content
   - Layout balance and readability
   - Consistency across slides
3. **If status "pass":** Presentation is ready -- inform the user
4. **If status "needs_revision":**
   - Apply the suggested fixes (shorten text, adjust wording, change composition)
   - Call `create_pptx` again with corrected content
   - Run `check_presentation_quality` again to verify
   - Maximum 2 revision rounds (then inform user of remaining issues)
5. **If status "critical":** Inform the user about the problems and suggest alternatives
6. **Feedback Loop**: Update `compositions.json` via `edit_file` with learned constraints:
   - Correct `max_chars` values based on what actually fits
   - Add notes about line break behavior
   - Adjust `font_size_pt` if observed differently
   - Future presentations with the same template benefit automatically

**Fallback** (without Visual Intelligence): Call `render_presentation` for manual visual inspection.

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
- Unfilled shapes (EVERY shape from get_composition_details MUST have content -- unfilled shapes are cleared and appear blank)
- Copy-pasted source text (ALWAYS transform: paragraphs → bullets, numbers → KPIs, sequences → process flows)
- Chart slides with wrong content (embedded bar/pie/waterfall charts show STATIC template data -- only use when content matches the chart type)
- Hallucinated numbers/data (NEVER invent percentages, KPIs, dates, or facts -- every data point must be traceable to the source material)

## 6. After Creation

- Offer matching DOCX handout (for presentations)
- Offer to save template preference in memory
- Ask if adjustments are needed before finalizing

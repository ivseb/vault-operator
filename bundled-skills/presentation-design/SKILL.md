---
name: presentation-design
description: Universal presentation design principles -- content classification, storytelling frameworks, visual vocabulary, design reasoning. Applies to ALL presentations (default themes AND corporate templates).
trigger: pr[aä]sentation.*erstell|erstell.*pr[aä]sentation|presentation.*creat|creat.*presentation|folie.*erstell|erstell.*folie|deck.*erstell|powerpoint|pptx
source: bundled
requiredTools: [create_pptx]
---

# Presentation Design Expertise

You are a world-class presentation designer. Every visual choice has a reason. Templates are your design vocabulary, not a rigid mold.

When a corporate template skill is active, use template_slide + content instead of HTML. For default themes (Executive/Modern/Minimal), see the "HTML Slide Format" section below.

## A. Deck Modes

Determine the mode FIRST -- it governs every rule below.

**SPEAKER DECK** (live presentation with a speaker):
- Slides support the speaker, NOT replace them
- Max 25 words per slide -- audience listens, not reads
- Visual-first: charts, images, KPIs dominate
- Every slide is a beat in a spoken narrative arc
- Speaker notes carry the detail (2-3 talking points per slide)

**READING DECK** (self-explanatory document, no speaker):
- Slides must stand alone -- reader has no voice-over
- Up to 170 words per slide -- complete sentences, full context
- Text-rich but structured: clear headings, sub-sections, annotations
- Charts need full labels and interpretation text on-slide
- Executive summary on first slide (reader may stop after slide 2)

Rules that differ by mode are marked [S] for Speaker and [R] for Reading.

## B. Design Thinking Chain

For EVERY slide, answer these four questions before choosing a composition:

1. **MESSAGE**: What is the ONE message? (If you cannot state it in one sentence, split the slide.)
2. **COGNITIVE OP**: compare | sequence | quantify | relate | feel?
3. **VISUAL FORM**: Which form triggers that operation? (see Visual Vocabulary)
4. **EMOTION**: What should the audience FEEL? trust | urgency | warmth | energy | clarity | confidence

Document your reasoning briefly in your planning response for each slide.

## C. Cognitive Load Rules

- **MILLER**: Max 7 visual elements per slide [S], max 9 [R]
- **COHERENCE**: Remove everything that does not support the message
- **CONTIGUITY**: Label next to the object, not in a separate legend
- **REDUNDANCY** [S]: Do not repeat the same info in title + body + chart. [R]: Redundancy allowed -- chart interpretation as text next to chart
- **SEGMENTATION**: Complex argument -> 2-3 slides, not one dense slide
- **ONE KEY MESSAGE** per slide [S]. Up to 2 related messages per slide [R]
- **DENSITY** [S]: Max 25 words/slide. [R]: Max 170 words/slide
- **SIGNAL-TO-NOISE**: Every element must carry information. Whitespace is information. Data-ink ratio > decoration

## D. Visual Storytelling and Emotional Arc

### Narrative Arc
Every presentation follows: **Hook -> Build -> Turn -> Resolution -> Echo**

- **Hook** (slide 1-2): Surprise, provocation, bold claim. Audience decides in 8 seconds whether to pay attention.
- **Build** (slides 3-5): Evidence, context, data. Create shared understanding.
- **Turn** (slide 6-7): The complication, the tension, the "but". Dramatic contrast to the build.
- **Resolution** (slides 8-9): The answer, the strategy, the solution. Release the tension.
- **Echo** (last slide): One sentence that stays. Not "Thank you" -- a call to action or memorable statement.

### Slide-Level Emotion
Every slide must evoke SOMETHING: concern, surprise, excitement, urgency, relief, confidence.
**If a slide evokes NO emotion, it is filler. Cut it or redesign it.**

## E. Color Semantics and Emphasis

### Semantic Color System
- success = green, error/risk = red, warning/caution = orange, info = blue, highlight = brand accent
- NEVER use accent colors randomly. Every colored element carries meaning.

### Focal Point Rule (CRITICAL)
The color accent marks the MOST IMPORTANT element. Place your result, climax, or key finding at the accent position. If a composition has a colored chevron among neutral ones, the accent chevron carries the conclusion.

### Emphasis Hierarchy
weight > size > space > color > CASE. Use the weakest technique that achieves distinction. Reserve color for the single focal point.


## F. Gestalt Principles

- **Proximity**: Related items close, unrelated items separated by whitespace
- **Similarity**: Same treatment (color, size, shape) = same category
- **Continuity**: Align along invisible lines to create flow
- **Figure/Ground**: One element dominates; everything else recedes

## G. Visual Vocabulary

| Visual Form | Communicates | Cognitive Trigger | Emotion |
|---|---|---|---|
| Chevron chain | Sequence, progress | "Step by step forward" | Clarity, momentum |
| Pyramid | Hierarchy, foundation | "Base supports top" | Stability, authority |
| Cycle | Iteration, continuity | "This repeats" | Confidence, reliability |
| 2x2 Matrix | Two-axis analysis | "Compare along 2 dimensions" | Analytical clarity |
| Funnel | Filtering, narrowing | "Many become few" | Focus, urgency |
| Side-by-side | Contrast, choice | "Compare these two" | Decision tension |
| Hub-spoke | Central concept | "Everything connects here" | Unity, importance |
| Timeline | Temporal sequence | "This order matters" | Anticipation, progress |
| KPI cards | Quantified facts | "Look at these numbers" | Trust, impact |

## H. Content Classification

### Decision Tree

```
Content has numbers?
  Yes -> How many data points?
       1-6 metrics -> KPI cards
       Time series -> Line chart
       Category comparison -> Bar chart
       Parts of whole -> Pie/donut
  No -> Describes a sequence?
       Yes -> Process / chevrons / timeline
       No -> Parallel aspects (equal weight)?
            Yes -> KPI cards / puzzle / cycle
            No -> Comparison?
                 Yes -> Two-column / matrix / SWOT
                 No -> Multiple -> one result?
                      Yes -> Funnel / convergence
                      No -> Hierarchical?
                           Yes -> Pyramid / org chart
                           No -> Content slide (LAST RESORT)
```

### Mapping Table

| Content Type | Visualization | Category |
|---|---|---|
| Single metric | KPI card | kpi |
| Metric comparison | Bar/column chart | chart |
| Time series | Line chart | chart |
| Parts of whole | Pie/donut | chart |
| Process / sequence | Chevron chain / flow | process |
| Hierarchy | Pyramid | pyramid |
| SWOT / strengths-weaknesses | 2x2 matrix | matrix |
| Pro/contra | Two-column comparison | comparison |
| Timeline | Timeline with markers | timeline |
| Plain text | Bullets (LAST RESORT) | content |

### Composition Rules
1. **Max 30% pure text slides** [S], max 50% [R]
2. **Never repeat** same slide type consecutively
3. **Section dividers** every 3-5 content slides
4. Numbers in bullets? Convert to KPI cards. Steps in bullets? Convert to process flow.

### Template-Based Creation (Corporate Templates)
When a template skill is active, it **extends and overrides** the static table above:
1. Read the Template Skill -- compositions organized by semantic meaning
2. Match content to composition by MEANING, not slide number
3. Use shape names/aliases as keys in `content` object
4. Respect capacity limits per shape (max_chars, font_size_pt)
5. Brand-DNA defines colors, fonts, tonality
6. Use `narrative_phase` from compositions.json to match narrative arc

**Priority**: Template compositions > static mapping table.

## I. Storytelling Frameworks

### Selection Guide

| Goal | Framework | Best For |
|------|-----------|----------|
| Recommend strategy | SCR | Board meetings, strategy reviews |
| Analyze problem | SCQA | Consulting, internal analysis |
| Brief executives | Pyramid | Executive summaries, steering committees |
| Sell idea/product | Problem-Solution-Benefit | Pitches, proposals |
| Present data | Data Story | Analytics reviews, research |
| Report progress | Status Report | Sprint reviews, QBRs |

### SCR (Situation -- Complication -- Resolution)
1-2: Title + Situation (KPIs, charts -- current state)
3-4: Complication (comparison, contrast -- what threatens)
5-7: Resolution (process, KPIs -- solution + evidence)
8: Roadmap (timeline). 9: CTA (concrete next steps)

### SCQA (Situation -- Complication -- Question -- Answer)
1-2: Situation (shared understanding). 3: Complication (gap/risk).
4: The Question (section divider, one sentence). 5-7: Answer (evidence-backed).
8: Implications. 9: Next Steps with owners.

### Pyramid Principle (Minto)
1: Conclusion upfront. 2: Key arguments (3-4 KPI cards).
3-7: Deep-dive per argument (charts, comparisons). 8: Synthesis. 9: Decision/CTA.

### Problem-Solution-Benefit
1-2: Problem quantified (KPIs, pain). 3: Transition ("There is a better way").
4-5: Solution (process, differentiators). 6-7: Evidence (benchmarks, ROI).
8: Benefits (quantified outcomes). 9: CTA with timeline.

### Data Story
1: Key finding as title. 2: Context (why this analysis).
3-5: Discovery + deep-dive (charts, correlations). 6: The "so what" (KPIs).
7: Implications. 8: Data-driven recommendations.

### Status Report
1: Overall status as action title. 2: Executive summary (KPI cards).
3: Highlights. 4: Risks/blockers. 5-6: Deep-dive (deviations only).
7: Next period (timeline). 8: Asks/decisions.

### Application Rules
1. Always choose a framework -- never create without narrative structure
2. Adapt slide count proportionally to content
3. Section dividers mark phase transitions
4. **Action titles on EVERY slide**: state a conclusion, not a topic ("Revenue doubled" not "Revenue")
5. First and last slides are most remembered -- make them count

## J. Typography and Density

**Font sizes**: titles >= 28px, body >= 14px, labels >= 12px
**Text limits** [S]: chevron labels 3 words, bullet items 8 words, titles 10 words, body max 25 words
**Text limits** [R]: titles 12 words, body max 170 words, structured with sub-headings
**Emphasis**: bold > italic > underline > color > CAPS. Use ONE technique per emphasis level.
**Speaker notes** [S]: 2-3 talking points per slide. [R]: methodology, sources, caveats.

## K. Image Strategy

**USE images when**: Humanize (people, teams), Prove (screenshots, evidence), Evoke (emotional backdrop)
**DO NOT use images when**: Generic stock, purely decorative, no connection to message

### Template Image Rule (CRITICAL)
NEVER use template placeholder images. If a composition has `shape_type: image`:
- ASK the user for relevant images, OR
- Choose a text-only composition instead
Template placeholder images are random -- they confuse the message.

## L. Visual Rhythm and Variation

### Two-Slide-Buffer Rule
Same composition TYPE needs minimum 2 DIFFERENT slides between uses. Section dividers do NOT count as buffer.

### Variation Patterns
- Alternate: data-heavy -> visual-light -> analytical -> emotional
- Alternate: dark background -> light background every 3-4 slides
- Alternate: full-bleed -> structured grid -> minimal whitespace
- Never 3 KPI slides in a row. Never 3 text slides in a row.

## M. Data Visualization

**Chart selection** (Abela framework):
- Comparison -> Bar/column. Trend -> Line. Composition -> Pie/stacked bar. Distribution -> Scatter/histogram.

**Tufte rules**: Maximize data-ink ratio. Remove chart junk (3D effects, heavy gridlines, decorative elements). Every pixel of ink should present data.

**Insight titles**: Chart title states the insight, not the metric. "Revenue doubled in 6 months" not "Revenue Chart".

## N. Content Transformation

| Source | Target | Transformation |
|---|---|---|
| Paragraph, 4 arguments | 4 bullet points | Core assertion per argument, max 8 words [S] |
| Step-by-step description | Process chevrons | 1-3 word label + 1-sentence description |
| "We achieved X, Y, Z" | KPI cards | Number + unit + trend per metric |
| "Option A vs Option B" | Two-column | Parallel structure, same categories |
| Long quote | Quote slide | Max 200 chars, keep the punch line |
| 4 parallel aspects | Cycle/puzzle | 1-word label + 2-line description per quadrant |

### Data Integrity Rule
NEVER invent numbers, percentages, or facts not in the source material. "Transform" = restructure FORMAT, not fabricate DATA. Every data point must be traceable. If a composition needs data you do not have, pick a different composition.

### Shape Completeness Rule
Template compositions define FIXED shapes. Unfilled shapes appear BLANK. Provide content for EVERY shape. If too many shapes: choose smaller composition or add relevant sub-points. If too few: consolidate or split across slides.

### Embedded Charts in Templates
Static chart slides show template sample data -- CANNOT be replaced via text. Only use when content semantically matches the chart type and data.

## O. Pre-Flight Self-Check

Run this checklist BEFORE calling create_pptx. All 10 must pass.

1. **TEXT RATIO**: >30% text slides [S] or >50% [R]? -> Convert to visual compositions
2. **LAYOUT REPETITION**: Same type within 2 slides? -> Swap (Two-Slide-Buffer Rule)
3. **COLOR MEANING**: Accent color on most important element? -> Reposition (Focal Point Rule)
4. **IMAGE CHECK**: Template placeholder images used? -> Ask user or choose text-only
5. **FOOTER CHECK**: Footer adapted to actual content? -> Set footer_text parameter
6. **NARRATIVE ARC**: Hook -> Build -> Turn -> Resolution -> Echo present? -> Restructure
7. **DENSITY CHECK** [S]: >25 words or >7 elements? [R]: >170 words or >9 elements? -> Split
8. **ACTION TITLES**: Every title states a conclusion? -> Rewrite topic titles
9. **EMOTION CHECK**: Every slide evokes a feeling? -> Redesign filler slides
10. **SHAPE COMPLETENESS**: Every shape in every composition filled? -> Fill or switch composition

## P. HTML Slide Format

For default themes AND corporate HTML mode (template_file + html, see office-workflow Step 5c). In corporate HTML mode, Brand-DNA colors/fonts come from compositions.json and deko elements (logo, accent bars) are auto-injected by the pipeline -- do NOT place them manually.

Each slide: annotated HTML on pixel canvas (1280x720 default, or from Brand-DNA slide_size_px). Every element: `<div>` with `data-object="true"` + `data-object-type`. Position via absolute pixel coordinates.

### Element Types

**shape** -- Backgrounds, accent bars, cards, circles:
```html
<div data-object="true" data-object-type="shape" style="position: absolute; left: 0px; top: 0px; width: 1280px; height: 720px; background-color: #1F2937;"></div>
```
Shape hints via `data-shape`: rect, roundRect, ellipse, circle, triangle, diamond, hexagon, pentagon, octagon, parallelogram, trapezoid, chevron, homePlate, funnel, star5, heart, cloud, plus, donut, cube, can, rightArrow, leftArrow, upArrow, downArrow, bentArrow, line, flowChartProcess, flowChartDecision, wedgeRectCallout. All 178 PptxGenJS shapes available by exact name.

**textbox** -- Titles, body text, labels, bullets:
```html
<div data-object="true" data-object-type="textbox" style="position: absolute; left: 100px; top: 250px; width: 1080px; height: 100px; font-size: 44px; font-weight: bold; color: #FFFFFF; text-align: center;">Title</div>
```
Vertical alignment: `data-valign="top|middle|bottom"`. Bullets: `data-bullets="true"`.

**image** -- Photos, logos, icons:
```html
<div data-object="true" data-object-type="image" data-vault-path="Assets/Logo.png" style="position: absolute; left: 1100px; top: 20px; width: 140px; height: 50px;"></div>
```

**chart** -- Native chart (`data-chart-index="0"`, data via `charts` field)
**table** -- Native table (`data-table-index="0"`, data via `tables` field). Max 7 rows, 5 columns.

### Layout Patterns

**Title**: Dark bg + centered title + subtitle + accent bar.
**KPI Grid**: Header + 3-4 cards (x:60/460/860, y:150, w:360, h:220). Value 36px, label 15px.
**Process**: Header + step shapes + arrows + descriptions.
**Two-Column**: Header + left (x:40, w:580) + right (x:660, w:580).
**Section Divider**: Dark bg + number (72px) + title (32px).

## Q. Default Theme Palettes

**Executive** (default): Primary #1F2937, Accent1 #3B82F6, Accent2 #10B981. Chart: #3B82F6, #10B981, #F59E0B, #EF4444, #8B5CF6, #06B6D4
**Modern**: Primary #1E40AF, Accent1 #F97316, Accent2 #8B5CF6. Chart: #F97316, #8B5CF6, #3B82F6, #10B981, #EC4899, #14B8A6
**Minimal**: Primary #111827, Accent1 #6B7280, Accent2 #9CA3AF. Chart: #6B7280, #111827, #9CA3AF, #4B5563, #D1D5DB, #374151

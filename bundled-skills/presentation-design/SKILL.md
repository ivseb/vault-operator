---
name: presentation-design
description: PPTX design expertise with HTML-based slide layout, element catalog, and quality standards
trigger: pr[aä]sentation.*erstell|erstell.*pr[aä]sentation|presentation.*creat|creat.*presentation|folie.*erstell|erstell.*folie|deck.*erstell|powerpoint|pptx
source: bundled
requiredTools: [create_pptx]
---

# Presentation Design Expertise

You are a professional presentation designer. This skill has two parts:
- **Part A (Universal)**: Content Classification Framework -- applies to ALL presentations (default themes AND corporate templates)
- **Part B (Default themes only)**: HTML slide format, layout patterns, palettes -- ONLY for Executive/Modern/Minimal themes. When a corporate template skill is active, IGNORE Part B entirely.

## A. Content Classification Framework (Universal)

This framework applies to EVERY presentation, regardless of template. Use it to decide HOW to visualize content.

### Content-Type to Visualization Mapping

| Content Type | Visualization | Element Category |
|---|---|---|
| Single metric | KPI card | kpi |
| Metric comparison | Bar/column chart | chart |
| Time series / trend | Line chart | chart |
| Parts of a whole | Pie/donut chart | chart |
| Process / sequence | Chevron chain / flowchart | process |
| Hierarchy / ranking | Pyramid | pyramid |
| Strengths/weaknesses | SWOT matrix (2x2) | matrix |
| Pro/contra | Two-column comparison | comparison |
| Org structure | Tree diagram | org-chart |
| Timeline | Timeline with markers | timeline |
| Plain text | Bullets (LAST RESORT) | content |

### Visualization Decision Tree

```
Content has numbers?
  Yes -> How many data points?
       1-6 metrics -> KPI cards
       Time series -> Line chart
       Category comparison -> Bar chart
       Parts of a whole -> Pie/donut chart
  No -> Describes a sequence?
       Yes -> Process flow / chevrons / timeline
       No -> Is it a comparison?
            Yes -> Two-column / matrix / SWOT
            No -> Is it hierarchical?
                 Yes -> Pyramid / org chart
                 No -> Content slide (bullets)
```

### Composition Rules

1. **Max 30% pure text slides** -- the rest must use structured visual layouts
2. **Never repeat** the same slide type on consecutive slides
3. **Section dividers** every 3-5 content slides
4. **Visual rhythm**: KPI -> Text -> Process -> Comparison (vary patterns)
5. **Numbers in bullets?** Convert to KPI cards or chart
6. **Steps in bullets?** Convert to process flow
7. **Metric-label pairs?** Convert to KPI cards

### Template-Based Slide Creation (Corporate Templates)

When a corporate template skill is active, the Template Skill **extends and overrides** the static Content Classification table above. The process is:

1. **Read the Template Skill** -- it lists ALL available slide compositions with Shape-Name mappings and slide classifications
2. **Build a dynamic mapping**: The Template Skill defines which slide types actually exist in this template. These may include types NOT in the static table above (e.g., quote, team, agenda-checkmarks, custom layouts). Use them.
3. **Match content to available slides**: For each content block, find the best matching template slide composition:
   - Direct match: content type matches a template slide classification (e.g., kpi content -> kpi slide) -- use it
   - Template-specific match: the template offers a specialized slide type for this content (e.g., a "quote" slide for testimonials) -- prefer it over generic alternatives
   - Fallback: no matching template slide exists -- use the closest available type (e.g., no "timeline" slide -> use "process" slide instead)
4. **Use Shape-Names as keys** in the `content` object (e.g. `"TextBox 5": "EUR 15.2M"`)
5. **Brand-DNA** from the template skill defines colors, fonts, and tonality
6. **Element catalog** shows what design elements (chevrons, KPI cards, pyramids etc.) exist in the template

**Priority**: Template Skill slide catalog > static Content Classification table. The static table helps you think about WHAT to visualize. The Template Skill tells you HOW to visualize it with the available slides.

### Storytelling Frameworks

Choose the framework that best fits the presentation's goal and audience. The framework determines the slide sequence and narrative arc. Apply it BEFORE selecting individual slide types.

#### Framework Selection Guide

| Goal | Framework | Best For |
|------|-----------|----------|
| Recommend a strategy or decision | SCR | Board meetings, strategy reviews |
| Analyze a problem rigorously | SCQA | Consulting, internal analysis |
| Brief executives quickly | Pyramid | Executive summaries, steering committees |
| Sell an idea or product | Problem-Solution-Benefit | Pitches, proposals, funding requests |
| Present data insights | Data Story | Analytics reviews, research findings |
| Report progress | Status Report | Sprint reviews, project updates, QBRs |

#### SCR (Situation -- Complication -- Resolution)

Classic strategy framework. Builds tension before revealing the answer.

| # | Phase | Slide Types | Content Focus |
|---|-------|-------------|---------------|
| 1 | Title | title | Core thesis as action title |
| 2 | Agenda | content | 3-4 section overview |
| 3-4 | Situation | kpi, chart | Current state with data |
| 5 | Complication | comparison, content | What changed / what threatens |
| 6-8 | Resolution | process, kpi, content | Solution + evidence + impact |
| 9 | Roadmap | timeline, process | Implementation steps |
| 10 | CTA | content | Concrete next steps + decision needed |

#### SCQA (Situation -- Complication -- Question -- Answer)

Consulting-style framework. Adds an explicit question to sharpen the analysis.

| # | Phase | Slide Types | Content Focus |
|---|-------|-------------|---------------|
| 1 | Title | title | Answering question as action title |
| 2 | Situation | kpi, chart | Shared understanding of status quo |
| 3 | Complication | comparison, content | Gap, risk, or change that creates tension |
| 4 | Question | section-divider | The central question (one sentence) |
| 5-8 | Answer | kpi, process, chart, comparison | Evidence-backed answer, structured |
| 9 | Implications | content, kpi | What this means for the audience |
| 10 | Next Steps | process, content | Actions with owners and dates |

#### Pyramid Principle (Minto)

Top-down: lead with the conclusion, then support with evidence layers.

| # | Phase | Slide Types | Content Focus |
|---|-------|-------------|---------------|
| 1 | Title + Conclusion | title | Main recommendation upfront |
| 2 | Key Arguments | kpi (3-4 cards) | 3-4 supporting pillars, one per card |
| 3-4 | Argument 1 Deep-Dive | chart, comparison | Data + evidence for pillar 1 |
| 5-6 | Argument 2 Deep-Dive | process, kpi | Data + evidence for pillar 2 |
| 7-8 | Argument 3 Deep-Dive | chart, content | Data + evidence for pillar 3 |
| 9 | Synthesis | kpi | Reinforced conclusion with numbers |
| 10 | Decision/CTA | content | What needs to happen |

#### Problem-Solution-Benefit

Persuasion framework for pitches and proposals.

| # | Phase | Slide Types | Content Focus |
|---|-------|-------------|---------------|
| 1 | Title | title | Bold benefit claim |
| 2-3 | Problem | kpi, chart | Pain points quantified (cost, time, risk) |
| 4 | Transition | section-divider | "There is a better way" |
| 5-6 | Solution | process, content | How it works, key differentiators |
| 7-8 | Evidence | kpi, chart, comparison | Proof: case studies, benchmarks, ROI |
| 9 | Benefits | kpi (3-4 cards) | Quantified outcomes |
| 10 | CTA | content | Clear ask with timeline |

#### Data Story

For presenting analytical findings. Numbers drive the narrative.

| # | Phase | Slide Types | Content Focus |
|---|-------|-------------|---------------|
| 1 | Title | title | Key finding as action title |
| 2 | Context | content, kpi | Why this analysis, what data |
| 3-4 | Discovery | chart, chart | Primary data visualizations with insight callouts |
| 5 | Key Finding | kpi | The "so what" -- headline number(s) |
| 6-7 | Deep-Dive | chart, comparison | Segmentation, trends, correlations |
| 8 | Implications | content | What this means for the business |
| 9 | Recommendations | process, kpi | Data-driven actions |
| 10 | Appendix note | content | Methodology, data sources, caveats |

#### Status Report

For regular updates. Focus on deviations and actions, not re-stating known context.

| # | Phase | Slide Types | Content Focus |
|---|-------|-------------|---------------|
| 1 | Title | title | Overall status as action title (not "Status Update Q1") |
| 2 | Executive Summary | kpi (3-4 cards) | Top-level KPIs with trend indicators |
| 3 | Highlights | content, kpi | What went well + metrics |
| 4 | Risks/Blockers | comparison, content | Issues with severity and mitigation |
| 5-6 | Deep-Dive | chart, process | Key area details (only deviations from plan) |
| 7 | Next Period | timeline, process | Upcoming milestones and owners |
| 8 | Asks/Decisions | content | What the audience needs to do |

#### Framework Application Rules

1. **Always choose a framework** -- never create a presentation without narrative structure
2. **Adapt slide count** to content: the tables above show typical structures, scale up/down proportionally
3. **Section dividers** mark phase transitions (e.g., Situation -> Complication)
4. **Action titles on EVERY slide** must advance the narrative ("Revenue doubled" not "Revenue Overview")
5. **Visual variety within phases**: never repeat the same slide type consecutively
6. **First and last slides** are the most remembered -- make them count

## B. HTML Slide Format (Default Themes Only)

**Part B applies ONLY to default themes (Executive/Modern/Minimal). When a corporate template skill is active, IGNORE everything below. Corporate templates use `template_slide` + `content`, NOT HTML.**

The office-workflow skill handles the general workflow (context, template, plan, create) and content rules (action titles, density, storytelling). Part B provides PPTX-specific HTML layout format and design patterns.

## B1. HTML Slide Format

Each slide is defined as annotated HTML on a **1280x720 pixel canvas** (16:9 widescreen).
Every visual element is a `<div>` with `data-object="true"` and a `data-object-type` attribute.
Position and style are set via inline CSS with **absolute pixel coordinates**.

### Element Types

#### shape -- Backgrounds, accent bars, cards, circles
```html
<div data-object="true" data-object-type="shape" style="position: absolute; left: 0px; top: 0px; width: 1280px; height: 720px; background-color: #1F2937;"></div>
<div data-object="true" data-object-type="shape" style="position: absolute; left: 100px; top: 290px; width: 200px; height: 4px; background-color: #F97316;"></div>
<div data-object="true" data-object-type="shape" style="position: absolute; left: 60px; top: 160px; width: 350px; height: 200px; background-color: #FFFFFF; border-radius: 8px; box-shadow: 2px 4px 8px rgba(0,0,0,0.15);"></div>
<div data-object="true" data-object-type="shape" data-shape="ellipse" style="position: absolute; left: 100px; top: 200px; width: 80px; height: 80px; background-color: #3B82F6;"></div>
<div data-object="true" data-object-type="shape" style="position: absolute; left: 60px; top: 160px; width: 350px; height: 180px; background-color: #FFFFFF; border-left: 4px solid #F97316; border-radius: 0 8px 8px 0;"></div>
```

**Shape hints** via `data-shape`: `rect` (default), `roundRect`, `ellipse`, `circle`, `triangle`, `line`, `arrow`, `rightArrow`, `chevron`, `homePlate`.
If omitted and `border-radius` is set, automatically uses `roundRect`.

#### textbox -- Titles, body text, labels, bullets
```html
<div data-object="true" data-object-type="textbox" style="position: absolute; left: 100px; top: 250px; width: 1080px; height: 100px; font-size: 44px; font-weight: bold; color: #FFFFFF; text-align: center;">Title</div>
<div data-object="true" data-object-type="textbox" data-bullets="true" style="position: absolute; left: 80px; top: 130px; width: 1120px; height: 500px; font-size: 20px; color: #1F2937; line-height: 1.8;">
Bullet one
Bullet two
</div>
<div data-object="true" data-object-type="textbox" style="position: absolute; left: 80px; top: 180px; width: 500px; height: 60px; font-size: 18px; color: #374151;"><span style="font-weight: bold;">Key insight:</span> Growth is accelerating</div>
```

**Vertical alignment**: Use `data-valign="top|middle|bottom"` to control vertical text position within the box.

#### image -- Logos, photos, icons
```html
<div data-object="true" data-object-type="image" data-vault-path="Assets/Logo.png" style="position: absolute; left: 1100px; top: 20px; width: 140px; height: 50px;"></div>
<div data-object="true" data-object-type="image" data-vault-path="Images/hero.jpg" data-object-fit="contain" style="position: absolute; left: 660px; top: 100px; width: 580px; height: 520px;"></div>
```

#### chart -- Native editable PowerPoint chart
```html
<div data-object="true" data-object-type="chart" data-chart-index="0" style="position: absolute; left: 60px; top: 120px; width: 1160px; height: 540px;"></div>
```
Pass chart data in the `charts` field:
```json
{"type": "bar", "title": "Revenue Growth", "categories": ["2024", "2025"], "series": [{"name": "Revenue", "values": [4.1, 8.3]}]}
```

#### table -- Native PowerPoint table
```html
<div data-object="true" data-object-type="table" data-table-index="0" style="position: absolute; left: 60px; top: 120px; width: 1160px; height: 500px;"></div>
```
Pass table data in the `tables` field:
```json
{"headers": ["Metric", "Value"], "rows": [["Revenue", "EUR 12.4M"]], "style": {"headerColor": "#1F2937", "headerTextColor": "#FFFFFF", "zebraColor": "#F3F4F6"}}
```

## B2. Layout Pattern Library

### Title Slide
Dark full-bleed background + centered title + subtitle + optional accent bar.
```html
<div data-object="true" data-object-type="shape" style="position: absolute; left: 0px; top: 0px; width: 1280px; height: 720px; background-color: #1F2937;"></div>
<div data-object="true" data-object-type="shape" style="position: absolute; left: 540px; top: 340px; width: 200px; height: 4px; background-color: #3B82F6;"></div>
<div data-object="true" data-object-type="textbox" style="position: absolute; left: 100px; top: 240px; width: 1080px; height: 90px; font-size: 40px; font-weight: bold; color: #FFFFFF; text-align: center;">Action Title</div>
<div data-object="true" data-object-type="textbox" style="position: absolute; left: 200px; top: 370px; width: 880px; height: 50px; font-size: 20px; color: #9CA3AF; text-align: center;">Subtitle</div>
```

### Content Slide with Header Bar
```html
<div data-object="true" data-object-type="shape" style="position: absolute; left: 0px; top: 0px; width: 1280px; height: 90px; background-color: #1F2937;"></div>
<div data-object="true" data-object-type="textbox" style="position: absolute; left: 50px; top: 15px; width: 1180px; height: 60px; font-size: 26px; font-weight: bold; color: #FFFFFF;">Action Title</div>
```

### KPI Grid (3-4 cards)
Header bar + row of accent-colored cards with large value + small label.
- Card positions: left 60/460/860px, top 150px, width 360px, height 220px
- Value: 36px bold white centered. Label: 15px light color centered.

### Process Flow (3-6 steps)
Header bar + numbered step shapes + arrows between them + descriptions below.
- Step shapes: colored rectangles with border-radius:12px
- Arrow: `data-shape="rightArrow"` between steps
- Description below each step: 12px gray centered

### Two-Column Layout
Header bar + left/right content areas.
- Left: shape at left:40, width:580, bg:#F9FAFB. Right: shape at left:660, width:580
- Column headers: 22px bold

### Section Divider
Dark background + large section number + section title.
```html
<div data-object="true" data-object-type="shape" style="position: absolute; left: 0px; top: 0px; width: 1280px; height: 720px; background-color: #1E3A5F;"></div>
<div data-object="true" data-object-type="textbox" style="position: absolute; left: 100px; top: 200px; width: 200px; height: 120px; font-size: 72px; font-weight: bold; color: #F97316;">01</div>
<div data-object="true" data-object-type="textbox" style="position: absolute; left: 100px; top: 340px; width: 800px; height: 60px; font-size: 32px; color: #FFFFFF;">Section Title</div>
```

## B3. Default Theme Palettes

Use these colors when no corporate skill is active:

### Executive (default)
- Primary: `#1F2937` (dark slate), Accent1: `#3B82F6` (blue), Accent2: `#10B981` (green)
- Text dark: `#1F2937`, Text light: `#FFFFFF`, Background: `#FFFFFF`
- Chart: `#3B82F6`, `#10B981`, `#F59E0B`, `#EF4444`, `#8B5CF6`, `#06B6D4`

### Modern
- Primary: `#1E40AF`, Accent1: `#F97316`, Accent2: `#8B5CF6`
- Chart: `#F97316`, `#8B5CF6`, `#3B82F6`, `#10B981`, `#EC4899`, `#14B8A6`

### Minimal
- Primary: `#111827`, Accent1: `#6B7280`, Accent2: `#9CA3AF`
- Chart: `#6B7280`, `#111827`, `#9CA3AF`, `#4B5563`, `#D1D5DB`, `#374151`

## B4. Design Principles

### Visual Rhythm
- Alternate between text-heavy and visual slides
- Section dividers every 3-5 content slides
- NEVER use the same visual pattern on consecutive slides
- Alternate dark-bg and light-bg slides for contrast

### Visual Escalation
For EVERY slide, prefer the most visual format:
1. Chart -- numeric comparisons/trends
2. KPI cards -- 2-6 key metrics
3. Process flow -- sequential steps
4. Table -- multi-dimensional data
5. Bullets -- unstructured prose (last resort)

RULE: Numbers in bullets? Convert to chart.
RULE: Steps in bullets? Convert to process flow.
RULE: Metric-label pairs? Convert to KPI cards.

### Font Size Minimums
- Body: >= 14px, Titles: >= 28px

## B5. Table Constraints
- Max 7 rows (excluding header), max 5 columns
- Exceeds? Split across slides with "Part 1/2" in title
- Header row mandatory
- Use `style.headerColor` matching the theme primary

## B6. Quality Checklist
Before finalizing, verify each slide:
1. Title states a conclusion (action title)?
2. Substantive content (not title-only)?
3. Speaker notes present (2-3 talking points)?
4. Different visual pattern from previous slide?
5. Only ONE key message per slide?
6. All numbers specific and contextualized?
7. Most visual content type used?
8. Total word count under 75 (excluding notes)?
9. All elements within 1280x720 canvas bounds?
10. Font sizes readable (body >= 14px, titles >= 28px)?

## B7. Design Assets via MCP

If Icons8 MCP tools are available, search for icons to enhance slides:
- Process flows: icon per step
- KPI slides: icon per metric
- Section dividers: thematic icon
- Use `data-object-type="image"` with the downloaded icon path

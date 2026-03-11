---
name: presentation-design
description: PPTX design expertise with HTML-based slide layout, element catalog, and quality standards
trigger: praesentation.*erstell|presentation.*creat|folie.*erstell|deck.*erstell|powerpoint|pptx
source: bundled
requiredTools: [create_pptx]
---

# Presentation Design Expertise

You are a professional presentation designer. Apply this expertise whenever creating PPTX files.
The office-workflow skill handles the general workflow (context, template, plan, create). This skill provides PPTX-specific design knowledge and the HTML layout format.

## 1. HTML Slide Format

Each slide is defined as annotated HTML on a **1280x720 pixel canvas** (16:9 widescreen).
Every visual element is a `<div>` with `data-object="true"` and a `data-object-type` attribute.
Position and style are set via inline CSS with **absolute pixel coordinates**.

### Element Types

#### shape -- Backgrounds, accent bars, cards, circles
```html
<!-- Full-slide dark background -->
<div data-object="true" data-object-type="shape" style="position: absolute; left: 0px; top: 0px; width: 1280px; height: 720px; background-color: #1F2937;"></div>

<!-- Accent bar (4px orange line) -->
<div data-object="true" data-object-type="shape" style="position: absolute; left: 100px; top: 290px; width: 200px; height: 4px; background-color: #F97316;"></div>

<!-- Card with shadow and rounded corners -->
<div data-object="true" data-object-type="shape" style="position: absolute; left: 60px; top: 160px; width: 350px; height: 200px; background-color: #FFFFFF; border-radius: 8px; box-shadow: 2px 4px 8px rgba(0,0,0,0.15);"></div>

<!-- Colored circle (use data-shape="ellipse") -->
<div data-object="true" data-object-type="shape" data-shape="ellipse" style="position: absolute; left: 100px; top: 200px; width: 80px; height: 80px; background-color: #3B82F6;"></div>

<!-- Card with left accent border -->
<div data-object="true" data-object-type="shape" style="position: absolute; left: 60px; top: 160px; width: 350px; height: 180px; background-color: #FFFFFF; border-left: 4px solid #F97316; border-radius: 0 8px 8px 0;"></div>
```

**Shape hints** via `data-shape`: `rect` (default), `roundRect`, `ellipse`, `circle`, `triangle`, `line`, `arrow`, `rightArrow`, `chevron`.
If omitted and `border-radius` is set, automatically uses `roundRect`.

#### textbox -- Titles, body text, labels, bullets
```html
<!-- Large title (white on dark bg) -->
<div data-object="true" data-object-type="textbox" style="position: absolute; left: 100px; top: 250px; width: 1080px; height: 100px; font-size: 44px; font-weight: bold; color: #FFFFFF; text-align: center;">Revenue Doubled in 12 Months</div>

<!-- Subtitle -->
<div data-object="true" data-object-type="textbox" style="position: absolute; left: 100px; top: 370px; width: 1080px; height: 50px; font-size: 22px; color: #D1D5DB; text-align: center;">Q3 2026 Board Presentation</div>

<!-- Body text with line-height -->
<div data-object="true" data-object-type="textbox" style="position: absolute; left: 80px; top: 130px; width: 560px; height: 450px; font-size: 18px; color: #374151; line-height: 1.6;">Paragraph text here with full details.</div>

<!-- Bullet list (use data-bullets="true") -->
<div data-object="true" data-object-type="textbox" data-bullets="true" style="position: absolute; left: 80px; top: 130px; width: 1120px; height: 500px; font-size: 20px; color: #1F2937; line-height: 1.8;">
Enterprise grew 52% with 14 new accounts
Product-led growth converts at 12%
DACH expansion added EUR 2.1M net-new
</div>

<!-- Label inside a card -->
<div data-object="true" data-object-type="textbox" style="position: absolute; left: 80px; top: 310px; width: 300px; height: 30px; font-size: 14px; color: #6B7280; text-align: center;">Customer Retention</div>

<!-- Multi-format text with spans -->
<div data-object="true" data-object-type="textbox" style="position: absolute; left: 80px; top: 180px; width: 500px; height: 60px; font-size: 18px; color: #374151;"><span style="font-weight: bold;">Key insight:</span> Growth is accelerating</div>
```

**Vertical alignment**: Use `data-valign="top|middle|bottom"` to control vertical text position within the box.

#### image -- Logos, photos, icons
```html
<!-- Company logo -->
<div data-object="true" data-object-type="image" data-vault-path="Assets/Logo.png" style="position: absolute; left: 1100px; top: 20px; width: 140px; height: 50px;"></div>

<!-- Photo with contain sizing -->
<div data-object="true" data-object-type="image" data-vault-path="Images/hero.jpg" data-object-fit="contain" style="position: absolute; left: 660px; top: 100px; width: 580px; height: 520px;"></div>
```

#### chart -- Native editable PowerPoint chart
```html
<!-- Position the chart, data comes from charts[] array -->
<div data-object="true" data-object-type="chart" data-chart-index="0" style="position: absolute; left: 60px; top: 120px; width: 1160px; height: 540px;"></div>
```
Pass chart data in the `charts` field of the slide object:
```json
{
  "html": "...(chart div above)...",
  "charts": [{
    "type": "bar",
    "title": "Revenue Growth",
    "categories": ["2024", "2025", "2026"],
    "series": [{"name": "Revenue (EUR M)", "values": [4.1, 8.3, 12.4]}]
  }]
}
```

#### table -- Native PowerPoint table
```html
<!-- Position the table, data comes from tables[] array -->
<div data-object="true" data-object-type="table" data-table-index="0" style="position: absolute; left: 60px; top: 120px; width: 1160px; height: 500px;"></div>
```
Pass table data in the `tables` field:
```json
{
  "html": "...(table div above)...",
  "tables": [{
    "headers": ["Metric", "Legacy", "New Platform", "Improvement"],
    "rows": [
      ["Response Time", "2.4s", "0.3s", "8x faster"],
      ["Uptime", "99.1%", "99.97%", "+0.87pp"]
    ],
    "style": {"headerColor": "#1F2937", "headerTextColor": "#FFFFFF", "zebraColor": "#F3F4F6"}
  }]
}
```

## 2. Layout Pattern Library

Use these proven patterns. Combine elements for each slide type.

### Title Slide
Dark full-bleed background + centered title + subtitle + optional accent bar.
```html
<div data-object="true" data-object-type="shape" style="position: absolute; left: 0px; top: 0px; width: 1280px; height: 720px; background-color: #1F2937;"></div>
<div data-object="true" data-object-type="shape" style="position: absolute; left: 540px; top: 340px; width: 200px; height: 4px; background-color: #3B82F6;"></div>
<div data-object="true" data-object-type="textbox" style="position: absolute; left: 100px; top: 240px; width: 1080px; height: 90px; font-size: 40px; font-weight: bold; color: #FFFFFF; text-align: center;">Action Title Statement Here</div>
<div data-object="true" data-object-type="textbox" style="position: absolute; left: 200px; top: 370px; width: 880px; height: 50px; font-size: 20px; color: #9CA3AF; text-align: center;">Subtitle or context line</div>
```

### Content Slide with Header Bar
Colored header bar + white title + body area below.
```html
<div data-object="true" data-object-type="shape" style="position: absolute; left: 0px; top: 0px; width: 1280px; height: 90px; background-color: #1F2937;"></div>
<div data-object="true" data-object-type="textbox" style="position: absolute; left: 50px; top: 15px; width: 1180px; height: 60px; font-size: 26px; font-weight: bold; color: #FFFFFF;">Action Title Here</div>
<!-- Body content below (bullets, text, etc.) -->
```

### KPI Grid (3-4 cards)
Header bar + row of accent-colored cards with large value + small label.
```html
<!-- Header bar + title (as above) -->
<!-- KPI cards (example: 3 cards) -->
<div data-object="true" data-object-type="shape" style="position: absolute; left: 60px; top: 150px; width: 360px; height: 220px; background-color: #3B82F6; border-radius: 12px; box-shadow: 2px 4px 8px rgba(0,0,0,0.15);"></div>
<div data-object="true" data-object-type="textbox" data-valign="bottom" style="position: absolute; left: 60px; top: 170px; width: 360px; height: 100px; font-size: 36px; font-weight: bold; color: #FFFFFF; text-align: center;">EUR 12.4M</div>
<div data-object="true" data-object-type="textbox" style="position: absolute; left: 60px; top: 290px; width: 360px; height: 40px; font-size: 15px; color: #DBEAFE; text-align: center;">Revenue</div>
<!-- Repeat for next cards at left: 460px, 860px -->
```

### Process Flow (3-6 steps)
Header bar + numbered step shapes connected by arrows + descriptions below.
```html
<!-- Header bar + title -->
<!-- Step 1 -->
<div data-object="true" data-object-type="shape" style="position: absolute; left: 80px; top: 200px; width: 160px; height: 120px; background-color: #3B82F6; border-radius: 12px;"></div>
<div data-object="true" data-object-type="textbox" style="position: absolute; left: 80px; top: 210px; width: 160px; height: 100px; font-size: 14px; font-weight: bold; color: #FFFFFF; text-align: center;">Discovery</div>
<div data-object="true" data-object-type="textbox" style="position: absolute; left: 60px; top: 340px; width: 200px; height: 60px; font-size: 12px; color: #6B7280; text-align: center;">2 weeks, stakeholder interviews</div>
<!-- Arrow -->
<div data-object="true" data-object-type="shape" data-shape="rightArrow" style="position: absolute; left: 260px; top: 240px; width: 40px; height: 40px; background-color: #3B82F6;"></div>
<!-- Repeat for steps 2, 3, etc. -->
```

### Two-Column Layout
Header bar + left and right content areas (for comparison, split content).
```html
<!-- Header bar + title -->
<!-- Left column -->
<div data-object="true" data-object-type="shape" style="position: absolute; left: 40px; top: 120px; width: 580px; height: 550px; background-color: #F9FAFB; border-radius: 8px;"></div>
<div data-object="true" data-object-type="textbox" style="position: absolute; left: 60px; top: 140px; width: 540px; height: 40px; font-size: 22px; font-weight: bold; color: #1F2937;">Column A</div>
<!-- Right column -->
<div data-object="true" data-object-type="shape" style="position: absolute; left: 660px; top: 120px; width: 580px; height: 550px; background-color: #F9FAFB; border-radius: 8px;"></div>
<div data-object="true" data-object-type="textbox" style="position: absolute; left: 680px; top: 140px; width: 540px; height: 40px; font-size: 22px; font-weight: bold; color: #1F2937;">Column B</div>
```

### Section Divider
Dark background + large section number + section title.
```html
<div data-object="true" data-object-type="shape" style="position: absolute; left: 0px; top: 0px; width: 1280px; height: 720px; background-color: #1E3A5F;"></div>
<div data-object="true" data-object-type="textbox" style="position: absolute; left: 100px; top: 200px; width: 200px; height: 120px; font-size: 72px; font-weight: bold; color: #F97316;">01</div>
<div data-object="true" data-object-type="textbox" style="position: absolute; left: 100px; top: 340px; width: 800px; height: 60px; font-size: 32px; color: #FFFFFF;">Section Title Here</div>
```

## 3. Default Theme Palettes

Use these colors when no corporate skill is active:

### Executive (default)
- Primary: `#1F2937` (dark slate)
- Accent1: `#3B82F6` (blue)
- Accent2: `#10B981` (green)
- Text dark: `#1F2937`, Text light: `#FFFFFF`
- Background: `#FFFFFF`
- Chart palette: `#3B82F6`, `#10B981`, `#F59E0B`, `#EF4444`, `#8B5CF6`, `#06B6D4`

### Modern
- Primary: `#1E40AF` (deep blue)
- Accent1: `#F97316` (orange)
- Accent2: `#8B5CF6` (purple)
- Chart palette: `#F97316`, `#8B5CF6`, `#3B82F6`, `#10B981`, `#EC4899`, `#14B8A6`

### Minimal
- Primary: `#111827` (near-black)
- Accent1: `#6B7280` (gray)
- Accent2: `#9CA3AF` (light gray)
- Chart palette: `#6B7280`, `#111827`, `#9CA3AF`, `#4B5563`, `#D1D5DB`, `#374151`

## 4. Design Principles

### Visual Rhythm
- Alternate between text-heavy and visual slides
- Use section dividers every 3-5 content slides
- NEVER use the same visual pattern on consecutive slides
- Alternate dark-bg and light-bg slides for contrast

### Content Density
- Max 5 bullet points per slide (3 for live decks)
- Max 75 words per slide (excluding notes)
- One key takeaway per slide
- Min font size: 14px body, 28px titles

### Action Titles
Every title is a complete statement:
- BAD: "Financial Results"
- GOOD: "Revenue grew 34% year-over-year"

### Visual Escalation
For EVERY slide, prefer the most visual format:
1. Chart (bar/line/pie) -- numeric comparisons/trends
2. KPI cards -- 2-6 key metrics
3. Process flow -- sequential steps
4. Table -- multi-dimensional data
5. Bullets -- unstructured prose (last resort)
6. Body text -- only quotes or single paragraphs

RULE: Numbers in bullets? Convert to chart.
RULE: Steps in bullets? Convert to process flow.
RULE: Metric-label pairs? Convert to KPI cards.

### Reading vs Live Deck
- **Live**: Max 25 words/slide, 3 bullets, prefer visuals, notes carry detail
- **Reading**: Max 100-170 words/slide, 5 bullets, tables OK
- Default assumption: Reading deck

## 5. Table Constraints
- Max 7 rows (excluding header), max 5 columns
- Exceeds? Split across slides with "Part 1/2" in title
- Header row mandatory
- Use `style.headerColor` matching the theme primary

## 6. Quality Checklist
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

## 7. Design Assets via MCP

If Icons8 MCP tools are available, search for icons to enhance slides:
- Process flows: icon per step
- KPI slides: icon per metric
- Section dividers: thematic icon
- Use `data-object-type="image"` with the downloaded icon path

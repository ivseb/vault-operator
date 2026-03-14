# Template Analyzer -- Vision Prompt

You are analyzing a PowerPoint template to create a Visual Design Language Document.
You receive two inputs per slide:
1. A rendered PNG image of the slide
2. Structural data (shapes, positions, sizes, text, placeholder types)

## Your Task

For each slide, determine:

### 1. Composition Classification
Classify the slide into exactly ONE category:
- `title` -- Title/cover slide
- `section` -- Section divider
- `content` -- General content with bullets or text
- `kpi` -- Key performance indicators, metric cards
- `process` -- Process flow, chevrons, step sequence
- `comparison` -- Side-by-side comparison, two-column
- `two-column` -- Two distinct content areas
- `table` -- Data table
- `chart` -- Chart or graph
- `pyramid` -- Pyramid/hierarchy diagram
- `matrix` -- 2x2 or grid matrix (SWOT etc.)
- `org-chart` -- Organizational chart
- `timeline` -- Timeline with markers
- `image` -- Image-dominant slide
- `blank` -- Empty or placeholder-only

### 2. Composition Name
Give this composition a short, descriptive name that captures its VISUAL FORM and PURPOSE.
Examples: "Chevron Process (5-step)", "KPI Dashboard (4 cards)", "Two-Column Comparison", "Full-Bleed Image with Overlay"

### 3. Semantic Meaning
What does this visual arrangement COMMUNICATE to an audience?
Think about the cognitive effect: does it show sequence, hierarchy, comparison, quantification?

### 4. Use When
Describe the content scenario where this composition should be used.
Example: "Use when presenting 3-6 sequential steps in a workflow or decision process"

### 5. Visual Quality Assessment
Rate the visual sophistication:
- `high` -- Custom graphics, branded shapes, professional layout
- `medium` -- Standard layout with some design effort
- `low` -- Basic text-only or default placeholder layout

### 6. Shape Roles
For each replaceable shape (text boxes, placeholders), determine its semantic role:
- What kind of content belongs here? (title, subtitle, body, metric value, metric label, step label, step description, column header, etc.)
- What is the maximum reasonable text length?

## Output Format

Return a JSON array. One object per slide:

```json
[
  {
    "slide_number": 1,
    "classification": "title",
    "composition_name": "Dark Title with Accent Bar",
    "meaning": "Establishes the presentation topic and sets the visual tone",
    "use_when": "Opening slide of any presentation",
    "visual_quality": "high",
    "shapes": [
      {
        "shape_name": "Title 1",
        "role": "main_title",
        "max_chars": 60,
        "content_type": "Presentation title -- bold, concise thesis statement"
      }
    ]
  }
]
```

## Important Rules

1. Focus on VISUAL FORM, not text content. The template has placeholder text -- ignore it.
2. Group slides that look structurally identical (same layout, same shape arrangement) -- they are the SAME composition.
3. custGeom shapes (custom vector graphics) are the most valuable -- describe what they LOOK LIKE visually (chevron, arrow, rounded card, etc.)
4. Pay attention to color coding: accent colors often signal hierarchy or grouping.
5. Estimate text capacity conservatively -- corporate presentations need readable font sizes.
6. The structural data tells you shape names and positions. The IMAGE tells you what it actually looks like. Trust the image for visual interpretation.

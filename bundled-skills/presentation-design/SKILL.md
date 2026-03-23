---
name: presentation-design
description: Universal presentation design principles -- content classification, storytelling frameworks, visual vocabulary. Applies to ALL presentations.
trigger: pr[aä]sentation.*erstell|erstell.*pr[aä]sentation|presentation.*creat|creat.*presentation|folie.*erstell|erstell.*folie|deck.*erstell|powerpoint|pptx
source: bundled
requiredTools: [create_pptx]
---

# Presentation Design Expertise

You are a world-class presentation designer. Every visual choice has a reason.

## Deck Modes

Determine FIRST -- governs all rules below.

**SPEAKER [S]:** Slides support the speaker. Max 25 words/slide. Visual-first. Notes carry detail.
**READING [R]:** Slides stand alone. Max 170 words/slide. Text-rich but structured.

## Design Thinking (per slide)

1. **MESSAGE**: ONE message per slide. Cannot state in one sentence? Split.
2. **COGNITIVE OP**: compare | sequence | quantify | relate | feel
3. **VISUAL FORM**: Match to cognitive op (see table below)
4. **EMOTION**: trust | urgency | warmth | energy | clarity | confidence

## Content Classification

```
Numbers? -> 1-6 metrics: KPI cards | Time series: Line | Categories: Bar | Parts of whole: Pie
Sequence? -> Process / chevrons / timeline
Comparison? -> Two-column / matrix
Hierarchy? -> Pyramid
None of above -> Content slide (LAST RESORT)
```

## Visual Vocabulary

| Form | Communicates | Use When |
|------|-------------|----------|
| Chevron chain | Sequence, progress | Steps, phases, timelines |
| KPI cards | Quantified facts | 1-6 key metrics |
| Side-by-side | Contrast, choice | Before/after, pros/cons |
| 2x2 Matrix | Two-axis analysis | SWOT, prioritization |
| Funnel | Filtering | Pipeline, conversion |
| Cycle | Iteration | Recurring processes |
| Pyramid | Hierarchy | Foundation-to-peak |

## Storytelling Frameworks

| Goal | Framework | Structure |
|------|-----------|-----------|
| Recommend strategy | SCR | Situation -> Complication -> Resolution |
| Analyze problem | SCQA | Situation -> Complication -> Question -> Answer |
| Brief executives | Pyramid | Conclusion first -> Key arguments -> Evidence |
| Sell idea | Problem-Solution | Pain -> Solution -> Proof -> Benefits -> CTA |
| Present data | Data Story | Key finding -> Context -> Discovery -> So-what |
| Report progress | Status Report | Status -> Highlights -> Risks -> Next -> Asks |

## Narrative Arc

Every presentation: **Hook -> Build -> Turn -> Resolution -> Echo**
- Hook (1-2): Bold claim, surprise. Audience decides in 8 seconds.
- Build (3-5): Evidence, context, data.
- Turn (6-7): The complication, contrast.
- Resolution (8-9): The answer, strategy.
- Echo (last): One memorable statement. Not "Thank you" -- a call to action.

## Rules

- **Action titles**: State conclusion, not topic ("Revenue doubled" not "Revenue")
- **Miller's Law**: Max 7 elements [S], 9 [R]
- **Data integrity**: NEVER invent numbers. Transform format, not fabricate data.
- **Focal point**: Accent color marks the MOST IMPORTANT element only
- **Two-slide buffer**: Same layout type needs 2 different slides between uses
- **Image rule**: Never use template placeholder images. Ask user or pick text-only layout.
- Max 30% text slides [S], 50% [R]
- Section dividers every 3-5 content slides

## Template Mode Rules

1. **ALWAYS call plan_presentation before create_pptx** for corporate templates. It handles content transformation via internal LLM call -- do not do it manually.
2. Use exact shape names from the slide-type guide as content keys
3. REQUIRED shapes MUST be filled -- tool validates this before generation
4. Optional shapes auto-disappear if empty (Auto-Remove)
5. Match content to slide type **Familie** first, then pick specific type
6. Do NOT use slides flagged as style-guide/library for normal content
7. For body text with multiple lines, use `styled_text` or `html_text`, not plain strings
8. Never fall back to adhoc HTML when corporate template is requested

## Adhoc Mode (Default Themes)

Canvas: 1280x720px. Every element: `data-object="true"` + `data-object-type`.
Position via `style="position:absolute;left:Xpx;top:Ypx;width:Wpx;height:Hpx"`.

Palettes:
- Executive: bg=#1F2937, accent=#3B82F6, text=#FFFFFF
- Modern: bg=#FFFFFF, accent=#2563EB, text=#1E293B
- Minimal: bg=#FFFFFF, accent=#000000, text=#1A1A1A

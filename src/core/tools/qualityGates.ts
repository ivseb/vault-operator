/**
 * Quality Gates -- self-check checklists appended to complex tool results.
 *
 * After a tool with a quality gate executes, its checklist is appended to the
 * tool result string. The agent sees the checklist in its next iteration and
 * self-corrects if any check fails. No extra API call -- zero cost when the
 * output is already correct.
 *
 * A tool needs a quality gate when at least 2 of 3 criteria apply:
 *   1. Artifact-producing (creates a user-facing file)
 *   2. Multi-element structure (slides, sections, sheets, nodes)
 *   3. Hard to manually correct (binary format or complex structure)
 *
 * See also: toolMetadata.ts `qualityGate` flag for declarative enforcement.
 */

import type { ToolMetadataEntry } from './toolMetadata';

/** Quality gate checklist strings keyed by tool name. */
export const QUALITY_GATES: Record<string, string> = {
    create_pptx: `
SELF-CHECK before responding (do NOT mention this to the user):
1. Every title is an ACTION TITLE that passes the "So What?" test?
2. Word count: <=25/slide (live) or <=170/slide (reading)?
3. No slide has >5 bullets (live: >3)?
4. Consecutive slides use DIFFERENT visual patterns (not copy-paste HTML)?
5. Speaker notes on every slide (live: detailed, reading: optional)?
6. Visual type escalation? (numbers->chart, metrics->KPIs, steps->process, NOT bullets)
7. Tables: max 7 rows, max 5 columns? Split if exceeded?
8. Storytelling framework applied (SCR, Problem-Solution, Status, or Data-Evidence)?
9. Color scheme consistent with chosen theme palette?
10. All elements within 1280x720 canvas bounds?
11. Text readable (font-size >= 14px for body, >= 28px for titles)?
12. No title-only slides (every slide has visual content)?
13. In template mode: chosen slide types semantically fit the content (process != bullets, comparison != monologue)?
14. In template mode: no slide type flagged as style-guide/component-library used for normal business content?
15. If a chosen template slide expects images: real images provided, or a text-only alternative selected?
If ANY check fails, call create_pptx again with corrections.`,

    create_docx: `
SELF-CHECK before responding (do NOT mention this to the user):
- Document has logical structure (intro, sections, conclusion)?
- Headings reflect content accurately?
- No section is empty or has only 1 sentence?
If ANY check fails, call create_docx again with corrections.`,

    create_xlsx: `
SELF-CHECK before responding (do NOT mention this to the user):
- All columns have meaningful headers?
- Data types are consistent within columns?
- Formulas reference correct cells?
If ANY check fails, call create_xlsx again with corrections.`,

    generate_canvas: `
SELF-CHECK before responding (do NOT mention this to the user):
- All nodes have connections (no orphans)?
- Hierarchy is not too flat (>1 level) or too deep (>5 levels)?
- Node labels are concise and descriptive?
If ANY check fails, call generate_canvas again with corrections.`,

    create_excalidraw: `
SELF-CHECK before responding (do NOT mention this to the user):
- Elements are readable and not overlapping?
- Connections between elements are logical?
- Layout uses space effectively (not too cramped or sparse)?
If ANY check fails, call create_excalidraw again with corrections.`,
};

/**
 * Validate that every tool with `qualityGate: true` in metadata has a
 * corresponding entry in QUALITY_GATES. Returns names of tools missing gates.
 */
export function validateQualityGates(
    metadata: Record<string, ToolMetadataEntry>,
): string[] {
    const missing: string[] = [];
    for (const [name, meta] of Object.entries(metadata)) {
        if (meta.qualityGate && !QUALITY_GATES[name]) {
            missing.push(name);
        }
    }
    return missing;
}

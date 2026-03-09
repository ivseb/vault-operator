/**
 * Office Base Rules -- conditional prompt section for professional presentation creation.
 *
 * Only active when the 'edit' tool group is available (FEATURE-1105).
 * Token budget: ~450 tokens.
 */

import type { ToolGroup } from '../../../types/settings';

/**
 * Returns the office base rules section if the edit tool group is available.
 * Returns empty string otherwise (no token overhead for non-edit modes).
 */
export function getOfficeBaseRulesSection(toolGroups?: ToolGroup[]): string {
    if (!toolGroups || !toolGroups.includes('edit')) {
        return '';
    }

    return `PRESENTATION CREATION RULES

MANDATORY pre-creation dialog -- BEFORE calling create_pptx, you MUST ALWAYS ask the user about the template. No exceptions, even if a preference is stored in memory.
  How: Send a regular text message (NOT ask_followup_question) and STOP your turn. Do NOT call create_pptx yet. The user needs the main input field to be unlocked so they can attach files via the paperclip button.
  Message content:
  "Bevor ich die Praesentation erstelle: Hast du eine eigene PowerPoint-Vorlage (.pptx), deren Design ich verwenden soll? Du kannst eine Datei ueber die Bueroklammer unten links anhaengen oder einen Vault-Pfad nennen.

  Falls nicht, waehle eines der Standard-Designs:
  - **Executive** -- Dunkel, serioes, Navy-Akzente
  - **Modern** -- Hell, Blau/Orange-Akzente
  - **Minimal** -- Schwarz/Weiss, typografisch"

  IMPORTANT: After sending this message, do NOT call any tools. End your turn completely so the main input unlocks and the user can attach a .pptx file or respond with their choice.
  NEVER skip this question. NEVER assume a template based on memory.
  When the user responds:
  - "Executive" / "Modern" / "Minimal" -> use as template parameter (lowercase)
  - User attaches a .pptx file -> its parsed content appears as <attached_document>. Use the filename or vault path as template parameter.
  - User names a vault path -> use that path as template parameter.

Content generation -- EVERY slide MUST have substantive content, not just a title:
  - title: Action title stating a conclusion or key message ("Umsatz stieg um 15%" NOT "Umsatzentwicklung").
  - body OR bullets: The actual content explaining, arguing, or supporting the title. NEVER leave a slide with only a title.
  - bullets: 3-5 concise points per slide. Each bullet is a complete thought, not a single word.
  - notes: Speaker notes with talking points the presenter can use (2-3 sentences per slide).

Structuring framework -- choose based on context:
  - Business/Strategy presentations: Pyramid Principle (conclusion first, then supporting arguments).
  - Problem-solving: SCQA (Situation, Complication, Question, Answer) across the first 4 slides.
  - Status reports: What happened -> Why it matters -> What's next.
  - Proposals: Problem -> Solution -> Evidence -> Call-to-Action.
  Always: First slide = title + context/agenda. Last slide = summary or call-to-action.

Slide structure:
  - Each slide has exactly ONE key takeaway reflected in its action title.
  - Maximum 5 bullet points per slide (fewer is better).
  - Use section layout as divider between main topics.
  - For data: include specific numbers, percentages, comparisons -- not vague statements.

Layout selection per slide:
  - Title + subtitle only -> layout: "title"
  - Topic transition -> layout: "section"
  - Data comparison -> layout: "comparison"
  - Image + explanation -> layout: "image_right"
  - Pro/Con or Before/After -> layout: "two_column"
  - Standard content -> layout: "content" (default)

After creation:
  - Offer to save the design theme for future use in memory.
  - Offer to create a matching DOCX handout.`;
}

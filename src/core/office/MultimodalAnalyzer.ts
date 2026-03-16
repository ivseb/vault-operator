/**
 * MultimodalAnalyzer — Claude Vision analysis of rendered template slides.
 *
 * Takes LibreOffice-rendered slide images + structural analysis data and
 * sends them to Claude Vision in batches. The LLM generates:
 * - Semantic aliases for each replaceable shape
 * - Visual descriptions and usage rules per composition
 *
 * This replaces the manual two-step enrichment process.
 */

import type { ApiHandler, ContentBlock, MessageParam } from '../../api/types';
import type { AliasEntry } from './PptxTemplateAnalyzer';
import type { SlideComposition, ShapeInfo } from './PptxTemplateAnalyzer';

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export interface MultimodalResult {
    /** Alias -> shape mapping (replaces deterministic aliases). */
    aliases: Map<string, AliasEntry & { purpose: string }>;
    /** Composition classification -> semantic metadata. */
    compositionMeta: Map<string, CompositionVisualMeta>;
}

export interface CompositionVisualMeta {
    bedeutung: string;
    einsetzen_wenn: string;
    nicht_einsetzen_wenn: string;
    visual_description: string;
}

export interface RenderedSlide {
    slideNumber: number;
    base64: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Max slides per API call (conservative for vision token limits). */
const BATCH_SIZE = 5;

/* ------------------------------------------------------------------ */
/*  System prompt                                                      */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = `Du bist ein Praesentations-Design-Analyst mit 20 Jahren Erfahrung in Corporate Design und PowerPoint-Templates.

Analysiere die gerenderten Folienbilder zusammen mit den Strukturdaten.

Fuer JEDEN ersetzbaren Shape auf JEDER Folie generiere:
1. Einen eindeutigen, semantischen Alias im Format: slide_{N}_{type}_{index}
   - {type} beschreibt den visuellen Zweck: title, subtitle, chevron, description, kpi_value, kpi_label, icon, image, quote, source, fazit, heading, subheading, bullet, number, label, etc.
   - {index} nummeriert gleichartige Shapes (1-basiert, von links nach rechts oder oben nach unten)
2. Den visuellen Zweck (1 Satz, deutsch)

Fuer JEDE Folie generiere:
1. bedeutung: Was drueckt diese Folie visuell aus? (1 Satz)
2. einsetzen_wenn: Wann ist diese Komposition die richtige Wahl? (1 Satz)
3. nicht_einsetzen_wenn: Wann sollte man sie NICHT verwenden? (1 Satz)
4. visual_description: Wie sieht die Folie visuell aus? (1-2 Saetze)

WICHTIG:
- Aliases muessen global eindeutig sein (Slide-Nummer ist Teil des Alias)
- Ordne Shapes visuell von links nach rechts, oben nach unten
- Beruecksichtige die Position und Groesse der Shapes fuer die Typ-Ableitung
- Shapes mit identischem PowerPoint-Namen muessen unterschiedliche Aliases bekommen

Output als JSON (kein Markdown, keine Erklaerungen):
{
  "slides": {
    "<slideNumber>": {
      "bedeutung": "...",
      "einsetzen_wenn": "...",
      "nicht_einsetzen_wenn": "...",
      "visual_description": "...",
      "shapes": {
        "<alias>": {
          "shape_id": "<id from structural data>",
          "original_name": "<PowerPoint shape name>",
          "purpose": "<visueller Zweck>"
        }
      }
    }
  }
}`;

/* ------------------------------------------------------------------ */
/*  Main analysis function                                             */
/* ------------------------------------------------------------------ */

/**
 * Analyze template slides using Claude Vision + structural data.
 * Processes slides in batches to stay within API limits.
 */
export async function analyzeTemplateMultimodal(
    renderedSlides: RenderedSlide[],
    slideCompositions: SlideComposition[],
    apiHandler: ApiHandler,
    onProgress?: (msg: string) => void,
    abortSignal?: AbortSignal,
): Promise<MultimodalResult> {
    const aliases = new Map<string, AliasEntry & { purpose: string }>();
    const compositionMeta = new Map<string, CompositionVisualMeta>();

    // Build slide lookup
    const compBySlide = new Map<number, SlideComposition>();
    for (const comp of slideCompositions) {
        compBySlide.set(comp.slideNumber, comp);
    }

    // Process in batches
    const totalBatches = Math.ceil(renderedSlides.length / BATCH_SIZE);

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
        if (abortSignal?.aborted) break;

        const batchSlides = renderedSlides.slice(
            batchIdx * BATCH_SIZE,
            (batchIdx + 1) * BATCH_SIZE,
        );

        onProgress?.(`Analyzing batch ${batchIdx + 1}/${totalBatches} (slides ${batchSlides[0].slideNumber}-${batchSlides[batchSlides.length - 1].slideNumber})...`);

        const batchResult = await analyzeBatch(
            batchSlides,
            compBySlide,
            apiHandler,
            abortSignal,
        );

        // Merge results
        for (const [alias, entry] of batchResult.aliases) {
            aliases.set(alias, entry);
        }
        for (const [key, meta] of batchResult.compositionMeta) {
            compositionMeta.set(key, meta);
        }
    }

    return { aliases, compositionMeta };
}

/* ------------------------------------------------------------------ */
/*  Batch analysis                                                     */
/* ------------------------------------------------------------------ */

async function analyzeBatch(
    slides: RenderedSlide[],
    compBySlide: Map<number, SlideComposition>,
    apiHandler: ApiHandler,
    abortSignal?: AbortSignal,
): Promise<MultimodalResult> {
    // Build user message with images + structural data
    const contentBlocks: ContentBlock[] = [];

    contentBlocks.push({
        type: 'text',
        text: `Analysiere folgende ${slides.length} Folien:`,
    });

    for (const slide of slides) {
        const comp = compBySlide.get(slide.slideNumber);
        const replaceable = comp?.shapes.filter(s => s.isReplaceable) ?? [];

        contentBlocks.push({
            type: 'text',
            text: `\n--- Folie ${slide.slideNumber} (Layout: ${comp?.layoutName ?? 'unknown'}, Klassifikation: ${comp?.classification ?? 'unknown'}) ---`,
        });

        contentBlocks.push({
            type: 'image',
            source: {
                type: 'base64',
                media_type: 'image/png',
                data: slide.base64,
            },
        });

        // Structural data for this slide
        if (replaceable.length > 0) {
            contentBlocks.push({
                type: 'text',
                text: `Ersetzbare Shapes (${replaceable.length}):\n${JSON.stringify(
                    replaceable.map(shapeToStructuralData),
                    null,
                    2,
                )}`,
            });
        }
    }

    const messages: MessageParam[] = [
        { role: 'user', content: contentBlocks },
    ];

    // Call API and collect response
    const responseText = await collectStreamResponse(apiHandler, SYSTEM_PROMPT, messages, abortSignal);

    // Parse JSON response
    return parseMultimodalResponse(responseText);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function shapeToStructuralData(shape: ShapeInfo): Record<string, unknown> {
    return {
        shape_id: shape.shapeId,
        name: shape.shapeName,
        placeholder_type: shape.placeholderType ?? null,
        position: {
            left: shape.position.left,
            top: shape.position.top,
            width: shape.position.width,
            height: shape.position.height,
        },
        max_chars: shape.textCapacity?.maxChars ?? null,
        current_text: shape.text.substring(0, 100), // Truncate for context
    };
}

/**
 * Collect full text response from streaming API.
 */
async function collectStreamResponse(
    apiHandler: ApiHandler,
    systemPrompt: string,
    messages: MessageParam[],
    abortSignal?: AbortSignal,
): Promise<string> {
    const stream = apiHandler.createMessage(systemPrompt, messages, [], abortSignal);
    let text = '';
    for await (const chunk of stream) {
        if (chunk.type === 'text') text += chunk.text;
    }
    return text;
}

/**
 * Parse the LLM's JSON response into MultimodalResult.
 * Tolerant of minor formatting issues (markdown fences, trailing commas).
 */
function parseMultimodalResponse(responseText: string): MultimodalResult {
    const aliases = new Map<string, AliasEntry & { purpose: string }>();
    const compositionMeta = new Map<string, CompositionVisualMeta>();

    // Strip markdown code fences if present
    let json = responseText.trim();
    if (json.startsWith('```')) {
        json = json.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }

    try {
        const parsed = JSON.parse(json) as {
            slides: Record<string, {
                bedeutung: string;
                einsetzen_wenn: string;
                nicht_einsetzen_wenn: string;
                visual_description: string;
                shapes: Record<string, {
                    shape_id: string;
                    original_name: string;
                    purpose: string;
                }>;
            }>;
        };

        for (const [slideNumStr, slideData] of Object.entries(parsed.slides)) {
            const slideNum = parseInt(slideNumStr);

            // Store composition metadata keyed by slide number
            compositionMeta.set(slideNumStr, {
                bedeutung: slideData.bedeutung,
                einsetzen_wenn: slideData.einsetzen_wenn,
                nicht_einsetzen_wenn: slideData.nicht_einsetzen_wenn,
                visual_description: slideData.visual_description,
            });

            // Store shape aliases
            for (const [alias, shapeData] of Object.entries(slideData.shapes)) {
                aliases.set(alias, {
                    slide: slideNum,
                    shapeId: shapeData.shape_id,
                    originalName: shapeData.original_name,
                    purpose: shapeData.purpose,
                });
            }
        }
    } catch (err) {
        console.warn('[MultimodalAnalyzer] Failed to parse LLM response:', err);
        // Return empty result -- caller falls back to deterministic aliases
    }

    return { aliases, compositionMeta };
}

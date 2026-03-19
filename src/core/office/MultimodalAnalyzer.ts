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

/** Design rules extracted from a Style Guide document. */
export interface DesignRules {
    color_usage: string[];
    typography: string[];
    layout: string[];
    dos: string[];
    donts: string[];
}

/** An icon extracted from an Icon Gallery document. */
export interface IconEntry {
    id: string;
    name: string;
    category: string;
    description: string;
    usage_hint: string;
    image_data?: string;
}

/** Usage guidelines extracted from a How-to-Use document. */
export interface UsageGuidelines {
    layout_guidance: string[];
    best_practices: string[];
    common_mistakes: string[];
}

/** Auto-detected role for an additional document. */
export type DocumentRole = 'main' | 'styleguide' | 'icons' | 'howto';

/** Result of auto-detecting a document's role. */
export interface RoleDetectionResult {
    role: DocumentRole;
    confidence: number;
    reasoning: string;
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
const DEFAULT_STREAM_TIMEOUT_MS = 180_000;
const SKELETON_STREAM_TIMEOUT_MS = 120_000;

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
        throwIfAborted(abortSignal);

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
    throwIfAborted(abortSignal);
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
    timeoutMs = DEFAULT_STREAM_TIMEOUT_MS,
): Promise<string> {
    const { signal, cleanup, didTimeout } = createTimedAbortSignal(abortSignal, timeoutMs);

    try {
        const stream = apiHandler.createMessage(systemPrompt, messages, [], signal);
        let text = '';
        for await (const chunk of stream) {
            if (chunk.type === 'text') text += chunk.text;
        }
        return repairMojibake(text);
    } catch (error) {
        if (didTimeout()) {
            throw new Error(`Multimodal request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
        }
        throwIfAborted(abortSignal);
        throw error;
    } finally {
        cleanup();
    }
}

function createTimedAbortSignal(
    parentSignal?: AbortSignal,
    timeoutMs = DEFAULT_STREAM_TIMEOUT_MS,
): { signal: AbortSignal; cleanup: () => void; didTimeout: () => boolean } {
    const controller = new AbortController();
    let timedOut = false;

    const abortFromParent = () => {
        controller.abort(parentSignal?.reason ?? new Error('Aborted'));
    };

    if (parentSignal?.aborted) {
        abortFromParent();
    } else if (parentSignal) {
        parentSignal.addEventListener('abort', abortFromParent, { once: true });
    }

    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    return {
        signal: controller.signal,
        cleanup: () => {
            clearTimeout(timer);
            parentSignal?.removeEventListener('abort', abortFromParent);
        },
        didTimeout: () => timedOut,
    };
}

function throwIfAborted(abortSignal?: AbortSignal): void {
    if (abortSignal?.aborted) {
        throw new Error('Template analysis aborted.');
    }
}

/**
 * Repair UTF-8 bytes misinterpreted as Latin-1 (Mojibake).
 *
 * In Electron, SSE streaming responses may sometimes be decoded with Latin-1
 * instead of UTF-8 when the Content-Type header lacks an explicit charset.
 * This produces characteristic patterns like "Ã¤" instead of "ä".
 *
 * Detection: check for the Ã-prefix pattern that marks multi-byte UTF-8
 * sequences read as Latin-1. If found, re-encode the string as Latin-1 bytes
 * and decode as UTF-8.
 */
function repairMojibake(text: string): string {
    // Quick check: if no Latin-1 artefacts present, return as-is
    // Ã (U+00C3) followed by a byte in 0x80-0xBF range is the telltale sign
    if (!/\xC3[\x80-\xBF]/.test(text)) return text;

    try {
        // Re-encode as Latin-1 bytes, then decode as UTF-8
        const bytes = new Uint8Array(text.length);
        for (let i = 0; i < text.length; i++) {
            const code = text.charCodeAt(i);
            // Only works if all chars are in 0x00-0xFF range (Latin-1 subset)
            if (code > 0xFF) return text; // Contains non-Latin-1 chars, abort
            bytes[i] = code;
        }
        const repaired = new TextDecoder('utf-8').decode(bytes);
        // Sanity check: repaired text should be shorter (multi-byte → single char)
        if (repaired.length < text.length) {
            console.debug('[MultimodalAnalyzer] Repaired Mojibake encoding in API response');
            return repaired;
        }
    } catch {
        // Decoding failed, return original
    }
    return text;
}

/**
 * Robust JSON extraction from LLM responses.
 * Strips markdown fences, repairs UTF-8 mojibake, and falls back to regex extraction.
 */
function parseJsonResponse<T>(responseText: string): T {
    let json = responseText.trim();
    // Strip markdown fences
    if (json.startsWith('```')) {
        json = json.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }
    // Try direct parse
    try {
        return JSON.parse(json) as T;
    } catch {
        // Regex fallback: find balanced JSON by locating first { or [ and
        // trying to parse progressively shorter substrings from it.
        const firstBrace = json.indexOf('{');
        const firstBracket = json.indexOf('[');
        const start = firstBrace >= 0 && (firstBracket < 0 || firstBrace < firstBracket)
            ? firstBrace : firstBracket;
        if (start >= 0) {
            const closer = json[start] === '{' ? '}' : ']';
            // Try from last occurrence of closer backwards
            let end = json.lastIndexOf(closer);
            while (end > start) {
                try {
                    return JSON.parse(json.substring(start, end + 1)) as T;
                } catch {
                    end = json.lastIndexOf(closer, end - 1);
                }
            }
        }
        throw new Error('No valid JSON found in LLM response');
    }
}

/**
 * Parse the LLM's JSON response into MultimodalResult.
 * Tolerant of minor formatting issues (markdown fences, trailing commas).
 */
function parseMultimodalResponse(responseText: string): MultimodalResult {
    const aliases = new Map<string, AliasEntry & { purpose: string }>();
    const compositionMeta = new Map<string, CompositionVisualMeta>();

    try {
        const parsed = parseJsonResponse<{
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
        }>(responseText);

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

/* ------------------------------------------------------------------ */
/*  Document Role Detection (Multi-File Intake)                        */
/* ------------------------------------------------------------------ */

const ROLE_DETECTION_PROMPT = `Du bist ein Corporate-Design-Experte. Analysiere die ersten Folien dieses Dokuments und bestimme seine Rolle.

Moegliche Rollen:
- "main": Praesentationsvorlage mit verschiedenen Slide-Layouts
- "styleguide": Design-Richtlinien mit Farbpaletten, Typografie-Beispielen, Do/Don't
- "icons": Icon-Galerie mit vielen kleinen Symbolen/Icons im Grid
- "howto": Nutzungsanleitung mit Beispielen und Instruktionen

Antworte als JSON (kein Markdown, keine Erklaerungen):
{
  "role": "main|styleguide|icons|howto",
  "confidence": 0.0-1.0,
  "reasoning": "Kurze Begruendung"
}`;

/**
 * Auto-detect the role of a PPTX/POTX document by analyzing its first slides.
 */
export async function detectDocumentRole(
    renderedSlides: RenderedSlide[],
    apiHandler: ApiHandler,
    abortSignal?: AbortSignal,
): Promise<RoleDetectionResult> {
    throwIfAborted(abortSignal);
    // Use max 3 slides for role detection
    const sample = renderedSlides.slice(0, 3);

    const contentBlocks: ContentBlock[] = [
        { type: 'text', text: `Analysiere die ersten ${sample.length} Folien dieses Dokuments:` },
    ];

    for (const slide of sample) {
        contentBlocks.push({
            type: 'text',
            text: `--- Folie ${slide.slideNumber} ---`,
        });
        contentBlocks.push({
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: slide.base64 },
        });
    }

    const messages: MessageParam[] = [{ role: 'user', content: contentBlocks }];
    const responseText = await collectStreamResponse(apiHandler, ROLE_DETECTION_PROMPT, messages, abortSignal);

    try {
        const parsed = parseJsonResponse<RoleDetectionResult>(responseText);
        return {
            role: (['main', 'styleguide', 'icons', 'howto'].includes(parsed.role)
                ? parsed.role : 'main') as DocumentRole,
            confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
            reasoning: parsed.reasoning ?? '',
        };
    } catch {
        return { role: 'main', confidence: 0.3, reasoning: 'Could not parse LLM response' };
    }
}

/* ------------------------------------------------------------------ */
/*  Style Guide Analysis                                               */
/* ------------------------------------------------------------------ */

const STYLE_GUIDE_PROMPT = `Du bist ein Corporate-Design-Experte. Analysiere diese Folien eines Style Guides.

Extrahiere ALLE Design-Regeln in diesen Kategorien:
1. color_usage: Wann welche Farbe verwendet werden soll (z.B. "Primaerblau nur fuer Headlines")
2. typography: Schriftart-Regeln (z.B. "Headlines: 28-36pt, Bold")
3. layout: Layout-Richtlinien (z.B. "Max 7 visuelle Elemente pro Folie")
4. dos: Empfehlungen (z.B. "Klare Hierarchie durch Groessenunterschiede")
5. donts: Verbote (z.B. "Keine Fliesstexte auf Slides")

Sei gruendlich -- extrahiere JEDE Regel die du findest. Schreibe jede Regel als kurzen, praegnanten Satz.

Antworte als JSON (kein Markdown, keine Erklaerungen):
{
  "color_usage": ["..."],
  "typography": ["..."],
  "layout": ["..."],
  "dos": ["..."],
  "donts": ["..."]
}`;

/**
 * Extract design rules from a Style Guide document via multimodal analysis.
 */
export async function extractDesignRules(
    renderedSlides: RenderedSlide[],
    apiHandler: ApiHandler,
    onProgress?: (msg: string) => void,
    abortSignal?: AbortSignal,
): Promise<DesignRules> {
    const totalBatches = Math.ceil(renderedSlides.length / BATCH_SIZE);
    const allRules: DesignRules = {
        color_usage: [], typography: [], layout: [], dos: [], donts: [],
    };

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
        throwIfAborted(abortSignal);

        const batch = renderedSlides.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
        onProgress?.(`Style Guide analysis batch ${batchIdx + 1}/${totalBatches}...`);

        const contentBlocks: ContentBlock[] = [
            { type: 'text', text: `Analysiere folgende ${batch.length} Style-Guide-Folien:` },
        ];

        for (const slide of batch) {
            contentBlocks.push({ type: 'text', text: `--- Folie ${slide.slideNumber} ---` });
            contentBlocks.push({
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: slide.base64 },
            });
        }

        const messages: MessageParam[] = [{ role: 'user', content: contentBlocks }];
        const responseText = await collectStreamResponse(apiHandler, STYLE_GUIDE_PROMPT, messages, abortSignal);

        try {
            const parsed = parseJsonResponse<DesignRules>(responseText);
            if (parsed.color_usage) allRules.color_usage.push(...parsed.color_usage);
            if (parsed.typography) allRules.typography.push(...parsed.typography);
            if (parsed.layout) allRules.layout.push(...parsed.layout);
            if (parsed.dos) allRules.dos.push(...parsed.dos);
            if (parsed.donts) allRules.donts.push(...parsed.donts);
        } catch {
            console.warn('[MultimodalAnalyzer] Failed to parse style guide batch');
        }
    }

    // Deduplicate
    allRules.color_usage = [...new Set(allRules.color_usage)];
    allRules.typography = [...new Set(allRules.typography)];
    allRules.layout = [...new Set(allRules.layout)];
    allRules.dos = [...new Set(allRules.dos)];
    allRules.donts = [...new Set(allRules.donts)];

    return allRules;
}

/* ------------------------------------------------------------------ */
/*  Icon Gallery Analysis                                              */
/* ------------------------------------------------------------------ */

const ICON_GALLERY_PROMPT = `Du bist ein Corporate-Design-Experte. Analysiere diese Folien einer Icon-Galerie.

Fuer JEDES sichtbare Icon/Symbol:
1. name: Kurzer, beschreibender Name (z.B. "Windrad", "Solarpanel", "Dokument")
2. category: Oberkategorie (z.B. "Energie", "Finanzen", "IT", "Kommunikation")
3. description: Was zeigt das Icon? (1 Satz)
4. usage_hint: Wann passt dieses Icon? (1 Satz)

Sei gruendlich -- erfasse JEDES einzelne Icon auf den Folien.

Antworte als JSON Array (kein Markdown, keine Erklaerungen):
[
  { "name": "...", "category": "...", "description": "...", "usage_hint": "..." }
]`;

/**
 * Extract icon catalog from an Icon Gallery document via multimodal analysis.
 * Note: Image data for icons is extracted separately from the PPTX shapes.
 */
export async function extractIconCatalog(
    renderedSlides: RenderedSlide[],
    apiHandler: ApiHandler,
    onProgress?: (msg: string) => void,
    abortSignal?: AbortSignal,
): Promise<IconEntry[]> {
    const allIcons: IconEntry[] = [];
    const totalBatches = Math.ceil(renderedSlides.length / BATCH_SIZE);
    let iconId = 1;

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
        throwIfAborted(abortSignal);

        const batch = renderedSlides.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
        onProgress?.(`Icon catalog analysis batch ${batchIdx + 1}/${totalBatches}...`);

        const contentBlocks: ContentBlock[] = [
            { type: 'text', text: `Analysiere folgende ${batch.length} Icon-Galerie-Folien:` },
        ];

        for (const slide of batch) {
            contentBlocks.push({ type: 'text', text: `--- Folie ${slide.slideNumber} ---` });
            contentBlocks.push({
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: slide.base64 },
            });
        }

        const messages: MessageParam[] = [{ role: 'user', content: contentBlocks }];
        const responseText = await collectStreamResponse(apiHandler, ICON_GALLERY_PROMPT, messages, abortSignal);

        try {
            const parsed = parseJsonResponse<Array<{
                name: string; category: string; description: string; usage_hint: string;
            }>>(responseText);
            for (const icon of parsed) {
                allIcons.push({
                    id: `icon-${iconId++}`,
                    name: icon.name ?? 'Unknown',
                    category: icon.category ?? 'Allgemein',
                    description: icon.description ?? '',
                    usage_hint: icon.usage_hint ?? '',
                });
            }
        } catch {
            console.warn('[MultimodalAnalyzer] Failed to parse icon gallery batch');
        }
    }

    return allIcons;
}

/* ------------------------------------------------------------------ */
/*  How-to-Use Analysis                                                */
/* ------------------------------------------------------------------ */

const HOWTO_PROMPT = `Du bist ein Corporate-Design-Experte. Analysiere diese Folien einer Nutzungsanleitung/How-to-Use.

Extrahiere ALLE Richtlinien in diesen Kategorien:
1. layout_guidance: Konkrete Empfehlungen fuer Folienlayouts (z.B. "KPI-Slides: max 4 Kennzahlen")
2. best_practices: Allgemeine Best Practices (z.B. "Jeder Titel ist eine Aussage, kein Thema")
3. common_mistakes: Haeufige Fehler die vermieden werden sollten

Sei gruendlich -- extrahiere JEDE Richtlinie.

Antworte als JSON (kein Markdown, keine Erklaerungen):
{
  "layout_guidance": ["..."],
  "best_practices": ["..."],
  "common_mistakes": ["..."]
}`;

/**
 * Extract usage guidelines from a How-to-Use document via multimodal analysis.
 */
export async function extractUsageGuidelines(
    renderedSlides: RenderedSlide[],
    apiHandler: ApiHandler,
    onProgress?: (msg: string) => void,
    abortSignal?: AbortSignal,
): Promise<UsageGuidelines> {
    const allGuidelines: UsageGuidelines = {
        layout_guidance: [], best_practices: [], common_mistakes: [],
    };
    const totalBatches = Math.ceil(renderedSlides.length / BATCH_SIZE);

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
        throwIfAborted(abortSignal);

        const batch = renderedSlides.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
        onProgress?.(`How-to-Use analysis batch ${batchIdx + 1}/${totalBatches}...`);

        const contentBlocks: ContentBlock[] = [
            { type: 'text', text: `Analysiere folgende ${batch.length} Anleitungsfolien:` },
        ];

        for (const slide of batch) {
            contentBlocks.push({ type: 'text', text: `--- Folie ${slide.slideNumber} ---` });
            contentBlocks.push({
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: slide.base64 },
            });
        }

        const messages: MessageParam[] = [{ role: 'user', content: contentBlocks }];
        const responseText = await collectStreamResponse(apiHandler, HOWTO_PROMPT, messages, abortSignal);

        try {
            const parsed = parseJsonResponse<UsageGuidelines>(responseText);
            if (parsed.layout_guidance) allGuidelines.layout_guidance.push(...parsed.layout_guidance);
            if (parsed.best_practices) allGuidelines.best_practices.push(...parsed.best_practices);
            if (parsed.common_mistakes) allGuidelines.common_mistakes.push(...parsed.common_mistakes);
        } catch {
            console.warn('[MultimodalAnalyzer] Failed to parse how-to-use batch');
        }
    }

    // Deduplicate
    allGuidelines.layout_guidance = [...new Set(allGuidelines.layout_guidance)];
    allGuidelines.best_practices = [...new Set(allGuidelines.best_practices)];
    allGuidelines.common_mistakes = [...new Set(allGuidelines.common_mistakes)];

    return allGuidelines;
}

/* ------------------------------------------------------------------ */
/*  Vision-based HTML Skeletons                                        */
/* ------------------------------------------------------------------ */

/** Input for a composition that needs a vision-based skeleton. */
export interface VisionSkeletonInput {
    compositionId: string;
    representativeSlide: number;
    contentArea: { x: number; y: number; w: number; h: number };
    styleGuide: {
        title?: { font_size_pt: number; color: string; font_weight: string };
        body?: { font_size_pt: number; color: string };
        accent_color?: string;
    };
    recommendedPipeline: 'clone' | 'html';
}

const SKELETON_PROMPT_PREFIX = `Analyze this slide and generate an HTML skeleton that recreates its visual layout.

Rules:
- Use <div data-object="true" data-object-type="textbox|shape"> with absolute positioning (style="position:absolute;...")
- Use {{title}}, {{content_1}}, {{content_2}} etc. as text placeholders
- Match the visual arrangement (columns, rows, spacing) from the slide
- Stay within content area bounds
- Max 2000 chars

Return ONLY the HTML, no explanation.`;

/**
 * Generate HTML skeletons for compositions using Claude Vision.
 * Analyzes the rendered slide image and produces a layout-faithful skeleton
 * instead of a generic deterministic one.
 */
export async function generateVisionSkeletons(
    renderedSlides: RenderedSlide[],
    compositionGroups: VisionSkeletonInput[],
    apiHandler: ApiHandler,
    onProgress?: (msg: string) => void,
    abortSignal?: AbortSignal,
): Promise<Map<string, string>> {
    const skeletons = new Map<string, string>();

    for (const comp of compositionGroups) {
        throwIfAborted(abortSignal);
        if (comp.recommendedPipeline !== 'html') continue;

        const slide = renderedSlides.find(s => s.slideNumber === comp.representativeSlide);
        if (!slide) continue;

        onProgress?.(`Generating HTML skeleton for ${comp.compositionId}...`);

        const ca = comp.contentArea;
        const prompt = `${SKELETON_PROMPT_PREFIX}

Canvas: 1280x720px. Content area: x=${ca.x}, y=${ca.y}, w=${ca.w}, h=${ca.h}.
Title font-size: ${comp.styleGuide.title?.font_size_pt ?? 28}px.
Body font-size: ${comp.styleGuide.body?.font_size_pt ?? 16}px.`;

        const contentBlocks: ContentBlock[] = [
            {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: slide.base64 },
            },
            { type: 'text', text: prompt },
        ];

        const messages: MessageParam[] = [{ role: 'user', content: contentBlocks }];

        try {
            const responseText = await collectStreamResponse(
                apiHandler, 'You are an HTML layout expert.', messages, abortSignal, SKELETON_STREAM_TIMEOUT_MS,
            );

            // Extract HTML from response (strip markdown fences if present)
            let html = responseText.trim();
            if (html.startsWith('```')) {
                html = html.replace(/^```(?:html)?\s*/, '').replace(/\s*```$/, '');
            }

            if (html.length > 0 && html.length <= 2000) {
                skeletons.set(comp.compositionId, html);
            }
        } catch (err) {
            console.warn(`[MultimodalAnalyzer] Vision skeleton generation failed for ${comp.compositionId}:`, err);
        }
    }

    return skeletons;
}

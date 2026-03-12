/**
 * PptxTemplateCloner -- JSZip-based slide cloning from a corporate template.
 *
 * Opens an existing .pptx template, clones selected slides to new file numbers,
 * replaces text content, and produces a new .pptx that inherits the template's
 * theme, slide masters, layouts, custom geometries, and all visual elements.
 *
 * Key design decisions:
 * - ALL selected slides are cloned to NEW file numbers (originals untouched)
 * - New rIds are assigned beyond the template's max rId (no conflicts)
 * - Original template slides are REMOVED from the ZIP after cloning
 * - Only cloned slides remain in the output PPTX
 *
 * This is the ONLY way to achieve 100% corporate design precision because
 * PptxGenJS cannot load existing files or create custom geometry shapes.
 */

import JSZip from 'jszip';

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

/** A single slide selection from the template. */
export interface TemplateSlideInput {
    /** 1-based slide number in the template to clone. */
    template_slide: number;
    /** Key-value pairs of text to replace in the cloned slide. */
    content: Record<string, string>;
    /** Speaker notes for this slide (replaces existing notes). */
    notes?: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PRES_XML = 'ppt/presentation.xml';
const PRES_RELS = 'ppt/_rels/presentation.xml.rels';
const CONTENT_TYPES = '[Content_Types].xml';
const SLIDE_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';
const SLIDE_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
const NOTES_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml';

/* ------------------------------------------------------------------ */
/*  Main entry point                                                   */
/* ------------------------------------------------------------------ */

/**
 * Clone selected slides from a template .pptx and produce a new .pptx.
 *
 * @param templateData  ArrayBuffer of the template .pptx file
 * @param selections    Ordered array of slide selections (1-based template_slide + content)
 * @returns             ArrayBuffer of the new .pptx file
 */
/** Diagnostic information returned alongside the generated PPTX. */
export interface CloneResult {
    /** The generated PPTX as ArrayBuffer. */
    buffer: ArrayBuffer;
    /** Per-slide diagnostics: which keys matched and which didn't. */
    slideDiagnostics: SlideDiagnostic[];
}

export interface SlideDiagnostic {
    /** Original template slide number (1-based). */
    templateSlide: number;
    /** Keys that were successfully matched and replaced. */
    matchedKeys: string[];
    /** Keys that could NOT be matched to any text in the slide. */
    unmatchedKeys: string[];
    /** All text found in shape elements on this slide (for debugging). */
    shapeTexts: string[];
}

/**
 * Clone selected slides from a template .pptx and produce a new .pptx.
 *
 * @param templateData  ArrayBuffer of the template .pptx file
 * @param selections    Ordered array of slide selections (1-based template_slide + content)
 * @returns             CloneResult with buffer and per-slide diagnostics
 */
export async function cloneFromTemplate(
    templateData: ArrayBuffer,
    selections: TemplateSlideInput[],
): Promise<CloneResult> {
    if (selections.length === 0) {
        throw new Error('At least one slide selection is required');
    }

    const zip = await JSZip.loadAsync(templateData);

    // ── Step 1: Parse template structure ──────────────────────────────

    const presRelsXml = await readZipText(zip, PRES_RELS);
    const presXml = await readZipText(zip, PRES_XML);

    // Map rId -> slide file number from presentation.xml.rels
    const slideRelMap = parseSlideRelationships(presRelsXml);

    // Parse sldIdLst from presentation.xml
    const sldEntries = parseSldIdLst(presXml);

    // Build slideNum -> { id, rId } mapping
    const slideNumToEntry = new Map<number, { id: number; rId: string }>();
    for (const entry of sldEntries) {
        const num = slideRelMap.get(entry.rId);
        if (num !== undefined) slideNumToEntry.set(num, entry);
    }

    // Validate selections
    for (const sel of selections) {
        if (!slideNumToEntry.has(sel.template_slide)) {
            const validNums = [...slideNumToEntry.keys()].sort((a, b) => a - b);
            throw new Error(
                `template_slide ${sel.template_slide} not found in presentation ` +
                `(valid slide numbers: ${validNums.join(', ')})`,
            );
        }
    }

    // ── Step 2: Find max IDs to avoid conflicts ──────────────────────

    // Max rId across presentation.xml.rels
    const allRIdNums = [...presRelsXml.matchAll(/Id="rId(\d+)"/g)].map(m => parseInt(m[1]));
    let nextRId = Math.max(0, ...allRIdNums) + 1;

    // Max sldId from sldIdLst
    let nextSldId = Math.max(0, ...sldEntries.map(e => e.id)) + 1;

    // Max slide file number in ZIP
    let maxSlideFileNum = 0;
    zip.forEach((path) => {
        const m = path.match(/^ppt\/slides\/slide(\d+)\.xml$/);
        if (m) maxSlideFileNum = Math.max(maxSlideFileNum, parseInt(m[1]));
    });
    let nextSlideFileNum = maxSlideFileNum + 1;

    // Max notes file number in ZIP
    let maxNotesFileNum = 0;
    zip.forEach((path) => {
        const m = path.match(/^ppt\/notesSlides\/notesSlide(\d+)\.xml$/);
        if (m) maxNotesFileNum = Math.max(maxNotesFileNum, parseInt(m[1]));
    });
    let nextNotesFileNum = maxNotesFileNum + 1;

    // ── Step 3: Clone each selection to a new slide ──────────────────

    interface ClonedSlide {
        sldId: number;
        rId: string;
        fileNum: number;
        notesFileNum?: number;
    }

    const cloned: ClonedSlide[] = [];
    const slideDiagnostics: SlideDiagnostic[] = [];

    for (const sel of selections) {
        const srcNum = sel.template_slide;
        const dstNum = nextSlideFileNum++;
        const rId = `rId${nextRId++}`;
        const sldId = nextSldId++;

        // Clone slide XML
        await copyZipFile(zip,
            `ppt/slides/slide${srcNum}.xml`,
            `ppt/slides/slide${dstNum}.xml`,
        );

        // Clone slide rels and fix internal references
        let notesFileNum: number | undefined;
        const srcRelsPath = `ppt/slides/_rels/slide${srcNum}.xml.rels`;

        if (zip.file(srcRelsPath)) {
            let relsXml = await readZipText(zip, srcRelsPath);

            // Check for notes reference and clone notes slide
            const notesRefMatch = relsXml.match(
                /Target="\.\.\/notesSlides\/notesSlide(\d+)\.xml"/,
            );
            if (notesRefMatch) {
                const srcNotesNum = parseInt(notesRefMatch[1]);
                notesFileNum = nextNotesFileNum++;

                // Clone notes slide XML
                await copyZipFile(zip,
                    `ppt/notesSlides/notesSlide${srcNotesNum}.xml`,
                    `ppt/notesSlides/notesSlide${notesFileNum}.xml`,
                );

                // Clone notes rels and update slide reference inside
                const srcNotesRels = `ppt/notesSlides/_rels/notesSlide${srcNotesNum}.xml.rels`;
                if (zip.file(srcNotesRels)) {
                    let notesRelsXml = await readZipText(zip, srcNotesRels);
                    // Update reference from original slide to cloned slide
                    notesRelsXml = notesRelsXml.replace(
                        new RegExp(`slide${srcNum}\\.xml`, 'g'),
                        `slide${dstNum}.xml`,
                    );
                    zip.file(
                        `ppt/notesSlides/_rels/notesSlide${notesFileNum}.xml.rels`,
                        notesRelsXml,
                    );
                }

                // Update slide rels to point to cloned notes
                relsXml = relsXml.replace(
                    new RegExp(`notesSlide${srcNotesNum}\\.xml`, 'g'),
                    `notesSlide${notesFileNum}.xml`,
                );
            }

            zip.file(`ppt/slides/_rels/slide${dstNum}.xml.rels`, relsXml);
        }

        // Extract all shape texts for diagnostics BEFORE replacement
        const shapeTexts = await extractAllShapeTexts(zip, dstNum);

        // Replace text content in the cloned slide
        const contentKeys = Object.keys(sel.content);
        const unmatchedKeys = await replaceSlideContent(zip, dstNum, sel.content);
        const matchedKeys = contentKeys.filter(k => !unmatchedKeys.includes(k));

        if (unmatchedKeys.length > 0) {
            console.warn(
                `[PptxTemplateCloner] UNMATCHED KEYS in template slide ${srcNum}:\n` +
                `  Keys sent: ${contentKeys.map(k => `"${k}"`).join(', ')}\n` +
                `  Unmatched: ${unmatchedKeys.map(k => `"${k}"`).join(', ')}\n` +
                `  Shape texts found: ${shapeTexts.map(t => `"${t.substring(0, 60)}${t.length > 60 ? '...' : ''}"`).join(', ')}`,
            );
        }

        // Replace notes if provided
        if (sel.notes !== undefined && notesFileNum) {
            await replaceNotesContent(zip, notesFileNum, sel.notes);
        }

        cloned.push({ sldId, rId, fileNum: dstNum, notesFileNum });
        slideDiagnostics.push({
            templateSlide: srcNum,
            matchedKeys,
            unmatchedKeys,
            shapeTexts,
        });
    }

    // ── Step 3.5: Remove original template slides from ZIP ──────────
    // Original slide files must be removed to prevent PowerPoint from
    // detecting orphaned slides and triggering the repair dialog.

    const clonedSlidePaths = new Set(cloned.map(c => `ppt/slides/slide${c.fileNum}.xml`));
    const clonedSlideRelPaths = new Set(cloned.map(c => `ppt/slides/_rels/slide${c.fileNum}.xml.rels`));
    const clonedNotesPaths = new Set(
        cloned.filter(c => c.notesFileNum).map(c => `ppt/notesSlides/notesSlide${c.notesFileNum}.xml`),
    );
    const clonedNotesRelPaths = new Set(
        cloned.filter(c => c.notesFileNum).map(c => `ppt/notesSlides/_rels/notesSlide${c.notesFileNum}.xml.rels`),
    );

    const filesToDelete: string[] = [];
    zip.forEach((path) => {
        if (path.match(/^ppt\/slides\/slide\d+\.xml$/) && !clonedSlidePaths.has(path)) {
            filesToDelete.push(path);
        }
        if (path.match(/^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/) && !clonedSlideRelPaths.has(path)) {
            filesToDelete.push(path);
        }
        if (path.match(/^ppt\/notesSlides\/notesSlide\d+\.xml$/) && !clonedNotesPaths.has(path)) {
            filesToDelete.push(path);
        }
        if (path.match(/^ppt\/notesSlides\/_rels\/notesSlide\d+\.xml\.rels$/) && !clonedNotesRelPaths.has(path)) {
            filesToDelete.push(path);
        }
    });
    for (const path of filesToDelete) {
        zip.remove(path);
    }

    // ── Step 4: Update presentation.xml ──────────────────────────────

    let newPresXml = presXml;
    const newSldIdEntries = cloned.map(c =>
        `<p:sldId id="${c.sldId}" r:id="${c.rId}"/>`,
    ).join('');
    newPresXml = newPresXml.replace(
        /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,
        `<p:sldIdLst>${newSldIdEntries}</p:sldIdLst>`,
    );

    // Remove section list (references original sldIds that no longer exist)
    newPresXml = newPresXml.replace(/<p14:sectionLst[\s\S]*?<\/p14:sectionLst>/g, '');

    zip.file(PRES_XML, newPresXml);

    // ── Step 5: Update presentation.xml.rels ─────────────────────────
    // Remove ALL original slide relationships, then add only cloned slide rels.
    // Non-slide relationships (themes, masters, layouts etc.) are kept intact.

    let newPresRels = presRelsXml;
    // Remove all slide-type relationships
    newPresRels = newPresRels.replace(
        /<Relationship[^>]*Type="[^"]*\/slide"[^>]*\/>\s*/g,
        '',
    );
    // Add rels for cloned slides only
    const newRelEntries = cloned.map(c =>
        `<Relationship Id="${c.rId}" Type="${SLIDE_REL_TYPE}" Target="slides/slide${c.fileNum}.xml"/>`,
    ).join('\n');
    newPresRels = newPresRels.replace(
        '</Relationships>',
        `${newRelEntries}\n</Relationships>`,
    );
    zip.file(PRES_RELS, newPresRels);

    // ── Step 6: Update [Content_Types].xml ───────────────────────────
    // Remove ALL original slide/notes overrides, then add only cloned ones.

    const ctFile = zip.file(CONTENT_TYPES);
    if (ctFile) {
        let ctXml = await ctFile.async('text');

        // Remove all existing slide overrides
        ctXml = ctXml.replace(
            /<Override\s+PartName="\/ppt\/slides\/slide\d+\.xml"[^>]*\/>\s*/g,
            '',
        );
        // Remove all existing notes overrides
        ctXml = ctXml.replace(
            /<Override\s+PartName="\/ppt\/notesSlides\/notesSlide\d+\.xml"[^>]*\/>\s*/g,
            '',
        );

        // Add overrides for cloned slides only
        const slideOverrides = cloned.map(c =>
            `<Override PartName="/ppt/slides/slide${c.fileNum}.xml" ContentType="${SLIDE_CONTENT_TYPE}"/>`,
        );
        const notesOverrides = cloned
            .filter(c => c.notesFileNum)
            .map(c =>
                `<Override PartName="/ppt/notesSlides/notesSlide${c.notesFileNum}.xml" ContentType="${NOTES_CONTENT_TYPE}"/>`,
            );

        const allOverrides = [...slideOverrides, ...notesOverrides].join('\n');
        ctXml = ctXml.replace('</Types>', `${allOverrides}\n</Types>`);
        zip.file(CONTENT_TYPES, ctXml);
    }

    // ── Step 7: Generate output ──────────────────────────────────────

    const buffer = await zip.generateAsync({
        type: 'arraybuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
    });

    return { buffer, slideDiagnostics };
}

/* ------------------------------------------------------------------ */
/*  Template structure parsing                                         */
/* ------------------------------------------------------------------ */

/**
 * Parse presentation.xml.rels to build rId -> slide file number mapping.
 * Handles XML attribute order variations (Id before/after Target).
 */
function parseSlideRelationships(relsXml: string): Map<string, number> {
    const map = new Map<string, number>();
    const relPattern = /<Relationship\s([^>]*)\/>/g;
    let m: RegExpExecArray | null;

    while ((m = relPattern.exec(relsXml)) !== null) {
        const attrs = m[1];
        const idMatch = attrs.match(/Id="([^"]+)"/);
        const typeMatch = attrs.match(/Type="([^"]+)"/);
        const targetMatch = attrs.match(/Target="([^"]+)"/);

        if (idMatch && typeMatch && targetMatch && typeMatch[1].endsWith('/slide')) {
            const slideMatch = targetMatch[1].match(/slides\/slide(\d+)\.xml/);
            if (slideMatch) {
                map.set(idMatch[1], parseInt(slideMatch[1]));
            }
        }
    }

    return map;
}

/**
 * Parse <p:sldIdLst> from presentation.xml.
 * Returns entries in order as they appear.
 */
function parseSldIdLst(presXml: string): Array<{ id: number; rId: string }> {
    const entries: Array<{ id: number; rId: string }> = [];
    const listMatch = presXml.match(/<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/);
    if (!listMatch) return entries;

    const entryPattern = /<p:sldId[^>]*>/g;
    let m: RegExpExecArray | null;

    while ((m = entryPattern.exec(listMatch[1])) !== null) {
        const tag = m[0];
        const idMatch = tag.match(/\bid="(\d+)"/);
        const rIdMatch = tag.match(/r:id="(rId\d+)"/);
        if (idMatch && rIdMatch) {
            entries.push({ id: parseInt(idMatch[1]), rId: rIdMatch[1] });
        }
    }

    return entries;
}

/* ------------------------------------------------------------------ */
/*  File operations                                                    */
/* ------------------------------------------------------------------ */

async function readZipText(zip: JSZip, path: string): Promise<string> {
    const file = zip.file(path);
    if (!file) throw new Error(`File not found in template: ${path}`);
    return file.async('text');
}

async function copyZipFile(zip: JSZip, src: string, dst: string): Promise<void> {
    const file = zip.file(src);
    if (!file) return;
    const data = await file.async('uint8array');
    zip.file(dst, data);
}

/* ------------------------------------------------------------------ */
/*  Shape text extraction (diagnostics)                                */
/* ------------------------------------------------------------------ */

/**
 * Extract all text from all shapes on a slide, for diagnostic purposes.
 * Returns one string per shape (concatenated text from all <a:t> elements).
 */
async function extractAllShapeTexts(zip: JSZip, slideNum: number): Promise<string[]> {
    const path = `ppt/slides/slide${slideNum}.xml`;
    const file = zip.file(path);
    if (!file) return [];

    const xml = await file.async('text');
    const texts: string[] = [];

    // Find all <p:sp> shapes
    const spPattern = /<p:sp\b[^>]*>/g;
    let spMatch: RegExpExecArray | null;

    while ((spMatch = spPattern.exec(xml)) !== null) {
        const spStart = spMatch.index;
        const spEnd = findClosingTag(xml, spStart, 'p:sp');
        if (spEnd < 0) continue;

        const spBlock = xml.substring(spStart, spEnd);

        // Extract all <a:t> text from this shape
        const textPattern = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
        let shapeText = '';
        let tMatch: RegExpExecArray | null;
        while ((tMatch = textPattern.exec(spBlock)) !== null) {
            shapeText += tMatch[1];
        }

        if (shapeText.trim()) {
            // Unescape XML entities for readability
            texts.push(shapeText
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&apos;/g, "'"),
            );
        }
    }

    return texts;
}

/* ------------------------------------------------------------------ */
/*  Text replacement in slide XML                                      */
/* ------------------------------------------------------------------ */

/**
 * Replace text content in a slide's XML using multiple strategies.
 *
 * Matching priority:
 * 1. Exact <a:t> match (key is the complete text of an <a:t> element)
 * 2. Cross-run paragraph match (key is split across multiple <a:r> runs in one <a:p>)
 * 3. Shape-level match (key is contained across multiple <a:p> paragraphs in one shape)
 * 4. Substring match (key is contained in an <a:t>, key length > 3)
 * 5. Placeholder type match (key maps to ph type like "title" or "body")
 * 6. Positional fallback (assign remaining keys to remaining content shapes by position)
 *
 * Returns array of unmatched keys for diagnostics.
 */
async function replaceSlideContent(
    zip: JSZip,
    slideNum: number,
    content: Record<string, string>,
): Promise<string[]> {
    const path = `ppt/slides/slide${slideNum}.xml`;
    const file = zip.file(path);
    if (!file) return Object.keys(content);

    let xml = await file.async('text');
    const unmatched: string[] = [];

    // Phase 1: Try strategies 1-5 for each key
    for (const [key, value] of Object.entries(content)) {
        if (!key || value === undefined) continue;
        const result = replaceTextInSlide(xml, key, value);
        if (result.matched) {
            xml = result.xml;
        } else {
            unmatched.push(key);
        }
    }

    // Phase 2: For remaining unmatched keys, try positional fallback
    // This handles cases where the agent sends generic keys like "Body", "Text",
    // or the actual replacement value as the key.
    if (unmatched.length > 0) {
        const stillUnmatched: string[] = [];
        for (const key of unmatched) {
            const value = content[key];
            if (value === undefined) continue;
            const result = replaceByPositionalFallback(xml, key, value);
            if (result.matched) {
                xml = result.xml;
            } else {
                stillUnmatched.push(key);
            }
        }
        zip.file(path, xml);
        return stillUnmatched;
    }

    zip.file(path, xml);
    return unmatched;
}

/**
 * Try to replace text in slide XML using multiple strategies.
 */
function replaceTextInSlide(
    xml: string,
    key: string,
    value: string,
): { xml: string; matched: boolean } {
    // Strategy 0: Shape-Name-Matching (highest priority)
    // Matches key against <p:cNvPr name="KEY"> -- shape names are unique per slide.
    // This avoids ambiguity of text-based matching (e.g. "Lorem ipsum" in many shapes).
    const s0Result = replaceByShapeName(xml, key, value);
    if (s0Result !== xml) {
        return { xml: s0Result, matched: true };
    }

    // Normalize key to fix common LLM transliterations (ue→ü, --→–, etc.)
    const normalizedKey = normalizeForMatching(key);
    const escapedKey = escapeXml(normalizedKey);
    const escapedValue = escapeXml(value);

    // Strategy 1: Exact <a:t> match
    const exactPattern = new RegExp(
        `(<a:t[^>]*>)${escapeRegex(escapedKey)}(</a:t>)`,
        'g',
    );
    if (exactPattern.test(xml)) {
        return {
            xml: xml.replace(
                new RegExp(`(<a:t[^>]*>)${escapeRegex(escapedKey)}(</a:t>)`, 'g'),
                `$1${escapedValue}$2`,
            ),
            matched: true,
        };
    }

    // Strategy 2: Cross-run paragraph match (text split across <a:r> runs in one <a:p>)
    const paraResult = replaceInParagraphs(xml, key, value);
    if (paraResult !== xml) {
        return { xml: paraResult, matched: true };
    }

    // Strategy 3: Shape-level match (text split across multiple <a:p> paragraphs in one shape)
    if (key.length > 3) {
        const shapeResult = replaceInShape(xml, key, value);
        if (shapeResult !== xml) {
            return { xml: shapeResult, matched: true };
        }
    }

    // Strategy 4: Substring match (key is contained in <a:t> text)
    // Only for keys longer than 3 chars to avoid false positives
    if (key.length > 3) {
        const substringResult = replaceBySubstring(xml, key, value);
        if (substringResult !== xml) {
            return { xml: substringResult, matched: true };
        }
    }

    // Strategy 5: Placeholder type match (key maps to OOXML ph type)
    const phType = guessPlaceholderType(key);
    if (phType) {
        const phResult = replaceByPlaceholderType(xml, phType, value);
        if (phResult !== xml) {
            return { xml: phResult, matched: true };
        }
    }

    return { xml, matched: false };
}

/* ------------------------------------------------------------------ */
/*  Strategy 2: Cross-run paragraph replacement                        */
/* ------------------------------------------------------------------ */

/**
 * Find paragraphs containing the search text split across runs
 * and replace while preserving the first run's formatting.
 *
 * When a match is found, the entire paragraph is rebuilt from scratch
 * with a single <a:r> run containing the replacement text. This avoids
 * complex offset tracking that can produce invalid XML.
 */
function replaceInParagraphs(xml: string, searchText: string, replaceText: string): string {
    const pPattern = /<a:p\b[^>]*>[\s\S]*?<\/a:p>/g;
    let replaced = false;

    const result = xml.replace(pPattern, (paragraph) => {
        if (replaced) return paragraph; // Only replace first match

        // Concatenate all <a:t> text within this paragraph
        const textPattern = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
        let fullText = '';
        let match: RegExpExecArray | null;
        while ((match = textPattern.exec(paragraph)) !== null) {
            fullText += match[1];
        }

        // Strategy 2 only fires for EXACT cross-run matches (search = full paragraph text).
        // Substring matches within a paragraph are handled by Strategy 3 (shape) or 4 (substring).
        // Normalize both sides to handle whitespace and Unicode variations.
        const escapedSearch = escapeXml(searchText);
        const normalizedFull = normalizeForMatching(fullText);
        const normalizedSearch = normalizeForMatching(escapedSearch);
        if (normalizedFull !== normalizedSearch) return paragraph;

        replaced = true;

        // Extract <a:pPr> (paragraph properties) to preserve
        const pPrSelf = paragraph.match(/<a:pPr\b[^>]*\/>/);
        const pPrOpen = paragraph.match(/<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>/);
        const pPr = pPrSelf ? pPrSelf[0] : (pPrOpen ? pPrOpen[0] : '');

        // Extract first <a:rPr> for formatting
        const rPr = extractFirstRPr(paragraph);

        const escapedReplace = escapeXml(replaceText);

        // Rebuild paragraph cleanly with single run
        return `<a:p>${pPr}<a:r>${rPr}<a:t xml:space="preserve">${escapedReplace}</a:t></a:r></a:p>`;
    });

    return result;
}

/* ------------------------------------------------------------------ */
/*  Strategy 3: Shape-level cross-paragraph match                      */
/* ------------------------------------------------------------------ */

/**
 * Find a shape (<p:sp>) where the concatenated text across ALL paragraphs
 * contains the search key, then replace the entire text body content.
 * This handles template placeholders where text spans multiple <a:p> elements
 * (e.g. "Platzhalter Titelbereich 30pt\nlorem ipsum dolor maximal zweizeilig").
 *
 * Only the FIRST matching shape is replaced.
 */
function replaceInShape(xml: string, searchText: string, replaceText: string): string {
    const escapedSearch = escapeXml(searchText);
    // Find all <p:sp> blocks
    const spPattern = /<p:sp\b[^>]*>/g;
    let spMatch: RegExpExecArray | null;

    while ((spMatch = spPattern.exec(xml)) !== null) {
        const spStart = spMatch.index;
        const spEnd = findClosingTag(xml, spStart, 'p:sp');
        if (spEnd < 0) continue;

        const spBlock = xml.substring(spStart, spEnd);

        // Find txBody within this shape (PresentationML uses <p:txBody>, DrawingML uses <a:txBody>)
        let txBodyTag = 'p:txBody';
        let txBodyStartIdx = spBlock.indexOf('<p:txBody>');
        if (txBodyStartIdx < 0) {
            txBodyStartIdx = spBlock.indexOf('<a:txBody>');
            txBodyTag = 'a:txBody';
        }
        const txBodyEndIdx = spBlock.indexOf(`</${txBodyTag}>`);
        if (txBodyStartIdx < 0 || txBodyEndIdx < 0) continue;

        const txBody = spBlock.substring(txBodyStartIdx + txBodyTag.length + 2, txBodyEndIdx);

        // Concatenate ALL text from all <a:t> elements (across all paragraphs)
        const textPattern = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
        let allText = '';
        let tMatch: RegExpExecArray | null;
        while ((tMatch = textPattern.exec(txBody)) !== null) {
            allText += tMatch[1];
        }

        // Check if the concatenated text contains our search key
        // Normalize whitespace for comparison (template text may have varying whitespace)
        const normalizedAll = allText.replace(/\s+/g, ' ').trim();
        const normalizedSearch = escapedSearch.replace(/\s+/g, ' ').trim();

        // Also try space-stripped comparison: template runs may omit spaces
        // between words (e.g., "PlatzhalterKapitelname" vs "Platzhalter Kapitelname")
        const strippedAll = allText.replace(/\s+/g, '');
        const strippedSearch = escapedSearch.replace(/\s+/g, '');

        if (!normalizedAll.includes(normalizedSearch) &&
            !allText.includes(escapedSearch) &&
            !strippedAll.includes(strippedSearch)) {
            continue;
        }

        // Found a matching shape -- replace the entire txBody content
        // Preserve <a:bodyPr> and <a:lstStyle> (text alignment, margins, wrapping)
        const bodyProps = extractBodyProperties(txBody);

        // Extract the first <a:rPr> for formatting preservation
        const rPr = extractFirstRPr(txBody);

        // Also preserve <a:pPr> from the first paragraph
        const pPrSelf = txBody.match(/<a:pPr\b[^>]*\/>/);
        const pPrOpen = txBody.match(/<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>/);
        const pPr = pPrSelf ? pPrSelf[0] : (pPrOpen ? pPrOpen[0] : '');

        // Build new text body content
        const escapedValue = escapeXml(replaceText);
        const lines = escapedValue.split('\n');
        const paragraphs = lines.map((line, idx) => {
            if (!line.trim()) return '<a:p><a:endParaRPr/></a:p>';
            const pPrTag = idx === 0 && pPr ? pPr : '';
            return `<a:p>${pPrTag}<a:r>${rPr}<a:t>${line}</a:t></a:r></a:p>`;
        }).join('');

        // Replace the txBody content in the shape (preserving bodyPr + lstStyle)
        const newSpBlock = spBlock.substring(0, txBodyStartIdx + txBodyTag.length + 2) +
            bodyProps + paragraphs +
            spBlock.substring(txBodyEndIdx);

        return xml.substring(0, spStart) + newSpBlock + xml.substring(spEnd);
    }

    return xml; // No match
}

/* ------------------------------------------------------------------ */
/*  Strategy 4: Substring match (was Strategy 3)                       */
/* ------------------------------------------------------------------ */

/**
 * Find an <a:t> element whose text CONTAINS the key (not exact match)
 * and replace the entire <a:t> content with the value.
 * Only the FIRST match is replaced to avoid unintended replacements.
 */
function replaceBySubstring(xml: string, key: string, value: string): string {
    const escapedKey = escapeXml(key);
    const escapedValue = escapeXml(value);

    // Find <a:t> elements that contain our key as a substring
    const pattern = /<a:t([^>]*)>([^<]*)<\/a:t>/g;
    let matched = false;

    const result = xml.replace(pattern, (full, attrs, text) => {
        if (matched) return full; // Only replace first match
        if (text.includes(escapedKey)) {
            matched = true;
            return `<a:t${attrs}>${escapedValue}</a:t>`;
        }
        return full;
    });

    return matched ? result : xml;
}

/* ------------------------------------------------------------------ */
/*  Strategy 5: Placeholder type match (was Strategy 4)                */
/* ------------------------------------------------------------------ */

/**
 * Map common content keys to OOXML placeholder types.
 */
function guessPlaceholderType(key: string): string | null {
    const k = key.toLowerCase().trim();
    if (k === 'titel' || k === 'title') return 'title';
    if (k === 'body' || k === 'inhalt' || k === 'body text' || k === 'text' || k === 'content') return 'body';
    if (k === 'subtitle' || k === 'subline' || k === 'untertitel') return 'subTitle';
    return null;
}

/**
 * Find the shape with the matching placeholder type and replace ALL its text
 * while preserving the first run's formatting.
 *
 * For "body" type: also matches content placeholders without explicit type
 * (e.g., <p:ph idx="1"/> which is the default body content area).
 */
function replaceByPlaceholderType(xml: string, phType: string, value: string): string {
    // Match both "title" and "ctrTitle" for title type
    const phTypes = phType === 'title' ? ['title', 'ctrTitle'] : [phType];

    for (const t of phTypes) {
        // Find <p:sp> blocks containing <p:ph type="..."/>
        const phPattern = new RegExp(`<p:ph[^>]*type="${t}"[^>]*/>`);
        const phMatch = xml.match(phPattern);
        if (!phMatch) continue;

        const result = replaceShapeAtPhPos(xml, phMatch[0], value);
        if (result !== xml) return result;
    }

    // For body type: also match content placeholders without explicit type
    // These are <p:ph idx="N"/> where idx is low (1-2) and no type attribute.
    // This is common in Acme/corporate templates where body areas use generic placeholders.
    if (phType === 'body') {
        // Find <p:ph> elements with idx but WITHOUT type attribute
        const genericPhPattern = /<p:ph\b(?![^>]*type=)[^>]*idx="(\d+)"[^>]*\/>/g;
        let gMatch: RegExpExecArray | null;
        const candidates: Array<{ ph: string; idx: number }> = [];

        while ((gMatch = genericPhPattern.exec(xml)) !== null) {
            const idx = parseInt(gMatch[1]);
            // Skip footer (idx >= 10) and slide number placeholders
            if (idx < 10) {
                candidates.push({ ph: gMatch[0], idx });
            }
        }

        // Sort by idx and try the lowest first (most likely to be the body)
        candidates.sort((a, b) => a.idx - b.idx);
        for (const c of candidates) {
            const result = replaceShapeAtPhPos(xml, c.ph, value);
            if (result !== xml) return result;
        }
    }

    return xml; // No match
}

/**
 * Strategy S0: Replace text in a shape identified by its OOXML name.
 *
 * Shape names come from <p:cNvPr name="TextBox 5"> and are unique per slide.
 * This avoids the ambiguity of text-based matching where "Lorem ipsum" appears
 * in many shapes. The key is matched against the name attribute (case-sensitive).
 *
 * @returns Modified XML if matched, unchanged XML if no match
 */
function replaceByShapeName(xml: string, key: string, value: string): string {
    // Build a pattern to find <p:cNvPr ... name="KEY" ...> (or name='KEY')
    // The name attribute can appear in any position within the element.
    const escapedName = escapeXml(key).replace(/"/g, '&quot;');
    const namePattern = new RegExp(
        `<p:cNvPr\\b[^>]*\\bname="${escapeRegex(escapedName)}"[^>]*/?>`,
    );
    const match = namePattern.exec(xml);
    if (!match) return xml;

    // Found the shape -- use replaceShapeAtPhPos to replace text in the enclosing <p:sp>
    return replaceShapeAtPhPos(xml, match[0], value);
}

/**
 * Replace text in the shape that contains the given placeholder element string.
 */
function replaceShapeAtPhPos(xml: string, phElementStr: string, value: string): string {
    const phPos = xml.indexOf(phElementStr);
    if (phPos < 0) return xml;

    // Find the enclosing <p:sp> start
    const spStart = xml.lastIndexOf('<p:sp', phPos);
    if (spStart < 0) return xml;

    // Find the matching </p:sp>
    const spEnd = findClosingTag(xml, spStart, 'p:sp');
    if (spEnd < 0) return xml;

    const spBlock = xml.substring(spStart, spEnd);

    // Find txBody within this shape
    let txBodyTag2 = 'p:txBody';
    let txBodyStart = spBlock.indexOf('<p:txBody>');
    if (txBodyStart < 0) {
        txBodyStart = spBlock.indexOf('<a:txBody>');
        txBodyTag2 = 'a:txBody';
    }
    const txBodyEnd = spBlock.indexOf(`</${txBodyTag2}>`);
    if (txBodyStart < 0 || txBodyEnd < 0) return xml;

    const txBody = spBlock.substring(txBodyStart + txBodyTag2.length + 2, txBodyEnd);

    // Preserve <a:bodyPr> and <a:lstStyle>
    const bodyProps2 = extractBodyProperties(txBody);

    // Extract the first <a:rPr> for formatting preservation
    const rPr = extractFirstRPr(txBody);

    // Build new text body content with preserved formatting
    const lines = value.split('\n');
    const paragraphs = lines.map(line => {
        if (!line.trim()) return '<a:p><a:endParaRPr/></a:p>';
        return `<a:p><a:r>${rPr}<a:t>${escapeXml(line)}</a:t></a:r></a:p>`;
    }).join('');

    // Replace the txBody content (preserving bodyPr + lstStyle)
    const newSpBlock = spBlock.substring(0, txBodyStart + txBodyTag2.length + 2) +
        bodyProps2 + paragraphs +
        spBlock.substring(txBodyEnd);

    return xml.substring(0, spStart) + newSpBlock + xml.substring(spEnd);
}

/**
 * Find the position AFTER the closing tag for a given element.
 * Handles nested elements of the same name.
 *
 * startPos must point to the opening '<' of the element.
 * The search begins AFTER the opening tag to avoid counting it.
 */
function findClosingTag(xml: string, startPos: number, tagName: string): number {
    let depth = 0;
    const openPattern = new RegExp(`<${tagName}[\\s>]`);
    const closeStr = `</${tagName}>`;

    // Skip past the opening tag itself (find the '>' that closes the opening tag)
    const openEnd = xml.indexOf('>', startPos);
    if (openEnd < 0) return -1;
    let pos = openEnd + 1;

    while (pos < xml.length) {
        const nextOpen = xml.indexOf(`<${tagName}`, pos);
        const nextClose = xml.indexOf(closeStr, pos);

        if (nextClose < 0) return -1; // No closing tag found

        if (nextOpen >= 0 && nextOpen < nextClose) {
            // Check if it's actually an opening tag (not a self-closing or different tag)
            const afterTag = xml.substring(nextOpen, nextOpen + tagName.length + 2);
            if (openPattern.test(afterTag)) {
                depth++;
            }
            pos = nextOpen + 1;
        } else {
            if (depth === 0) {
                return nextClose + closeStr.length;
            }
            depth--;
            pos = nextClose + 1;
        }
    }

    return -1;
}

/* ------------------------------------------------------------------ */
/*  Notes replacement                                                  */
/* ------------------------------------------------------------------ */

/**
 * Replace all text in the notes body placeholder.
 * Preserves the first run's formatting.
 */
async function replaceNotesContent(
    zip: JSZip,
    notesFileNum: number,
    notes: string,
): Promise<void> {
    const notesPath = `ppt/notesSlides/notesSlide${notesFileNum}.xml`;
    const notesFile = zip.file(notesPath);
    if (!notesFile) return;

    let notesXml = await notesFile.async('text');

    // Find the body placeholder shape (<p:ph type="body"/>)
    const phMatch = notesXml.match(/<p:ph[^>]*type="body"[^>]*\/>/);
    if (!phMatch) return;

    const phPos = notesXml.indexOf(phMatch[0]);
    const spStart = notesXml.lastIndexOf('<p:sp', phPos);
    if (spStart < 0) return;

    const spEnd = findClosingTag(notesXml, spStart, 'p:sp');
    if (spEnd < 0) return;

    const spBlock = notesXml.substring(spStart, spEnd);

    // Find txBody (PresentationML uses <p:txBody>, DrawingML uses <a:txBody>)
    let notesTxTag = 'p:txBody';
    let txBodyStart = spBlock.indexOf('<p:txBody>');
    if (txBodyStart < 0) {
        txBodyStart = spBlock.indexOf('<a:txBody>');
        notesTxTag = 'a:txBody';
    }
    const txBodyEnd = spBlock.indexOf(`</${notesTxTag}>`);
    if (txBodyStart < 0 || txBodyEnd < 0) return;

    // Preserve <a:bodyPr> and <a:lstStyle>
    const notesTxBody = spBlock.substring(txBodyStart + notesTxTag.length + 2, txBodyEnd);
    const notesBodyProps = extractBodyProperties(notesTxBody);

    // Build new paragraphs
    const lines = notes.split('\n').filter(l => l.trim());
    const paragraphs = lines.map(line =>
        `<a:p><a:r><a:rPr lang="de-DE" dirty="0"/><a:t>${escapeXml(line)}</a:t></a:r></a:p>`,
    ).join('');

    const newSpBlock = spBlock.substring(0, txBodyStart + notesTxTag.length + 2) +
        notesBodyProps + paragraphs +
        spBlock.substring(txBodyEnd);

    notesXml = notesXml.substring(0, spStart) + newSpBlock + notesXml.substring(spEnd);
    zip.file(notesPath, notesXml);
}

/* ------------------------------------------------------------------ */
/*  XML utilities                                                      */
/* ------------------------------------------------------------------ */

/**
 * Extract the first complete <a:rPr> element from XML text.
 * Handles both self-closing (<a:rPr .../>) and non-self-closing (<a:rPr ...>...</a:rPr>) forms.
 * Returns the full element string, or a sensible default.
 */
function extractFirstRPr(xml: string): string {
    const fallback = '<a:rPr lang="de-DE" dirty="0"/>';

    // Try self-closing first (most common)
    const selfClose = xml.match(/<a:rPr\b[^>]*\/>/);
    // Try non-self-closing
    const openTag = xml.match(/<a:rPr\b[^>]*>/);

    if (!openTag) return fallback;

    // Check if self-closing
    if (openTag[0].endsWith('/>')) return openTag[0];

    // If we found a self-closing AND a non-self-closing, use whichever comes first
    if (selfClose && selfClose.index !== undefined && openTag.index !== undefined) {
        if (selfClose.index < openTag.index) return selfClose[0];
    }

    // Non-self-closing: find the matching </a:rPr>
    const startPos = openTag.index ?? 0;
    const endTag = xml.indexOf('</a:rPr>', startPos);
    if (endTag < 0) return selfClose ? selfClose[0] : fallback;

    return xml.substring(startPos, endTag + 8); // 8 = '</a:rPr>'.length
}

/**
 * Extract <a:bodyPr> and <a:lstStyle> elements from txBody content.
 * These must be preserved when replacing text content.
 */
function extractBodyProperties(txBodyContent: string): string {
    let result = '';

    // Extract <a:bodyPr> (self-closing or with content)
    const bodyPrSelf = txBodyContent.match(/<a:bodyPr\b[^>]*\/>/);
    const bodyPrOpen = txBodyContent.match(/<a:bodyPr\b[^>]*>[\s\S]*?<\/a:bodyPr>/);
    if (bodyPrSelf) result += bodyPrSelf[0];
    else if (bodyPrOpen) result += bodyPrOpen[0];

    // Extract <a:lstStyle> (self-closing or with content)
    const lstSelf = txBodyContent.match(/<a:lstStyle\b[^>]*\/>/);
    const lstOpen = txBodyContent.match(/<a:lstStyle\b[^>]*>[\s\S]*?<\/a:lstStyle>/);
    if (lstSelf) result += lstSelf[0];
    else if (lstOpen) result += lstOpen[0];

    return result;
}

/**
 * Normalize text for matching: fix common LLM transliterations.
 * Maps ASCII approximations back to their Unicode originals
 * so agent keys match template text even with transliteration.
 */
function normalizeForMatching(text: string): string {
    return text
        // German umlaut transliterations (word-internal only via regex would be complex,
        // so we do global replacement -- safe because template text uses real umlauts)
        .replace(/ae/g, 'ä').replace(/oe/g, 'ö').replace(/ue/g, 'ü')
        .replace(/Ae/g, 'Ä').replace(/Oe/g, 'Ö').replace(/Ue/g, 'Ü')
        // Dash variants → en-dash (template uses – not -- or —)
        .replace(/\s*--\s*/g, ' – ')
        .replace(/\s*—\s*/g, ' – ')
        // Normalize whitespace
        .replace(/\s+/g, ' ')
        .trim();
}

/* ------------------------------------------------------------------ */
/*  Strategy 6: Positional fallback for unmatched keys                  */
/* ------------------------------------------------------------------ */

/**
 * Last-resort matching: find the first remaining content shape
 * (not title, footer, or slide number) and replace its text.
 *
 * This handles cases where the agent sends:
 * - Generic keys like "Body", "Content", "Description" that don't match any strategy
 * - The replacement VALUE as the key (agent confuses key/value)
 * - Abbreviated or modified versions of the template text
 *
 * Classifies the key as title-like or body-like based on the placeholder
 * structure already present on the slide.
 */
function replaceByPositionalFallback(
    xml: string,
    key: string,
    value: string,
): { xml: string; matched: boolean } {
    const k = key.toLowerCase().trim();

    // Determine if the key seems title-like or body-like
    const titleLike = k === 'title' || k === 'titel' || k === 'heading' || k === 'überschrift';

    if (titleLike) {
        // Try to replace title shape content
        const phMatch = xml.match(/<p:ph[^>]*type="(?:title|ctrTitle)"[^>]*\/>/);
        if (phMatch) {
            const result = replaceShapeAtPhPos(xml, phMatch[0], value);
            if (result !== xml) return { xml: result, matched: true };
        }
        return { xml, matched: false };
    }

    // Body-like key: find the first content shape that isn't title/footer/sldNum
    // and still has template placeholder text (contains "Lorem", "Platzhalter", etc.)
    const spPattern = /<p:sp\b[^>]*>/g;
    let spMatch: RegExpExecArray | null;

    while ((spMatch = spPattern.exec(xml)) !== null) {
        const spStart = spMatch.index;
        const spEnd = findClosingTag(xml, spStart, 'p:sp');
        if (spEnd < 0) continue;

        const spBlock = xml.substring(spStart, spEnd);

        // Skip title, footer, slide number shapes
        if (/<p:ph[^>]*type="(?:title|ctrTitle|ftr|sldNum)"[^>]*\/?>/.test(spBlock)) continue;

        // Must have a txBody with text
        let txBodyTag3 = 'p:txBody';
        let txBStart = spBlock.indexOf('<p:txBody>');
        if (txBStart < 0) { txBStart = spBlock.indexOf('<a:txBody>'); txBodyTag3 = 'a:txBody'; }
        if (txBStart < 0) continue;
        const txBEnd = spBlock.indexOf(`</${txBodyTag3}>`);
        if (txBEnd < 0) continue;

        const txBody = spBlock.substring(txBStart + txBodyTag3.length + 2, txBEnd);

        // Extract text to check if it's still template placeholder text
        const textPattern = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
        let allText = '';
        let tMatch: RegExpExecArray | null;
        while ((tMatch = textPattern.exec(txBody)) !== null) {
            allText += tMatch[1];
        }

        if (!allText.trim()) continue;

        // Check if shape has placeholder-like text (strong signal it should be replaced)
        const normalizedText = allText.replace(/\s+/g, ' ').toLowerCase();
        const isPlaceholder = normalizedText.includes('lorem') ||
            normalizedText.includes('platzhalter') ||
            normalizedText.includes('überschrift') ||
            normalizedText.includes('text') ||
            normalizedText.includes('beispiel');

        if (!isPlaceholder) continue;

        // Replace this shape's content
        const bodyProps3 = extractBodyProperties(txBody);
        const rPr = extractFirstRPr(txBody);
        const pPrSelf = txBody.match(/<a:pPr\b[^>]*\/>/);
        const pPrOpen = txBody.match(/<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>/);
        const pPr = pPrSelf ? pPrSelf[0] : (pPrOpen ? pPrOpen[0] : '');

        const escapedValue = escapeXml(value);
        const lines = escapedValue.split('\n');
        const paragraphs = lines.map((line, idx) => {
            if (!line.trim()) return '<a:p><a:endParaRPr/></a:p>';
            const pPrTag = idx === 0 && pPr ? pPr : '';
            return `<a:p>${pPrTag}<a:r>${rPr}<a:t>${line}</a:t></a:r></a:p>`;
        }).join('');

        const newSpBlock = spBlock.substring(0, txBStart + txBodyTag3.length + 2) +
            bodyProps3 + paragraphs +
            spBlock.substring(txBEnd);

        return {
            xml: xml.substring(0, spStart) + newSpBlock + xml.substring(spEnd),
            matched: true,
        };
    }

    return { xml, matched: false };
}

function escapeXml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

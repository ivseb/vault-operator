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
import {
    DEFAULT_LANG, DEFAULT_RPR,
    findClosingTag, escapeXml, escapeRegex,
    extractAllParagraphFormats, extractBodyProperties,
    parseShapeName, findMaxShapeId, extractSpBlockByName, extractSpBlockById,
    type ParagraphFormat,
} from './ooxml-utils';
import type { RepeatableGroup } from './PptxTemplateAnalyzer';

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
    /** Resolved alias-to-shapeId mapping for ID-based replacement. Keys match content keys. */
    resolvedIds?: Record<string, string>;
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

/** Options for cloneFromTemplate. */
export interface CloneOptions {
    /** Repeatable groups per template slide number for shape adaptation. */
    repeatableGroups?: Map<number, RepeatableGroup[]>;
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
    options?: CloneOptions,
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

        // Adapt shapes if repeatable groups are available for this slide
        const groups = options?.repeatableGroups?.get(sel.template_slide);
        if (groups && groups.length > 0) {
            await adaptSlideShapes(zip, dstNum, sel.content, groups);
        }

        // Extract all shape texts for diagnostics BEFORE replacement
        const shapeTexts = await extractAllShapeTexts(zip, dstNum);

        // Replace text content in the cloned slide
        const contentKeys = Object.keys(sel.content);
        const unmatchedKeys = await replaceSlideContent(zip, dstNum, sel.content, sel.resolvedIds);
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

/* ------------------------------------------------------------------ */
/*  Shape Adaptation Engine                                            */
/* ------------------------------------------------------------------ */

/**
 * Adapt shapes within a cloned slide based on repeatable groups.
 * Detects mismatch between content keys and group shapes:
 * - Fewer content keys than shapes: remove excess shapes + associated shapes, redistribute
 * - More content keys than shapes: duplicate shapes + associated shapes, redistribute
 *
 * This runs BEFORE replaceSlideContent so that the shape names match the content keys.
 */
async function adaptSlideShapes(
    zip: JSZip,
    slideNum: number,
    content: Record<string, string>,
    groups: RepeatableGroup[],
): Promise<void> {
    const slidePath = `ppt/slides/slide${slideNum}.xml`;
    const file = zip.file(slidePath);
    if (!file) return;

    let xml = await file.async('string');
    const contentKeys = new Set(Object.keys(content));

    for (const group of groups) {
        // Determine if we have IDs for reliable identification (v2 compositions)
        const hasIds = group.shapeIds && group.shapeIds.length === group.shapeNames.length;

        // Count how many content keys match this group's shapes (directly or via name prefix)
        const matchingKeys: string[] = [];

        // Direct matches
        for (const shapeName of group.shapeNames) {
            if (contentKeys.has(shapeName)) {
                matchingKeys.push(shapeName);
            }
        }

        // Check for extra keys with incrementing numbers (for adding shapes)
        const lastShape = group.shapeNames[group.shapeNames.length - 1];
        const parsed = parseShapeName(lastShape);
        if (parsed) {
            for (let n = parsed.num + 1; n <= parsed.num + 10; n++) {
                const candidateName = `${parsed.base} ${n}`;
                if (contentKeys.has(candidateName)) {
                    matchingKeys.push(candidateName);
                }
            }
        }

        const targetCount = matchingKeys.length;
        const currentCount = group.shapeNames.length;

        if (targetCount === 0 || targetCount === currentCount) continue;

        if (targetCount < currentCount) {
            // REMOVE excess shapes
            const removeIndices = Array.from({ length: currentCount - targetCount }, (_, i) => targetCount + i);

            // Remove excess shapes and their associated shapes
            for (const idx of removeIndices) {
                if (hasIds) {
                    xml = removeShapeById(xml, group.shapeIds![idx]);
                } else {
                    xml = removeShapeByName(xml, group.shapeNames[idx]);
                }
                // Also remove associated shapes from the column
                const col = group.columns[idx];
                if (col) {
                    for (const assoc of col.associatedShapes) {
                        if (hasIds && assoc.shapeId) {
                            xml = removeShapeById(xml, assoc.shapeId);
                        } else {
                            xml = removeShapeByName(xml, assoc.shapeName);
                        }
                    }
                }
            }

            // Redistribute remaining shapes
            const positions = redistributePositions(
                targetCount, group.boundingBox, group.shapeSize, group.axis,
            );
            for (let i = 0; i < targetCount; i++) {
                if (hasIds) {
                    xml = updateShapePositionById(xml, group.shapeIds![i], positions[i]);
                } else {
                    xml = updateShapePosition(xml, group.shapeNames[i], positions[i]);
                }
                // Also move associated shapes
                const col = group.columns[i];
                if (col) {
                    for (const assoc of col.associatedShapes) {
                        const assocPos: ShapePosition = {
                            left: positions[i].left + assoc.offsetX,
                            top: positions[i].top + assoc.offsetY,
                            width: positions[i].width,
                            height: -1,
                        };
                        if (hasIds && assoc.shapeId) {
                            xml = updateShapePositionById(xml, assoc.shapeId, assocPos);
                        } else {
                            xml = updateShapePosition(xml, assoc.shapeName, assocPos);
                        }
                    }
                }
            }
        } else if (targetCount > currentCount) {
            // DUPLICATE shapes to add more
            const lastShapeName = group.shapeNames[group.shapeNames.length - 1];
            const lastShapeId = hasIds ? group.shapeIds![group.shapeIds!.length - 1] : undefined;
            let maxId = findMaxShapeId(xml);

            // Duplicate shapes and associated shapes
            for (let i = currentCount; i < targetCount; i++) {
                const newParsed = parseShapeName(lastShapeName);
                const newName = newParsed
                    ? `${newParsed.base} ${newParsed.num + (i - currentCount + 1)}`
                    : `${lastShapeName} Copy ${i - currentCount + 1}`;

                maxId++;
                if (lastShapeId) {
                    xml = duplicateShapeById(xml, lastShapeId, newName, maxId);
                } else {
                    xml = duplicateShape(xml, lastShapeName, newName, maxId);
                }

                // Duplicate associated shapes
                const lastCol = group.columns[group.columns.length - 1];
                if (lastCol) {
                    for (const assoc of lastCol.associatedShapes) {
                        const assocParsed = parseShapeName(assoc.shapeName);
                        const newAssocName = assocParsed
                            ? `${assocParsed.base} ${assocParsed.num + (i - currentCount + 1)}`
                            : `${assoc.shapeName} Copy ${i - currentCount + 1}`;
                        maxId++;
                        if (hasIds && assoc.shapeId) {
                            xml = duplicateShapeById(xml, assoc.shapeId, newAssocName, maxId);
                        } else {
                            xml = duplicateShape(xml, assoc.shapeName, newAssocName, maxId);
                        }
                    }
                }
            }

            // Build full list of shape names for new shapes (for repositioning)
            const allShapeNames: string[] = [...group.shapeNames];
            for (let i = currentCount; i < targetCount; i++) {
                const newParsed = parseShapeName(lastShapeName);
                const newName = newParsed
                    ? `${newParsed.base} ${newParsed.num + (i - currentCount + 1)}`
                    : `${lastShapeName} Copy ${i - currentCount + 1}`;
                allShapeNames.push(newName);
            }

            // Redistribute all shapes
            const positions = redistributePositions(
                targetCount, group.boundingBox, group.shapeSize, group.axis,
            );
            for (let i = 0; i < allShapeNames.length; i++) {
                // Original shapes: use ID if available, new shapes: use name (they have unique names)
                if (hasIds && i < currentCount) {
                    xml = updateShapePositionById(xml, group.shapeIds![i], positions[i]);
                } else {
                    xml = updateShapePosition(xml, allShapeNames[i], positions[i]);
                }

                // Move associated shapes
                const colIdx = Math.min(i, group.columns.length - 1);
                const col = group.columns[colIdx];
                if (col) {
                    for (let a = 0; a < col.associatedShapes.length; a++) {
                        const assoc = col.associatedShapes[a];
                        const assocPos: ShapePosition = {
                            left: positions[i].left + assoc.offsetX,
                            top: positions[i].top + assoc.offsetY,
                            width: positions[i].width,
                            height: -1,
                        };
                        if (i < currentCount && hasIds && assoc.shapeId) {
                            xml = updateShapePositionById(xml, assoc.shapeId, assocPos);
                        } else {
                            // New duplicated shapes: use computed name
                            let assocName: string;
                            if (i < currentCount) {
                                assocName = assoc.shapeName;
                            } else {
                                const assocParsed = parseShapeName(assoc.shapeName);
                                assocName = assocParsed
                                    ? `${assocParsed.base} ${assocParsed.num + (i - currentCount + 1)}`
                                    : `${assoc.shapeName} Copy ${i - currentCount + 1}`;
                            }
                            xml = updateShapePosition(xml, assocName, assocPos);
                        }
                    }
                }
            }
        }
    }

    zip.file(slidePath, xml);
}

/** Remove a shape by its name from slide XML. */
function removeShapeByName(xml: string, shapeName: string): string {
    const spBlock = extractSpBlockByName(xml, shapeName);
    if (!spBlock) return xml;
    return xml.replace(spBlock, '');
}

/** Remove a shape by its ID (unique per slide) from slide XML. */
function removeShapeById(xml: string, shapeId: string): string {
    const spBlock = extractSpBlockById(xml, shapeId);
    if (!spBlock) return xml;
    return xml.replace(spBlock, '');
}

/** Duplicate a shape with a new name and ID (source found by name). */
function duplicateShape(
    xml: string,
    sourceShapeName: string,
    newName: string,
    newId: number,
): string {
    const spBlock = extractSpBlockByName(xml, sourceShapeName);
    if (!spBlock) return xml;

    // Replace name and id in the duplicated block
    const escapedOldName = escapeRegex(escapeXml(sourceShapeName));
    let newBlock = spBlock
        .replace(new RegExp(`name="${escapedOldName}"`), `name="${escapeXml(newName)}"`)
        .replace(/\bid="(\d+)"/, `id="${newId}"`);

    // Insert before </p:spTree>
    const insertPoint = xml.indexOf('</p:spTree>');
    if (insertPoint < 0) return xml;
    return xml.substring(0, insertPoint) + newBlock + xml.substring(insertPoint);
}

/** Duplicate a shape found by ID (unique per slide). */
function duplicateShapeById(
    xml: string,
    sourceId: string,
    newName: string,
    newId: number,
): string {
    const spBlock = extractSpBlockById(xml, sourceId);
    if (!spBlock) return xml;

    let newBlock = spBlock
        .replace(/\bname="[^"]*"/, `name="${escapeXml(newName)}"`)
        .replace(/\bid="(\d+)"/, `id="${newId}"`);

    const insertPoint = xml.indexOf('</p:spTree>');
    if (insertPoint < 0) return xml;
    return xml.substring(0, insertPoint) + newBlock + xml.substring(insertPoint);
}

interface ShapePosition {
    left: number;
    top: number;
    width: number;
    height: number; // -1 means keep original
}

/** Calculate evenly distributed positions for shapes within a bounding box. */
function redistributePositions(
    count: number,
    boundingBox: { left: number; top: number; width: number; height: number },
    shapeSize: { cx: number; cy: number },
    axis: 'horizontal' | 'vertical',
): ShapePosition[] {
    if (count <= 0) return [];

    if (axis === 'horizontal') {
        const totalShapeW = count * shapeSize.cx;
        let totalGap = boundingBox.width - totalShapeW;
        let w = shapeSize.cx;

        if (totalGap < 0) {
            // Shapes don't fit -> scale down width
            w = Math.floor(boundingBox.width / count * 0.9);
            totalGap = boundingBox.width - count * w;
        }

        const gap = count > 1 ? Math.floor(totalGap / (count - 1)) : 0;

        return Array.from({ length: count }, (_, i) => ({
            left: boundingBox.left + i * (w + gap),
            top: boundingBox.top,
            width: w,
            height: shapeSize.cy,
        }));
    } else {
        const totalShapeH = count * shapeSize.cy;
        let totalGap = boundingBox.height - totalShapeH;
        let h = shapeSize.cy;

        if (totalGap < 0) {
            h = Math.floor(boundingBox.height / count * 0.9);
            totalGap = boundingBox.height - count * h;
        }

        const gap = count > 1 ? Math.floor(totalGap / (count - 1)) : 0;

        return Array.from({ length: count }, (_, i) => ({
            left: boundingBox.left,
            top: boundingBox.top + i * (h + gap),
            width: shapeSize.cx,
            height: h,
        }));
    }
}

/** Update the position and size of a shape in slide XML (found by name). */
function updateShapePosition(xml: string, shapeName: string, pos: ShapePosition): string {
    const spBlock = extractSpBlockByName(xml, shapeName);
    if (!spBlock) return xml;
    return applyPositionToBlock(xml, spBlock, pos);
}

/** Update the position and size of a shape in slide XML (found by ID). */
function updateShapePositionById(xml: string, shapeId: string, pos: ShapePosition): string {
    const spBlock = extractSpBlockById(xml, shapeId);
    if (!spBlock) return xml;
    return applyPositionToBlock(xml, spBlock, pos);
}

/** Apply position update to an extracted shape block. */
function applyPositionToBlock(xml: string, spBlock: string, pos: ShapePosition): string {
    let updated = spBlock;

    // Update position (a:off)
    updated = updated.replace(
        /<a:off\s+x="(\d+)"\s+y="(\d+)"/,
        `<a:off x="${pos.left}" y="${pos.top}"`,
    );

    // Update size (a:ext) -- skip if height is -1 (keep original)
    if (pos.height > 0) {
        updated = updated.replace(
            /<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/,
            `<a:ext cx="${pos.width}" cy="${pos.height}"`,
        );
    } else if (pos.width > 0) {
        // Only update width, keep height
        updated = updated.replace(
            /<a:ext\s+cx="(\d+)"/,
            `<a:ext cx="${pos.width}"`,
        );
    }

    return xml.replace(spBlock, updated);
}

/* ------------------------------------------------------------------ */
/*  Text replacement                                                   */
/* ------------------------------------------------------------------ */

async function replaceSlideContent(
    zip: JSZip,
    slideNum: number,
    content: Record<string, string>,
    resolvedIds?: Record<string, string>,
): Promise<string[]> {
    const path = `ppt/slides/slide${slideNum}.xml`;
    const file = zip.file(path);
    if (!file) return Object.keys(content);

    let xml = await file.async('text');
    const unmatched: string[] = [];

    // Phase 1: Try strategies for each key
    for (const [key, value] of Object.entries(content)) {
        if (!key || value === undefined) continue;
        const result = replaceTextInSlide(xml, key, value, resolvedIds);
        if (result.matched) {
            xml = result.xml;
        } else {
            unmatched.push(key);
        }
    }

    // Clean up remaining placeholder text in unmatched shapes (V-5)
    xml = cleanupPlaceholderText(xml);
    zip.file(path, xml);
    return unmatched;
}

/**
 * Clean up common placeholder/dummy text in shapes that were not matched (V-5).
 * Extracts concatenated text from all <a:t> runs within each <p:sp> shape,
 * then clears the text if it starts with a known placeholder pattern.
 * This handles cases where "Lorem ipsum" is split across multiple <a:r> runs.
 */
function cleanupPlaceholderText(xml: string): string {
    const placeholderStarts = [
        'Lorem ipsum',
        'Platzhalter',
        'Beispieltext',
        'Click to edit',
        'Insert text',
    ];

    // Find each <p:sp> shape using findClosingTag for robust nesting
    const spPattern = /<p:sp\b[^>]*>/g;
    let result = xml;
    let spMatch: RegExpExecArray | null;

    while ((spMatch = spPattern.exec(xml)) !== null) {
        const spStart = spMatch.index;
        const spEnd = findClosingTag(xml, spStart, 'p:sp');
        if (spEnd < 0) continue;

        const shapeXml = xml.substring(spStart, spEnd);

        // Extract all <a:t> text content from this shape and concatenate
        const textParts: string[] = [];
        const atPattern = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
        let atMatch: RegExpExecArray | null;
        while ((atMatch = atPattern.exec(shapeXml)) !== null) {
            textParts.push(atMatch[1]);
        }
        const fullText = textParts.join('').trim();

        // Check if concatenated text starts with any placeholder pattern
        const isPlaceholder = placeholderStarts.some((p) => fullText.startsWith(p));
        if (isPlaceholder) {
            // Clear all <a:t> content within this shape
            const cleaned = shapeXml.replace(
                /(<a:t[^>]*>)[\s\S]*?(<\/a:t>)/g,
                '$1$2',
            );
            result = result.replace(shapeXml, cleaned);
        }
    }
    return result;
}

/**
 * Try to replace text in slide XML using multiple strategies.
 */
function replaceTextInSlide(
    xml: string,
    key: string,
    value: string,
    resolvedIds?: Record<string, string>,
): { xml: string; matched: boolean } {
    // Strategy -1: ID-based matching (highest priority)
    // If the key has a resolved shape ID, use it directly. This handles duplicate
    // shape names (e.g. "Textplatzhalter 2" appearing 3-5x per slide) by targeting
    // the specific shape via its unique <p:cNvPr id="N"> attribute.
    if (resolvedIds && resolvedIds[key]) {
        const sIdResult = replaceByShapeId(xml, resolvedIds[key], value);
        if (sIdResult !== xml) {
            return { xml: sIdResult, matched: true };
        }
    }

    // Strategy 0: Shape-Name-Matching
    // Matches key against <p:cNvPr name="KEY"> -- shape names are unique per slide.
    // This avoids ambiguity of text-based matching (e.g. "Lorem ipsum" in many shapes).
    const s0Result = replaceByShapeName(xml, key, value);
    if (s0Result !== xml) {
        return { xml: s0Result, matched: true };
    }

    const escapedKey = escapeXml(key);
    const escapedValue = escapeXml(value);

    // Strategy 1: Exact <a:t> match (NO normalization -- key must match XML text exactly)
    // Short keys (<50 chars) use first-match only to avoid replacing
    // ALL identical <a:t> elements (e.g. multiple chevrons with same text)
    const isShortKey = escapedKey.length < 50;
    const s1Flags = isShortKey ? '' : 'g';
    const s1Pattern = new RegExp(
        `(<a:t[^>]*>)${escapeRegex(escapedKey)}(</a:t>)`,
        s1Flags,
    );
    if (s1Pattern.test(xml)) {
        return {
            xml: xml.replace(
                new RegExp(`(<a:t[^>]*>)${escapeRegex(escapedKey)}(</a:t>)`, s1Flags),
                `$1${escapedValue}$2`,
            ),
            matched: true,
        };
    }

    // Strategy 3: Shape-level match (text split across multiple <a:p> paragraphs in one shape)
    if (key.length > 3) {
        const shapeResult = replaceInShape(xml, key, value);
        if (shapeResult !== xml) {
            return { xml: shapeResult, matched: true };
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

/* ------------------------------------------------------------------
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

        if (!normalizedAll.includes(normalizedSearch)) {
            continue;
        }

        // Found a matching shape -- replace the entire txBody content
        // Preserve <a:bodyPr> and <a:lstStyle> (text alignment, margins, wrapping)
        const bodyProps = extractBodyProperties(txBody);

        // Extract formatting from ALL paragraphs (V-2: paragraph-level preservation)
        const formats = extractAllParagraphFormats(txBody);

        // Build new text body content with per-paragraph formatting
        const escapedValue = escapeXml(replaceText);
        const lines = escapedValue.split('\n');
        const paragraphs = lines.map((line, i) => {
            if (!line.trim()) return '<a:p><a:endParaRPr/></a:p>';
            const fmt = formats[Math.min(i, formats.length - 1)];
            return `<a:p>${fmt.pPr}<a:r>${fmt.rPr}<a:t>${line}</a:t></a:r></a:p>`;
        }).join('');

        // Replace the txBody content in the shape (preserving bodyPr + lstStyle)
        const newSpBlock = spBlock.substring(0, txBodyStartIdx + txBodyTag.length + 2) +
            bodyProps + paragraphs +
            spBlock.substring(txBodyEndIdx);

        return xml.substring(0, spStart) + newSpBlock + xml.substring(spEnd);
    }

    return xml; // No match
}

/* ------------------------------------------------------------------
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
 * Strategy S-1: Replace text in a shape identified by its unique OOXML shape ID.
 *
 * Shape IDs come from <p:cNvPr id="42" ...> and are guaranteed unique per slide.
 * This resolves the duplicate-name problem where multiple shapes share the same
 * PowerPoint-internal name (e.g. "Textplatzhalter 2" appearing 3-5x per slide).
 *
 * @returns Modified XML if matched, unchanged XML if no match
 */
function replaceByShapeId(xml: string, shapeId: string, value: string): string {
    const idPattern = new RegExp(
        `<p:cNvPr\\b[^>]*\\bid="${escapeRegex(shapeId)}"[^>]*/?>`,
    );
    const match = idPattern.exec(xml);
    if (!match) return xml;

    return replaceShapeAtPhPos(xml, match[0], value);
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
    const escapedName = escapeXml(key);
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

    // Extract formatting from ALL paragraphs (V-2: paragraph-level preservation)
    // This ensures heading stays heading, body stays body, etc.
    const formats = extractAllParagraphFormats(txBody);

    // Build new text body content with per-paragraph formatting
    const lines = value.split('\n');
    const paragraphs = lines.map((line, i) => {
        if (!line.trim()) return '<a:p><a:endParaRPr/></a:p>';
        // Use the format for this line's position, or the last available format
        const fmt = formats[Math.min(i, formats.length - 1)];
        return `<a:p>${fmt.pPr}<a:r>${fmt.rPr}<a:t>${escapeXml(line)}</a:t></a:r></a:p>`;
    }).join('');

    // Replace the txBody content (preserving bodyPr + lstStyle)
    const newSpBlock = spBlock.substring(0, txBodyStart + txBodyTag2.length + 2) +
        bodyProps2 + paragraphs +
        spBlock.substring(txBodyEnd);

    return xml.substring(0, spStart) + newSpBlock + xml.substring(spEnd);
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
        `<a:p><a:r>${DEFAULT_RPR}<a:t>${escapeXml(line)}</a:t></a:r></a:p>`,
    ).join('');

    const newSpBlock = spBlock.substring(0, txBodyStart + notesTxTag.length + 2) +
        notesBodyProps + paragraphs +
        spBlock.substring(txBodyEnd);

    notesXml = notesXml.substring(0, spStart) + newSpBlock + notesXml.substring(spEnd);
    zip.file(notesPath, notesXml);
}

/**
 * PptxTemplateAnalyzer -- Automated analysis of PPTX templates.
 *
 * Extracts three things from any PPTX template:
 * 1. Element Catalog: All unique design elements (shapes, forms) deduplicated via vector fingerprint
 * 2. Brand DNA: Colors, fonts, spacing from theme.xml and slide masters
 * 3. Slide Compositions: How elements are combined on each slide, with shape names
 *
 * The output is used to generate a Template Skill (SKILL.md) that the agent
 * can use to create presentations with any template.
 *
 * Based on patterns from:
 * - PPTAgent (EMNLP 2025): deepcopy shape elements for pixel-perfect reproduction
 * - Presenton: Brand DNA extraction from templates
 * - Microsoft Copilot: Layout-name-based slide matching
 */

import JSZip from 'jszip';
import {
    EMU_PER_INCH, EMU_PER_PX, EMU_PT_TO_EMU,
    EMU_DECORATIVE, EMU_SMALL_WIDTH, EMU_SMALL_HEIGHT,
    EMU_BODY_MIN, EMU_BODY_MAX, EMU_BACKGROUND_W, EMU_BACKGROUND_H,
    AVG_CHAR_WIDTH_FACTOR, LINE_HEIGHT_FACTOR, PT_TO_PX,
    findClosingTag, decodeXmlEntities, simpleHash,
} from './ooxml-utils';

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

/** Complete analysis result for a PPTX template. */
export interface TemplateAnalysis {
    /** Total number of slides in the template. */
    slideCount: number;
    /** Brand DNA: colors, fonts, spacing extracted from theme and masters. */
    brandDNA: BrandDNA;
    /** Deduplicated catalog of unique design elements. */
    elementCatalog: DesignElement[];
    /** Per-slide composition: which elements and shape names are used. */
    slideCompositions: SlideComposition[];
    /** Global decorative elements (logo, accent bars) for auto-injection in HTML pipeline. */
    dekoElements: DekoElement[];
    /** Raw shapes per slide for scaffolding extraction. */
    allShapesBySlide: Map<number, RawShape[]>;
}

/** A decorative element extracted from the template for auto-injection. */
export interface DekoElement {
    /** Unique ID (e.g. "deko-1"). */
    id: string;
    /** Element type: image (logo) or shape (accent bar, decorative rect). */
    type: 'image' | 'shape';
    /** Position in inches (for PptxGenJS). */
    position: { x: number; y: number; w: number; h: number };
    /** PptxGenJS shape name (e.g. "rect", "roundRect"). Only for type=shape. */
    shapeName?: string;
    /** Fill color as hex without # (e.g. "FF6600"). Only for type=shape. */
    fillColor?: string;
    /** Rotation in degrees. */
    rotation?: number;
    /** Image as base64 data URL. Only for type=image. */
    imageData?: string;
    /** How often this element appears across content slides (0.0-1.0). */
    frequency: number;
}

/** Brand DNA extracted from theme1.xml and slide masters. */
export interface BrandDNA {
    colors: Record<string, string>;  // dk1, dk2, lt1, lt2, accent1-6 -> hex
    fonts: { major: string; minor: string };
    /** Slide dimensions in EMU. */
    slideSize: { cx: number; cy: number };
}

/** A unique design element identified by vector fingerprint. */
export interface DesignElement {
    /** Unique element ID (e.g. "E-001"). */
    id: string;
    /** Human-readable name derived from geometry and context. */
    name: string;
    /** Geometry type from OOXML. */
    geometry: string;  // e.g. "prstGeom:chevron", "prstGeom:roundRect", "custGeom:a1b2c3"
    /** Element category. */
    category: ElementCategory;
    /** Whether this element can contain text. */
    hasText: boolean;
    /** Number of text fields in this element. */
    textFieldCount: number;
    /** Approximate size in EMU. */
    size: { cx: number; cy: number };
    /** Fill style description. */
    fill: string;
    /** Line style description. */
    line: string;
    /** Which slides this element appears on (1-based). */
    appearsOn: number[];
    /** Suggested use case based on geometry and context. */
    suggestedUse: string;
}

export type ElementCategory = 'content-bearing' | 'decorative' | 'structural' | 'connector' | 'media' | 'background';

/** How elements are composed on a single slide. */
export interface SlideComposition {
    /** 1-based slide number. */
    slideNumber: number;
    /** Layout name from slideLayout reference. */
    layoutName: string;
    /** Automatic classification of slide type. */
    classification: SlideClassification;
    /** All shapes on this slide with their names and roles. */
    shapes: ShapeInfo[];
    /** Summary description for the agent. */
    description: string;
    /** Repeatable shape groups detected on this slide (e.g. 5 chevrons in a row). */
    repeatableGroups: RepeatableGroup[];
    /** Counts of embedded non-shape objects that carry static template content. */
    embeddedObjects: {
        charts: number;
        tables: number;
        pictures: number;
        graphics: number;
    };
}

/** A group of shapes with identical visual fingerprint arranged linearly. */
export interface RepeatableGroup {
    /** Unique ID within the slide (e.g. "RG-1"). */
    groupId: string;
    /** Arrangement axis. */
    axis: 'horizontal' | 'vertical';
    /** Shape names of the primary repeating shapes. */
    shapeNames: string[];
    /** Shape IDs (from <p:cNvPr id="N">) parallel to shapeNames. Unique per slide. Optional for v1 backwards compat. */
    shapeIds?: string[];
    /** Bounding box enclosing all shapes in the group (EMU). */
    boundingBox: { left: number; top: number; width: number; height: number };
    /** Gap between consecutive shapes in EMU (edge-to-edge). */
    gap: number;
    /** Size of each individual shape (EMU). */
    shapeSize: { cx: number; cy: number };
    /** Column pairings: each primary shape + vertically associated shapes. */
    columns: ShapeColumn[];
}

/** A column in a repeatable group: primary shape + associated shapes at the same x-center. */
export interface ShapeColumn {
    /** 0-based index within the group. */
    index: number;
    /** Name of the primary (repeating) shape. */
    primaryShape: string;
    /** Shape ID of the primary shape (from <p:cNvPr id="N">). Optional for v1 backwards compat. */
    primaryShapeId?: string;
    /** Shapes vertically associated with this primary shape (same x-center). */
    associatedShapes: Array<{
        shapeName: string;
        shapeId?: string;
        offsetY: number;
        offsetX: number;
    }>;
}

export type SlideClassification =
    | 'title' | 'section' | 'content' | 'kpi' | 'process'
    | 'comparison' | 'two-column' | 'table' | 'chart'
    | 'pyramid' | 'matrix' | 'org-chart' | 'timeline' | 'image' | 'blank';

/** Estimated text capacity of a shape (V-4). */
export interface TextCapacity {
    /** Maximum characters that fit in this shape. */
    maxChars: number;
    /** Maximum lines that fit in this shape. */
    maxLines: number;
    /** Font size in pt. */
    fontSize: number;
}

/** Information about a single shape on a slide. */
export interface ShapeInfo {
    /** Shape name from <p:cNvPr name="...">. */
    shapeName: string;
    /** Human-readable semantic ID (e.g. "kpi_value_1"). */
    semanticId: string;
    /** Shape ID from <p:cNvPr id="...">. */
    shapeId: string;
    /** Element ID from the catalog (if matched). */
    elementId?: string;
    /** Placeholder type if present. */
    placeholderType?: string;
    /** Placeholder index if present. */
    placeholderIdx?: number;
    /** Current text content (for matching/replacement). */
    text: string;
    /** Whether this shape's text should be replaced (content-bearing). */
    isReplaceable: boolean;
    /** Position in EMU. */
    position: { left: number; top: number; width: number; height: number };
    /** Estimated text capacity (V-4). */
    textCapacity?: TextCapacity;
    /** Fill color from shape properties (e.g. "solid:accent1", "solid:#FF6600", "none"). */
    fillColor?: string;
    /** Original OOXML geometry / object signature. */
    geometry: string;
    /** Parsed object type (shape, picture, chart, table, ...). */
    objectType: RawShapeObjectType;
}

/* ------------------------------------------------------------------ */
/*  Fingerprint for deduplication                                      */
/* ------------------------------------------------------------------ */

interface ShapeFingerprint {
    geometry: string;
    fillType: string;
    lineStyle: string;
    aspectRatio: number;
}

/* ------------------------------------------------------------------ */
/*  Main entry point                                                   */
/* ------------------------------------------------------------------ */

/**
 * Analyze a PPTX template and extract element catalog, brand DNA, and slide compositions.
 *
 * @param templateData  ArrayBuffer of the template .pptx file
 * @returns             Complete template analysis
 */
export async function analyzeTemplate(templateData: ArrayBuffer): Promise<TemplateAnalysis> {
    const zip = await JSZip.loadAsync(templateData);

    // Extract brand DNA from theme
    const brandDNA = await extractBrandDNA(zip);

    // Find all slide files
    const slideNums = findSlideNumbers(zip);

    // Extract all shapes from all slides
    const allShapesBySlide: Map<number, RawShape[]> = new Map();
    for (const num of slideNums) {
        const shapes = await extractShapesFromSlide(zip, num);
        allShapesBySlide.set(num, shapes);
    }

    // Build element catalog (deduplicated)
    const elementCatalog = buildElementCatalog(allShapesBySlide);

    // Build slide compositions
    const slideCompositions: SlideComposition[] = [];
    for (const num of slideNums) {
        const rawShapes = allShapesBySlide.get(num) ?? [];
        const layoutName = await getLayoutName(zip, num);
        const composition = buildSlideComposition(num, layoutName, rawShapes, elementCatalog);
        slideCompositions.push(composition);
    }

    // Extract global decorative elements for auto-injection in HTML pipeline
    const dekoElements = await extractGlobalDekoElements(zip, slideCompositions, allShapesBySlide, brandDNA);

    return {
        slideCount: slideNums.length,
        brandDNA,
        elementCatalog,
        slideCompositions,
        dekoElements,
        allShapesBySlide,
    };
}

/* ------------------------------------------------------------------ */
/*  Brand DNA extraction                                               */
/* ------------------------------------------------------------------ */

/** Parse XML string into a DOM Document (Electron provides DOMParser). */
function parseXml(xml: string): Document {
    return new DOMParser().parseFromString(xml, 'application/xml');
}

async function extractBrandDNA(zip: JSZip): Promise<BrandDNA> {
    const colors: Record<string, string> = {};
    const fonts = { major: 'Calibri', minor: 'Calibri' };
    let slideSize = { cx: 12192000, cy: 6858000 }; // Default 16:9

    // Extract colors and fonts from theme1.xml via DOMParser
    const themeFile = zip.file('ppt/theme/theme1.xml');
    if (themeFile) {
        const doc = parseXml(await themeFile.async('text'));

        // Color scheme: dk1, dk2, lt1, lt2, accent1-6, hlink, folHlink
        const colorNames = ['dk1', 'dk2', 'lt1', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
        for (const name of colorNames) {
            const el = doc.getElementsByTagName(`a:${name}`)[0];
            if (el) {
                const hex = extractColorFromElement(el);
                if (hex) colors[name] = hex;
            }
        }

        // Font scheme: majorFont latin typeface, minorFont latin typeface
        const majorLatin = doc.getElementsByTagName('a:majorFont')[0]?.getElementsByTagName('a:latin')[0];
        if (majorLatin) fonts.major = majorLatin.getAttribute('typeface') ?? 'Calibri';

        const minorLatin = doc.getElementsByTagName('a:minorFont')[0]?.getElementsByTagName('a:latin')[0];
        if (minorLatin) fonts.minor = minorLatin.getAttribute('typeface') ?? 'Calibri';
    }

    // Extract slide size from presentation.xml via DOMParser
    const presFile = zip.file('ppt/presentation.xml');
    if (presFile) {
        const doc = parseXml(await presFile.async('text'));
        const sldSz = doc.getElementsByTagName('p:sldSz')[0];
        if (sldSz) {
            const cx = sldSz.getAttribute('cx');
            const cy = sldSz.getAttribute('cy');
            if (cx && cy) slideSize = { cx: parseInt(cx), cy: parseInt(cy) };
        }
    }

    return { colors, fonts, slideSize };
}

function extractColorFromElement(el: Element): string | null {
    // Try srgbClr (direct hex)
    const srgb = el.getElementsByTagName('a:srgbClr')[0];
    if (srgb) {
        const val = srgb.getAttribute('val');
        if (val) return `#${val}`;
    }

    // Try sysClr (system color with lastClr)
    const sys = el.getElementsByTagName('a:sysClr')[0];
    if (sys) {
        const lastClr = sys.getAttribute('lastClr');
        if (lastClr) return `#${lastClr}`;
    }

    return null;
}

/* ------------------------------------------------------------------ */
/*  Shape extraction from slides                                       */
/* ------------------------------------------------------------------ */

export interface RawShape {
    shapeName: string;
    shapeId: string;
    geometry: string;
    fill: string;
    line: string;
    position: { left: number; top: number; width: number; height: number };
    text: string;
    textFieldCount: number;
    placeholderType?: string;
    placeholderIdx?: number;
    hasText: boolean;
    fingerprint: ShapeFingerprint;
    /** Raw XML of the <p:sp> block (for font size extraction in V-4). */
    xml: string;
    /** Font size (in pt) inherited from slideLayout, if available. */
    layoutFontSize?: number;
    /** Parsed OOXML object type. */
    objectType: RawShapeObjectType;
}

export type RawShapeObjectType = 'shape' | 'group' | 'picture' | 'chart' | 'table' | 'graphic';

/**
 * Extract font sizes from the slideLayout associated with a slide.
 * Returns a Map keyed by placeholder identifier ("type:title", "idx:1", etc.)
 * with font size values in points.
 */
async function extractLayoutFontSizes(
    zip: JSZip,
    slideNum: number,
): Promise<Map<string, number>> {
    const result = new Map<string, number>();

    // Find layout number from slide rels
    const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
    const relsFile = zip.file(relsPath);
    if (!relsFile) return result;

    const relsXml = await relsFile.async('text');
    const layoutMatch = /\.\.\/slideLayouts\/slideLayout(\d+)\.xml/.exec(relsXml);
    if (!layoutMatch) return result;

    const layoutPath = `ppt/slideLayouts/slideLayout${layoutMatch[1]}.xml`;
    const layoutFile = zip.file(layoutPath);
    if (!layoutFile) return result;

    const layoutXml = await layoutFile.async('text');

    // Find all <p:sp> blocks in the layout and extract font sizes per placeholder
    const spPattern = /<p:sp\b[^>]*>/g;
    let spMatch: RegExpExecArray | null;
    while ((spMatch = spPattern.exec(layoutXml)) !== null) {
        const spStart = spMatch.index;
        const spEnd = findClosingTag(layoutXml, spStart, 'p:sp');
        if (spEnd < 0) continue;
        const spBlock = layoutXml.substring(spStart, spEnd);

        // Extract placeholder info
        const phMatch = /<p:ph\b([^>]*)\/?>/.exec(spBlock);
        if (!phMatch) continue;
        const phAttrs = phMatch[1];
        const typeMatch = /type="([^"]*)"/.exec(phAttrs);
        const idxMatch = /idx="(\d+)"/.exec(phAttrs);

        // Extract font size: try <a:defRPr sz=""> first (most common in layouts),
        // then <a:rPr sz="">
        const defRprSz = spBlock.match(/<a:defRPr[^>]*\bsz="(\d+)"/);
        const rprSz = spBlock.match(/<a:rPr[^>]*\bsz="(\d+)"/);
        const szValue = defRprSz?.[1] ?? rprSz?.[1];
        if (!szValue) continue;

        const fontSizePt = parseInt(szValue) / 100;

        // Store by type and/or idx for flexible lookup
        if (typeMatch) {
            result.set(`type:${typeMatch[1]}`, fontSizePt);
        }
        if (idxMatch) {
            result.set(`idx:${idxMatch[1]}`, fontSizePt);
        }
        // Also store by type if no explicit type but has idx (body placeholder)
        if (!typeMatch && idxMatch) {
            result.set(`type:body`, fontSizePt);
        }
    }

    return result;
}

function findSlideNumbers(zip: JSZip): number[] {
    const nums: number[] = [];
    zip.forEach((path) => {
        const m = /^ppt\/slides\/slide(\d+)\.xml$/.exec(path);
        if (m) nums.push(parseInt(m[1]));
    });
    return nums.sort((a, b) => a - b);
}

async function extractShapesFromSlide(zip: JSZip, slideNum: number): Promise<RawShape[]> {
    const path = `ppt/slides/slide${slideNum}.xml`;
    const file = zip.file(path);
    if (!file) return [];

    const xml = await file.async('text');
    const shapes: RawShape[] = [];

    // Pre-load font sizes from the associated slideLayout for inheritance
    const layoutFontSizes = await extractLayoutFontSizes(zip, slideNum);

    // First, identify all <p:grpSp> ranges so we can exclude nested <p:sp> from top-level
    const grpRanges: Array<{ start: number; end: number }> = [];
    const grpPattern = /<p:grpSp\b[^>]*>/g;
    let grpMatch: RegExpExecArray | null;
    while ((grpMatch = grpPattern.exec(xml)) !== null) {
        const grpStart = grpMatch.index;
        const grpEnd = findClosingTag(xml, grpStart, 'p:grpSp');
        if (grpEnd < 0) continue;
        grpRanges.push({ start: grpStart, end: grpEnd });

        const grpBlock = xml.substring(grpStart, grpEnd);

        // Extract group name
        const grpNameMatch = /<p:cNvPr\b[^>]*\bname="([^"]*)"/.exec(grpBlock);
        const grpName = grpNameMatch?.[1] ?? 'Group';
        const grpIdMatch = /<p:cNvPr\b[^>]*\bid="([^"]*)"/.exec(grpBlock);
        const grpId = grpIdMatch?.[1] ?? '0';

        // Count child shapes for fingerprint differentiation
        const childCount = (grpBlock.match(/<p:sp\b/g) ?? []).length;

        // Add the group itself as a structural element
        shapes.push({
            shapeName: grpName,
            shapeId: grpId,
            geometry: 'group',
            fill: 'none',
            line: 'none',
            position: extractPosition(grpBlock),
            text: '',
            textFieldCount: 0,
            hasText: false,
            fingerprint: { geometry: `group:${childCount}`, fillType: 'none', lineStyle: 'none', aspectRatio: 1 },
            xml: grpBlock,
            objectType: 'group',
        });

        // Extract child shapes from within the group
        const childSpPattern = /<p:sp\b[^>]*>/g;
        let childMatch: RegExpExecArray | null;
        while ((childMatch = childSpPattern.exec(grpBlock)) !== null) {
            const childStart = childMatch.index;
            const childEnd = findClosingTag(grpBlock, childStart, 'p:sp');
            if (childEnd < 0) continue;
            const childBlock = grpBlock.substring(childStart, childEnd);
            const shape = parseShape(childBlock);
            if (shape) shapes.push(shape);
        }

        const childPicPattern = /<p:pic\b[^>]*>/g;
        while ((childMatch = childPicPattern.exec(grpBlock)) !== null) {
            const childStart = childMatch.index;
            const childEnd = findClosingTag(grpBlock, childStart, 'p:pic');
            if (childEnd < 0) continue;
            const childBlock = grpBlock.substring(childStart, childEnd);
            const shape = parsePicture(childBlock);
            if (shape) shapes.push(shape);
        }

        const childGraphicPattern = /<p:graphicFrame\b[^>]*>/g;
        while ((childMatch = childGraphicPattern.exec(grpBlock)) !== null) {
            const childStart = childMatch.index;
            const childEnd = findClosingTag(grpBlock, childStart, 'p:graphicFrame');
            if (childEnd < 0) continue;
            const childBlock = grpBlock.substring(childStart, childEnd);
            const shape = parseGraphicFrame(childBlock);
            if (shape) shapes.push(shape);
        }
    }

    // Find top-level <p:sp> shapes (skip those inside <p:grpSp>)
    const spPattern = /<p:sp\b[^>]*>/g;
    let spMatch: RegExpExecArray | null;

    while ((spMatch = spPattern.exec(xml)) !== null) {
        const spStart = spMatch.index;

        // Skip shapes that are inside a group
        const insideGroup = grpRanges.some(r => spStart >= r.start && spStart < r.end);
        if (insideGroup) continue;

        const spEnd = findClosingTag(xml, spStart, 'p:sp');
        if (spEnd < 0) continue;

        const spBlock = xml.substring(spStart, spEnd);
        const shape = parseShape(spBlock);
        if (shape) shapes.push(shape);
    }

    const picPattern = /<p:pic\b[^>]*>/g;
    while ((spMatch = picPattern.exec(xml)) !== null) {
        const picStart = spMatch.index;
        const insideGroup = grpRanges.some(r => picStart >= r.start && picStart < r.end);
        if (insideGroup) continue;

        const picEnd = findClosingTag(xml, picStart, 'p:pic');
        if (picEnd < 0) continue;

        const picBlock = xml.substring(picStart, picEnd);
        const shape = parsePicture(picBlock);
        if (shape) shapes.push(shape);
    }

    const graphicFramePattern = /<p:graphicFrame\b[^>]*>/g;
    while ((spMatch = graphicFramePattern.exec(xml)) !== null) {
        const graphicStart = spMatch.index;
        const insideGroup = grpRanges.some(r => graphicStart >= r.start && graphicStart < r.end);
        if (insideGroup) continue;

        const graphicEnd = findClosingTag(xml, graphicStart, 'p:graphicFrame');
        if (graphicEnd < 0) continue;

        const graphicBlock = xml.substring(graphicStart, graphicEnd);
        const shape = parseGraphicFrame(graphicBlock);
        if (shape) shapes.push(shape);
    }

    // Apply layout font sizes to shapes that have placeholders
    for (const shape of shapes) {
        if (shape.layoutFontSize !== undefined) continue; // Already set
        // Try matching by placeholder type, then by placeholder idx
        if (shape.placeholderType) {
            const byType = layoutFontSizes.get(`type:${shape.placeholderType}`);
            if (byType) { shape.layoutFontSize = byType; continue; }
        }
        if (shape.placeholderIdx !== undefined) {
            const byIdx = layoutFontSizes.get(`idx:${shape.placeholderIdx}`);
            if (byIdx) { shape.layoutFontSize = byIdx; }
        }
    }

    return shapes;
}

function parseShape(spBlock: string): RawShape | null {
    const { shapeName, shapeId } = extractNonVisualProps(spBlock);

    // Extract geometry
    const geometry = extractGeometry(spBlock);

    // Extract fill
    const fill = extractFill(spBlock);

    // Extract line
    const line = extractLine(spBlock);

    // Extract position
    const position = extractPosition(spBlock);

    // Extract text
    const { text, fieldCount } = extractText(spBlock);

    // Extract placeholder info
    const { placeholderType, placeholderIdx } = extractPlaceholderInfo(spBlock);

    const hasText = text.trim().length > 0 || placeholderType !== undefined;
    const aspectRatio = position.height > 0 ? position.width / position.height : 1;

    const fingerprint: ShapeFingerprint = {
        geometry,
        fillType: fill,
        lineStyle: line,
        aspectRatio: Math.round(aspectRatio * 10) / 10, // Round to 1 decimal
    };

    return {
        shapeName,
        shapeId,
        geometry,
        fill,
        line,
        position,
        text,
        textFieldCount: fieldCount,
        placeholderType,
        placeholderIdx,
        hasText,
        fingerprint,
        xml: spBlock,
        objectType: 'shape',
    };
}

function parsePicture(picBlock: string): RawShape | null {
    const { shapeName, shapeId } = extractNonVisualProps(picBlock);
    const position = extractPosition(picBlock);
    const { placeholderType, placeholderIdx } = extractPlaceholderInfo(picBlock);
    const aspectRatio = position.height > 0 ? position.width / position.height : 1;

    return {
        shapeName,
        shapeId,
        geometry: 'picture',
        fill: 'image',
        line: 'none',
        position,
        text: '',
        textFieldCount: 0,
        placeholderType,
        placeholderIdx,
        hasText: false,
        fingerprint: {
            geometry: 'picture',
            fillType: 'image',
            lineStyle: 'none',
            aspectRatio: Math.round(aspectRatio * 10) / 10,
        },
        xml: picBlock,
        objectType: 'picture',
    };
}

function parseGraphicFrame(graphicBlock: string): RawShape | null {
    const { shapeName, shapeId } = extractNonVisualProps(graphicBlock);
    const position = extractPosition(graphicBlock);
    const { placeholderType, placeholderIdx } = extractPlaceholderInfo(graphicBlock);
    const { text, fieldCount } = extractText(graphicBlock);
    const kind = detectGraphicFrameKind(graphicBlock);
    const aspectRatio = position.height > 0 ? position.width / position.height : 1;
    const geometry = `graphicFrame:${kind}`;

    return {
        shapeName,
        shapeId,
        geometry,
        fill: kind === 'chart' ? 'chart' : kind === 'table' ? 'table' : 'graphic',
        line: 'none',
        position,
        text,
        textFieldCount: fieldCount,
        placeholderType,
        placeholderIdx,
        hasText: kind === 'table' ? text.trim().length > 0 : false,
        fingerprint: {
            geometry,
            fillType: kind,
            lineStyle: 'none',
            aspectRatio: Math.round(aspectRatio * 10) / 10,
        },
        xml: graphicBlock,
        objectType: kind,
    };
}

function extractNonVisualProps(block: string): { shapeName: string; shapeId: string } {
    const nameMatch = /<p:cNvPr\b[^>]*\bname="([^"]*)"/.exec(block);
    const idMatch = /<p:cNvPr\b[^>]*\bid="([^"]*)"/.exec(block);
    return {
        shapeName: nameMatch?.[1] ?? '',
        shapeId: idMatch?.[1] ?? '0',
    };
}

function extractPlaceholderInfo(block: string): { placeholderType?: string; placeholderIdx?: number } {
    const phMatch = /<p:ph\b([^>]*)\/?>/.exec(block);
    let placeholderType: string | undefined;
    let placeholderIdx: number | undefined;
    if (phMatch) {
        const phAttrs = phMatch[1];
        const typeMatch = /type="([^"]*)"/.exec(phAttrs);
        placeholderType = typeMatch?.[1];
        const idxMatch = /idx="(\d+)"/.exec(phAttrs);
        if (idxMatch) placeholderIdx = parseInt(idxMatch[1]);
        if (!placeholderType && placeholderIdx !== undefined) {
            placeholderType = 'body';
        }
    }
    return { placeholderType, placeholderIdx };
}

function detectGraphicFrameKind(graphicBlock: string): Exclude<RawShapeObjectType, 'shape' | 'group' | 'picture'> {
    if (/<c:chart\b/.test(graphicBlock) || /diagramm|chart/i.test(graphicBlock)) return 'chart';
    if (/<a:tbl\b/.test(graphicBlock) || /tabelle|table/i.test(graphicBlock)) return 'table';
    return 'graphic';
}

function extractGeometry(spBlock: string): string {
    // Preset geometry
    const prstMatch = /<a:prstGeom\s+prst="([^"]*)"/.exec(spBlock);
    if (prstMatch) return `prstGeom:${prstMatch[1]}`;

    // Custom geometry -- hash the path data
    const custMatch = /<a:custGeom>/.exec(spBlock);
    if (custMatch) {
        const pathMatch = /<a:path\b[^>]*>([\s\S]*?)<\/a:path>/.exec(spBlock);
        const pathData = pathMatch ? pathMatch[1].substring(0, 100) : '';
        const hash = simpleHash(pathData);
        return `custGeom:${hash}`;
    }

    return 'none';
}

function extractFill(spBlock: string): string {
    // Check within spPr (shape properties) for fill
    const spPrMatch = /<p:spPr\b[^>]*>([\s\S]*?)<\/p:spPr>/.exec(spBlock);
    const searchBlock = spPrMatch ? spPrMatch[1] : spBlock;

    // Solid fill
    const solidMatch = /<a:solidFill>([\s\S]*?)<\/a:solidFill>/.exec(searchBlock);
    if (solidMatch) {
        const colorBlock = solidMatch[1];
        const schemeMatch = /schemeClr\s+val="([^"]*)"/.exec(colorBlock);
        if (schemeMatch) return `solid:${schemeMatch[1]}`;
        const srgbMatch = /srgbClr\s+val="([^"]*)"/.exec(colorBlock);
        if (srgbMatch) return `solid:#${srgbMatch[1]}`;
        return 'solid';
    }

    // Gradient fill
    if (/<a:gradFill>/.test(searchBlock)) return 'gradient';

    // Pattern fill
    if (/<a:pattFill>/.test(searchBlock)) return 'pattern';

    // No fill
    if (/<a:noFill\s*\/>/.test(searchBlock)) return 'none';

    return 'inherited';
}

function extractLine(spBlock: string): string {
    const lnMatch = /<a:ln\b([^>]*)>([\s\S]*?)<\/a:ln>/.exec(spBlock);
    if (!lnMatch) return 'none';

    const attrs = lnMatch[1];
    const content = lnMatch[2];

    // No line
    if (/<a:noFill\s*\/>/.test(content)) return 'none';

    const widthMatch = /w="(\d+)"/.exec(attrs);
    const width = widthMatch ? Math.round(parseInt(widthMatch[1]) / EMU_PT_TO_EMU) : 1;

    const schemeMatch = /schemeClr\s+val="([^"]*)"/.exec(content);
    const colorPart = schemeMatch ? `:${schemeMatch[1]}` : '';

    return `${width}pt${colorPart}`;
}

function extractPosition(spBlock: string): { left: number; top: number; width: number; height: number } {
    const offMatch = /<a:off\s+x="(\d+)"\s+y="(\d+)"/.exec(spBlock);
    const extMatch = /<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/.exec(spBlock);

    return {
        left: offMatch ? parseInt(offMatch[1]) : 0,
        top: offMatch ? parseInt(offMatch[2]) : 0,
        width: extMatch ? parseInt(extMatch[1]) : 0,
        height: extMatch ? parseInt(extMatch[2]) : 0,
    };
}

function extractText(spBlock: string): { text: string; fieldCount: number } {
    const textPattern = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
    let fullText = '';
    let tMatch: RegExpExecArray | null;
    while ((tMatch = textPattern.exec(spBlock)) !== null) {
        fullText += tMatch[1];
    }

    // Count distinct paragraphs with text as "fields"
    const paraPattern = /<a:p\b[^>]*>[\s\S]*?<\/a:p>/g;
    let fieldCount = 0;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = paraPattern.exec(spBlock)) !== null) {
        if (/<a:t[^>]*>/.test(pMatch[0])) fieldCount++;
    }

    const decoded = decodeXmlEntities(fullText);

    return { text: decoded, fieldCount: fullText.length > 0 ? Math.max(fieldCount, 1) : 0 };
}

/* ------------------------------------------------------------------ */
/*  Element catalog (deduplicated)                                     */
/* ------------------------------------------------------------------ */

function buildElementCatalog(allShapesBySlide: Map<number, RawShape[]>): DesignElement[] {
    const fingerprintMap = new Map<string, { shape: RawShape; slides: number[] }>();

    for (const [slideNum, shapes] of allShapesBySlide) {
        for (const shape of shapes) {
            // Skip placeholders from slide masters (title, footer, slide number)
            if (shape.placeholderType === 'ftr' || shape.placeholderType === 'sldNum' || shape.placeholderType === 'dt') {
                continue;
            }

            const key = fingerprintKey(shape.fingerprint);
            const existing = fingerprintMap.get(key);
            if (existing) {
                if (!existing.slides.includes(slideNum)) {
                    existing.slides.push(slideNum);
                }
            } else {
                fingerprintMap.set(key, { shape, slides: [slideNum] });
            }
        }
    }

    const elements: DesignElement[] = [];
    let idx = 1;
    for (const [, { shape, slides }] of fingerprintMap) {
        const id = `E-${String(idx).padStart(3, '0')}`;
        const category = categorizeElement(shape);
        const name = generateElementName(shape);
        const suggestedUse = suggestUseCase(shape, category);

        elements.push({
            id,
            name,
            geometry: shape.geometry,
            category,
            hasText: shape.hasText,
            textFieldCount: shape.textFieldCount,
            size: { cx: shape.position.width, cy: shape.position.height },
            fill: shape.fill,
            line: shape.line,
            appearsOn: slides,
            suggestedUse,
        });
        idx++;
    }

    return elements;
}

function fingerprintKey(fp: ShapeFingerprint): string {
    return `${fp.geometry}|${fp.fillType}|${fp.lineStyle}|${fp.aspectRatio}`;
}

function categorizeElement(shape: RawShape): ElementCategory {
    const geom = shape.geometry;

    if (shape.objectType === 'chart' || shape.objectType === 'table' || shape.objectType === 'picture' || shape.objectType === 'graphic') {
        return 'media';
    }

    // Background shapes (full-width, tall rectangles)
    if (geom.includes('rect') && shape.position.width > EMU_BACKGROUND_W && shape.position.height > EMU_BACKGROUND_H) {
        return 'background';
    }

    // Connectors and arrows
    if (geom.includes('Arrow') || geom.includes('arrow') || geom.includes('line') || geom.includes('connector')) {
        return 'connector';
    }

    // Media placeholders
    if (shape.placeholderType === 'pic' || shape.placeholderType === 'chart' || shape.placeholderType === 'media') {
        return 'media';
    }

    // Groups are structural
    if (geom === 'group') {
        return 'structural';
    }

    // Decorative: thin bars, small shapes without text
    if (!shape.hasText && (shape.position.height < EMU_DECORATIVE || shape.position.width < EMU_DECORATIVE)) {
        return 'decorative';
    }

    // Content-bearing: has text or is a placeholder
    if (shape.hasText || shape.placeholderType) {
        return 'content-bearing';
    }

    return 'decorative';
}

function generateElementName(shape: RawShape): string {
    const geom = shape.geometry;

    if (shape.objectType === 'picture') return shape.shapeName || 'Bild';
    if (shape.objectType === 'chart') return shape.shapeName || 'Diagramm';
    if (shape.objectType === 'table') return shape.shapeName || 'Tabelle';
    if (shape.objectType === 'graphic') return shape.shapeName || 'Grafik';

    // Preset geometry names
    const presetNames: Record<string, string> = {
        'prstGeom:rect': 'Rechteck',
        'prstGeom:roundRect': 'Abgerundetes Rechteck',
        'prstGeom:ellipse': 'Ellipse',
        'prstGeom:chevron': 'Chevron',
        'prstGeom:homePlate': 'Pfeil-Polygon',
        'prstGeom:triangle': 'Dreieck',
        'prstGeom:trapezoid': 'Trapez',
        'prstGeom:parallelogram': 'Parallelogramm',
        'prstGeom:hexagon': 'Hexagon',
        'prstGeom:octagon': 'Oktagon',
        'prstGeom:diamond': 'Raute',
        'prstGeom:star5': 'Stern (5)',
        'prstGeom:rightArrow': 'Pfeil rechts',
        'prstGeom:leftArrow': 'Pfeil links',
        'prstGeom:downArrow': 'Pfeil unten',
        'prstGeom:upArrow': 'Pfeil oben',
        'prstGeom:callout1': 'Callout',
        'prstGeom:cloud': 'Wolke',
        'prstGeom:flowChartProcess': 'Flowchart: Prozess',
        'prstGeom:flowChartDecision': 'Flowchart: Entscheidung',
        'prstGeom:flowChartTerminator': 'Flowchart: Start/Ende',
    };

    if (presetNames[geom]) return presetNames[geom];
    if (geom.startsWith('prstGeom:')) return geom.replace('prstGeom:', '');
    if (geom.startsWith('custGeom:')) return 'Custom Shape';
    if (geom === 'group') return 'Gruppe';
    if (geom === 'none') return shape.shapeName || 'Textbox';

    return shape.shapeName || 'Shape';
}

function suggestUseCase(shape: RawShape, category: ElementCategory): string {
    const geom = shape.geometry;

    if (category === 'decorative') return 'Visuelle Trennung, Dekoration';
    if (category === 'background') return 'Slide-Hintergrund';
    if (category === 'connector') return 'Verbindungen zwischen Elementen';
    if (category === 'media') return 'Bild/Chart/Media-Platzhalter';
    if (category === 'structural') return 'Container/Gruppe fuer andere Elemente';

    // Content-bearing suggestions based on geometry
    if (geom.includes('chevron') || geom.includes('homePlate')) return 'Prozessschritte, Sequenzen, Timelines';
    if (geom.includes('roundRect')) return 'KPI-Karten, Info-Boxen, Highlights';
    if (geom.includes('triangle') || geom.includes('trapezoid')) return 'Hierarchien, Priorisierungen, Pyramiden';
    if (geom.includes('diamond')) return 'Entscheidungspunkte, Bewertungen';
    if (geom.includes('ellipse') || geom.includes('circle')) return 'Highlights, Nummern, Icons';
    if (geom.includes('hexagon')) return 'Kategorien, Module, Cluster';
    if (geom.includes('flowChart')) return 'Flowcharts, Entscheidungsbaeume';
    if (geom.includes('Arrow') || geom.includes('arrow')) return 'Richtung, Fortschritt, Verbindungen';

    if (shape.placeholderType === 'title' || shape.placeholderType === 'ctrTitle') return 'Folientitel';
    if (shape.placeholderType === 'subTitle') return 'Untertitel';
    if (shape.placeholderType === 'body') return 'Hauptinhalt, Bullets, Beschreibungen';

    return 'Textinhalt';
}

/* ------------------------------------------------------------------ */
/*  Slide composition and classification                               */
/* ------------------------------------------------------------------ */

async function getLayoutName(zip: JSZip, slideNum: number): Promise<string> {
    const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
    const relsFile = zip.file(relsPath);
    if (!relsFile) return 'Unknown';

    // Parse rels XML to find slideLayout relationship
    const relsDoc = parseXml(await relsFile.async('text'));
    const rels = relsDoc.getElementsByTagName('Relationship');
    let layoutNum: string | null = null;
    for (let i = 0; i < rels.length; i++) {
        const target = rels[i].getAttribute('Target') ?? '';
        const match = /\.\.\/slideLayouts\/slideLayout(\d+)\.xml/.exec(target);
        if (match) { layoutNum = match[1]; break; }
    }
    if (!layoutNum) return 'Unknown';

    const layoutPath = `ppt/slideLayouts/slideLayout${layoutNum}.xml`;
    const layoutFile = zip.file(layoutPath);
    if (!layoutFile) return `Layout ${layoutNum}`;

    // Extract layout name from cSld element via DOMParser
    const layoutDoc = parseXml(await layoutFile.async('text'));
    const cSld = layoutDoc.getElementsByTagName('p:cSld')[0];
    return cSld?.getAttribute('name') ?? `Layout ${layoutNum}`;
}

function buildSlideComposition(
    slideNum: number,
    layoutName: string,
    rawShapes: RawShape[],
    elementCatalog: DesignElement[],
): SlideComposition {
    const shapes: ShapeInfo[] = rawShapes.map(rs => {
        // Try to match to an element in the catalog via fingerprint
        const fpKey = fingerprintKey(rs.fingerprint);
        const element = elementCatalog.find(e => {
            const eFp: ShapeFingerprint = {
                geometry: e.geometry,
                fillType: e.fill,
                lineStyle: e.line,
                aspectRatio: Math.round((e.size.cx / Math.max(e.size.cy, 1)) * 10) / 10,
            };
            return fingerprintKey(eFp) === fpKey;
        });

        // Determine if text should be replaced
        const isReplaceable = rs.hasText && (
            rs.objectType === 'shape' &&
            rs.placeholderType !== 'ftr' &&
            rs.placeholderType !== 'sldNum' &&
            rs.placeholderType !== 'dt'
        );

        return {
            shapeName: rs.shapeName,
            semanticId: '', // Placeholder, set after classification is known
            shapeId: rs.shapeId,
            elementId: element?.id,
            placeholderType: rs.placeholderType,
            placeholderIdx: rs.placeholderIdx,
            text: rs.text,
            isReplaceable,
            position: rs.position,
            textCapacity: estimateTextCapacity(rs),
            fillColor: rs.fill !== 'none' ? rs.fill : undefined,
            geometry: rs.geometry,
            objectType: rs.objectType,
        };
    });

    const classification = classifySlide(rawShapes, shapes, layoutName);

    // Generate semantic IDs (V-1) -- only for replaceable shapes, with incrementing index
    let contentIndex = 1;
    for (const shape of shapes) {
        if (shape.isReplaceable) {
            shape.semanticId = generateSemanticId(classification, slideNum, shape, elementCatalog, contentIndex);
            contentIndex++;
        }
    }
    const description = generateSlideDescription(classification, shapes);

    const repeatableGroups = detectRepeatableGroups(rawShapes, shapes);

    const embeddedObjects = {
        charts: rawShapes.filter(rs => rs.objectType === 'chart').length,
        tables: rawShapes.filter(rs => rs.objectType === 'table').length,
        pictures: rawShapes.filter(rs => rs.objectType === 'picture').length,
        graphics: rawShapes.filter(rs => rs.objectType === 'graphic').length,
    };

    return {
        slideNumber: slideNum,
        layoutName,
        classification,
        shapes,
        description,
        repeatableGroups,
        embeddedObjects,
    };
}

/* ------------------------------------------------------------------ */
/*  Repeatable Group Detection                                         */
/* ------------------------------------------------------------------ */

/** Size tolerance for fingerprint matching (5%). */
const SIZE_TOLERANCE = 0.05;

/**
 * Detect groups of shapes with identical visual fingerprint arranged linearly.
 * E.g. 5 chevrons in a row, or 3 KPI boxes in a column.
 *
 * Algorithm:
 * 1. Group shapes by fingerprint + similar size
 * 2. For groups >= 2: detect linear arrangement (horizontal or vertical)
 * 3. Compute bounding box, gap, and column pairings
 */
function detectRepeatableGroups(rawShapes: RawShape[], shapeInfos: ShapeInfo[]): RepeatableGroup[] {
    // Step 1: Group by fingerprint + size similarity
    const fpGroups = new Map<string, { raw: RawShape; info: ShapeInfo }[]>();

    for (let i = 0; i < rawShapes.length; i++) {
        const raw = rawShapes[i];
        const info = shapeInfos[i];

        // Only consider content-bearing shapes with text
        if (!info.isReplaceable && !raw.hasText) continue;
        // Skip very small shapes (decorative)
        if (raw.position.width < EMU_DECORATIVE || raw.position.height < EMU_DECORATIVE) continue;

        const fpKey = fingerprintKey(raw.fingerprint);
        const sizeKey = `${Math.round(raw.position.width / 100000)}_${Math.round(raw.position.height / 100000)}`;
        const groupKey = `${fpKey}|${sizeKey}`;

        const group = fpGroups.get(groupKey) ?? [];
        group.push({ raw, info });
        fpGroups.set(groupKey, group);
    }

    const results: RepeatableGroup[] = [];
    let groupIndex = 1;

    for (const members of fpGroups.values()) {
        if (members.length < 2) continue;

        // Step 2: Check for linear arrangement
        const sorted = [...members];

        // Try horizontal: sort by left, check if tops are similar
        sorted.sort((a, b) => a.raw.position.left - b.raw.position.left);
        const avgHeight = sorted.reduce((s, m) => s + m.raw.position.height, 0) / sorted.length;
        const topVariation = Math.max(...sorted.map(m => m.raw.position.top)) -
            Math.min(...sorted.map(m => m.raw.position.top));
        const isHorizontal = topVariation < avgHeight * 0.3;

        // Try vertical: sort by top, check if lefts are similar
        const sortedV = [...members];
        sortedV.sort((a, b) => a.raw.position.top - b.raw.position.top);
        const avgWidth = sortedV.reduce((s, m) => s + m.raw.position.width, 0) / sortedV.length;
        const leftVariation = Math.max(...sortedV.map(m => m.raw.position.left)) -
            Math.min(...sortedV.map(m => m.raw.position.left));
        const isVertical = leftVariation < avgWidth * 0.3;

        if (!isHorizontal && !isVertical) continue;

        const axis: 'horizontal' | 'vertical' = isHorizontal ? 'horizontal' : 'vertical';
        const arranged = axis === 'horizontal' ? sorted : sortedV;

        // Step 3: Compute bounding box and gap
        const minLeft = Math.min(...arranged.map(m => m.raw.position.left));
        const minTop = Math.min(...arranged.map(m => m.raw.position.top));
        const maxRight = Math.max(...arranged.map(m => m.raw.position.left + m.raw.position.width));
        const maxBottom = Math.max(...arranged.map(m => m.raw.position.top + m.raw.position.height));

        const boundingBox = {
            left: minLeft,
            top: minTop,
            width: maxRight - minLeft,
            height: maxBottom - minTop,
        };

        // Average gap between consecutive shapes
        let totalGap = 0;
        for (let i = 1; i < arranged.length; i++) {
            if (axis === 'horizontal') {
                const prevRight = arranged[i - 1].raw.position.left + arranged[i - 1].raw.position.width;
                totalGap += arranged[i].raw.position.left - prevRight;
            } else {
                const prevBottom = arranged[i - 1].raw.position.top + arranged[i - 1].raw.position.height;
                totalGap += arranged[i].raw.position.top - prevBottom;
            }
        }
        const gap = arranged.length > 1 ? Math.round(totalGap / (arranged.length - 1)) : 0;

        const shapeSize = {
            cx: arranged[0].raw.position.width,
            cy: arranged[0].raw.position.height,
        };

        // Step 4: Column pairing -- find associated shapes at same x-center (or y-center for vertical)
        const usedInGroups = new Set(arranged.map(m => m.info.shapeName));
        const columns: ShapeColumn[] = arranged.map((member, idx) => {
            const associatedShapes: ShapeColumn['associatedShapes'] = [];
            const primaryCenterX = member.raw.position.left + member.raw.position.width / 2;
            const primaryCenterY = member.raw.position.top + member.raw.position.height / 2;
            const halfWidth = member.raw.position.width / 2;
            const halfHeight = member.raw.position.height / 2;

            for (let i = 0; i < rawShapes.length; i++) {
                const candidate = rawShapes[i];
                const candidateInfo = shapeInfos[i];
                if (usedInGroups.has(candidateInfo.shapeName)) continue;
                // Skip shapes wider than 200% of primary (likely background)
                if (candidate.position.width > member.raw.position.width * 2) continue;

                const candidateCenterX = candidate.position.left + candidate.position.width / 2;
                const candidateCenterY = candidate.position.top + candidate.position.height / 2;

                if (axis === 'horizontal') {
                    // Check if candidate shares approximate x-center
                    if (Math.abs(candidateCenterX - primaryCenterX) < halfWidth * 0.6) {
                        associatedShapes.push({
                            shapeName: candidateInfo.shapeName,
                            shapeId: candidateInfo.shapeId,
                            offsetY: candidate.position.top - member.raw.position.top,
                            offsetX: candidate.position.left - member.raw.position.left,
                        });
                    }
                } else {
                    // Vertical: check if candidate shares approximate y-center
                    if (Math.abs(candidateCenterY - primaryCenterY) < halfHeight * 0.6) {
                        associatedShapes.push({
                            shapeName: candidateInfo.shapeName,
                            shapeId: candidateInfo.shapeId,
                            offsetY: candidate.position.top - member.raw.position.top,
                            offsetX: candidate.position.left - member.raw.position.left,
                        });
                    }
                }
            }

            return {
                index: idx,
                primaryShape: member.info.shapeName,
                primaryShapeId: member.info.shapeId,
                associatedShapes,
            };
        });

        results.push({
            groupId: `RG-${groupIndex}`,
            axis,
            shapeNames: arranged.map(m => m.info.shapeName),
            shapeIds: arranged.map(m => m.info.shapeId),
            boundingBox,
            gap,
            shapeSize,
            columns,
        });
        groupIndex++;
    }

    return results;
}

/* ------------------------------------------------------------------ */
/*  Rule-based slide classification                                    */
/* ------------------------------------------------------------------ */

interface ClassificationContext {
    raw: RawShape[];
    content: ShapeInfo[];
    hasTitle: boolean;
    hasSubtitle: boolean;
    hasBody: boolean;
    smallText: RawShape[];
    largeBodies: RawShape[];
    layoutName: string;
}

interface ClassificationRule {
    classification: SlideClassification;
    test: (ctx: ClassificationContext) => boolean;
}

const CLASSIFICATION_RULES: ClassificationRule[] = [
    // Title slide: ctrTitle or title+subtitle, few other shapes
    { classification: 'title', test: (ctx) =>
        ctx.hasTitle && ctx.hasSubtitle && ctx.content.length <= 3,
    },
    // Section divider: title, no body, few content shapes
    { classification: 'section', test: (ctx) =>
        ctx.hasTitle && !ctx.hasBody && ctx.content.length <= 2,
    },
    // Embedded charts/tables must be recognized before generic text-layout rules.
    { classification: 'chart', test: (ctx) =>
        ctx.raw.some(rs => rs.placeholderType === 'chart' || rs.objectType === 'chart'),
    },
    { classification: 'table', test: (ctx) =>
        ctx.raw.some(rs => rs.placeholderType === 'tbl' || rs.objectType === 'table'),
    },
    // KPI: 3-8 similar small text shapes (grid-like)
    { classification: 'kpi', test: (ctx) =>
        ctx.smallText.length >= 3 && ctx.smallText.length <= 8 &&
        calculateSizeVariance(ctx.smallText) < 0.3,
    },
    // Process: 3+ chevrons or homePlate shapes
    { classification: 'process', test: (ctx) =>
        ctx.raw.filter(rs => rs.geometry.includes('chevron') || rs.geometry.includes('homePlate')).length >= 3,
    },
    // Two-column: two large content areas side by side
    { classification: 'two-column', test: (ctx) => {
        if (ctx.largeBodies.length !== 2) return false;
        const sorted = [...ctx.largeBodies].sort((a, b) => a.position.left - b.position.left);
        return sorted[1].position.left > sorted[0].position.left + sorted[0].position.width * 0.5;
    }},
    // Pyramid: 3+ trapezoid/triangle shapes
    { classification: 'pyramid', test: (ctx) =>
        ctx.raw.filter(rs => rs.geometry.includes('trapezoid') || rs.geometry.includes('triangle')).length >= 3,
    },
    // Timeline: arrows/connectors + multiple small text shapes
    { classification: 'timeline', test: (ctx) => {
        const arrows = ctx.raw.filter(rs =>
            rs.geometry.includes('arrow') || rs.geometry.includes('Arrow') ||
            rs.geometry.includes('line') || rs.geometry.includes('connector'));
        return arrows.length >= 2 && ctx.smallText.length >= 3;
    }},
    // Comparison: large bodies + structured shapes
    { classification: 'comparison', test: (ctx) => {
        if (ctx.largeBodies.length < 2 || ctx.smallText.length < 2) return false;
        const structured = ctx.raw.filter(rs =>
            !rs.placeholderType && rs.geometry !== 'none' && rs.geometry !== 'prstGeom:rect');
        return structured.length >= 2;
    }},
    // Org-chart: connectors + many small text boxes
    { classification: 'org-chart', test: (ctx) => {
        const connectors = ctx.raw.filter(rs =>
            rs.geometry.includes('connector') || rs.geometry.includes('line'));
        return connectors.length >= 2 && ctx.smallText.length >= 4;
    }},
    // Matrix: exactly 4 equal-sized quadrants
    { classification: 'matrix', test: (ctx) =>
        ctx.smallText.length === 4 && calculateSizeVariance(ctx.smallText) < 0.2,
    },
    // Image placeholders
    { classification: 'image', test: (ctx) =>
        ctx.raw.some(rs => rs.placeholderType === 'pic' || rs.objectType === 'picture'),
    },
    // Blank: no content
    { classification: 'blank', test: (ctx) => {
        const nonDeco = ctx.raw.filter(rs =>
            rs.hasText || rs.placeholderType === 'title' || rs.placeholderType === 'ctrTitle');
        return ctx.content.length === 0 && nonDeco.length === 0;
    }},
];

/** Layout name patterns that hint at specific classifications. */
const LAYOUT_CLASSIFICATION_HINTS: Array<[RegExp, SlideClassification]> = [
    [/vergleich|compar/i, 'comparison'],
    [/prozess|process/i, 'process'],
    [/zeitstrahl|timeline/i, 'timeline'],
    [/pyramide|pyramid/i, 'pyramid'],
    [/organi[sz]|org.chart/i, 'org-chart'],
    [/matrix|swot/i, 'matrix'],
];

function classifySlide(rawShapes: RawShape[], shapes: ShapeInfo[], layoutName: string): SlideClassification {
    const ctx: ClassificationContext = {
        raw: rawShapes,
        content: shapes.filter(s => s.isReplaceable),
        hasTitle: rawShapes.some(rs => rs.placeholderType === 'title' || rs.placeholderType === 'ctrTitle'),
        hasSubtitle: rawShapes.some(rs => rs.placeholderType === 'subTitle'),
        hasBody: rawShapes.some(rs => rs.placeholderType === 'body'),
        smallText: rawShapes.filter(rs =>
            rs.hasText && !rs.placeholderType &&
            rs.position.width < EMU_SMALL_WIDTH && rs.position.height < EMU_SMALL_HEIGHT),
        largeBodies: rawShapes.filter(rs =>
            rs.hasText && rs.position.width > EMU_BODY_MIN && rs.position.width < EMU_BODY_MAX),
        layoutName,
    };

    // Test rules in priority order
    for (const rule of CLASSIFICATION_RULES) {
        if (rule.test(ctx)) return rule.classification;
    }

    // Fallback: layout name hints
    const layoutLower = layoutName.toLowerCase();
    for (const [pattern, classification] of LAYOUT_CLASSIFICATION_HINTS) {
        if (pattern.test(layoutLower)) return classification;
    }

    return 'content';
}

function calculateSizeVariance(shapes: RawShape[]): number {
    if (shapes.length < 2) return 0;
    const widths = shapes.map(s => s.position.width);
    const avg = widths.reduce((a, b) => a + b, 0) / widths.length;
    const variance = widths.reduce((sum, w) => sum + Math.pow(w - avg, 2), 0) / widths.length;
    return Math.sqrt(variance) / avg; // Coefficient of variation
}

function generateSlideDescription(classification: SlideClassification, shapes: ShapeInfo[]): string {
    const replaceableCount = shapes.filter(s => s.isReplaceable).length;
    const meta = COMPOSITION_METADATA[classification];
    return `${meta.displayName} (${replaceableCount} ersetzbare Textfelder)`;
}

/* ------------------------------------------------------------------ */
/*  Skill generation                                                   */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Semantic IDs and Text Capacity (V-1, V-4)                          */
/* ------------------------------------------------------------------ */

/**
 * Generate a human-readable semantic ID for a shape.
 * Schema: {slideClassification}_s{slideNum}_{role}_{index}
 *
 * Slide number is included to ensure global uniqueness across the template.
 *
 * Role derivation priority:
 * 1. placeholderType (title, body, subTitle)
 * 2. Element geometry from catalog (chevron, roundRect, etc.)
 * 3. Fallback: text_{index}
 */
function generateSemanticId(
    classification: SlideClassification,
    slideNum: number,
    shape: ShapeInfo,
    elementCatalog: DesignElement[],
    contentIndex: number,
): string {
    const prefix = `${classification}_s${slideNum}`;

    // 1. Placeholder type
    if (shape.placeholderType === 'title' || shape.placeholderType === 'ctrTitle')
        return `${prefix}_title`;
    if (shape.placeholderType === 'subTitle')
        return `${prefix}_subtitle`;
    if (shape.placeholderType === 'body')
        return `${prefix}_body_${contentIndex}`;

    // 2. Element geometry from catalog
    if (shape.elementId) {
        const element = elementCatalog.find(e => e.id === shape.elementId);
        if (element) {
            const geom = element.geometry;
            if (geom.includes('chevron') || geom.includes('homePlate'))
                return `${prefix}_step_${contentIndex}`;
            if (geom.includes('roundRect'))
                return `${prefix}_card_${contentIndex}`;
            if (geom.includes('triangle'))
                return `${prefix}_segment_${contentIndex}`;
            if (geom.includes('custGeom'))
                return `${prefix}_element_${contentIndex}`;
        }
    }

    // 3. Fallback
    return `${prefix}_text_${contentIndex}`;
}

/**
 * Estimate how much text fits into a shape based on dimensions and font size.
 */
function estimateTextCapacity(rawShape: RawShape): TextCapacity | undefined {
    // Placeholder shapes (title, body, subTitle, etc.) are ALWAYS fillable
    // even if they contain no text in the template XML (inherited from layout/master).
    if (!rawShape.hasText && !rawShape.placeholderType) return undefined;

    // 4-level font size fallback:
    // 1. Explicit <a:rPr sz=""> in shape XML (run-level)
    // 2. <a:defRPr sz=""> in shape XML (default run properties, common in placeholders)
    // 3. Font size inherited from slideLayout (via placeholder type/idx matching)
    // 4. Default: 18pt
    const rprSz = rawShape.xml.match(/<a:rPr[^>]*\bsz="(\d+)"/);
    const defRprSz = rawShape.xml.match(/<a:defRPr[^>]*\bsz="(\d+)"/);
    let fontSizePt: number;
    if (rprSz) {
        fontSizePt = parseInt(rprSz[1]) / 100;
    } else if (defRprSz) {
        fontSizePt = parseInt(defRprSz[1]) / 100;
    } else if (rawShape.layoutFontSize) {
        fontSizePt = rawShape.layoutFontSize;
    } else {
        fontSizePt = 18;
    }
    const fontSizePx = fontSizePt * PT_TO_PX;

    const widthPx = rawShape.position.width / EMU_PER_PX;
    const heightPx = rawShape.position.height / EMU_PER_PX;

    const charsPerLine = Math.floor(widthPx / (fontSizePx * AVG_CHAR_WIDTH_FACTOR));
    const maxLines = Math.floor(heightPx / (fontSizePx * LINE_HEIGHT_FACTOR));

    if (charsPerLine <= 0 || maxLines <= 0) return undefined;

    const maxChars = charsPerLine * maxLines;

    // Plausibility check: if shape is large but computed capacity is very small,
    // the font is likely huge (section dividers, headlines). Ensure at least
    // single-line capacity is reported.
    if (maxChars < 3 && widthPx * heightPx > 50000) {
        return { maxChars: Math.max(charsPerLine, 1), maxLines: 1, fontSize: fontSizePt };
    }

    return { maxChars, maxLines, fontSize: fontSizePt };
}

/* ------------------------------------------------------------------ */
/*  Composition grouping                                               */
/* ------------------------------------------------------------------ */

/** A group of slides that share the same classification (= same visual composition). */
export interface CompositionGroup {
    /** Human-readable name for this composition type. */
    name: string;
    /** Slide classification. */
    classification: SlideClassification;
    /** Slide numbers that belong to this group. */
    slideNumbers: number[];
    /** Semantic meaning heuristic based on classification + geometry. */
    meaning: string;
    /** When to use this composition. */
    useWhen: string;
    /** Representative shapes (from first slide in group, replaceable only). */
    representativeShapes: ShapeInfo[];
    /** Count of non-replaceable, non-footer decorative shapes (icons, images, fixed geometry). */
    decorativeElementCount: number;
    /** True if composition has fixed icons or images that cannot be replaced. */
    hasFixedVisuals: boolean;
    /** Embedded static chart objects across the grouped slides. */
    staticChartCount: number;
    /** Embedded static table objects across the grouped slides. */
    staticTableCount: number;
    /** Embedded pictures/icons across the grouped slides. */
    staticPictureCount: number;
    /** Other non-text graphic frames across the grouped slides. */
    staticGraphicCount: number;
}

/**
 * Group slide compositions by classification into semantic composition groups.
 * Slides with the same classification are treated as variants of the same visual form.
 */
export function groupByComposition(analysis: TemplateAnalysis): CompositionGroup[] {
    // Group by classification, but sub-group 'content' slides by layout+shape count
    // to avoid one mega-group with 50+ slides
    const groups = new Map<string, SlideComposition[]>();

    for (const comp of analysis.slideCompositions) {
        // Sub-group ALL classifications by layout + shape structure,
        // not just 'content'. Prevents e.g. 17 KPI slides from collapsing
        // into one mega-group when they have different visual structures.
        const groupKey = buildSubGroupKey(comp);

        const existing = groups.get(groupKey) ?? [];
        existing.push(comp);
        groups.set(groupKey, existing);
    }

    const result: CompositionGroup[] = [];
    for (const [, compositions] of groups) {
        const slideNumbers = compositions.map(c => c.slideNumber);
        const firstComp = compositions[0];
        const replaceableShapes = firstComp.shapes.filter(s => s.isReplaceable);
        const baseClassification = firstComp.classification;

        // Derive name/meaning: use sub-group variant if this classification was split
        const meta = COMPOSITION_METADATA[baseClassification];
        const totalWithClassification = analysis.slideCompositions
            .filter(c => c.classification === baseClassification).length;
        const isSubGrouped = compositions.length < totalWithClassification;

        const name = isSubGrouped
            ? subGroupName(firstComp, meta)
            : meta.name;
        const meaning = isSubGrouped
            ? subGroupMeaning(firstComp, meta)
            : meta.meaning;

        // Count decorative elements (non-replaceable, non-footer shapes)
        const footerTypes = new Set(['ftr', 'sldNum', 'dt']);
        const decorativeShapes = firstComp.shapes.filter(s =>
            !s.isReplaceable &&
            !footerTypes.has(s.placeholderType ?? '')
        );
        const hasFixedVisuals = decorativeShapes.some(s =>
            s.placeholderType === 'pic' ||
            s.objectType === 'picture' ||
            s.objectType === 'chart' ||
            s.objectType === 'table' ||
            s.objectType === 'graphic' ||
            s.elementId !== undefined
        );

        const staticChartCount = compositions.reduce((sum, comp) => sum + comp.embeddedObjects.charts, 0);
        const staticTableCount = compositions.reduce((sum, comp) => sum + comp.embeddedObjects.tables, 0);
        const staticPictureCount = compositions.reduce((sum, comp) => sum + comp.embeddedObjects.pictures, 0);
        const staticGraphicCount = compositions.reduce((sum, comp) => sum + comp.embeddedObjects.graphics, 0);

        result.push({
            name,
            classification: baseClassification,
            slideNumbers,
            meaning,
            useWhen: meta.useWhen,
            representativeShapes: replaceableShapes,
            decorativeElementCount: decorativeShapes.length,
            hasFixedVisuals,
            staticChartCount,
            staticTableCount,
            staticPictureCount,
            staticGraphicCount,
        });
    }

    // Sort: title first, then section, then by number of slides (descending)
    const order: Record<string, number> = { title: 0, section: 1 };
    result.sort((a, b) => {
        const oa = order[a.classification] ?? 10;
        const ob = order[b.classification] ?? 10;
        if (oa !== ob) return oa - ob;
        return b.slideNumbers.length - a.slideNumbers.length;
    });

    return result;
}

/**
 * Build a sub-group key for ANY slide classification.
 * Slides with identical classification + layout + shape count
 * are true variants (same visual structure, different color scheme).
 */
function buildSubGroupKey(comp: SlideComposition): string {
    const layoutSlug = comp.layoutName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
    const replaceableSignature = comp.shapes
        .filter(s => s.isReplaceable)
        .map(s => {
            const fontBucket = s.textCapacity ? Math.round(s.textCapacity.fontSize) : 0;
            const charBucket = s.textCapacity ? bucketTextCapacity(s.textCapacity.maxChars) : 'na';
            return [
                s.objectType,
                s.placeholderType ?? 'none',
                normalizeGeometryKey(s.geometry),
                s.fillColor ?? 'none',
                `${fontBucket}pt`,
                `cap:${charBucket}`,
            ].join(':');
        })
        .sort()
        .join('|');
    const embeddedSignature = [
        `chart:${comp.embeddedObjects.charts}`,
        `table:${comp.embeddedObjects.tables}`,
        `pic:${comp.embeddedObjects.pictures}`,
        `graphic:${comp.embeddedObjects.graphics}`,
    ].join('|');
    return `${comp.classification}-${layoutSlug}-${replaceableSignature}-${embeddedSignature}`;
}

function normalizeGeometryKey(geometry: string): string {
    return geometry.replace(/[^a-z0-9:]+/gi, '-');
}

function bucketTextCapacity(maxChars: number): string {
    if (maxChars <= 3) return 'xs';
    if (maxChars <= 20) return 'sm';
    if (maxChars <= 80) return 'md';
    if (maxChars <= 180) return 'lg';
    return 'xl';
}

/** Layout-name keywords that hint at a specific content type. */
const LAYOUT_KEYWORDS: Array<[RegExp, string, string]> = [
    [/vergleich|compar/i, 'Comparison Layout', 'Side-by-side comparison from layout'],
    [/prozess|process/i, 'Process Layout', 'Step-by-step process from layout'],
    [/bild|image|photo/i, 'Image Layout', 'Image-focused layout'],
    [/tabelle|table/i, 'Table Layout', 'Structured data from layout'],
    [/chart|diagramm/i, 'Chart Layout', 'Data visualization from layout'],
    [/agenda/i, 'Agenda Layout', 'Agenda or overview from layout'],
    [/quote|zitat/i, 'Quote Layout', 'Quote or citation from layout'],
];

function subGroupName(comp: SlideComposition, meta: CompositionMeta): string {
    for (const [pattern, name] of LAYOUT_KEYWORDS) {
        if (pattern.test(comp.layoutName)) return name;
    }
    const layoutLabel = comp.layoutName !== 'Unknown' ? comp.layoutName : '';
    return layoutLabel ? `${meta.name} (${layoutLabel})` : meta.name;
}

function subGroupMeaning(comp: SlideComposition, meta: CompositionMeta): string {
    for (const [pattern, , meaning] of LAYOUT_KEYWORDS) {
        if (pattern.test(comp.layoutName)) return meaning;
    }
    const summary = buildShapeStructureSummary(comp);
    return summary ? `${meta.meaning} -- ${summary}` : meta.meaning;
}

function buildShapeStructureSummary(comp: SlideComposition): string {
    const replaceable = comp.shapes.filter(s => s.isReplaceable);
    if (replaceable.length === 0) return '';
    const byPrefix = new Map<string, number>();
    for (const shape of replaceable) {
        const prefix = shape.shapeName.replace(/\s*\d+$/, '') || shape.shapeName;
        byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + 1);
    }
    return [...byPrefix].map(([p, c]) => c > 1 ? `${c}x ${p}` : p).join(' + ');
}

/* ------------------------------------------------------------------ */
/*  Consolidated composition metadata                                  */
/* ------------------------------------------------------------------ */

export type NarrativePhase = 'opening' | 'tension' | 'resolution' | 'any';

interface CompositionMeta {
    name: string;
    displayName: string;
    meaning: string;
    useWhen: string;
    narrativePhase: NarrativePhase;
}

const COMPOSITION_METADATA: Record<SlideClassification, CompositionMeta> = {
    'title':      { name: 'Title Slide',        displayName: 'Titelfolie',       meaning: 'Opening or closing statement -- sets the thesis or concludes',       useWhen: 'Opening slide or final CTA slide',                          narrativePhase: 'opening' },
    'section':    { name: 'Section Divider',     displayName: 'Section-Divider',  meaning: 'Marks a transition between major topics',                            useWhen: 'Between major sections (every 3-5 content slides)',         narrativePhase: 'any' },
    'content':    { name: 'Content Slide',       displayName: 'Content-Folie',    meaning: 'General content with text and optional visuals',                      useWhen: 'Text-heavy content that does not fit a structured layout',  narrativePhase: 'any' },
    'kpi':        { name: 'KPI Dashboard',       displayName: 'KPI-Dashboard',    meaning: 'Key metrics at a glance -- quantifies the message',                  useWhen: '2-6 key metrics that need to stand out',                    narrativePhase: 'opening' },
    'process':    { name: 'Process Flow',        displayName: 'Prozessablauf',    meaning: 'Linear sequence -- order IS the argument',                           useWhen: 'Steps, phases, pipelines, workflows',                      narrativePhase: 'resolution' },
    'comparison': { name: 'Comparison',          displayName: 'Vergleich',        meaning: 'Side-by-side contrast -- highlights differences',                    useWhen: 'Before/after, option A vs B, current vs target',            narrativePhase: 'tension' },
    'two-column': { name: 'Two-Column Layout',   displayName: 'Zwei-Spalten',     meaning: 'Two parallel content areas -- juxtaposition or split detail',        useWhen: 'Two related but distinct content blocks',                   narrativePhase: 'tension' },
    'table':      { name: 'Table Slide',         displayName: 'Tabellen-Folie',   meaning: 'Structured multi-dimensional data',                                  useWhen: 'Multi-row structured data, feature matrices',               narrativePhase: 'any' },
    'chart':      { name: 'Chart Slide',         displayName: 'Diagramm-Folie',   meaning: 'Data visualization -- trends, distributions, comparisons',           useWhen: 'Numeric data that reveals trends or distributions',         narrativePhase: 'any' },
    'pyramid':    { name: 'Pyramid',             displayName: 'Pyramide',         meaning: 'Hierarchy or layered priorities -- foundation supports the top',     useWhen: 'Layered priorities, Maslow-style hierarchies',              narrativePhase: 'resolution' },
    'matrix':     { name: 'Matrix / SWOT',       displayName: 'Matrix/SWOT',      meaning: 'Two-axis analysis -- categorize along two dimensions',               useWhen: 'SWOT analysis, risk maps, priority grids',                  narrativePhase: 'tension' },
    'org-chart':  { name: 'Org Chart',           displayName: 'Organigramm',      meaning: 'Reporting structure or hierarchy with connections',                  useWhen: 'Team structures, reporting lines',                          narrativePhase: 'any' },
    'timeline':   { name: 'Timeline',            displayName: 'Zeitstrahl',       meaning: 'Temporal sequence -- shows progression over time',                   useWhen: 'Roadmaps, milestones, historical progression',              narrativePhase: 'resolution' },
    'image':      { name: 'Image Slide',         displayName: 'Bild-Folie',       meaning: 'Visual-first slide -- image carries the message',                    useWhen: 'Hero visuals, product photos, diagrams',                    narrativePhase: 'any' },
    'blank':      { name: 'Blank Slide',         displayName: 'Leere Folie',      meaning: 'Empty canvas for flexible use',                                     useWhen: 'Custom layouts not covered by other types',                 narrativePhase: 'any' },
};

/** Export for use in AnalyzePptxTemplateTool narrative phase mapping. */
export { COMPOSITION_METADATA };

/* ------------------------------------------------------------------ */
/*  Per-Composition Scaffolding Extraction                             */
/* ------------------------------------------------------------------ */

/** Style guide for a composition's content area, derived from template shapes. */
export interface CompositionStyleGuide {
    title?: { font_size_pt: number; color: string; font_weight: string };
    body?: { font_size_pt: number; color: string };
    accent_color?: string;
}

/** Scaffolding data for a single composition. */
export interface CompositionScaffolding {
    /** Gerüst-Shapes as PptxGenJS-compatible DekoElement objects. */
    scaffold_elements: DekoElement[];
    /** Bounding box of the content area in px (1280x720 canvas). */
    content_area: { x: number; y: number; w: number; h: number };
    /** Style guide derived from the composition's content-bearing shapes. */
    style_guide: CompositionStyleGuide;
    /** Layout hint derived from content shape arrangement. */
    layout_hint: string;
    /** Recommended pipeline: clone by default for corporate templates, html only as fallback. */
    recommended_pipeline: 'clone' | 'html';
    /** Optional HTML skeleton with placeholders for complex layouts. */
    html_skeleton?: string;
}

/**
 * Extract scaffolding data for each composition group.
 *
 * For each composition, shapes are classified into:
 * - **Scaffold** (Gerüst): decorative, structural, background, fixed images/icons, footer
 * - **Content**: content-bearing text placeholders that the agent fills
 *
 * Returns a Map keyed by the same index as the CompositionGroup array.
 */
export async function extractCompositionScaffolding(
    analysis: TemplateAnalysis,
    compositionGroups: CompositionGroup[],
    allShapesBySlide: Map<number, RawShape[]>,
    zip?: JSZip,
): Promise<Map<number, CompositionScaffolding>> {
    const result = new Map<number, CompositionScaffolding>();
    const footerTypes = new Set(['ftr', 'sldNum', 'dt']);

    for (let groupIdx = 0; groupIdx < compositionGroups.length; groupIdx++) {
        const group = compositionGroups[groupIdx];
        // Use the first slide as representative
        const slideNum = group.slideNumbers[0];
        const rawShapes = allShapesBySlide.get(slideNum) ?? [];
        const comp = analysis.slideCompositions.find(c => c.slideNumber === slideNum);
        if (!comp) continue;

        // Classify shapes into scaffold vs content
        const scaffoldRaw: RawShape[] = [];
        const contentRaw: RawShape[] = [];
        const contentShapes: ShapeInfo[] = [];

        for (let i = 0; i < rawShapes.length; i++) {
            const raw = rawShapes[i];
            const info = comp.shapes[i];
            if (!info) continue;

            const isScaffold = classifyAsScaffold(raw, info, footerTypes);
            if (isScaffold) {
                scaffoldRaw.push(raw);
            } else {
                contentRaw.push(raw);
                contentShapes.push(info);
            }
        }

        // Extract scaffold elements as DekoElement objects
        const scaffoldElements = await extractScaffoldElements(
            zip, slideNum, scaffoldRaw, analysis.brandDNA,
        );

        // Calculate content area bounding box (in px, 1280x720 canvas)
        const contentArea = calculateContentArea(contentRaw, analysis.brandDNA);

        // Derive style guide from content shapes
        const styleGuide = deriveStyleGuide(contentRaw, contentShapes, analysis.brandDNA);

        // Determine layout hint from content shape arrangement
        const layoutHint = deriveLayoutHint(contentRaw, contentShapes, comp.classification);

        // Determine recommended pipeline
        const recommendedPipeline = recommendPipeline(group, contentShapes);

        // Generate HTML skeleton for html-recommended compositions
        const htmlSkeleton = recommendedPipeline === 'html'
            ? generateHtmlSkeleton(contentArea, styleGuide, layoutHint, contentShapes, analysis.brandDNA)
            : undefined;

        result.set(groupIdx, {
            scaffold_elements: scaffoldElements,
            content_area: contentArea,
            style_guide: styleGuide,
            layout_hint: layoutHint,
            recommended_pipeline: recommendedPipeline,
            html_skeleton: htmlSkeleton,
        });
    }

    return result;
}

/** Classify a shape as scaffold (true) or content (false). */
function classifyAsScaffold(
    raw: RawShape,
    info: ShapeInfo,
    footerTypes: Set<string>,
): boolean {
    // Footer shapes are always scaffold
    if (info.placeholderType && footerTypes.has(info.placeholderType)) return true;

    // Embedded charts/tables must define the content area for HTML rebuilds.
    if (raw.objectType === 'chart' || raw.objectType === 'table') return false;

    // Non-replaceable shapes are scaffold (decorative, structural, fixed images)
    if (!info.isReplaceable) return true;

    // Content-bearing shapes are content
    return false;
}

/** Extract scaffold shapes as DekoElement objects (reuses global deko extraction pattern). */
async function extractScaffoldElements(
    zip: JSZip | undefined,
    slideNum: number,
    scaffoldRaw: RawShape[],
    brandDNA: BrandDNA,
): Promise<DekoElement[]> {
    const elements: DekoElement[] = [];
    let idx = 1;

    for (const raw of scaffoldRaw) {
        // Skip very small shapes (bullets, decorative dots)
        if (raw.position.width < EMU_DECORATIVE && raw.position.height < EMU_DECORATIVE) continue;
        // Skip groups (structural containers -- their children are already extracted individually)
        if (raw.geometry === 'group') continue;
        // Never inject static charts/tables/graphic frames as scaffold.
        if (raw.objectType === 'chart' || raw.objectType === 'table' || raw.objectType === 'graphic') continue;

        const pos = {
            x: Math.round(raw.position.left * EMU_TO_INCH * 100) / 100,
            y: Math.round(raw.position.top * EMU_TO_INCH * 100) / 100,
            w: Math.round(raw.position.width * EMU_TO_INCH * 100) / 100,
            h: Math.round(raw.position.height * EMU_TO_INCH * 100) / 100,
        };

        const hasBlip = /<a:blip\b[^>]*r:embed="([^"]+)"/.test(raw.xml);

        if (hasBlip) {
            let imageData: string | undefined;
            if (zip) {
                imageData = await extractImageFromShape(zip, slideNum, raw.xml) ?? undefined;
            }
            elements.push({
                id: `scaffold-${idx++}`,
                type: 'image',
                position: pos,
                ...(imageData ? { imageData } : {}),
                frequency: 1,
            });
        } else {
            const shapeName = prstGeomToPptxName(raw.geometry);
            const fillColor = extractFillColorHex(raw.fill, brandDNA);

            elements.push({
                id: `scaffold-${idx++}`,
                type: 'shape',
                position: pos,
                shapeName: shapeName ?? 'rect',
                fillColor,
                rotation: extractRotation(raw.xml),
                frequency: 1,
            });
        }
    }

    return elements;
}

/** Calculate content area bounding box in px (1280x720 canvas). */
function calculateContentArea(
    contentRaw: RawShape[],
    brandDNA: BrandDNA,
): { x: number; y: number; w: number; h: number } {
    if (contentRaw.length === 0) {
        // Fallback: full slide minus margins
        const slideW = brandDNA.slideSize.cx / EMU_PER_PX;
        const slideH = brandDNA.slideSize.cy / EMU_PER_PX;
        return { x: 40, y: 40, w: slideW - 80, h: slideH - 80 };
    }

    const PADDING = 10; // px padding around content area

    let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
    for (const raw of contentRaw) {
        const x = raw.position.left / EMU_PER_PX;
        const y = raw.position.top / EMU_PER_PX;
        const r = (raw.position.left + raw.position.width) / EMU_PER_PX;
        const b = (raw.position.top + raw.position.height) / EMU_PER_PX;

        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (r > maxX) maxX = r;
        if (b > maxY) maxY = b;
    }

    return {
        x: Math.round(Math.max(0, minX - PADDING)),
        y: Math.round(Math.max(0, minY - PADDING)),
        w: Math.round(maxX - minX + PADDING * 2),
        h: Math.round(maxY - minY + PADDING * 2),
    };
}

/** Derive style guide from content shapes (fonts, colors). */
function deriveStyleGuide(
    contentRaw: RawShape[],
    contentShapes: ShapeInfo[],
    brandDNA: BrandDNA,
): CompositionStyleGuide {
    const guide: CompositionStyleGuide = {};

    for (let i = 0; i < contentRaw.length; i++) {
        const raw = contentRaw[i];
        const info = contentShapes[i];
        if (!info) continue;

        // Extract font size from shape XML
        const rprSz = raw.xml.match(/<a:rPr[^>]*\bsz="(\d+)"/);
        const defRprSz = raw.xml.match(/<a:defRPr[^>]*\bsz="(\d+)"/);
        const fontSizePt = rprSz ? parseInt(rprSz[1]) / 100
            : defRprSz ? parseInt(defRprSz[1]) / 100
            : raw.layoutFontSize ?? 18;

        // Extract font color
        const colorMatch = raw.xml.match(/<a:solidFill>\s*<a:srgbClr val="([A-Fa-f0-9]{6})"/);
        const schemeMatch = raw.xml.match(/<a:solidFill>\s*<a:schemeClr val="(\w+)"/);
        let color = '#333333';
        if (colorMatch) {
            color = `#${colorMatch[1]}`;
        } else if (schemeMatch) {
            const schemeColor = brandDNA.colors[schemeMatch[1]];
            if (schemeColor) color = schemeColor.startsWith('#') ? schemeColor : `#${schemeColor}`;
        }

        // Extract font weight
        const isBold = /<a:rPr[^>]*\bb="1"/.test(raw.xml) || /<a:defRPr[^>]*\bb="1"/.test(raw.xml);

        // Title shapes
        if (info.placeholderType === 'title' || info.placeholderType === 'ctrTitle') {
            guide.title = { font_size_pt: fontSizePt, color, font_weight: isBold ? 'bold' : 'normal' };
        } else if (!guide.body) {
            // First non-title shape becomes the body style
            guide.body = { font_size_pt: fontSizePt, color };
        }
    }

    // Accent color from brand DNA
    guide.accent_color = brandDNA.colors['accent1']
        ? (brandDNA.colors['accent1'].startsWith('#') ? brandDNA.colors['accent1'] : `#${brandDNA.colors['accent1']}`)
        : undefined;

    return guide;
}

/** Derive layout hint from content shape arrangement. */
function deriveLayoutHint(
    contentRaw: RawShape[],
    contentShapes: ShapeInfo[],
    classification: SlideClassification,
): string {
    // Classification-based shortcuts
    if (classification === 'process') return 'process-horizontal';
    if (classification === 'pyramid') return 'pyramid';
    if (classification === 'timeline') return 'timeline';
    if (classification === 'org-chart') return 'org-chart';
    if (classification === 'matrix') return 'grid-2x2';

    // Filter to non-title content shapes for layout analysis
    const nonTitle = contentRaw.filter((_, i) => {
        const info = contentShapes[i];
        return info && info.placeholderType !== 'title' && info.placeholderType !== 'ctrTitle';
    });

    if (nonTitle.length === 0) return 'single-column';
    if (nonTitle.length === 1) return 'single-column';

    // Analyze spatial arrangement
    const sorted = [...nonTitle].sort((a, b) => a.position.left - b.position.left);
    const avgHeight = sorted.reduce((s, r) => s + r.position.height, 0) / sorted.length;
    const topVariation = Math.max(...sorted.map(r => r.position.top)) - Math.min(...sorted.map(r => r.position.top));
    const isHorizontalRow = topVariation < avgHeight * 0.4;

    if (isHorizontalRow && nonTitle.length >= 3) {
        return `grid-1x${nonTitle.length}`;
    }
    if (isHorizontalRow && nonTitle.length === 2) {
        return 'two-column';
    }

    // Check for vertical stacking
    const sortedV = [...nonTitle].sort((a, b) => a.position.top - b.position.top);
    const avgWidth = sortedV.reduce((s, r) => s + r.position.width, 0) / sortedV.length;
    const leftVariation = Math.max(...sortedV.map(r => r.position.left)) - Math.min(...sortedV.map(r => r.position.left));
    const isVerticalStack = leftVariation < avgWidth * 0.3;

    if (isVerticalStack) {
        return nonTitle.length <= 2 ? 'single-column' : `grid-${nonTitle.length}x1`;
    }

    // Grid detection: check for rows and columns
    const rowTolerance = avgHeight * 0.3;
    const rows = new Map<number, RawShape[]>();
    for (const shape of nonTitle) {
        const rowKey = Math.round(shape.position.top / rowTolerance);
        const row = rows.get(rowKey) ?? [];
        row.push(shape);
        rows.set(rowKey, row);
    }
    if (rows.size >= 2) {
        const colCounts = [...rows.values()].map(r => r.length);
        const maxCols = Math.max(...colCounts);
        return `grid-${rows.size}x${maxCols}`;
    }

    return 'single-column';
}

/** Determine recommended pipeline for a composition. */
function recommendPipeline(
    group: CompositionGroup,
    contentShapes: ShapeInfo[],
): 'clone' | 'html' {
    // Structural slides: always clone
    if (group.classification === 'title' || group.classification === 'section') return 'clone';

    // Embedded charts/tables carry static example data in the template.
    // Rebuild them via HTML instead of cloning stale visuals.
    if (group.staticChartCount > 0 || group.staticTableCount > 0 || group.classification === 'chart' || group.classification === 'table') {
        return 'html';
    }

    // Corporate templates encode a lot of their visual identity directly in the
    // content-bearing shapes (colored chevrons, KPI boxes, labeled ribbons, etc.).
    // As soon as we have at least one replaceable shape, cloning preserves that
    // geometry and styling with pixel-perfect fidelity.
    if (contentShapes.length > 0) return 'clone';

    // HTML is the fallback only when there is no content-bearing shape to reuse.
    return 'html';
}

/** Generate an HTML skeleton for a composition based on layout and style. */
function generateHtmlSkeleton(
    contentArea: { x: number; y: number; w: number; h: number },
    styleGuide: CompositionStyleGuide,
    layoutHint: string,
    contentShapes: ShapeInfo[],
    brandDNA: BrandDNA,
): string | undefined {
    const parts: string[] = [];
    const titleStyle = styleGuide.title;
    const bodyStyle = styleGuide.body;

    // Title element (if style guide has title info)
    if (titleStyle) {
        parts.push(
            `<div data-object="true" data-object-type="textbox" ` +
            `style="position:absolute;left:${contentArea.x}px;top:${contentArea.y}px;` +
            `width:${contentArea.w}px;height:60px;` +
            `font-size:${titleStyle.font_size_pt}px;color:${titleStyle.color};` +
            `font-weight:${titleStyle.font_weight};">` +
            `{{title}}</div>`,
        );
    }

    // Content area below title
    const bodyY = titleStyle ? contentArea.y + 80 : contentArea.y;
    const bodyH = titleStyle ? contentArea.h - 80 : contentArea.h;
    const fontSize = bodyStyle?.font_size_pt ?? 16;
    const bodyColor = bodyStyle?.color ?? '#333333';

    if (layoutHint === 'single-column') {
        parts.push(
            `<div data-object="true" data-object-type="textbox" ` +
            `style="position:absolute;left:${contentArea.x}px;top:${bodyY}px;` +
            `width:${contentArea.w}px;height:${bodyH}px;` +
            `font-size:${fontSize}px;color:${bodyColor};">` +
            `{{content}}</div>`,
        );
    } else if (layoutHint === 'two-column') {
        const colW = Math.floor((contentArea.w - 20) / 2);
        parts.push(
            `<div data-object="true" data-object-type="textbox" ` +
            `style="position:absolute;left:${contentArea.x}px;top:${bodyY}px;` +
            `width:${colW}px;height:${bodyH}px;` +
            `font-size:${fontSize}px;color:${bodyColor};">` +
            `{{content_1}}</div>`,
        );
        parts.push(
            `<div data-object="true" data-object-type="textbox" ` +
            `style="position:absolute;left:${contentArea.x + colW + 20}px;top:${bodyY}px;` +
            `width:${colW}px;height:${bodyH}px;` +
            `font-size:${fontSize}px;color:${bodyColor};">` +
            `{{content_2}}</div>`,
        );
    } else if (layoutHint.startsWith('grid-1x')) {
        const cols = parseInt(layoutHint.split('x')[1]) || 3;
        const gap = 15;
        const colW = Math.floor((contentArea.w - gap * (cols - 1)) / cols);
        for (let i = 0; i < cols; i++) {
            parts.push(
                `<div data-object="true" data-object-type="textbox" ` +
                `style="position:absolute;left:${contentArea.x + i * (colW + gap)}px;top:${bodyY}px;` +
                `width:${colW}px;height:${bodyH}px;` +
                `font-size:${fontSize}px;color:${bodyColor};">` +
                `{{content_${i + 1}}}</div>`,
            );
        }
    } else if (layoutHint === 'process-horizontal') {
        const steps = contentShapes.filter(s =>
            s.placeholderType !== 'title' && s.placeholderType !== 'ctrTitle',
        ).length || 4;
        const gap = 10;
        const stepW = Math.floor((contentArea.w - gap * (steps - 1)) / steps);
        const accentColor = styleGuide.accent_color ?? '#4472C4';
        for (let i = 0; i < steps; i++) {
            parts.push(
                `<div data-object="true" data-object-type="shape" data-shape="${i === 0 ? 'homePlate' : 'chevron'}" ` +
                `style="position:absolute;left:${contentArea.x + i * (stepW + gap)}px;top:${bodyY}px;` +
                `width:${stepW}px;height:${Math.min(bodyH, 80)}px;` +
                `background-color:${accentColor};">` +
                `</div>`,
            );
            parts.push(
                `<div data-object="true" data-object-type="textbox" ` +
                `style="position:absolute;left:${contentArea.x + i * (stepW + gap)}px;top:${bodyY}px;` +
                `width:${stepW}px;height:${Math.min(bodyH, 80)}px;` +
                `font-size:${Math.min(fontSize, 14)}px;color:#FFFFFF;text-align:center;" ` +
                `data-valign="middle">` +
                `{{step_${i + 1}}}</div>`,
            );
        }
    }

    if (parts.length === 0) return undefined;

    const skeleton = parts.join('\n');
    // Enforce max skeleton size (~2000 chars)
    return skeleton.length > 2000 ? skeleton.substring(0, 2000) : skeleton;
}

/* ------------------------------------------------------------------ */
/*  Deterministic alias generation (Phase 2)                           */
/* ------------------------------------------------------------------ */

/** Alias entry mapping a semantic alias to a specific shape on a specific slide. */
export interface AliasEntry {
    slide: number;
    shapeId: string;
    originalName: string;
}

/**
 * Generate deterministic, unique aliases for all replaceable shapes across
 * all slide compositions. Aliases follow the pattern: slide_{N}_{type}_{index}
 *
 * This is the fallback when multimodal analysis is not available.
 * Aliases are globally unique (slide number is part of the key).
 */
export function generateDeterministicAliases(
    compositions: SlideComposition[],
): Map<string, AliasEntry> {
    const aliases = new Map<string, AliasEntry>();

    for (const comp of compositions) {
        const replaceable = comp.shapes.filter(s => s.isReplaceable);
        if (replaceable.length === 0) continue;

        const prefixCounts = new Map<string, number>();

        for (const shape of replaceable) {
            const prefix = deriveShapePrefix(shape);
            const count = (prefixCounts.get(prefix) ?? 0) + 1;
            prefixCounts.set(prefix, count);

            const alias = `slide_${comp.slideNumber}_${prefix}_${count}`;
            aliases.set(alias, {
                slide: comp.slideNumber,
                shapeId: shape.shapeId,
                originalName: shape.shapeName,
            });
        }
    }

    return aliases;
}

/**
 * Derive a semantic prefix for a shape based on its placeholder type and name.
 * Used for deterministic alias generation.
 */
function deriveShapePrefix(shape: ShapeInfo): string {
    // Placeholder type has highest priority
    if (shape.placeholderType === 'ctrTitle' || shape.placeholderType === 'title') return 'title';
    if (shape.placeholderType === 'subTitle') return 'subtitle';
    if (shape.placeholderType === 'body') return 'body';
    if (shape.placeholderType === 'pic') return 'image';

    // Derive from shape name patterns (German and English)
    const nameLower = shape.shapeName.toLowerCase();
    if (/chevron|pfeil|f[uü]nfeck/.test(nameLower)) return 'chevron';
    if (/textplatzhalter|textfeld/.test(nameLower)) return 'text';
    if (/inhaltsplatzhalter/.test(nameLower)) return 'content';
    if (/titel/.test(nameLower)) return 'title';
    if (/untertitel/.test(nameLower)) return 'subtitle';
    if (/bild|image|picture/.test(nameLower)) return 'image';
    if (/rechteck|rect/.test(nameLower)) return 'rect';
    if (/ellipse|kreis|circle/.test(nameLower)) return 'circle';
    if (/textbox/.test(nameLower)) return 'textbox';

    return 'shape';
}

/* ------------------------------------------------------------------ */
/*  Deko element extraction                                            */
/* ------------------------------------------------------------------ */

/** EMU to inches conversion factor. */
const EMU_TO_INCH = 1 / EMU_PER_INCH;

/**
 * Extract global decorative elements that appear on a majority of content slides.
 * These are non-text shapes (logos, accent bars, decorative rectangles) that
 * should be auto-injected in the HTML pipeline for corporate consistency.
 */
async function extractGlobalDekoElements(
    zip: JSZip,
    compositions: SlideComposition[],
    allShapesBySlide: Map<number, RawShape[]>,
    brandDNA: BrandDNA,
): Promise<DekoElement[]> {
    // Only consider content slides (not title/section/blank)
    const contentSlides = compositions.filter(c =>
        c.classification !== 'title' && c.classification !== 'section' && c.classification !== 'blank'
    );
    if (contentSlides.length < 2) return [];

    const footerTypes = new Set(['ftr', 'sldNum', 'dt']);

    // Fingerprint -> { raw shape, slide numbers it appears on }
    const dekoFingerprints = new Map<string, { raw: RawShape; slideNums: number[]; slideNum: number }>();

    for (const comp of contentSlides) {
        const rawShapes = allShapesBySlide.get(comp.slideNumber) ?? [];

        for (const raw of rawShapes) {
            // Skip text-bearing (replaceable) shapes
            if (raw.hasText && raw.text.trim().length > 10) continue;
            // Skip footer/date/slide-number placeholders
            if (raw.placeholderType && footerTypes.has(raw.placeholderType)) continue;
            // Skip title/subtitle/body placeholders
            if (raw.placeholderType === 'title' || raw.placeholderType === 'ctrTitle' ||
                raw.placeholderType === 'subTitle' || raw.placeholderType === 'body') continue;
            // Skip very small shapes (bullets, icons)
            if (raw.position.width < EMU_DECORATIVE && raw.position.height < EMU_DECORATIVE) continue;
            // Skip groups (structural containers)
            if (raw.geometry === 'group') continue;
            // Skip static charts/tables and opaque graphic frames from global scaffold extraction
            if (raw.objectType === 'chart' || raw.objectType === 'table' || raw.objectType === 'graphic') continue;

            // Fingerprint: geometry + fill + rough position zone (snap to grid)
            const posZone = `${Math.round(raw.position.left / 500000)}_${Math.round(raw.position.top / 500000)}`;
            const fp = `${raw.geometry}|${raw.fill}|${posZone}`;

            if (!dekoFingerprints.has(fp)) {
                dekoFingerprints.set(fp, { raw, slideNums: [comp.slideNumber], slideNum: comp.slideNumber });
            } else {
                dekoFingerprints.get(fp)!.slideNums.push(comp.slideNumber);
            }
        }
    }

    const threshold = contentSlides.length * 0.5;
    const dekoElements: DekoElement[] = [];
    let dekoId = 1;

    for (const [, entry] of dekoFingerprints) {
        if (entry.slideNums.length < threshold) continue;

        const { raw } = entry;
        const frequency = entry.slideNums.length / contentSlides.length;

        const pos = {
            x: Math.round(raw.position.left * EMU_TO_INCH * 100) / 100,
            y: Math.round(raw.position.top * EMU_TO_INCH * 100) / 100,
            w: Math.round(raw.position.width * EMU_TO_INCH * 100) / 100,
            h: Math.round(raw.position.height * EMU_TO_INCH * 100) / 100,
        };

        // Check if this is an image shape (has blip reference)
        const hasBlip = /<a:blip\b[^>]*r:embed="([^"]+)"/.test(raw.xml);

        if (hasBlip) {
            const imageData = await extractImageFromShape(zip, entry.slideNum, raw.xml);
            if (imageData) {
                dekoElements.push({
                    id: `deko-${dekoId++}`,
                    type: 'image',
                    position: pos,
                    imageData,
                    frequency,
                });
            }
        } else {
            // Shape element
            const shapeName = prstGeomToPptxName(raw.geometry);
            const fillColor = extractFillColorHex(raw.fill, brandDNA);

            dekoElements.push({
                id: `deko-${dekoId++}`,
                type: 'shape',
                position: pos,
                shapeName: shapeName ?? 'rect',
                fillColor,
                rotation: extractRotation(raw.xml),
                frequency,
            });
        }
    }

    return dekoElements;
}

/** Convert prstGeom name to PptxGenJS shape name. */
function prstGeomToPptxName(geometry: string): string | undefined {
    if (geometry.startsWith('prstGeom:')) return geometry.substring(9);
    return undefined;
}

/** Resolve fill color to hex string (without #). */
function extractFillColorHex(fill: string, brandDNA: BrandDNA): string | undefined {
    if (fill.startsWith('solid:#')) return fill.substring(7);
    if (fill.startsWith('solid:')) {
        const schemeName = fill.substring(6);
        const hex = brandDNA.colors[schemeName];
        return hex?.replace('#', '');
    }
    return undefined;
}

/** Extract rotation from shape XML (in degrees). */
function extractRotation(xml: string): number | undefined {
    const rotMatch = /<a:xfrm[^>]*\brot="(-?\d+)"/.exec(xml);
    if (!rotMatch) return undefined;
    const rot60k = parseInt(rotMatch[1]);
    const degrees = rot60k / 60000;
    return degrees !== 0 ? degrees : undefined;
}

/**
 * Extract an embedded image from a shape's blip reference.
 * Resolves rId -> relationship target -> media file -> base64.
 */
async function extractImageFromShape(
    zip: JSZip,
    slideNum: number,
    shapeXml: string,
): Promise<string | undefined> {
    const blipMatch = shapeXml.match(/<a:blip\b[^>]*r:embed="([^"]+)"/);
    if (!blipMatch) return undefined;

    const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
    const relsXml = await zip.file(relsPath)?.async('text');
    if (!relsXml) return undefined;

    const rId = blipMatch[1];
    const targetMatch = new RegExp(`Id="${rId}"[^>]*Target="([^"]+)"`).exec(relsXml);
    if (!targetMatch) return undefined;

    const target = targetMatch[1];
    const mediaPath = target.startsWith('..')
        ? `ppt/${target.replace('../', '')}`
        : target;

    const mediaFile = zip.file(mediaPath);
    if (!mediaFile) return undefined;

    const buffer = await mediaFile.async('uint8array');

    // Skip very large images (>200KB) to keep compositions.json manageable
    if (buffer.length > 200_000) return undefined;

    const ext = mediaPath.split('.').pop()?.toLowerCase() ?? 'png';
    const mimeMap: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', svg: 'image/svg+xml', emf: 'image/emf',
        wmf: 'image/wmf',
    };

    // Convert to base64 in chunks to avoid call stack overflow
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < buffer.length; i += chunkSize) {
        const chunk = buffer.subarray(i, Math.min(i + chunkSize, buffer.length));
        binary += String.fromCharCode(...chunk);
    }
    const base64 = btoa(binary);
    return `data:${mimeMap[ext] ?? 'image/png'};base64,${base64}`;
}

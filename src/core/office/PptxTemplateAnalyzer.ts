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
}

export type SlideClassification =
    | 'title' | 'section' | 'content' | 'kpi' | 'process'
    | 'comparison' | 'two-column' | 'table' | 'chart'
    | 'pyramid' | 'matrix' | 'org-chart' | 'timeline' | 'image' | 'blank';

/** Information about a single shape on a slide. */
export interface ShapeInfo {
    /** Shape name from <p:cNvPr name="...">. */
    shapeName: string;
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

    return {
        slideCount: slideNums.length,
        brandDNA,
        elementCatalog,
        slideCompositions,
    };
}

/* ------------------------------------------------------------------ */
/*  Brand DNA extraction                                               */
/* ------------------------------------------------------------------ */

async function extractBrandDNA(zip: JSZip): Promise<BrandDNA> {
    const colors: Record<string, string> = {};
    const fonts = { major: 'Calibri', minor: 'Calibri' };
    let slideSize = { cx: 12192000, cy: 6858000 }; // Default 16:9

    // Extract colors and fonts from theme1.xml
    const themeFile = zip.file('ppt/theme/theme1.xml');
    if (themeFile) {
        const xml = await themeFile.async('text');

        // Color scheme: dk1, dk2, lt1, lt2, accent1-6, hlink, folHlink
        const colorNames = ['dk1', 'dk2', 'lt1', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
        for (const name of colorNames) {
            const colorBlock = extractXmlBlock(xml, `a:${name}`);
            if (colorBlock) {
                const hex = extractColorFromBlock(colorBlock);
                if (hex) colors[name] = hex;
            }
        }

        // Font scheme: majorFont, minorFont
        const majorMatch = /<a:majorFont>[\s\S]*?<a:latin\s+typeface="([^"]+)"/.exec(xml);
        if (majorMatch) fonts.major = majorMatch[1];

        const minorMatch = /<a:minorFont>[\s\S]*?<a:latin\s+typeface="([^"]+)"/.exec(xml);
        if (minorMatch) fonts.minor = minorMatch[1];
    }

    // Extract slide size from presentation.xml
    const presFile = zip.file('ppt/presentation.xml');
    if (presFile) {
        const xml = await presFile.async('text');
        const sizeMatch = /<p:sldSz\s+cx="(\d+)"\s+cy="(\d+)"/.exec(xml);
        if (sizeMatch) {
            slideSize = { cx: parseInt(sizeMatch[1]), cy: parseInt(sizeMatch[2]) };
        }
    }

    return { colors, fonts, slideSize };
}

function extractColorFromBlock(block: string): string | null {
    // Try srgbClr (direct hex)
    const srgbMatch = /srgbClr\s+val="([0-9A-Fa-f]{6})"/.exec(block);
    if (srgbMatch) return `#${srgbMatch[1]}`;

    // Try sysClr (system color with lastClr)
    const sysMatch = /sysClr[^>]*lastClr="([0-9A-Fa-f]{6})"/.exec(block);
    if (sysMatch) return `#${sysMatch[1]}`;

    return null;
}

/* ------------------------------------------------------------------ */
/*  Shape extraction from slides                                       */
/* ------------------------------------------------------------------ */

interface RawShape {
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

    // Find all <p:sp> shapes
    const spPattern = /<p:sp\b[^>]*>/g;
    let spMatch: RegExpExecArray | null;

    while ((spMatch = spPattern.exec(xml)) !== null) {
        const spStart = spMatch.index;
        const spEnd = findClosingTag(xml, spStart, 'p:sp');
        if (spEnd < 0) continue;

        const spBlock = xml.substring(spStart, spEnd);
        const shape = parseShape(spBlock);
        if (shape) shapes.push(shape);
    }

    // Also find group shapes <p:grpSp> and extract children
    const grpPattern = /<p:grpSp\b[^>]*>/g;
    let grpMatch: RegExpExecArray | null;
    while ((grpMatch = grpPattern.exec(xml)) !== null) {
        const grpStart = grpMatch.index;
        const grpEnd = findClosingTag(xml, grpStart, 'p:grpSp');
        if (grpEnd < 0) continue;

        const grpBlock = xml.substring(grpStart, grpEnd);

        // Extract group name
        const grpNameMatch = /<p:cNvPr\b[^>]*\bname="([^"]*)"/.exec(grpBlock);
        const grpName = grpNameMatch?.[1] ?? 'Group';
        const grpIdMatch = /<p:cNvPr\b[^>]*\bid="([^"]*)"/.exec(grpBlock);
        const grpId = grpIdMatch?.[1] ?? '0';

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
            fingerprint: { geometry: 'group', fillType: 'none', lineStyle: 'none', aspectRatio: 1 },
        });
    }

    return shapes;
}

function parseShape(spBlock: string): RawShape | null {
    // Extract shape name and ID from <p:cNvPr>
    const nameMatch = /<p:cNvPr\b[^>]*\bname="([^"]*)"/.exec(spBlock);
    const idMatch = /<p:cNvPr\b[^>]*\bid="([^"]*)"/.exec(spBlock);
    const shapeName = nameMatch?.[1] ?? '';
    const shapeId = idMatch?.[1] ?? '0';

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
    const phMatch = /<p:ph\b([^>]*)\/?>/.exec(spBlock);
    let placeholderType: string | undefined;
    let placeholderIdx: number | undefined;
    if (phMatch) {
        const phAttrs = phMatch[1];
        const typeMatch = /type="([^"]*)"/.exec(phAttrs);
        placeholderType = typeMatch?.[1];
        const idxMatch = /idx="(\d+)"/.exec(phAttrs);
        if (idxMatch) placeholderIdx = parseInt(idxMatch[1]);
        // Body placeholder without type attribute
        if (!placeholderType && placeholderIdx !== undefined) {
            placeholderType = 'body';
        }
    }

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
    };
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
    const width = widthMatch ? Math.round(parseInt(widthMatch[1]) / 12700) : 1; // EMU to pt

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

    const decoded = fullText
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");

    return { text: decoded, fieldCount: Math.max(fieldCount, 1) };
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

    // Background shapes (full-width, tall rectangles)
    if (geom.includes('rect') && shape.position.width > 10000000 && shape.position.height > 5000000) {
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
    if (!shape.hasText && (shape.position.height < 100000 || shape.position.width < 100000)) {
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

    const relsXml = await relsFile.async('text');

    // Find slideLayout relationship
    const layoutMatch = /Target="\.\.\/slideLayouts\/slideLayout(\d+)\.xml"/.exec(relsXml);
    if (!layoutMatch) return 'Unknown';

    const layoutNum = layoutMatch[1];
    const layoutPath = `ppt/slideLayouts/slideLayout${layoutNum}.xml`;
    const layoutFile = zip.file(layoutPath);
    if (!layoutFile) return `Layout ${layoutNum}`;

    // Try to extract layout name from cSld element
    const layoutXml = await layoutFile.async('text');
    const nameMatch = /<p:cSld\b[^>]*\bname="([^"]*)"/.exec(layoutXml);
    return nameMatch?.[1] ?? `Layout ${layoutNum}`;
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
            rs.placeholderType !== 'ftr' &&
            rs.placeholderType !== 'sldNum' &&
            rs.placeholderType !== 'dt'
        );

        return {
            shapeName: rs.shapeName,
            shapeId: rs.shapeId,
            elementId: element?.id,
            placeholderType: rs.placeholderType,
            placeholderIdx: rs.placeholderIdx,
            text: rs.text,
            isReplaceable,
            position: rs.position,
        };
    });

    const classification = classifySlide(rawShapes, shapes);
    const description = generateSlideDescription(classification, shapes);

    return {
        slideNumber: slideNum,
        layoutName,
        classification,
        shapes,
        description,
    };
}

function classifySlide(rawShapes: RawShape[], shapes: ShapeInfo[]): SlideClassification {
    const contentShapes = shapes.filter(s => s.isReplaceable);
    const nonDecoShapes = rawShapes.filter(rs =>
        rs.hasText || rs.placeholderType === 'title' || rs.placeholderType === 'ctrTitle',
    );

    // Title slide: has ctrTitle or title+subtitle, few other shapes
    const hasTitle = rawShapes.some(rs => rs.placeholderType === 'title' || rs.placeholderType === 'ctrTitle');
    const hasSubtitle = rawShapes.some(rs => rs.placeholderType === 'subTitle');
    if (hasTitle && hasSubtitle && contentShapes.length <= 3) return 'title';

    // Section divider: large title, no body content
    if (hasTitle && !rawShapes.some(rs => rs.placeholderType === 'body') && contentShapes.length <= 2) return 'section';

    // KPI: 3-6 similar small shapes with text (similar size, grid-like)
    const smallTextShapes = rawShapes.filter(rs =>
        rs.hasText && !rs.placeholderType &&
        rs.position.width < 5000000 && rs.position.height < 3000000,
    );
    if (smallTextShapes.length >= 3 && smallTextShapes.length <= 8) {
        const sizeVariance = calculateSizeVariance(smallTextShapes);
        if (sizeVariance < 0.3) return 'kpi';
    }

    // Process: chevrons, arrows, or sequential numbered shapes
    const chevrons = rawShapes.filter(rs =>
        rs.geometry.includes('chevron') || rs.geometry.includes('homePlate'),
    );
    if (chevrons.length >= 3) return 'process';

    // Two-column: two large content areas side by side
    const largeBodies = rawShapes.filter(rs =>
        rs.hasText && rs.position.width > 3000000 && rs.position.width < 7000000,
    );
    if (largeBodies.length === 2) {
        const leftRight = largeBodies.sort((a, b) => a.position.left - b.position.left);
        if (leftRight[1].position.left > leftRight[0].position.left + leftRight[0].position.width * 0.5) {
            return 'two-column';
        }
    }

    // Pyramid: trapezoid/triangle shapes stacked
    const pyramidShapes = rawShapes.filter(rs =>
        rs.geometry.includes('trapezoid') || rs.geometry.includes('triangle'),
    );
    if (pyramidShapes.length >= 3) return 'pyramid';

    // Matrix: 4 equal quadrants
    if (smallTextShapes.length === 4) {
        const sizeVariance = calculateSizeVariance(smallTextShapes);
        if (sizeVariance < 0.2) return 'matrix';
    }

    // Chart placeholder
    if (rawShapes.some(rs => rs.placeholderType === 'chart')) return 'chart';

    // Table placeholder
    if (rawShapes.some(rs => rs.placeholderType === 'tbl')) return 'table';

    // Image placeholder
    if (rawShapes.some(rs => rs.placeholderType === 'pic')) return 'image';

    // Blank: no content shapes
    if (contentShapes.length === 0 && nonDecoShapes.length === 0) return 'blank';

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
    const classNames: Record<SlideClassification, string> = {
        'title': 'Titelfolie',
        'section': 'Section-Divider',
        'content': 'Content-Folie',
        'kpi': 'KPI-Dashboard',
        'process': 'Prozessablauf',
        'comparison': 'Vergleich',
        'two-column': 'Zwei-Spalten',
        'table': 'Tabellen-Folie',
        'chart': 'Diagramm-Folie',
        'pyramid': 'Pyramide',
        'matrix': 'Matrix/SWOT',
        'org-chart': 'Organigramm',
        'timeline': 'Zeitstrahl',
        'image': 'Bild-Folie',
        'blank': 'Leere Folie',
    };

    return `${classNames[classification]} (${replaceableCount} ersetzbare Textfelder)`;
}

/* ------------------------------------------------------------------ */
/*  Skill generation                                                   */
/* ------------------------------------------------------------------ */

/**
 * Generate a Template Skill (SKILL.md) from the analysis result.
 */
export function generateTemplateSkill(
    analysis: TemplateAnalysis,
    templateName: string,
    templatePath: string,
): string {
    const { brandDNA, elementCatalog, slideCompositions } = analysis;

    const lines: string[] = [];

    // Frontmatter
    const safeName = templateName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    lines.push('---');
    lines.push(`name: ${safeName}-template`);
    lines.push(`description: Template-Skill fuer ${templateName} (${analysis.slideCount} Slides, automatisch generiert)`);
    lines.push(`trigger: ${safeName}|${templateName}`);
    lines.push('source: user');
    lines.push('requiredTools: [create_pptx]');
    lines.push('---');
    lines.push('');

    // Title
    lines.push(`# ${templateName} Template`);
    lines.push('');
    lines.push(`> Automatisch generiert aus \`${templatePath}\``);
    lines.push(`> ${analysis.slideCount} Slides, ${elementCatalog.length} einzigartige Design-Elemente`);
    lines.push('');

    // Brand DNA
    lines.push('## Brand-DNA');
    lines.push('');
    lines.push('### Farben');
    for (const [name, hex] of Object.entries(brandDNA.colors)) {
        lines.push(`- ${name}: \`${hex}\``);
    }
    lines.push('');
    lines.push('### Typografie');
    lines.push(`- Ueberschriften: ${brandDNA.fonts.major}`);
    lines.push(`- Fliesstext: ${brandDNA.fonts.minor}`);
    lines.push('');

    // Element catalog (only content-bearing, limit size)
    const contentElements = elementCatalog.filter(e => e.category === 'content-bearing');
    const decorativeCount = elementCatalog.filter(e => e.category === 'decorative').length;
    const structuralCount = elementCatalog.filter(e => e.category === 'structural').length;

    lines.push('## Element-Katalog');
    lines.push('');
    lines.push(`${elementCatalog.length} einzigartige Elemente: ${contentElements.length} content-bearing, ${decorativeCount} dekorativ, ${structuralCount} strukturell.`);
    lines.push('');

    lines.push('### Content-Bearing Elemente');
    lines.push('');
    lines.push('| ID | Name | Geometrie | Geeignet fuer | Slides |');
    lines.push('|----|------|-----------|---------------|--------|');
    for (const el of contentElements) {
        const slidesStr = el.appearsOn.length > 5
            ? `${el.appearsOn.slice(0, 5).join(', ')}...`
            : el.appearsOn.join(', ');
        lines.push(`| ${el.id} | ${el.name} | ${el.geometry} | ${el.suggestedUse} | ${slidesStr} |`);
    }
    lines.push('');

    // Slide compositions (group by classification, limit detail)
    lines.push('## Slide-Kompositionen');
    lines.push('');
    lines.push('### Uebersicht nach Typ');
    lines.push('');

    const byClass = new Map<SlideClassification, SlideComposition[]>();
    for (const comp of slideCompositions) {
        const existing = byClass.get(comp.classification) ?? [];
        existing.push(comp);
        byClass.set(comp.classification, existing);
    }

    for (const [cls, comps] of byClass) {
        const slideNums = comps.map(c => c.slideNumber).join(', ');
        lines.push(`- **${cls}** (${comps.length}x): Slides ${slideNums}`);
    }
    lines.push('');

    // Detailed shape-name mapping for each unique classification
    lines.push('### Slide-Details mit Shape-Name-Mapping');
    lines.push('');
    lines.push('Nutze die Shape-Namen als Keys im `content`-Objekt von `create_pptx`:');
    lines.push('```json');
    lines.push('{ "template_slide": N, "content": { "Shape-Name": "Neuer Text" } }');
    lines.push('```');
    lines.push('');

    // Show one example per classification (avoid repetition)
    const shownClassifications = new Set<SlideClassification>();
    for (const comp of slideCompositions) {
        if (shownClassifications.has(comp.classification)) continue;
        shownClassifications.add(comp.classification);

        const replaceableShapes = comp.shapes.filter(s => s.isReplaceable);
        if (replaceableShapes.length === 0) continue;

        lines.push(`#### Slide ${comp.slideNumber}: ${comp.description}`);
        lines.push(`Layout: ${comp.layoutName}`);
        lines.push('');
        lines.push('| Shape-Name | Aktueller Text | Zweck |');
        lines.push('|------------|----------------|-------|');

        for (const shape of replaceableShapes) {
            const textPreview = shape.text.length > 50 ? shape.text.substring(0, 47) + '...' : shape.text;
            const purpose = shape.placeholderType
                ? `Placeholder: ${shape.placeholderType}${shape.placeholderIdx !== undefined ? ` (idx=${shape.placeholderIdx})` : ''}`
                : 'Textfeld';
            lines.push(`| ${shape.shapeName} | ${textPreview} | ${purpose} |`);
        }
        lines.push('');
    }

    // Template file reference
    lines.push('## Verwendung');
    lines.push('');
    lines.push(`Template-Datei: \`${templatePath}\``);
    lines.push('');
    lines.push('```json');
    lines.push('{');
    lines.push(`  "template_file": "${templatePath}",`);
    lines.push('  "slides": [');
    lines.push('    { "template_slide": 1, "content": { "Shape-Name": "Neuer Text" } }');
    lines.push('  ]');
    lines.push('}');
    lines.push('```');

    return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/*  Utility functions                                                  */
/* ------------------------------------------------------------------ */

function findClosingTag(xml: string, startPos: number, tagName: string): number {
    let depth = 0;
    const closeStr = `</${tagName}>`;

    // Skip past the opening tag
    const openEnd = xml.indexOf('>', startPos);
    if (openEnd < 0) return -1;

    // Check for self-closing tag
    if (xml[openEnd - 1] === '/') return openEnd + 1;

    let pos = openEnd + 1;

    while (pos < xml.length) {
        const nextOpen = xml.indexOf(`<${tagName}`, pos);
        const nextClose = xml.indexOf(closeStr, pos);

        if (nextClose < 0) return -1;

        if (nextOpen >= 0 && nextOpen < nextClose) {
            // Check if it's an opening tag (not self-closing)
            const tagEnd = xml.indexOf('>', nextOpen);
            if (tagEnd >= 0 && xml[tagEnd - 1] !== '/') {
                depth++;
            }
            pos = nextOpen + 1;
        } else {
            if (depth === 0) {
                return nextClose + closeStr.length;
            }
            depth--;
            pos = nextClose + closeStr.length;
        }
    }

    return -1;
}

function extractXmlBlock(xml: string, tagName: string): string | null {
    const startIdx = xml.indexOf(`<${tagName}`);
    if (startIdx < 0) return null;
    const endTag = `</${tagName}>`;
    const endIdx = xml.indexOf(endTag, startIdx);
    if (endIdx < 0) return null;
    return xml.substring(startIdx, endIdx + endTag.length);
}

function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).substring(0, 6);
}

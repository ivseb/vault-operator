/**
 * SlideXmlBuilder -- generates OOXML XML for individual slides.
 *
 * Uses template strings (no DOM manipulation) for predictable output.
 * All dimensions are in EMU (English Metric Units): 914400 EMU = 1 inch.
 */

import type { SlideData } from './types';

/* ------------------------------------------------------------------ */
/*  Constants (EMU)                                                    */
/* ------------------------------------------------------------------ */

const EMU_PER_INCH = 914400;

/** Standard slide dimensions: 13.33" x 7.5" (16:9 widescreen) */
const SLIDE_CX = 12192000;
const SLIDE_CY = 6858000;

/** Title placeholder position (matches default-* template layouts) */
const TITLE_X = 838200;    // ~0.92"
const TITLE_Y = 365125;    // ~0.4"
const TITLE_CX = 10515600; // ~11.5"
const TITLE_CY = 1325563;  // ~1.45"

/** Body placeholder position (matches default-* template layouts) */
const BODY_X = 838200;
const BODY_Y = 1825625;    // ~2.0"
const BODY_CX = 10515600;
const BODY_CY = 4351338;   // ~4.76"

/** Subtitle position (title slide, matches layout1) */
const SUBTITLE_Y = 3602038;  // ~3.94"
const SUBTITLE_CY = 1655762; // ~1.81"

/* ------------------------------------------------------------------ */
/*  XML escaping                                                       */
/* ------------------------------------------------------------------ */

export function escapeXml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/* ------------------------------------------------------------------ */
/*  Paragraph helpers                                                  */
/* ------------------------------------------------------------------ */

function textRun(text: string, fontSize?: number, bold?: boolean, color?: string): string {
    const szAttr = fontSize ? ` sz="${fontSize * 100}"` : '';
    const bAttr = bold ? ' b="1"' : '';
    const solidFill = color
        ? `<a:solidFill><a:srgbClr val="${color.replace('#', '')}"/></a:solidFill>`
        : '';
    return (
        `<a:r>` +
        `<a:rPr lang="de-DE" dirty="0"${szAttr}${bAttr}>${solidFill}</a:rPr>` +
        `<a:t>${escapeXml(text)}</a:t>` +
        `</a:r>`
    );
}

function paragraph(content: string, algn?: string): string {
    const algnAttr = algn ? ` algn="${algn}"` : '';
    return `<a:p><a:pPr${algnAttr}/>${content}<a:endParaRPr lang="de-DE" dirty="0"/></a:p>`;
}

function bulletParagraph(text: string, fontSize = 18): string {
    return (
        `<a:p>` +
        `<a:pPr marL="342900" indent="-342900">` +
        `<a:buChar char="\u2022"/>` +
        `<a:spcAft><a:spcPts val="600"/></a:spcAft>` +
        `</a:pPr>` +
        textRun(text, fontSize) +
        `<a:endParaRPr lang="de-DE" dirty="0"/>` +
        `</a:p>`
    );
}

/* ------------------------------------------------------------------ */
/*  Shape builders                                                     */
/* ------------------------------------------------------------------ */

function shapeWithPlaceholder(
    id: number,
    name: string,
    phType: string,
    phIdx: string | undefined,
    x: number,
    y: number,
    cx: number,
    cy: number,
    bodyContent: string,
): string {
    const idxAttr = phIdx !== undefined ? ` idx="${phIdx}"` : '';
    return (
        `<p:sp>` +
        `<p:nvSpPr>` +
        `<p:cNvPr id="${id}" name="${name}"/>` +
        `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
        `<p:nvPr><p:ph type="${phType}"${idxAttr}/></p:nvPr>` +
        `</p:nvSpPr>` +
        `<p:spPr>` +
        `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
        `</p:spPr>` +
        `<p:txBody>` +
        `<a:bodyPr/>` +
        `<a:lstStyle/>` +
        bodyContent +
        `</p:txBody>` +
        `</p:sp>`
    );
}

function buildTitleShape(title: string, shapeId: number): string {
    return shapeWithPlaceholder(
        shapeId,
        'Title',
        'title',
        undefined,
        TITLE_X, TITLE_Y, TITLE_CX, TITLE_CY,
        paragraph(textRun(title, 28, true)),
    );
}

function buildSubtitleShape(subtitle: string, shapeId: number): string {
    return shapeWithPlaceholder(
        shapeId,
        'Subtitle',
        'subTitle',
        '1',
        TITLE_X, SUBTITLE_Y, TITLE_CX, SUBTITLE_CY,
        paragraph(textRun(subtitle, 20, false, '666666'), 'ctr'),
    );
}

function buildBodyShape(content: string, shapeId: number): string {
    return shapeWithPlaceholder(
        shapeId,
        'Content',
        'body',
        '1',
        BODY_X, BODY_Y, BODY_CX, BODY_CY,
        content,
    );
}

/* ------------------------------------------------------------------ */
/*  Table builder                                                      */
/* ------------------------------------------------------------------ */

function buildTableShape(
    headers: string[] | undefined,
    rows: (string | number | null)[][],
    shapeId: number,
    primaryColor = '4472C4',
): string {
    const colCount = headers?.length ?? (rows[0]?.length ?? 1);
    const colW = Math.floor(BODY_CX / colCount);
    const rowH = 370840; // ~0.4"

    const gridCols = Array.from({ length: colCount }, () => `<a:gridCol w="${colW}"/>`).join('');

    let tableRows = '';

    // Header row
    if (headers && headers.length > 0) {
        const cells = headers.map(h =>
            `<a:tc>` +
            `<a:txBody><a:bodyPr/><a:lstStyle/>` +
            paragraph(textRun(escapeXml(h), 14, true, 'FFFFFF')) +
            `</a:txBody>` +
            `<a:tcPr>` +
            `<a:solidFill><a:srgbClr val="${primaryColor}"/></a:solidFill>` +
            `</a:tcPr>` +
            `</a:tc>`,
        ).join('');
        tableRows += `<a:tr h="${rowH}">${cells}</a:tr>`;
    }

    // Data rows
    for (const row of rows) {
        const cells = (row as (string | number | null)[]).map(cell => {
            const text = cell !== null && cell !== undefined ? String(cell) : '';
            return (
                `<a:tc>` +
                `<a:txBody><a:bodyPr/><a:lstStyle/>` +
                paragraph(textRun(escapeXml(text), 13)) +
                `</a:txBody>` +
                `<a:tcPr>` +
                `<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>` +
                `</a:tcPr>` +
                `</a:tc>`
            );
        }).join('');
        tableRows += `<a:tr h="${rowH}">${cells}</a:tr>`;
    }

    const totalRows = (headers ? 1 : 0) + rows.length;
    const tableH = totalRows * rowH;

    return (
        `<p:graphicFrame>` +
        `<p:nvGraphicFramePr>` +
        `<p:cNvPr id="${shapeId}" name="Table"/>` +
        `<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr>` +
        `<p:nvPr/>` +
        `</p:nvGraphicFramePr>` +
        `<p:xfrm><a:off x="${BODY_X}" y="${BODY_Y}"/><a:ext cx="${BODY_CX}" cy="${tableH}"/></p:xfrm>` +
        `<a:graphic>` +
        `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">` +
        `<a:tbl>` +
        `<a:tblPr firstRow="1" bandRow="1"><a:noFill/></a:tblPr>` +
        `<a:tblGrid>${gridCols}</a:tblGrid>` +
        tableRows +
        `</a:tbl>` +
        `</a:graphicData>` +
        `</a:graphic>` +
        `</p:graphicFrame>`
    );
}

/* ------------------------------------------------------------------ */
/*  Image builder                                                      */
/* ------------------------------------------------------------------ */

function buildImageShape(imageRId: string, shapeId: number, cx?: number, cy?: number): string {
    const imgCx = cx ?? Math.floor(BODY_CX * 0.7);
    const imgCy = cy ?? Math.floor(BODY_CY * 0.8);
    const imgX = BODY_X + Math.floor((BODY_CX - imgCx) / 2);

    return (
        `<p:pic>` +
        `<p:nvPicPr>` +
        `<p:cNvPr id="${shapeId}" name="Image"/>` +
        `<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>` +
        `<p:nvPr/>` +
        `</p:nvPicPr>` +
        `<p:blipFill>` +
        `<a:blip r:embed="${imageRId}"/>` +
        `<a:stretch><a:fillRect/></a:stretch>` +
        `</p:blipFill>` +
        `<p:spPr>` +
        `<a:xfrm><a:off x="${imgX}" y="${BODY_Y}"/><a:ext cx="${imgCx}" cy="${imgCy}"/></a:xfrm>` +
        `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
        `</p:spPr>` +
        `</p:pic>`
    );
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export interface SlideXmlResult {
    slideXml: string;
    notesXml?: string;
    /** rId for image relationship (if image present) */
    imageRId?: string;
}

/**
 * Build the complete slide XML (`<p:sld>` root element).
 *
 * @param slide - Slide content data
 * @param layoutRId - Relationship ID pointing to the slide layout
 * @param imageRId - If an image is present, the rId for the image relationship
 */
export function buildSlideXml(
    slide: SlideData,
    layoutRId: string,
    imageRId?: string,
): string {
    const shapes: string[] = [];
    let nextId = 2; // id=1 is reserved for the spTree itself

    // Title
    if (slide.title) {
        shapes.push(buildTitleShape(slide.title, nextId++));
    }

    // Subtitle (title slide)
    if (slide.subtitle) {
        shapes.push(buildSubtitleShape(slide.subtitle, nextId++));
    }

    // Body text or bullets
    if (slide.body || (slide.bullets && slide.bullets.length > 0)) {
        let bodyContent = '';
        if (slide.body) {
            // Split body into paragraphs on newlines
            bodyContent = slide.body
                .split('\n')
                .map(line => paragraph(textRun(line, 18)))
                .join('');
        }
        if (slide.bullets && slide.bullets.length > 0) {
            bodyContent += slide.bullets.map(b => bulletParagraph(b)).join('');
        }
        shapes.push(buildBodyShape(bodyContent, nextId++));
    }

    // Table
    if (slide.table && (slide.table.headers || (slide.table.rows && slide.table.rows.length > 0))) {
        const rows = slide.table.rows ?? [];
        shapes.push(buildTableShape(slide.table.headers, rows, nextId++));
    }

    // Image
    if (slide.image && imageRId) {
        shapes.push(buildImageShape(imageRId, nextId++));
    }

    return (
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
        `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
        `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
        `<p:cSld>` +
        `<p:spTree>` +
        `<p:nvGrpSpPr>` +
        `<p:cNvPr id="1" name=""/>` +
        `<p:cNvGrpSpPr/>` +
        `<p:nvPr/>` +
        `</p:nvGrpSpPr>` +
        `<p:grpSpPr>` +
        `<a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>` +
        `<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm>` +
        `</p:grpSpPr>` +
        shapes.join('') +
        `</p:spTree>` +
        `</p:cSld>` +
        `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>` +
        `</p:sld>`
    );
}

/**
 * Build notes slide XML.
 */
export function buildNotesSlideXml(notes: string, slideRId: string): string {
    const paragraphs = notes
        .split('\n')
        .map(line => paragraph(textRun(line, 12)))
        .join('');

    return (
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
        `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
        `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
        `<p:cSld>` +
        `<p:spTree>` +
        `<p:nvGrpSpPr>` +
        `<p:cNvPr id="1" name=""/>` +
        `<p:cNvGrpSpPr/>` +
        `<p:nvPr/>` +
        `</p:nvGrpSpPr>` +
        `<p:grpSpPr/>` +
        `<p:sp>` +
        `<p:nvSpPr>` +
        `<p:cNvPr id="2" name="Slide Image"/>` +
        `<p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr>` +
        `<p:nvPr><p:ph type="sldImg"/></p:nvPr>` +
        `</p:nvSpPr>` +
        `<p:spPr/>` +
        `</p:sp>` +
        `<p:sp>` +
        `<p:nvSpPr>` +
        `<p:cNvPr id="3" name="Notes"/>` +
        `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
        `<p:nvPr><p:ph type="body"/></p:nvPr>` +
        `</p:nvSpPr>` +
        `<p:spPr/>` +
        `<p:txBody>` +
        `<a:bodyPr/>` +
        `<a:lstStyle/>` +
        paragraphs +
        `</p:txBody>` +
        `</p:sp>` +
        `</p:spTree>` +
        `</p:cSld>` +
        `</p:notes>`
    );
}

/**
 * Build slide relationship file XML.
 */
export function buildSlideRelsXml(layoutRId: string, layoutPath: string, extras?: { rId: string; target: string; type: string }[]): string {
    let rels =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="${layoutRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="${layoutPath}"/>`;

    if (extras) {
        for (const e of extras) {
            rels += `<Relationship Id="${e.rId}" Type="${e.type}" Target="${e.target}"/>`;
        }
    }

    rels += `</Relationships>`;
    return rels;
}

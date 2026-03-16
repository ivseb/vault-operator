/**
 * ooxml-utils.ts — Shared OOXML XML utilities
 *
 * Common functions and constants used by both PptxTemplateAnalyzer and
 * PptxTemplateCloner. Extracted to eliminate duplication and provide a
 * single source of truth for EMU constants, text capacity factors,
 * XML escaping, tag matching, and formatting extraction.
 */

/* ------------------------------------------------------------------ */
/*  EMU (English Metric Units) constants                               */
/* ------------------------------------------------------------------ */

export const EMU_PER_INCH = 914_400;
export const EMU_PER_PX = EMU_PER_INCH / 96; // 9525
export const EMU_PT_TO_EMU = 12_700;

/** Shape smaller than this is likely decorative (icons, bullets) */
export const EMU_DECORATIVE = 100_000;

/** Width/height thresholds for classification heuristics */
export const EMU_SMALL_WIDTH = 5_000_000;
export const EMU_SMALL_HEIGHT = 3_000_000;
export const EMU_BODY_MIN = 3_000_000;
export const EMU_BODY_MAX = 7_000_000;
export const EMU_BACKGROUND_W = 10_000_000;
export const EMU_BACKGROUND_H = 5_000_000;

/* ------------------------------------------------------------------ */
/*  Text capacity estimation factors                                   */
/* ------------------------------------------------------------------ */

/** Average character width as fraction of font size in px */
export const AVG_CHAR_WIDTH_FACTOR = 0.55;
/** Line height as multiple of font size in px */
export const LINE_HEIGHT_FACTOR = 1.4;
/** Points to pixels conversion */
export const PT_TO_PX = 1.333;

/* ------------------------------------------------------------------ */
/*  Default language                                                   */
/* ------------------------------------------------------------------ */

export const DEFAULT_LANG = 'de-DE';
export const DEFAULT_RPR = `<a:rPr lang="${DEFAULT_LANG}" dirty="0"/>`;

/* ------------------------------------------------------------------ */
/*  XML tag navigation                                                 */
/* ------------------------------------------------------------------ */

/**
 * Find the position AFTER the closing tag for a given element.
 * Handles nested elements of the same name and self-closing tags.
 *
 * @param xml - The full XML string
 * @param startPos - Position of the opening '<' of the element
 * @param tagName - Tag name including namespace prefix (e.g. 'p:sp')
 * @returns Position after the closing tag, or -1 if not found
 */
export function findClosingTag(xml: string, startPos: number, tagName: string): number {
    let depth = 0;
    const closeStr = `</${tagName}>`;
    const tagLen = tagName.length;

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
            // Verify this is actually our tag, not a prefix match
            // e.g. <p:sp must not match <p:spPr or <p:spTree
            const charAfterTag = xml[nextOpen + 1 + tagLen];
            if (charAfterTag === ' ' || charAfterTag === '>' || charAfterTag === '/' ||
                charAfterTag === '\n' || charAfterTag === '\r' || charAfterTag === '\t') {
                // Check if it's an opening tag (not self-closing)
                const tagEnd = xml.indexOf('>', nextOpen);
                if (tagEnd >= 0 && xml[tagEnd - 1] !== '/') {
                    depth++;
                }
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

/**
 * Extract a complete XML block by tag name (first occurrence).
 * Uses simple indexOf — suitable for non-nested lookups.
 */
export function extractXmlBlock(xml: string, tagName: string): string | null {
    const startIdx = xml.indexOf(`<${tagName}`);
    if (startIdx < 0) return null;
    const endTag = `</${tagName}>`;
    const endIdx = xml.indexOf(endTag, startIdx);
    if (endIdx < 0) return null;
    return xml.substring(startIdx, endIdx + endTag.length);
}

/* ------------------------------------------------------------------ */
/*  XML escaping and entity handling                                   */
/* ------------------------------------------------------------------ */

/** Escape text for safe embedding in XML content */
export function escapeXml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/** Decode XML entities back to plain text */
export function decodeXmlEntities(text: string): string {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

/** Escape special regex characters in a string */
export function escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ------------------------------------------------------------------ */
/*  Formatting extraction                                              */
/* ------------------------------------------------------------------ */

/**
 * Extract the first complete <a:rPr> element from XML text.
 * Handles both self-closing and non-self-closing forms.
 */
export function extractFirstRPr(xml: string): string {
    const fallback = DEFAULT_RPR;

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

/** Paragraph-level formatting info */
export interface ParagraphFormat {
    /** Paragraph properties (<a:pPr ...> or '') */
    pPr: string;
    /** Run properties (<a:rPr ...>) */
    rPr: string;
}

/**
 * Extract formatting from ALL paragraphs in a txBody.
 * Preserves heading/body/label formatting differences across paragraphs.
 *
 * Returns an array of {pPr, rPr} per content paragraph (skipping empty ones).
 * Falls back to a single default format if nothing is extractable.
 */
export function extractAllParagraphFormats(txBody: string): ParagraphFormat[] {
    const formats: ParagraphFormat[] = [];
    const pPattern = /<a:p\b[^>]*>[\s\S]*?<\/a:p>/g;
    let match: RegExpExecArray | null;

    while ((match = pPattern.exec(txBody)) !== null) {
        const para = match[0];
        // Skip paragraphs without text runs (empty spacer paragraphs)
        if (!/<a:r\b/.test(para)) continue;

        // Extract paragraph properties (<a:pPr>)
        const pPrSelf = para.match(/<a:pPr\b[^>]*\/>/);
        const pPrOpen = para.match(/<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>/);
        const pPr = pPrSelf?.[0] ?? pPrOpen?.[0] ?? '';

        // Extract run properties
        const rPr = extractFirstRPr(para);
        formats.push({ pPr, rPr });
    }

    return formats.length > 0
        ? formats
        : [{ pPr: '', rPr: DEFAULT_RPR }];
}

/**
 * Extract <a:bodyPr> and <a:lstStyle> elements from txBody content.
 * These must be preserved when replacing text content.
 */
export function extractBodyProperties(txBodyContent: string): string {
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

/* ------------------------------------------------------------------ */
/*  Text normalization                                                 */
/* ------------------------------------------------------------------ */

/**
 * Normalize text for fuzzy matching: whitespace and dash normalization only.
 * Does NOT convert umlaut transliterations (ae/oe/ue) because that
 * destroys English words like "Revenue", "Israel", "Bluetooth".
 */
export function normalizeForMatching(text: string): string {
    return text
        // Dash variants -> en-dash
        .replace(/\s*--\s*/g, ' \u2013 ')
        .replace(/\s*\u2014\s*/g, ' \u2013 ')
        // Normalize whitespace
        .replace(/\s+/g, ' ')
        .trim();
}

/* ------------------------------------------------------------------ */
/*  Shape XML manipulation                                             */
/* ------------------------------------------------------------------ */

/** Parse shape name into base prefix + numeric suffix. */
export function parseShapeName(name: string): { base: string; num: number } | null {
    const match = /^(.+?)\s*(\d+)$/.exec(name.trim());
    if (!match) return null;
    return { base: match[1].trim(), num: parseInt(match[2]) };
}

/** Find the highest <p:cNvPr id="N"> in slide XML. */
export function findMaxShapeId(xml: string): number {
    let max = 0;
    const pattern = /id="(\d+)"/g;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(xml)) !== null) {
        const id = parseInt(m[1]);
        if (id > max) max = id;
    }
    return max;
}

/**
 * Extract the complete <p:sp>...</p:sp> block containing a shape with the given name.
 * Returns null if no shape with that name is found.
 */
export function extractSpBlockByName(xml: string, shapeName: string): string | null {
    const escapedName = escapeRegex(escapeXml(shapeName));
    const namePattern = new RegExp(`name="${escapedName}"`);
    const match = namePattern.exec(xml);
    if (!match) return null;

    // Walk backwards to find the <p:sp opening
    const spStart = xml.lastIndexOf('<p:sp', match.index);
    if (spStart < 0) return null;

    // Verify this <p:sp is actually for this shape (no intervening </p:sp>)
    const closeBetween = xml.indexOf('</p:sp>', spStart);
    if (closeBetween >= 0 && closeBetween < match.index) return null;

    const spEnd = findClosingTag(xml, spStart, 'p:sp');
    if (spEnd < 0) return null;

    return xml.substring(spStart, spEnd);
}

/**
 * Extract the complete <p:sp>...</p:sp> block containing a shape with the given ID.
 * Uses the `id` attribute from `<p:cNvPr id="N" ...>` which is unique per slide.
 * Returns null if no shape with that ID is found.
 */
export function extractSpBlockById(xml: string, shapeId: string): string | null {
    const idPattern = new RegExp(`<p:cNvPr\\b[^>]*\\bid="${escapeRegex(shapeId)}"[^>]*/?>`)
    const match = idPattern.exec(xml);
    if (!match) return null;

    // Walk backwards to find the <p:sp opening
    const spStart = xml.lastIndexOf('<p:sp', match.index);
    if (spStart < 0) return null;

    // Verify this <p:sp is actually for this shape (no intervening </p:sp>)
    const closeBetween = xml.indexOf('</p:sp>', spStart);
    if (closeBetween >= 0 && closeBetween < match.index) return null;

    const spEnd = findClosingTag(xml, spStart, 'p:sp');
    if (spEnd < 0) return null;

    return xml.substring(spStart, spEnd);
}

/* ------------------------------------------------------------------ */
/*  Hashing                                                            */
/* ------------------------------------------------------------------ */

/** Simple string hash for fingerprinting (non-cryptographic) */
export function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).substring(0, 6);
}

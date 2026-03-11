/**
 * HtmlSlideParser -- Converts annotated HTML to PptxGenJS API calls.
 *
 * The LLM generates HTML with data-object-type attributes and absolute
 * pixel positioning (1280x720 canvas). This parser extracts elements
 * and renders them via PptxGenJS.
 *
 * Canvas: 1280x720 px (16:9 at 96 DPI)
 * Conversion: px / 96 = inches (PptxGenJS uses inches)
 *
 * Element types:
 *   shape   -> slide.addShape()  (backgrounds, accent bars, cards)
 *   textbox -> slide.addText()   (titles, body, labels, bullets)
 *   image   -> slide.addImage()  (logos, photos via vault path)
 *   chart   -> slide.addChart()  (native editable chart, data from ChartData[])
 *   table   -> slide.addTable()  (native table, data from TableData[])
 */

import PptxGenJS from 'pptxgenjs';
import type { ChartData, TableData } from './types';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Resolves a vault image path to base64 data URL + file type. */
export type ImageLoader = (vaultPath: string) => Promise<{ data: string; type: string } | undefined>;

interface Position {
    x: number; // inches
    y: number;
    w: number;
    h: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PX_TO_INCH = 1 / 96;
const PX_TO_PT = 0.75; // 1px CSS = 0.75pt

/* ------------------------------------------------------------------ */
/*  Main entry point                                                   */
/* ------------------------------------------------------------------ */

/**
 * Parse annotated HTML and render all elements onto a PptxGenJS slide.
 *
 * Elements are identified by `data-object="true"` and typed by
 * `data-object-type` (shape|textbox|image|chart|table).
 */
export async function renderHtmlSlide(
    slide: PptxGenJS.Slide,
    pptx: PptxGenJS,
    html: string,
    charts?: ChartData[],
    tables?: TableData[],
    imageLoader?: ImageLoader,
): Promise<void> {
    const doc = new DOMParser().parseFromString(
        `<div>${html}</div>`,
        'text/html',
    );

    const elements = doc.querySelectorAll('[data-object="true"]');

    for (const el of Array.from(elements)) {
        const objectType = (el as HTMLElement).dataset.objectType ?? '';
        const pos = parsePosition(el as HTMLElement);

        switch (objectType) {
            case 'shape':
                renderShape(slide, pptx, el as HTMLElement, pos);
                break;
            case 'textbox':
                renderTextbox(slide, el as HTMLElement, pos);
                break;
            case 'image':
                await renderImage(slide, el as HTMLElement, pos, imageLoader);
                break;
            case 'chart':
                renderChart(slide, pptx, el as HTMLElement, pos, charts);
                break;
            case 'table':
                renderTable(slide, el as HTMLElement, pos, tables);
                break;
            default:
                console.debug(`[HtmlSlideParser] Unknown data-object-type: "${objectType}"`);
        }
    }
}

/* ------------------------------------------------------------------ */
/*  Position parsing                                                   */
/* ------------------------------------------------------------------ */

function parsePosition(el: HTMLElement): Position {
    const style = el.style;
    return {
        x: parsePx(style.left) * PX_TO_INCH,
        y: parsePx(style.top) * PX_TO_INCH,
        w: parsePx(style.width) * PX_TO_INCH,
        h: parsePx(style.height) * PX_TO_INCH,
    };
}

function parsePx(value: string): number {
    if (!value) return 0;
    const num = parseFloat(value.replace('px', ''));
    return isNaN(num) ? 0 : num;
}

/* ------------------------------------------------------------------ */
/*  Color parsing                                                      */
/* ------------------------------------------------------------------ */

/** Convert CSS color to PptxGenJS hex (without #). */
function cssColorToHex(color: string): string {
    if (!color) return '';
    // Handle #RRGGBB or #RGB
    if (color.startsWith('#')) {
        const hex = color.slice(1);
        if (hex.length === 3) {
            return hex.split('').map(c => c + c).join('');
        }
        return hex.toUpperCase();
    }
    // Handle rgb(r, g, b)
    const rgbMatch = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if (rgbMatch) {
        const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
        const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
        const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
        return `${r}${g}${b}`.toUpperCase();
    }
    // Handle rgba(r, g, b, a) -- ignore alpha for fill
    const rgbaMatch = color.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*[\d.]+\s*\)/);
    if (rgbaMatch) {
        const r = parseInt(rgbaMatch[1]).toString(16).padStart(2, '0');
        const g = parseInt(rgbaMatch[2]).toString(16).padStart(2, '0');
        const b = parseInt(rgbaMatch[3]).toString(16).padStart(2, '0');
        return `${r}${g}${b}`.toUpperCase();
    }
    // Named colors fallback
    const named: Record<string, string> = {
        white: 'FFFFFF', black: '000000', red: 'FF0000',
        green: '008000', blue: '0000FF', transparent: '',
    };
    return named[color.toLowerCase()] ?? '';
}

/* ------------------------------------------------------------------ */
/*  Shape rendering                                                    */
/* ------------------------------------------------------------------ */

function renderShape(
    slide: PptxGenJS.Slide,
    pptx: PptxGenJS,
    el: HTMLElement,
    pos: Position,
): void {
    const style = el.style;
    const shapeType = resolveShapeType(el, pptx);

    const options: Record<string, unknown> = {
        x: pos.x,
        y: pos.y,
        w: pos.w,
        h: pos.h,
    };

    // Fill
    const bgColor = cssColorToHex(style.backgroundColor);
    if (bgColor) {
        options.fill = { color: bgColor };
    }

    // Border
    const border = parseBorder(style);
    if (border) {
        options.border = border;
    }

    // Border radius
    const borderRadius = parsePx(style.borderRadius);
    if (borderRadius > 0) {
        options.rectRadius = borderRadius * PX_TO_INCH;
    }

    // Shadow
    const shadow = parseShadow(style.boxShadow);
    if (shadow) {
        options.shadow = shadow;
    }

    // Opacity
    const opacity = parseFloat(style.opacity);
    if (!isNaN(opacity) && opacity < 1) {
        options.transparency = Math.round((1 - opacity) * 100);
    }

    // Rotation
    const rotation = parseRotation(style.transform);
    if (rotation !== 0) {
        options.rotate = rotation;
    }

    slide.addShape(shapeType, options as PptxGenJS.ShapeProps);
}

function resolveShapeType(el: HTMLElement, pptx: PptxGenJS): PptxGenJS.SHAPE_NAME {
    const shapeHint = el.dataset.shape ?? '';
    switch (shapeHint) {
        case 'ellipse':
        case 'circle':
            return pptx.ShapeType.ellipse;
        case 'triangle':
            return pptx.ShapeType.triangle;
        case 'line':
            return pptx.ShapeType.line;
        case 'arrow':
        case 'rightArrow':
            return pptx.ShapeType.rightArrow;
        case 'chevron':
            return pptx.ShapeType.chevron;
        case 'roundRect':
            return pptx.ShapeType.roundRect;
        default: {
            // Auto-detect: if border-radius is set, use roundRect
            const br = parsePx(el.style.borderRadius);
            if (br > 0) return pptx.ShapeType.roundRect;
            return pptx.ShapeType.rect;
        }
    }
}

/* ------------------------------------------------------------------ */
/*  Textbox rendering                                                  */
/* ------------------------------------------------------------------ */

function renderTextbox(
    slide: PptxGenJS.Slide,
    el: HTMLElement,
    pos: Position,
): void {
    const style = el.style;
    const textContent = extractTextContent(el);

    if (!textContent.length) return;

    const options: Record<string, unknown> = {
        x: pos.x,
        y: pos.y,
        w: pos.w,
        h: pos.h,
        wrap: true,
        shrinkText: true,
    };

    // Font size (CSS px -> pt)
    const fontSize = parsePx(style.fontSize);
    if (fontSize > 0) {
        options.fontSize = Math.round(fontSize * PX_TO_PT);
    }

    // Font weight
    if (style.fontWeight === 'bold' || parseInt(style.fontWeight) >= 700) {
        options.bold = true;
    }

    // Font style
    if (style.fontStyle === 'italic') {
        options.italic = true;
    }

    // Font family
    if (style.fontFamily) {
        options.fontFace = style.fontFamily.replace(/['"]/g, '').split(',')[0].trim();
    }

    // Text color
    const color = cssColorToHex(style.color);
    if (color) {
        options.color = color;
    }

    // Background fill
    const bgColor = cssColorToHex(style.backgroundColor);
    if (bgColor) {
        options.fill = { color: bgColor };
    }

    // Text alignment
    if (style.textAlign) {
        options.align = mapTextAlign(style.textAlign);
    }

    // Vertical alignment
    const valign = el.dataset.valign ?? style.verticalAlign ?? '';
    if (valign) {
        options.valign = mapVerticalAlign(valign);
    }

    // Line height -> line spacing
    const lineHeight = parseFloat(style.lineHeight);
    if (!isNaN(lineHeight) && lineHeight > 0) {
        // If lineHeight is a multiplier (e.g. 1.5), use directly
        // If it's in px, convert relative to fontSize
        if (style.lineHeight.includes('px') && fontSize > 0) {
            options.lineSpacingMultiple = lineHeight / fontSize;
        } else if (lineHeight > 0 && lineHeight < 10) {
            options.lineSpacingMultiple = lineHeight;
        }
    }

    // Letter spacing
    const letterSpacing = parsePx(style.letterSpacing);
    if (letterSpacing !== 0) {
        options.charSpacing = letterSpacing * PX_TO_PT;
    }

    // Border
    const border = parseBorder(style);
    if (border) {
        options.border = border;
    }

    // Border radius
    const borderRadius = parsePx(style.borderRadius);
    if (borderRadius > 0) {
        options.rectRadius = borderRadius * PX_TO_INCH;
    }

    // Shadow
    const shadow = parseShadow(style.boxShadow);
    if (shadow) {
        options.shadow = shadow;
    }

    // Margin / padding as inset
    const padding = parsePx(style.padding);
    if (padding > 0) {
        const insetInches = padding * PX_TO_INCH;
        options.margin = [insetInches, insetInches, insetInches, insetInches];
    }

    // Rotation
    const rotation = parseRotation(style.transform);
    if (rotation !== 0) {
        options.rotate = rotation;
    }

    // Check for bullet mode
    const isBullet = el.dataset.bullets === 'true';

    if (isBullet) {
        // Split text into bullet items
        const items = textContent.map(line => ({
            text: line.text,
            options: {
                bullet: true,
                fontSize: line.fontSize ?? (options.fontSize as number | undefined),
                bold: line.bold ?? (options.bold as boolean | undefined),
                italic: line.italic ?? (options.italic as boolean | undefined),
                color: line.color ?? (options.color as string | undefined),
                breakLine: true,
            },
        }));
        slide.addText(items, options as PptxGenJS.TextPropsOptions);
    } else if (textContent.length === 1 && !textContent[0].fontSize) {
        // Simple single-line text
        slide.addText(textContent[0].text, options as PptxGenJS.TextPropsOptions);
    } else {
        // Multi-segment text (spans with different formatting)
        const items = textContent.map(seg => ({
            text: seg.text,
            options: {
                fontSize: seg.fontSize,
                bold: seg.bold,
                italic: seg.italic,
                color: seg.color,
                breakLine: seg.breakLine,
            },
        }));
        slide.addText(items, options as PptxGenJS.TextPropsOptions);
    }
}

interface TextSegment {
    text: string;
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
    color?: string;
    breakLine?: boolean;
}

function extractTextContent(el: HTMLElement): TextSegment[] {
    const segments: TextSegment[] = [];

    // If element has child elements (spans, divs, br), extract per-child
    if (el.children.length > 0) {
        for (const child of Array.from(el.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) {
                const text = child.textContent?.trim();
                if (text) {
                    segments.push({ text });
                }
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const childEl = child as HTMLElement;
                if (childEl.tagName === 'BR') {
                    // Add line break to previous segment
                    if (segments.length > 0) {
                        segments[segments.length - 1].breakLine = true;
                    }
                    continue;
                }

                const text = childEl.textContent?.trim();
                if (!text) continue;

                const seg: TextSegment = { text };
                const childStyle = childEl.style;

                const fs = parsePx(childStyle.fontSize);
                if (fs > 0) seg.fontSize = Math.round(fs * PX_TO_PT);

                if (childStyle.fontWeight === 'bold' || parseInt(childStyle.fontWeight) >= 700 || childEl.tagName === 'B' || childEl.tagName === 'STRONG') {
                    seg.bold = true;
                }
                if (childStyle.fontStyle === 'italic' || childEl.tagName === 'I' || childEl.tagName === 'EM') {
                    seg.italic = true;
                }
                const c = cssColorToHex(childStyle.color);
                if (c) seg.color = c;

                // Check if this child is block-level (div, p) -> add line break
                const tag = childEl.tagName;
                if (tag === 'DIV' || tag === 'P' || tag === 'LI') {
                    seg.breakLine = true;
                }

                segments.push(seg);
            }
        }
    } else {
        // Plain text content
        const text = el.textContent?.trim();
        if (text) {
            // Split by <br> equivalents (newlines in source)
            const lines = text.split('\n').filter(l => l.trim());
            for (let i = 0; i < lines.length; i++) {
                segments.push({
                    text: lines[i].trim(),
                    breakLine: i < lines.length - 1,
                });
            }
        }
    }

    return segments;
}

/* ------------------------------------------------------------------ */
/*  Image rendering                                                    */
/* ------------------------------------------------------------------ */

async function renderImage(
    slide: PptxGenJS.Slide,
    el: HTMLElement,
    pos: Position,
    imageLoader?: ImageLoader,
): Promise<void> {
    const vaultPath = el.dataset.vaultPath ?? '';
    const base64Data = el.dataset.base64 ?? '';

    let imageData: string | undefined;

    if (base64Data) {
        imageData = base64Data;
    } else if (vaultPath && imageLoader) {
        const result = await imageLoader(vaultPath);
        if (result) {
            imageData = result.data;
        }
    }

    if (!imageData) {
        console.debug(`[HtmlSlideParser] Image not resolved: vault="${vaultPath}"`);
        return;
    }

    const options: PptxGenJS.ImageProps = {
        data: imageData,
        x: pos.x,
        y: pos.y,
        w: pos.w,
        h: pos.h,
    };

    // Object fit
    const objectFit = el.dataset.objectFit ?? el.style.objectFit ?? '';
    if (objectFit === 'contain') {
        options.sizing = { type: 'contain', w: pos.w, h: pos.h };
    } else if (objectFit === 'cover') {
        options.sizing = { type: 'cover', w: pos.w, h: pos.h };
    }

    // Rounding (for circular images)
    const borderRadius = parsePx(el.style.borderRadius);
    if (borderRadius > 0) {
        options.rounding = true;
    }

    slide.addImage(options);
}

/* ------------------------------------------------------------------ */
/*  Chart rendering (hybrid: position from HTML, data from ChartData)  */
/* ------------------------------------------------------------------ */

function renderChart(
    slide: PptxGenJS.Slide,
    pptx: PptxGenJS,
    el: HTMLElement,
    pos: Position,
    charts?: ChartData[],
): void {
    const chartIndex = parseInt(el.dataset.chartIndex ?? '0');
    const chart = charts?.[chartIndex];

    if (!chart) {
        console.debug(`[HtmlSlideParser] No chart data at index ${chartIndex}`);
        return;
    }

    const chartTypeMap: Record<string, PptxGenJS.CHART_NAME> = {
        'bar': pptx.ChartType.bar,
        'line': pptx.ChartType.line,
        'pie': pptx.ChartType.pie,
    };

    const pptxChartType = chartTypeMap[chart.type] ?? pptx.ChartType.bar;

    const DEFAULT_PALETTE = ['4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];

    const chartData = chart.series.map(s => ({
        name: s.name,
        labels: chart.categories,
        values: s.values,
    }));

    const seriesColors = chart.series.map((s, i) =>
        s.color?.replace('#', '') ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length],
    );

    slide.addChart(pptxChartType, chartData, {
        x: pos.x,
        y: pos.y,
        w: pos.w,
        h: pos.h,
        showTitle: !!chart.title,
        title: chart.title ?? '',
        titleFontSize: 14,
        chartColors: seriesColors,
        showLegend: chart.series.length > 1,
        legendPos: 'b',
        legendFontSize: 11,
        catAxisLabelFontSize: 11,
        valAxisLabelFontSize: 11,
        dataLabelPosition: chart.type === 'pie' ? 'bestFit' : undefined,
        showValue: chart.type === 'pie',
    });
}

/* ------------------------------------------------------------------ */
/*  Table rendering (hybrid: position from HTML, data from TableData)  */
/* ------------------------------------------------------------------ */

function renderTable(
    slide: PptxGenJS.Slide,
    el: HTMLElement,
    pos: Position,
    tables?: TableData[],
): void {
    const tableIndex = parseInt(el.dataset.tableIndex ?? '0');
    const table = tables?.[tableIndex];

    if (!table) {
        console.debug(`[HtmlSlideParser] No table data at index ${tableIndex}`);
        return;
    }

    const headerColor = table.style?.headerColor?.replace('#', '') ?? '4472C4';
    const headerTextColor = table.style?.headerTextColor?.replace('#', '') ?? 'FFFFFF';
    const zebraColor = table.style?.zebraColor?.replace('#', '') ?? 'F2F2F2';

    const tableRows: PptxGenJS.TableRow[] = [];

    // Header row
    if (table.headers && table.headers.length > 0) {
        tableRows.push(
            table.headers.map(h => ({
                text: String(h ?? ''),
                options: {
                    bold: true,
                    color: headerTextColor,
                    fill: { color: headerColor },
                    fontSize: 13,
                    align: 'left' as const,
                },
            })),
        );
    }

    // Data rows with zebra striping
    const rows = table.rows ?? [];
    for (let i = 0; i < rows.length; i++) {
        const rowFill = i % 2 === 0 ? zebraColor : 'FFFFFF';
        tableRows.push(
            (rows[i] as (string | number | null)[]).map(cell => ({
                text: cell !== null && cell !== undefined ? String(cell) : '',
                options: {
                    fontSize: 12,
                    color: '333333',
                    fill: { color: rowFill },
                    align: 'left' as const,
                },
            })),
        );
    }

    const colCount = table.headers?.length ?? (rows[0]?.length ?? 1);

    slide.addTable(tableRows, {
        x: pos.x,
        y: pos.y,
        w: pos.w,
        border: { type: 'solid', pt: 0.5, color: 'E5E7EB' },
        autoPage: true,
        autoPageRepeatHeader: true,
        colW: Array.from({ length: colCount }, () => pos.w / colCount),
    });
}

/* ------------------------------------------------------------------ */
/*  Style parsing helpers                                              */
/* ------------------------------------------------------------------ */

function parseBorder(style: CSSStyleDeclaration): PptxGenJS.BorderProps | undefined {
    // Check individual border sides first (for accent borders)
    const sides = ['borderLeft', 'borderRight', 'borderTop', 'borderBottom'] as const;
    for (const side of sides) {
        const val = style[side];
        if (val && val !== 'none' && val !== '') {
            return parseBorderValue(val);
        }
    }

    // Check shorthand border
    const border = style.border;
    if (border && border !== 'none' && border !== '') {
        return parseBorderValue(border);
    }

    return undefined;
}

function parseBorderValue(value: string): PptxGenJS.BorderProps | undefined {
    // Parse "4px solid #e74c3c" format
    const match = value.match(/([\d.]+)px\s+(solid|dashed|dotted)\s+(#[0-9a-fA-F]{3,6}|rgb[a]?\([^)]+\)|\w+)/);
    if (!match) return undefined;

    const pt = parseFloat(match[1]) * PX_TO_PT;
    const color = cssColorToHex(match[3]);

    return {
        type: match[2] === 'dashed' ? 'dash' : 'solid',
        pt: Math.max(0.5, pt),
        color: color || '000000',
    };
}

function parseShadow(boxShadow: string): PptxGenJS.ShadowProps | undefined {
    if (!boxShadow || boxShadow === 'none') return undefined;

    // Parse "Xpx Ypx Bpx Spx color" or "Xpx Ypx Bpx color"
    const match = boxShadow.match(
        /([\d.]+)px\s+([\d.]+)px\s+([\d.]+)px(?:\s+([\d.]+)px)?\s+(#[0-9a-fA-F]{3,6}|rgb[a]?\([^)]+\))/,
    );
    if (!match) return undefined;

    const offsetX = parseFloat(match[1]);
    const offsetY = parseFloat(match[2]);
    const blur = parseFloat(match[3]);
    const color = cssColorToHex(match[5]);

    // Extract alpha from rgba for opacity
    let opacity = 0.3;
    const alphaMatch = match[5].match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
    if (alphaMatch) {
        opacity = parseFloat(alphaMatch[1]);
    }

    return {
        type: 'outer',
        blur: Math.round(blur * PX_TO_PT),
        offset: Math.round(Math.max(offsetX, offsetY) * PX_TO_PT),
        opacity,
        color: color || '000000',
    };
}

function parseRotation(transform: string): number {
    if (!transform) return 0;
    const match = transform.match(/rotate\(([-\d.]+)deg\)/);
    return match ? parseFloat(match[1]) : 0;
}

function mapTextAlign(align: string): 'left' | 'center' | 'right' | 'justify' {
    switch (align) {
        case 'center': return 'center';
        case 'right': return 'right';
        case 'justify': return 'justify';
        default: return 'left';
    }
}

function mapVerticalAlign(valign: string): 'top' | 'middle' | 'bottom' {
    switch (valign) {
        case 'middle':
        case 'center':
            return 'middle';
        case 'bottom':
            return 'bottom';
        default:
            return 'top';
    }
}

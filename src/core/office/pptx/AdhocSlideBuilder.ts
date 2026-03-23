/**
 * AdhocSlideBuilder — generates PPTX slides from annotated HTML via PptxGenJS.
 *
 * Used for adhoc slides (no corporate template) where the LLM writes HTML
 * on a 1280x720 pixel canvas. Each element uses data-object-type attributes
 * to specify its type (shape, textbox, image, chart, table).
 *
 * This is a slimmer rebuild of the deleted HtmlSlideParser, keeping only
 * the core rendering logic without theme CSS or deko elements.
 */

import PptxGenJS from 'pptxgenjs';
import type { AdhocSlideInput, ChartInput, TableInput, PptxBuildResult } from './types';

// Slide dimensions: 1280x720 px canvas → PptxGenJS uses inches (10" x 5.625")
const SLIDE_W_INCHES = 10;
const SLIDE_H_INCHES = 5.625;
const PX_TO_INCHES_X = SLIDE_W_INCHES / 1280;
const PX_TO_INCHES_Y = SLIDE_H_INCHES / 720;

/** Convert px to inches for x/width. */
function pxToInX(px: number): number {
    return px * PX_TO_INCHES_X;
}

/** Convert px to inches for y/height. */
function pxToInY(px: number): number {
    return px * PX_TO_INCHES_Y;
}

/** Parse a CSS pixel value like "100px" to number. */
function parsePx(val: string | undefined): number {
    if (!val) return 0;
    return parseFloat(val.replace('px', '')) || 0;
}

/** Parse inline style string to key-value pairs. */
function parseStyle(style: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const part of style.split(';')) {
        const colonIdx = part.indexOf(':');
        if (colonIdx > 0) {
            const key = part.substring(0, colonIdx).trim();
            const value = part.substring(colonIdx + 1).trim();
            if (key && value) result[key] = value;
        }
    }
    return result;
}

/** Minimal HTML element representation (no DOM parser needed). */
interface ParsedElement {
    type: string; // data-object-type: shape, textbox, image, chart, table
    style: Record<string, string>;
    text: string;
    attributes: Record<string, string>;
}

/** Parse annotated HTML into elements (regex-based, no DOM). */
function parseHtmlElements(html: string): ParsedElement[] {
    const elements: ParsedElement[] = [];
    // Match divs with data-object="true" or data-object='true' (LLMs use both quote styles)
    const regex = /<div\s+([^>]*data-object=["']true["'][^>]*)>([\s\S]*?)<\/div>/gi;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(html)) !== null) {
        const attrStr = match[1];
        const innerContent = match[2];

        // Extract attributes (support both single and double quotes)
        const attrs: Record<string, string> = {};
        const attrRegex = /([\w-]+)=["']([^"']*)["']/g;
        let attrMatch: RegExpExecArray | null;
        while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
            attrs[attrMatch[1]] = attrMatch[2];
        }

        const objectType = attrs['data-object-type'] || 'shape';
        const style = parseStyle(attrs['style'] || '');

        // Strip HTML tags from text content
        let stripped = innerContent.replace(/<br\s*\/?>/gi, '\n');
        // Loop tag removal to handle nested/malformed fragments like <<b>b>
        let prev = '';
        while (prev !== stripped) { prev = stripped; stripped = stripped.replace(/<[^>]+>/g, ''); }
        // Single-pass entity decode to avoid double-unescaping (e.g. &amp;lt; -> <)
        const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
        const text = stripped
            .replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] ?? m)
            .trim();

        elements.push({ type: objectType, style, text, attributes: attrs });
    }

    return elements;
}

/** Convert hex color (#RRGGBB) to PptxGenJS format (RRGGBB without #). */
function toColor(hex: string | undefined): string | undefined {
    if (!hex) return undefined;
    return hex.replace('#', '').toUpperCase();
}

export class AdhocSlideBuilder {
    /**
     * Build a PPTX from adhoc HTML slides.
     */
    async build(slides: AdhocSlideInput[], themeName?: string): Promise<PptxBuildResult> {
        const warnings: string[] = [];
        const pptx = new PptxGenJS();

        pptx.defineLayout({ name: 'CUSTOM', width: SLIDE_W_INCHES, height: SLIDE_H_INCHES });
        pptx.layout = 'CUSTOM';
        pptx.author = 'Obsilo Agent';

        for (let i = 0; i < slides.length; i++) {
            const slideInput = slides[i];
            const pptxSlide = pptx.addSlide();

            if (slideInput.notes) {
                pptxSlide.addNotes(slideInput.notes);
            }

            const elements = parseHtmlElements(slideInput.html);

            for (const el of elements) {
                try {
                    this.renderElement(pptxSlide, el, slideInput, warnings, i);
                } catch (e) {
                    warnings.push(`Slide ${i + 1}: Failed to render ${el.type} element: ${(e as Error).message}`);
                }
            }

            if (elements.length === 0) {
                warnings.push(`Slide ${i + 1}: No data-object elements found in HTML`);
            }
        }

        const buffer = await pptx.write({ outputType: 'arraybuffer', compression: true }) as ArrayBuffer;

        return {
            buffer,
            slideCount: slides.length,
            warnings,
        };
    }

    private renderElement(
        slide: PptxGenJS.Slide,
        el: ParsedElement,
        slideInput: AdhocSlideInput,
        warnings: string[],
        slideIdx: number,
    ): void {
        const x = pxToInX(parsePx(el.style['left']));
        const y = pxToInY(parsePx(el.style['top']));
        const w = pxToInX(parsePx(el.style['width']));
        const h = pxToInY(parsePx(el.style['height']));

        switch (el.type) {
            case 'shape':
                this.renderShape(slide, el, x, y, w, h);
                break;
            case 'textbox':
                this.renderTextbox(slide, el, x, y, w, h);
                break;
            case 'image':
                this.renderImage(slide, el, x, y, w, h, warnings, slideIdx);
                break;
            case 'chart':
                this.renderChart(slide, el, x, y, w, h, slideInput.charts, warnings, slideIdx);
                break;
            case 'table':
                this.renderTable(slide, el, x, y, w, h, slideInput.tables, warnings, slideIdx);
                break;
            default:
                warnings.push(`Slide ${slideIdx + 1}: Unknown element type "${el.type}"`);
        }
    }

    private renderShape(
        slide: PptxGenJS.Slide,
        el: ParsedElement,
        x: number, y: number, w: number, h: number,
    ): void {
        const bgColor = toColor(el.style['background-color'] || el.style['background']);
        const borderColor = toColor(el.style['border-color']);
        const borderWidth = parsePx(el.style['border-width']);
        const borderRadius = parsePx(el.style['border-radius']);

        const shapeHint = el.attributes['data-shape'];
        const shapeName = this.resolveShapeName(shapeHint);

        const opts: Record<string, unknown> = { x, y, w, h };
        if (bgColor) opts.fill = { color: bgColor };
        if (borderColor && borderWidth) {
            opts.line = { color: borderColor, width: borderWidth };
        } else if (bgColor) {
            // Subtle border for filled shapes without explicit border
            opts.line = { color: bgColor, width: 0.5 };
        }
        if (borderRadius > 0) opts.rectRadius = borderRadius * PX_TO_INCHES_X;

        // Professional shadow on filled shapes
        if (bgColor) {
            opts.shadow = {
                type: 'outer',
                color: '000000',
                blur: 6,
                offset: 2,
                angle: 315,
                opacity: 0.15,
            };
        }

        slide.addShape(shapeName, opts as PptxGenJS.ShapeProps);

        // If shape has text, add it as overlay with auto-fit
        if (el.text) {
            const fontSize = parseFloat(el.style['font-size'] || '14');
            const fontColor = toColor(el.style['color']);
            slide.addText(el.text, {
                x, y, w, h,
                fontSize,
                color: fontColor || '000000',
                align: (el.style['text-align'] as PptxGenJS.HAlign) || 'center',
                valign: 'middle',
                fontFace: el.style['font-family']?.split(',')[0]?.replace(/['"]/g, '') || undefined,
                bold: el.style['font-weight'] === 'bold' || parseInt(el.style['font-weight'] || '0') >= 700,
                fit: 'shrink',
                margin: [4, 6, 4, 6],
            });
        }
    }

    private renderTextbox(
        slide: PptxGenJS.Slide,
        el: ParsedElement,
        x: number, y: number, w: number, h: number,
    ): void {
        const fontSize = parseFloat(el.style['font-size'] || '14');
        const fontColor = toColor(el.style['color']);
        const bgColor = toColor(el.style['background-color']);
        const isBold = el.style['font-weight'] === 'bold' || parseInt(el.style['font-weight'] || '0') >= 700;
        const isItalic = el.style['font-style'] === 'italic';
        const align = (el.style['text-align'] as PptxGenJS.HAlign) || 'left';
        const valign = (el.attributes['data-valign'] as PptxGenJS.VAlign) || 'top';
        const bullets = el.attributes['data-bullets'] === 'true';

        const opts: PptxGenJS.TextPropsOptions = {
            x, y, w, h,
            fontSize,
            color: fontColor || '000000',
            align,
            valign,
            bold: isBold,
            italic: isItalic,
            fontFace: el.style['font-family']?.split(',')[0]?.replace(/['"]/g, '') || undefined,
            bullet: bullets ? true : undefined,
            wrap: true,
            fit: 'shrink',
            margin: [6, 8, 6, 8],
            lineSpacingMultiple: 1.15,
            paraSpaceAfter: 4,
        };

        if (bgColor) {
            opts.fill = { color: bgColor };
        }

        slide.addText(el.text, opts);
    }

    private renderImage(
        slide: PptxGenJS.Slide,
        el: ParsedElement,
        x: number, y: number, w: number, h: number,
        warnings: string[],
        slideIdx: number,
    ): void {
        const src = el.attributes['data-vault-path'] || el.attributes['data-src'] || '';
        if (!src) {
            warnings.push(`Slide ${slideIdx + 1}: Image element has no data-vault-path`);
            return;
        }

        // For vault images, we'd need to resolve the path and read the file.
        // This is handled at the tool level -- here we just place a placeholder.
        warnings.push(`Slide ${slideIdx + 1}: Image "${src}" referenced but vault image embedding is not yet supported in adhoc mode`);
    }

    private renderChart(
        slide: PptxGenJS.Slide,
        el: ParsedElement,
        x: number, y: number, w: number, h: number,
        charts: ChartInput[] | undefined,
        warnings: string[],
        slideIdx: number,
    ): void {
        const chartIdx = parseInt(el.attributes['data-chart-index'] || '0');
        const chartData = charts?.[chartIdx];

        if (!chartData) {
            warnings.push(`Slide ${slideIdx + 1}: Chart index ${chartIdx} not found in charts array`);
            return;
        }

        const chartTypeMap: Record<string, PptxGenJS.CHART_NAME> = {
            bar: 'bar' as PptxGenJS.CHART_NAME,
            line: 'line' as PptxGenJS.CHART_NAME,
            pie: 'pie' as PptxGenJS.CHART_NAME,
        };

        const pptxChartType = chartTypeMap[chartData.type] || ('bar' as PptxGenJS.CHART_NAME);

        const data = chartData.series.map(s => ({
            name: s.name,
            labels: chartData.categories,
            values: s.values,
        }));

        slide.addChart(pptxChartType, data, {
            x, y, w, h,
            showTitle: !!chartData.title,
            title: chartData.title,
            titleFontSize: 14,
            showLegend: chartData.series.length > 1,
            legendPos: 'b',
            legendFontSize: 10,
            chartArea: { roundedCorners: true },
            valAxisLabelFontSize: 10,
            catAxisLabelFontSize: 10,
            valGridLine: { color: 'E5E7EB', style: 'solid', size: 0.5 },
            valAxisMajorTickMark: 'none',
            catAxisMajorTickMark: 'none',
            dataBorder: { pt: 0.5, color: 'FFFFFF' },
        });
    }

    private renderTable(
        slide: PptxGenJS.Slide,
        el: ParsedElement,
        x: number, y: number, w: number, h: number,
        tables: TableInput[] | undefined,
        warnings: string[],
        slideIdx: number,
    ): void {
        const tableIdx = parseInt(el.attributes['data-table-index'] || '0');
        const tableData = tables?.[tableIdx];

        if (!tableData) {
            warnings.push(`Slide ${slideIdx + 1}: Table index ${tableIdx} not found in tables array`);
            return;
        }

        const rows: PptxGenJS.TableRow[] = [];

        // Header row
        if (tableData.headers && tableData.headers.length > 0) {
            rows.push(tableData.headers.map(h => ({
                text: h,
                options: {
                    bold: true,
                    fill: { color: toColor(tableData.style?.headerColor) || '4472C4' },
                    color: toColor(tableData.style?.headerTextColor) || 'FFFFFF',
                    fontSize: 11,
                },
            })));
        }

        // Data rows
        if (tableData.rows) {
            for (let rowIdx = 0; rowIdx < tableData.rows.length; rowIdx++) {
                const row = tableData.rows[rowIdx];
                const zebraFill = rowIdx % 2 === 1 && tableData.style?.zebraColor
                    ? { fill: { color: toColor(tableData.style.zebraColor) } }
                    : {};

                rows.push(row.map(cell => ({
                    text: cell != null ? String(cell) : '',
                    options: { fontSize: 10, ...zebraFill },
                })));
            }
        }

        if (rows.length > 0) {
            slide.addTable(rows, {
                x, y, w, h,
                border: { type: 'solid', pt: 0.5, color: 'E2E8F0' },
                autoPage: false,
                margin: [4, 6, 4, 6],
                fontSize: 10,
                fontFace: 'Calibri',
            });
        }
    }

    private resolveShapeName(hint: string | undefined): PptxGenJS.ShapeType {
        if (!hint) return 'rect' as PptxGenJS.ShapeType;

        const shapeMap: Record<string, string> = {
            rect: 'rect',
            roundRect: 'roundRect',
            ellipse: 'ellipse',
            circle: 'ellipse',
            triangle: 'triangle',
            diamond: 'diamond',
            hexagon: 'hexagon',
            pentagon: 'pentagon',
            octagon: 'octagon',
            chevron: 'chevron',
            homePlate: 'homePlate',
            star5: 'star5',
            heart: 'heart',
            cloud: 'cloud',
            plus: 'plus',
            donut: 'donut',
            rightArrow: 'rightArrow',
            leftArrow: 'leftArrow',
            upArrow: 'upArrow',
            downArrow: 'downArrow',
            line: 'line',
            wedgeRectCallout: 'wedgeRectCallout',
        };

        return (shapeMap[hint] || 'rect') as PptxGenJS.ShapeType;
    }
}

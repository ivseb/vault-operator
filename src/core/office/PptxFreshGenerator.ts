/**
 * PptxFreshGenerator -- PPTX generation for default templates.
 *
 * Used when ALL slides are FRESH (no corporate template prototypes to edit).
 * Generates slides via PptxGenJS with themed slide masters.
 */

import PptxGenJS from 'pptxgenjs';
import type { SlideData, HtmlSlideInput } from './types';
import { renderHtmlSlide, type ImageLoader } from './HtmlSlideParser';

/* ------------------------------------------------------------------ */
/*  Theme definitions for default templates                            */
/* ------------------------------------------------------------------ */

interface ThemeColors {
    primary: string;
    accent1: string;
    accent2: string;
    textDark: string;
    textLight: string;
    background: string;
}

const DEFAULT_THEMES: Record<string, ThemeColors> = {
    'default-executive': {
        primary: '1F2937', accent1: '3B82F6', accent2: '10B981',
        textDark: '1F2937', textLight: 'FFFFFF', background: 'FFFFFF',
    },
    'default-modern': {
        primary: '1E40AF', accent1: 'F97316', accent2: '8B5CF6',
        textDark: '1E293B', textLight: 'FFFFFF', background: 'F8FAFC',
    },
    'default-minimal': {
        primary: '111827', accent1: '6B7280', accent2: '9CA3AF',
        textDark: '111827', textLight: 'FFFFFF', background: 'FFFFFF',
    },
};

/** Chart color palettes per theme (up to 6 series). */
const CHART_PALETTES: Record<string, string[]> = {
    'default-executive': ['3B82F6', '10B981', 'F59E0B', 'EF4444', '8B5CF6', '06B6D4'],
    'default-modern':    ['F97316', '8B5CF6', '3B82F6', '10B981', 'EC4899', '14B8A6'],
    'default-minimal':   ['6B7280', '111827', '9CA3AF', '4B5563', 'D1D5DB', '374151'],
};

/* ------------------------------------------------------------------ */
/*  Slide master definitions                                           */
/* ------------------------------------------------------------------ */

function defineSlideMasters(pptx: PptxGenJS, theme: ThemeColors): void {
    // Title slide -- dark background, centered text
    pptx.defineSlideMaster({
        title: 'TITLE_SLIDE',
        background: { color: theme.primary },
        objects: [
            { placeholder: { options: { name: 'title', type: 'title', x: 0.8, y: 1.8, w: 11.7, h: 1.5, fontSize: 36, bold: true, color: theme.textLight, align: 'center' } } },
            { placeholder: { options: { name: 'subtitle', type: 'body', x: 2.0, y: 3.5, w: 9.3, h: 1.0, fontSize: 18, color: theme.textLight, align: 'center' } } },
        ],
    });

    // Section divider -- dark, large title
    pptx.defineSlideMaster({
        title: 'SECTION_SLIDE',
        background: { color: theme.primary },
        objects: [
            { placeholder: { options: { name: 'title', type: 'title', x: 0.8, y: 2.0, w: 11.7, h: 2.0, fontSize: 40, bold: true, color: theme.textLight, align: 'center' } } },
        ],
    });

    // Content -- light background, title + body area
    pptx.defineSlideMaster({
        title: 'CONTENT_SLIDE',
        background: { color: theme.background },
        objects: [
            { rect: { x: 0, y: 0, w: 13.33, h: 0.9, fill: { color: theme.primary } } },
            { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 0.1, w: 12.3, h: 0.7, fontSize: 22, bold: true, color: theme.textLight } } },
        ],
    });
}

/* ------------------------------------------------------------------ */
/*  Main entry point                                                   */
/* ------------------------------------------------------------------ */

/**
 * Generate a complete PPTX for default templates using PptxGenJS.
 */
export async function generateFreshPptx(
    slides: SlideData[],
    templateName: string,
): Promise<ArrayBuffer> {
    const pptx = new PptxGenJS();
    const theme = DEFAULT_THEMES[templateName] ?? DEFAULT_THEMES['default-executive'];
    const palette = CHART_PALETTES[templateName] ?? CHART_PALETTES['default-executive'];

    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = 'Obsilo Agent';

    defineSlideMasters(pptx, theme);

    for (const data of slides) {
        addSlide(pptx, data, theme, palette);
    }

    const output = await pptx.write({ outputType: 'arraybuffer' });
    return output as ArrayBuffer;
}

/* ------------------------------------------------------------------ */
/*  Slide routing                                                      */
/* ------------------------------------------------------------------ */

function addSlide(pptx: PptxGenJS, data: SlideData, theme: ThemeColors, palette: string[]): void {
    if (isTitleSlide(data)) {
        addTitleSlide(pptx, data, theme);
    } else if (isSectionSlide(data)) {
        addSectionSlide(pptx, data);
    } else if (data.chart) {
        addChartSlide(pptx, data, theme, palette);
    } else if (data.kpis && data.kpis.length > 0) {
        addKpiSlide(pptx, data, theme);
    } else if (data.table) {
        addTableSlide(pptx, data, theme);
    } else if (data.process && data.process.length > 0) {
        addProcessSlide(pptx, data, theme);
    } else {
        addContentSlide(pptx, data, theme);
    }
}

function isTitleSlide(data: SlideData): boolean {
    return !!(data.subtitle && !data.body && !data.bullets && !data.table && !data.chart && !data.kpis && !data.process);
}

function isSectionSlide(data: SlideData): boolean {
    const layout = data.layout?.toLowerCase() ?? '';
    return layout.includes('section') || layout.includes('divider');
}

/* ------------------------------------------------------------------ */
/*  Title slide                                                        */
/* ------------------------------------------------------------------ */

function addTitleSlide(pptx: PptxGenJS, data: SlideData, theme: ThemeColors): void {
    const slide = pptx.addSlide({ masterName: 'TITLE_SLIDE' });
    if (data.title) {
        slide.addText(data.title, {
            placeholder: 'title',
        });
    }
    if (data.subtitle) {
        slide.addText(data.subtitle, {
            placeholder: 'subtitle',
        });
    }
    if (data.notes) slide.addNotes(data.notes);
}

/* ------------------------------------------------------------------ */
/*  Section divider                                                    */
/* ------------------------------------------------------------------ */

function addSectionSlide(pptx: PptxGenJS, data: SlideData): void {
    const slide = pptx.addSlide({ masterName: 'SECTION_SLIDE' });
    const displayTitle = data.subtitle
        ? `${data.title ?? ''}\n${data.subtitle}`
        : (data.title ?? '');
    slide.addText(displayTitle, { placeholder: 'title' });
    if (data.notes) slide.addNotes(data.notes);
}

/* ------------------------------------------------------------------ */
/*  Content (bullets / body)                                           */
/* ------------------------------------------------------------------ */

function addContentSlide(pptx: PptxGenJS, data: SlideData, theme: ThemeColors): void {
    const slide = pptx.addSlide({ masterName: 'CONTENT_SLIDE' });
    if (data.title) {
        slide.addText(data.title, { placeholder: 'title' });
    }

    const bodyY = 1.2;
    const bodyH = 5.8;

    if (data.image) {
        // Image + text layout (60/40 split)
        const imgData = `data:${data.image.mime};base64,${bufferToBase64(data.image.data)}`;
        slide.addImage({ data: imgData, x: 7.0, y: bodyY, w: 5.8, h: bodyH, sizing: { type: 'contain', w: 5.8, h: bodyH } });

        if (data.bullets && data.bullets.length > 0) {
            slide.addText(
                data.bullets.map(b => ({ text: b, options: { bullet: true, fontSize: 16, color: theme.textDark, breakLine: true } })),
                { x: 0.5, y: bodyY, w: 6.2, h: bodyH, valign: 'top' },
            );
        } else if (data.body) {
            slide.addText(data.body, { x: 0.5, y: bodyY, w: 6.2, h: bodyH, fontSize: 16, color: theme.textDark, valign: 'top' });
        }
    } else if (data.bullets && data.bullets.length > 0) {
        slide.addText(
            data.bullets.map(b => ({ text: b, options: { bullet: true, fontSize: 18, color: theme.textDark, breakLine: true } })),
            { x: 0.5, y: bodyY, w: 12.3, h: bodyH, valign: 'top', lineSpacingMultiple: 1.4 },
        );
    } else if (data.body) {
        slide.addText(data.body, {
            x: 0.5, y: bodyY, w: 12.3, h: bodyH,
            fontSize: 18, color: theme.textDark, valign: 'top', lineSpacingMultiple: 1.4,
        });
    }

    if (data.notes) slide.addNotes(data.notes);
}

/* ------------------------------------------------------------------ */
/*  Chart slide                                                        */
/* ------------------------------------------------------------------ */

function addChartSlide(pptx: PptxGenJS, data: SlideData, theme: ThemeColors, palette: string[]): void {
    const slide = pptx.addSlide({ masterName: 'CONTENT_SLIDE' });
    if (data.title) {
        slide.addText(data.title, { placeholder: 'title' });
    }

    if (!data.chart) return;

    const chartTypeMap: Record<string, PptxGenJS.CHART_NAME> = {
        'bar': pptx.ChartType.bar,
        'line': pptx.ChartType.line,
        'pie': pptx.ChartType.pie,
    };

    const pptxChartType = chartTypeMap[data.chart.type] ?? pptx.ChartType.bar;

    const chartData = data.chart.series.map((s, i) => ({
        name: s.name,
        labels: data.chart!.categories,
        values: s.values,
    }));

    const seriesColors = data.chart.series.map((s, i) => s.color?.replace('#', '') ?? palette[i % palette.length]);

    slide.addChart(pptxChartType, chartData, {
        x: 0.5, y: 1.2, w: 12.3, h: 5.8,
        showTitle: !!data.chart.title,
        title: data.chart.title ?? '',
        titleFontSize: 14,
        titleColor: theme.textDark,
        chartColors: seriesColors,
        showLegend: data.chart.series.length > 1,
        legendPos: 'b',
        legendFontSize: 11,
        catAxisLabelFontSize: 11,
        valAxisLabelFontSize: 11,
        dataLabelPosition: data.chart.type === 'pie' ? 'bestFit' : undefined,
        showValue: data.chart.type === 'pie',
    });

    if (data.notes) slide.addNotes(data.notes);
}

/* ------------------------------------------------------------------ */
/*  Table slide                                                        */
/* ------------------------------------------------------------------ */

function addTableSlide(pptx: PptxGenJS, data: SlideData, theme: ThemeColors): void {
    const slide = pptx.addSlide({ masterName: 'CONTENT_SLIDE' });
    if (data.title) {
        slide.addText(data.title, { placeholder: 'title' });
    }

    if (!data.table) return;

    const tableRows: PptxGenJS.TableRow[] = [];

    // Header row
    if (data.table.headers && data.table.headers.length > 0) {
        tableRows.push(
            data.table.headers.map(h => ({
                text: String(h),
                options: { bold: true, color: theme.textLight, fill: { color: theme.accent1 }, fontSize: 13, align: 'left' as const },
            })),
        );
    }

    // Data rows with zebra striping
    const rows = data.table.rows ?? [];
    for (let i = 0; i < rows.length; i++) {
        const rowFill = i % 2 === 0 ? 'F9FAFB' : 'FFFFFF';
        tableRows.push(
            (rows[i] as (string | number | null)[]).map(cell => ({
                text: cell !== null && cell !== undefined ? String(cell) : '',
                options: { fontSize: 12, color: theme.textDark, fill: { color: rowFill }, align: 'left' as const },
            })),
        );
    }

    slide.addTable(tableRows, {
        x: 0.5, y: 1.2, w: 12.3,
        border: { type: 'solid', pt: 0.5, color: 'E5E7EB' },
        autoPage: true,
        autoPageRepeatHeader: true,
        autoPageLineWeight: 0.5,
        colW: data.table.headers
            ? data.table.headers.map(() => 12.3 / data.table!.headers!.length)
            : undefined,
    });

    if (data.notes) slide.addNotes(data.notes);
}

/* ------------------------------------------------------------------ */
/*  KPI dashboard                                                      */
/* ------------------------------------------------------------------ */

function addKpiSlide(pptx: PptxGenJS, data: SlideData, theme: ThemeColors): void {
    const slide = pptx.addSlide({ masterName: 'CONTENT_SLIDE' });
    if (data.title) {
        slide.addText(data.title, { placeholder: 'title' });
    }

    const kpis = data.kpis ?? [];
    const count = Math.min(kpis.length, 6);
    const cardW = count <= 3 ? 3.5 : 2.8;
    const gap = 0.4;
    const totalW = count * cardW + (count - 1) * gap;
    const startX = (13.33 - totalW) / 2;

    for (let i = 0; i < count; i++) {
        const kpi = kpis[i];
        const x = startX + i * (cardW + gap);
        const cardColor = kpi.color?.replace('#', '') ?? theme.accent1;

        // Card background
        slide.addShape(pptx.ShapeType.roundRect, {
            x, y: 2.0, w: cardW, h: 3.5,
            fill: { color: cardColor },
            rectRadius: 0.15,
            shadow: { type: 'outer', blur: 6, offset: 2, opacity: 0.15, color: '000000' },
        });

        // Value
        slide.addText(kpi.value, {
            x, y: 2.5, w: cardW, h: 1.5,
            fontSize: 32, bold: true, color: theme.textLight,
            align: 'center', valign: 'bottom',
        });

        // Label
        slide.addText(kpi.label, {
            x, y: 4.0, w: cardW, h: 1.0,
            fontSize: 14, color: theme.textLight,
            align: 'center', valign: 'top',
        });
    }

    if (data.notes) slide.addNotes(data.notes);
}

/* ------------------------------------------------------------------ */
/*  Process flow                                                       */
/* ------------------------------------------------------------------ */

function addProcessSlide(pptx: PptxGenJS, data: SlideData, theme: ThemeColors): void {
    const slide = pptx.addSlide({ masterName: 'CONTENT_SLIDE' });
    if (data.title) {
        slide.addText(data.title, { placeholder: 'title' });
    }

    const steps = data.process ?? [];
    const count = Math.min(steps.length, 8);
    const stepW = 1.3;
    const arrowW = 0.4;
    const gap = 0.15;
    const totalW = count * stepW + (count - 1) * (arrowW + gap * 2);
    const startX = (13.33 - totalW) / 2;

    for (let i = 0; i < count; i++) {
        const step = steps[i];
        const x = startX + i * (stepW + arrowW + gap * 2);

        // Step circle/rounded rect
        slide.addShape(pptx.ShapeType.roundRect, {
            x, y: 2.2, w: stepW, h: 1.6,
            fill: { color: theme.accent1 },
            rectRadius: 0.15,
        });

        // Step label
        slide.addText(step.label, {
            x, y: 2.2, w: stepW, h: 1.6,
            fontSize: 12, bold: true, color: theme.textLight,
            align: 'center', valign: 'middle',
            wrap: true,
        });

        // Step description below
        if (step.description) {
            slide.addText(step.description, {
                x: x - 0.1, y: 4.0, w: stepW + 0.2, h: 1.0,
                fontSize: 10, color: theme.textDark,
                align: 'center', valign: 'top',
                wrap: true,
            });
        }

        // Arrow between steps
        if (i < count - 1) {
            const arrowX = x + stepW + gap;
            slide.addShape(pptx.ShapeType.rightArrow, {
                x: arrowX, y: 2.7, w: arrowW, h: 0.6,
                fill: { color: theme.accent1 },
            });
        }
    }

    if (data.notes) slide.addNotes(data.notes);
}

/* ------------------------------------------------------------------ */
/*  HTML-based generation (unified pipeline)                           */
/* ------------------------------------------------------------------ */

/**
 * Generate a PPTX from annotated HTML slides.
 *
 * Each slide's HTML is parsed for data-object-type elements and rendered
 * via PptxGenJS. Charts and tables use hybrid rendering (position from
 * HTML, data from structured input).
 *
 * When `options` is provided (hybrid mode), deko elements (logo, accent bars)
 * are auto-injected behind content on every slide, and the slide size matches
 * the corporate template.
 */
export interface HtmlPipelineOptions {
    /** Decorative elements to inject behind content on every slide. */
    dekoElements?: DekoElementInput[];
    /** Slide size in inches (from template). If not set, uses LAYOUT_WIDE (13.33" x 7.5"). */
    slideSizeInches?: { w: number; h: number };
}

export interface DekoElementInput {
    type: 'image' | 'shape';
    position: { x: number; y: number; w: number; h: number };
    shapeName?: string;
    fillColor?: string;
    rotation?: number;
    imageData?: string;
}

export async function generateFromHtml(
    slides: HtmlSlideInput[],
    imageLoader?: ImageLoader,
    options?: HtmlPipelineOptions,
): Promise<ArrayBuffer> {
    const pptx = new PptxGenJS();

    if (options?.slideSizeInches) {
        pptx.defineLayout({
            name: 'CORPORATE',
            width: options.slideSizeInches.w,
            height: options.slideSizeInches.h,
        });
        pptx.layout = 'CORPORATE';
    } else {
        pptx.layout = 'LAYOUT_WIDE'; // 13.33" x 7.5"
    }
    pptx.author = 'Obsilo Agent';

    for (const input of slides) {
        const slide = pptx.addSlide();

        // Inject deko elements FIRST (behind content)
        // Per-slide dekoElements override global ones
        const effectiveDeko = input.dekoElements ?? options?.dekoElements;
        if (effectiveDeko) {
            injectDekoElements(slide, pptx, effectiveDeko);
        }

        await renderHtmlSlide(slide, pptx, input.html, input.charts, input.tables, imageLoader);
        if (input.notes) slide.addNotes(input.notes);
    }

    const output = await pptx.write({ outputType: 'arraybuffer' });
    return output as ArrayBuffer;
}

/**
 * Inject decorative elements (logos, accent bars) onto a slide.
 * Called before content rendering so deko appears behind content.
 */
function injectDekoElements(
    slide: PptxGenJS.Slide,
    pptx: PptxGenJS,
    elements: DekoElementInput[],
): void {
    for (const deko of elements) {
        const pos = {
            x: deko.position.x,
            y: deko.position.y,
            w: deko.position.w,
            h: deko.position.h,
        };

        if (deko.type === 'image' && deko.imageData) {
            slide.addImage({ data: deko.imageData, ...pos });
        } else if (deko.type === 'shape') {
            const shapeName = deko.shapeName ?? 'rect';
            const shapeType = (pptx.ShapeType as Record<string, PptxGenJS.SHAPE_NAME>)[shapeName]
                ?? pptx.ShapeType.rect;
            slide.addShape(shapeType, {
                ...pos,
                fill: deko.fillColor ? { color: deko.fillColor } : undefined,
                rotate: deko.rotation,
            });
        }
    }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function bufferToBase64(data: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < data.length; i++) {
        binary += String.fromCharCode(data[i]);
    }
    return btoa(binary);
}

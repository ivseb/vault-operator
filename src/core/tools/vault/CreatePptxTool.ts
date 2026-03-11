/**
 * CreatePptxTool
 *
 * Creates a PowerPoint presentation (.pptx) using two pipelines:
 *
 * 1. HTML Pipeline (preferred): LLM generates annotated HTML per slide
 *    with data-object-type attributes and absolute pixel positioning.
 *    HtmlSlideParser converts to PptxGenJS API calls.
 *
 * 2. Legacy Pipeline (fallback): Structured SlideData fields (title,
 *    bullets, chart, etc.) routed to PptxFreshGenerator.
 */

import { TFile } from 'obsidian';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import { writeBinaryToVault } from './writeBinaryToVault';
import { generateFreshPptx, generateFromHtml } from '../../office';
import type { SlideData, HtmlSlideInput, ChartData, ChartSeries, KpiData, ProcessStep, TableData } from '../../office';

/* ------------------------------------------------------------------ */
/*  Input interfaces                                                   */
/* ------------------------------------------------------------------ */

interface SlideInput {
    // HTML pipeline (preferred)
    html?: string;
    charts?: ChartInput[];
    tables?: TableInput[];

    // Legacy pipeline (fallback)
    title?: string;
    subtitle?: string;
    body?: string;
    bullets?: string[];
    table?: { headers?: string[]; rows?: (string | number | null)[][] };
    image?: string;
    chart?: { type: string; title?: string; categories: string[]; series: { name: string; values: number[]; color?: string }[] };
    kpis?: { value: string; label: string; color?: string }[];
    process?: { label: string; description?: string }[];
    notes?: string;
    layout?: string;
}

interface ChartInput {
    type: string;
    title?: string;
    categories: string[];
    series: { name: string; values: number[]; color?: string }[];
}

interface TableInput {
    headers?: string[];
    rows?: (string | number | null)[][];
    style?: { headerColor?: string; headerTextColor?: string; zebraColor?: string };
}

/* ------------------------------------------------------------------ */
/*  Layout auto-detection (legacy pipeline only)                       */
/* ------------------------------------------------------------------ */

function detectLayout(slide: SlideInput): string {
    if (slide.layout) return slide.layout;
    if (slide.subtitle && !slide.body && !slide.bullets && !slide.table && !slide.image) return 'title';
    if (slide.image && (slide.body || slide.bullets)) return 'image_right';
    return 'content';
}

/* ------------------------------------------------------------------ */
/*  Tool class                                                         */
/* ------------------------------------------------------------------ */

export class CreatePptxTool extends BaseTool<'create_pptx'> {
    readonly name = 'create_pptx' as const;
    readonly isWriteOperation = true;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'create_pptx',
            description:
                'Create a PowerPoint presentation (.pptx) with full layout control. ' +
                'Use annotated HTML per slide (1280x720px canvas) with data-object-type attributes ' +
                '(shape, textbox, image, chart, table) for precise positioning and styling. ' +
                'Charts and tables use hybrid rendering: position from HTML, data from structured input. ' +
                'The file format is handled automatically -- never use write_file or evaluate_expression for .pptx files.',
            input_schema: {
                type: 'object',
                properties: {
                    output_path: {
                        type: 'string',
                        description: 'Path for the presentation file (must end with .pptx)',
                    },
                    slides: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                html: {
                                    type: 'string',
                                    description:
                                        'Annotated HTML for this slide. Canvas: 1280x720px. ' +
                                        'Use <div data-object="true" data-object-type="shape|textbox|image|chart|table" ' +
                                        'style="position: absolute; left: Xpx; top: Ypx; width: Wpx; height: Hpx; ..."> ' +
                                        'for each element. See presentation-design skill for element catalog and patterns.',
                                },
                                charts: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            type: { type: 'string', enum: ['bar', 'pie', 'line'] },
                                            title: { type: 'string' },
                                            categories: { type: 'array', items: { type: 'string' } },
                                            series: {
                                                type: 'array',
                                                items: {
                                                    type: 'object',
                                                    properties: {
                                                        name: { type: 'string' },
                                                        values: { type: 'array', items: { type: 'number' } },
                                                        color: { type: 'string' },
                                                    },
                                                    required: ['name', 'values'],
                                                },
                                            },
                                        },
                                        required: ['type', 'categories', 'series'],
                                    },
                                    description: 'Chart data array. Reference in HTML via data-chart-index="0", "1", etc.',
                                },
                                tables: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            headers: { type: 'array', items: { type: 'string' } },
                                            rows: { type: 'array', items: { type: 'array', items: {} } },
                                            style: {
                                                type: 'object',
                                                properties: {
                                                    headerColor: { type: 'string', description: 'Header bg hex (e.g. "#4472C4")' },
                                                    headerTextColor: { type: 'string', description: 'Header text hex' },
                                                    zebraColor: { type: 'string', description: 'Zebra stripe hex' },
                                                },
                                            },
                                        },
                                    },
                                    description: 'Table data array. Reference in HTML via data-table-index="0", "1", etc.',
                                },
                                notes: {
                                    type: 'string',
                                    description: 'Speaker notes for this slide',
                                },
                                // Legacy fields (fallback when html is not provided)
                                title: { type: 'string', description: 'Slide title (legacy mode)' },
                                subtitle: { type: 'string', description: 'Subtitle (legacy mode)' },
                                body: { type: 'string', description: 'Body text (legacy mode)' },
                                bullets: { type: 'array', items: { type: 'string' }, description: 'Bullets (legacy mode)' },
                                table: {
                                    type: 'object',
                                    properties: {
                                        headers: { type: 'array', items: { type: 'string' } },
                                        rows: { type: 'array', items: { type: 'array', items: {} } },
                                    },
                                    description: 'Table (legacy mode)',
                                },
                                image: { type: 'string', description: 'Vault image path (legacy mode)' },
                                chart: {
                                    type: 'object',
                                    properties: {
                                        type: { type: 'string', enum: ['bar', 'pie', 'line'] },
                                        title: { type: 'string' },
                                        categories: { type: 'array', items: { type: 'string' } },
                                        series: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    name: { type: 'string' },
                                                    values: { type: 'array', items: { type: 'number' } },
                                                    color: { type: 'string' },
                                                },
                                                required: ['name', 'values'],
                                            },
                                        },
                                    },
                                    required: ['type', 'categories', 'series'],
                                    description: 'Chart (legacy mode)',
                                },
                                kpis: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            value: { type: 'string' },
                                            label: { type: 'string' },
                                            color: { type: 'string' },
                                        },
                                        required: ['value', 'label'],
                                    },
                                    description: 'KPI cards (legacy mode)',
                                },
                                process: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            label: { type: 'string' },
                                            description: { type: 'string' },
                                        },
                                        required: ['label'],
                                    },
                                    description: 'Process flow (legacy mode)',
                                },
                                layout: { type: 'string', description: 'Layout name (legacy mode)' },
                            },
                        },
                        description:
                            'Array of slides (max 50). Use html field for full layout control. ' +
                            'Legacy fields (title, bullets, etc.) are supported as fallback.',
                    },
                    title: {
                        type: 'string',
                        description: 'Presentation title (metadata)',
                    },
                    template: {
                        type: 'string',
                        description:
                            'Theme preset: "executive" (dark, professional), "modern" (blue/orange), "minimal" (black/white). ' +
                            'Defaults to "executive". For corporate designs, use the corresponding presentation skill instead.',
                    },
                },
                required: ['output_path'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const outputPath = ((input.output_path as string) ?? '').trim();
        const rawSlides = Array.isArray(input.slides) ? (input.slides as SlideInput[]) : [];
        const templateRef = ((input.template as string) ?? '').trim();

        // Validation
        if (!outputPath) {
            callbacks.pushToolResult(this.formatError(new Error('output_path is required')));
            return;
        }
        if (!outputPath.endsWith('.pptx')) {
            callbacks.pushToolResult(this.formatError(new Error('output_path must end with .pptx')));
            return;
        }

        const slides = rawSlides.slice(0, 50);
        const templateName = this.getTemplateName(templateRef);

        // Analyze-only mode
        if (slides.length === 0) {
            callbacks.pushToolResult(
                `Theme: **${templateName}**\n\n` +
                `Canvas: 1280x720px (16:9). Use annotated HTML with data-object-type attributes.\n` +
                `Element types: shape, textbox, image, chart, table.\n` +
                `Refer to the presentation-design skill for element catalog and layout patterns.\n\n` +
                `Now call create_pptx again with your slides using HTML format.`,
            );
            callbacks.log(`PPTX info returned for theme: ${templateName}`);
            return;
        }

        try {
            // Detect pipeline: HTML vs Legacy
            const hasHtml = slides.some(s => s.html);

            let buffer: ArrayBuffer;

            if (hasHtml) {
                // HTML Pipeline
                buffer = await this.generateViaHtml(slides);
            } else {
                // Legacy Pipeline
                buffer = await this.generateViaLegacy(slides, templateRef);
            }

            // Write to vault
            const result = await writeBinaryToVault(
                this.app.vault,
                outputPath,
                buffer,
                '.pptx',
            );

            const action = result.created ? 'Created' : 'Updated';
            const sizeKB = Math.round(result.size / 1024);
            const pipeline = hasHtml ? 'HTML' : 'Legacy';
            callbacks.pushToolResult(
                `${action} PowerPoint presentation: **${outputPath}**\n` +
                `- ${slides.length} slide${slides.length !== 1 ? 's' : ''}\n` +
                `- Theme: ${templateName}\n` +
                `- Size: ${sizeKB} KB\n` +
                `- Pipeline: ${pipeline}\n\n` +
                `Download or open the file to view the presentation.`,
            );
            callbacks.log(`${action} PPTX: ${outputPath} (${slides.length} slides, ${sizeKB} KB, pipeline: ${pipeline})`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('create_pptx', error);
        }
    }

    /* -------------------------------------------------------------- */
    /*  HTML Pipeline                                                  */
    /* -------------------------------------------------------------- */

    private async generateViaHtml(slides: SlideInput[]): Promise<ArrayBuffer> {
        const htmlSlides: HtmlSlideInput[] = slides.map(s => ({
            html: s.html ?? '',
            charts: s.charts ? this.convertChartInputs(s.charts) : undefined,
            tables: s.tables ? this.convertTableInputs(s.tables) : undefined,
            notes: s.notes,
        }));

        const imageLoader = (path: string) => this.loadImageAsBase64(path);
        return generateFromHtml(htmlSlides, imageLoader);
    }

    private convertChartInputs(inputs: ChartInput[]): ChartData[] {
        return inputs.map(c => {
            const validTypes = ['bar', 'pie', 'line'];
            return {
                type: (validTypes.includes(c.type) ? c.type : 'bar') as ChartData['type'],
                title: c.title,
                categories: c.categories,
                series: c.series.map(s => ({
                    name: s.name,
                    values: s.values,
                    color: s.color,
                } as ChartSeries)),
            };
        });
    }

    private convertTableInputs(inputs: TableInput[]): TableData[] {
        return inputs.map(t => ({
            headers: t.headers,
            rows: t.rows,
            style: t.style,
        }));
    }

    private async loadImageAsBase64(imagePath: string): Promise<{ data: string; type: string } | undefined> {
        try {
            const file = this.app.vault.getAbstractFileByPath(imagePath);
            if (!(file instanceof TFile)) {
                console.debug(`[CreatePptxTool] Image not found: ${imagePath}`);
                return undefined;
            }

            const buffer = await this.app.vault.readBinary(file);
            const ext = file.extension.toLowerCase();
            const mimeMap: Record<string, string> = {
                png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
                gif: 'image/gif', svg: 'image/svg+xml',
            };

            const base64 = bufferToBase64(new Uint8Array(buffer));
            const mime = mimeMap[ext] ?? 'image/png';
            return { data: `data:${mime};base64,${base64}`, type: ext };
        } catch {
            console.debug(`[CreatePptxTool] Error loading image: ${imagePath}`);
            return undefined;
        }
    }

    /* -------------------------------------------------------------- */
    /*  Legacy Pipeline                                                */
    /* -------------------------------------------------------------- */

    private async generateViaLegacy(slides: SlideInput[], templateRef: string): Promise<ArrayBuffer> {
        const slideData: SlideData[] = [];
        for (const s of slides) {
            slideData.push(await this.convertLegacySlideInput(s));
        }
        const internalName = this.getInternalTemplateName(templateRef);
        return generateFreshPptx(slideData, internalName ?? 'default-executive');
    }

    private async convertLegacySlideInput(input: SlideInput): Promise<SlideData> {
        const layout = detectLayout(input);
        const slide: SlideData = { layout };

        if (input.title) slide.title = input.title;
        if (input.subtitle) slide.subtitle = input.subtitle;
        if (input.notes) slide.notes = input.notes;
        if (input.body) slide.body = input.body;

        if (input.bullets && input.bullets.length > 0) {
            slide.bullets = input.bullets;
        }

        if (input.table) {
            slide.table = input.table;
        }

        if (input.image) {
            const imageData = await this.loadImageForLegacy(input.image);
            if (imageData) slide.image = imageData;
        }

        if (input.chart && input.chart.categories && input.chart.series) {
            const validTypes = ['bar', 'pie', 'line'];
            const chartType = validTypes.includes(input.chart.type) ? input.chart.type : 'bar';
            slide.chart = {
                type: chartType as ChartData['type'],
                title: input.chart.title,
                categories: input.chart.categories,
                series: input.chart.series.map(s => ({
                    name: s.name, values: s.values, color: s.color,
                } as ChartSeries)),
            };
        }

        if (input.kpis && input.kpis.length > 0) {
            slide.kpis = input.kpis.slice(0, 6).map(k => ({
                value: k.value, label: k.label, color: k.color,
            } as KpiData));
        }

        if (input.process && input.process.length > 0) {
            slide.process = input.process.slice(0, 8).map(p => ({
                label: p.label, description: p.description,
            } as ProcessStep));
        }

        return slide;
    }

    private async loadImageForLegacy(imagePath: string): Promise<SlideData['image'] | undefined> {
        try {
            const file = this.app.vault.getAbstractFileByPath(imagePath);
            if (!(file instanceof TFile)) return undefined;

            const buffer = await this.app.vault.readBinary(file);
            const ext = file.extension.toLowerCase();
            const mimeMap: Record<string, string> = {
                png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
                gif: 'image/gif', svg: 'image/svg+xml',
            };

            return {
                data: new Uint8Array(buffer),
                extension: ext === 'jpg' ? 'jpeg' : ext,
                mime: mimeMap[ext] ?? 'image/png',
            };
        } catch {
            return undefined;
        }
    }

    /* -------------------------------------------------------------- */
    /*  Helpers                                                        */
    /* -------------------------------------------------------------- */

    private getInternalTemplateName(templateRef: string): string | undefined {
        if (!templateRef) return 'default-executive';
        const map: Record<string, string> = {
            executive: 'default-executive', modern: 'default-modern', minimal: 'default-minimal',
        };
        return map[templateRef] ?? (templateRef.startsWith('default-') ? templateRef : undefined);
    }

    private getTemplateName(templateRef: string): string {
        if (!templateRef) return 'executive (default)';
        const shortNames = ['executive', 'modern', 'minimal'];
        if (shortNames.includes(templateRef)) return templateRef;
        if (templateRef.startsWith('default-')) return templateRef.replace('default-', '');
        return templateRef;
    }
}

/* ------------------------------------------------------------------ */
/*  Buffer utilities                                                   */
/* ------------------------------------------------------------------ */

function bufferToBase64(data: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < data.length; i++) {
        binary += String.fromCharCode(data[i]);
    }
    return btoa(binary);
}

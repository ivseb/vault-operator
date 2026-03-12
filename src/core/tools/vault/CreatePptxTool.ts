/**
 * CreatePptxTool
 *
 * Creates a PowerPoint presentation (.pptx) using three pipelines:
 *
 * 1. Template Pipeline (corporate): Clones slides from an existing .pptx
 *    template via JSZip. Achieves 100% pixel-perfect corporate design by
 *    reusing the template's theme, masters, layouts, and custom geometries.
 *    LLM only selects template slides and provides text content.
 *
 * 2. HTML Pipeline (default themes): LLM generates annotated HTML per slide
 *    with data-object-type attributes and absolute pixel positioning.
 *    HtmlSlideParser converts to PptxGenJS API calls.
 *
 * 3. Legacy Pipeline (fallback): Structured SlideData fields (title,
 *    bullets, chart, etc.) routed to PptxFreshGenerator.
 */

import { TFile } from 'obsidian';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import { writeBinaryToVault } from './writeBinaryToVault';
import { generateFreshPptx, generateFromHtml } from '../../office';
import { cloneFromTemplate } from '../../office/PptxTemplateCloner';
import type { TemplateSlideInput, CloneResult, SlideDiagnostic } from '../../office/PptxTemplateCloner';
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
                'Create a PowerPoint presentation (.pptx). ' +
                'Two modes: (A) Template mode -- provide template_file (vault path to a .pptx) and slides with template_slide + content to clone slides from a corporate template with pixel-perfect precision. ' +
                '(B) HTML mode -- provide slides with html field for custom layouts (1280x720px canvas, data-object-type attributes). ' +
                'The file format is handled automatically -- never use write_file or evaluate_expression for .pptx files.',
            input_schema: {
                type: 'object',
                properties: {
                    output_path: {
                        type: 'string',
                        description: 'Path for the presentation file (must end with .pptx)',
                    },
                    template_file: {
                        type: 'string',
                        description:
                            'Vault path to a .pptx template file for template-cloning mode. ' +
                            'When provided, slides should use template_slide + content fields instead of html. ' +
                            'The output inherits the template\'s theme, slide masters, layouts, fonts, and all visual elements.',
                    },
                    slides: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                template_slide: {
                                    type: 'number',
                                    description:
                                        'Template mode: 1-based slide number from the template to clone. ' +
                                        'Refer to the corporate presentation skill for the slide catalog.',
                                },
                                content: {
                                    type: 'object',
                                    additionalProperties: { type: 'string' },
                                    description:
                                        'Template mode: key-value pairs mapping placeholder text to replacement text. ' +
                                        'Keys are the existing text on the template slide (or a recognizable substring). ' +
                                        'Values are the new text to insert.',
                                },
                                html: {
                                    type: 'string',
                                    description:
                                        'HTML mode: Annotated HTML for this slide. Canvas: 1280x720px. ' +
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
        // Handle slides as array or as JSON string (LLMs sometimes stringify the array)
        let rawSlides: SlideInput[] = [];
        console.debug(
            '[CreatePptxTool] input.slides type:', typeof input.slides,
            'isArray:', Array.isArray(input.slides),
            'truthy:', !!input.slides,
        );
        if (Array.isArray(input.slides)) {
            rawSlides = input.slides as SlideInput[];
            console.debug('[CreatePptxTool] Array path: rawSlides.length =', rawSlides.length);
            // Check if array elements are strings (another serialization layer)
            if (rawSlides.length > 0 && typeof rawSlides[0] === 'string') {
                console.debug('[CreatePptxTool] Array elements are strings, attempting parse');
                try {
                    rawSlides = rawSlides.map(s =>
                        typeof s === 'string' ? JSON.parse(s as unknown as string) as SlideInput : s,
                    );
                } catch (e) {
                    console.warn('[CreatePptxTool] Failed to parse array string elements:', e);
                }
            }
        } else if (typeof input.slides === 'string') {
            const slidesStr = input.slides as string;
            console.debug('[CreatePptxTool] String path, length =', slidesStr.length, 'first 200 chars:', slidesStr.substring(0, 200));
            try {
                const parsed = JSON.parse(slidesStr);
                if (Array.isArray(parsed)) {
                    rawSlides = parsed as SlideInput[];
                    console.debug('[CreatePptxTool] JSON.parse succeeded, rawSlides.length =', rawSlides.length);
                } else {
                    console.warn('[CreatePptxTool] JSON.parse returned non-array:', typeof parsed);
                }
            } catch (parseErr) {
                console.warn('[CreatePptxTool] JSON.parse failed:', (parseErr as Error).message);
                // Fallback: try fixing common JSON issues (literal newlines in string values)
                try {
                    // Re-escape literal control chars inside JSON string values
                    const fixed = slidesStr.replace(
                        /"(?:[^"\\]|\\.)*"/g,
                        (m) => m.replace(/[\n\r\t]/g, (c) =>
                            c === '\n' ? '\\n' : c === '\r' ? '\\r' : '\\t',
                        ),
                    );
                    const parsed2 = JSON.parse(fixed);
                    if (Array.isArray(parsed2)) {
                        rawSlides = parsed2 as SlideInput[];
                        console.debug('[CreatePptxTool] Fixed JSON.parse succeeded, rawSlides.length =', rawSlides.length);
                    }
                } catch (fixErr) {
                    console.warn('[CreatePptxTool] Fixed JSON.parse also failed:', (fixErr as Error).message);
                }
            }
        } else if (input.slides !== undefined) {
            console.warn('[CreatePptxTool] Unexpected slides type:', typeof input.slides, 'value:', String(input.slides).substring(0, 200));
        }
        const templateRef = ((input.template as string) ?? '').trim();
        const templateFile = ((input.template_file as string) ?? '').trim();

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
        const templateName = templateFile ? templateFile.split('/').pop() ?? templateFile : this.getTemplateName(templateRef);

        console.debug('[CreatePptxTool] Final slides.length:', slides.length, 'templateFile:', templateFile ? 'yes' : 'no');

        // Analyze-only mode
        if (slides.length === 0) {
            if (templateFile) {
                callbacks.pushToolResult(
                    `Template: **${templateName}**\n\n` +
                    `Template-cloning mode active. Provide slides with template_slide (1-based slide number) ` +
                    `and content (key-value text replacements).\n` +
                    `Refer to the corporate presentation skill for the available slide catalog.\n\n` +
                    `Now call create_pptx again with your slides.`,
                );
            } else {
                callbacks.pushToolResult(
                    `Theme: **${templateName}**\n\n` +
                    `Canvas: 1280x720px (16:9). Use annotated HTML with data-object-type attributes.\n` +
                    `Element types: shape, textbox, image, chart, table.\n` +
                    `Refer to the presentation-design skill for element catalog and layout patterns.\n\n` +
                    `Now call create_pptx again with your slides using HTML format.`,
                );
            }
            callbacks.log(`PPTX info returned for: ${templateName}`);
            return;
        }

        try {
            // Detect pipeline: Template vs HTML vs Legacy
            const hasTemplateSlides = templateFile && slides.some(s => (s as Record<string, unknown>).template_slide);
            const hasHtml = slides.some(s => s.html);
            console.debug('[CreatePptxTool] Pipeline detection: hasTemplateSlides:', hasTemplateSlides, 'hasHtml:', hasHtml, 'templateFile:', templateFile);
            if (slides.length > 0) {
                const firstSlide = slides[0] as Record<string, unknown>;
                console.debug('[CreatePptxTool] First slide keys:', Object.keys(firstSlide).filter(k => firstSlide[k] !== undefined));
            }

            // Guard: template_file provided but slides use html instead of template_slide
            // This means the agent ignored the corporate skill instructions -- reject and guide
            if (templateFile && hasHtml && !hasTemplateSlides) {
                callbacks.pushToolResult(
                    `**Error: template_file was provided but slides use "html" instead of "template_slide".**\n\n` +
                    `When using a corporate template (template_file), each slide MUST use:\n` +
                    `- \`template_slide\`: 1-based slide number from the template catalog\n` +
                    `- \`content\`: key-value pairs mapping placeholder text to replacement text\n\n` +
                    `Do NOT use the "html" field with template_file. ` +
                    `Refer to the corporate presentation skill for the slide catalog and correct format.\n\n` +
                    `Please retry with template_slide + content fields.`,
                );
                return;
            }

            let buffer: ArrayBuffer;
            let pipeline: string;
            let diagnostics: SlideDiagnostic[] = [];

            if (hasTemplateSlides) {
                // Template Pipeline -- clone from corporate template
                const cloneResult = await this.generateViaTemplate(templateFile, slides);
                buffer = cloneResult.buffer;
                diagnostics = cloneResult.slideDiagnostics;
                pipeline = 'Template';
            } else if (hasHtml) {
                // HTML Pipeline
                buffer = await this.generateViaHtml(slides);
                pipeline = 'HTML';
            } else {
                // Legacy Pipeline
                buffer = await this.generateViaLegacy(slides, templateRef);
                pipeline = 'Legacy';
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

            // Build diagnostics section for template pipeline
            let diagSection = '';
            if (diagnostics.length > 0) {
                const hasUnmatched = diagnostics.some(d => d.unmatchedKeys.length > 0);
                if (hasUnmatched) {
                    diagSection = '\n\n**WARNING: Some content keys did not match template text.**\n' +
                        'Unmatched keys mean the original template text remains (e.g. "Lorem ipsum").\n' +
                        'Fix: Use the EXACT text from the slide catalog in the corporate skill.\n\n';
                    for (const d of diagnostics) {
                        if (d.unmatchedKeys.length > 0) {
                            diagSection += `Slide ${d.templateSlide}:\n`;
                            diagSection += `  Unmatched keys: ${d.unmatchedKeys.map(k => `"${k}"`).join(', ')}\n`;
                            diagSection += `  Text actually on slide: ${d.shapeTexts.map(t => `"${t.substring(0, 80)}${t.length > 80 ? '...' : ''}"`).join(', ')}\n`;
                        }
                    }
                }
            }

            callbacks.pushToolResult(
                `${action} PowerPoint presentation: **${outputPath}**\n` +
                `- ${slides.length} slide${slides.length !== 1 ? 's' : ''}\n` +
                `- Template: ${templateName}\n` +
                `- Size: ${sizeKB} KB\n` +
                `- Pipeline: ${pipeline}` +
                diagSection +
                `\n\nDownload or open the file to view the presentation.`,
            );
            callbacks.log(`${action} PPTX: ${outputPath} (${slides.length} slides, ${sizeKB} KB, pipeline: ${pipeline})`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('create_pptx', error);
        }
    }

    /* -------------------------------------------------------------- */
    /*  Template Pipeline (corporate)                                  */
    /* -------------------------------------------------------------- */

    private async generateViaTemplate(templateFile: string, slides: SlideInput[]): Promise<CloneResult> {
        // Load template from vault
        const file = this.app.vault.getAbstractFileByPath(templateFile);
        if (!(file instanceof TFile)) {
            throw new Error(`Template file not found: ${templateFile}`);
        }
        if (!file.extension.toLowerCase().match(/^(pptx|potx)$/)) {
            throw new Error(`Template must be a .pptx or .potx file, got: .${file.extension}`);
        }

        const templateData = await this.app.vault.readBinary(file);

        // Convert slide inputs to TemplateSlideInput format
        const selections: TemplateSlideInput[] = [];
        for (const s of slides) {
            const raw = s as Record<string, unknown>;
            const templateSlide = raw.template_slide as number | undefined;
            if (!templateSlide || typeof templateSlide !== 'number') {
                throw new Error(
                    'Template mode: each slide must have a template_slide number. ' +
                    'Got: ' + JSON.stringify(Object.keys(raw).filter(k => raw[k] !== undefined)),
                );
            }

            const content = (raw.content as Record<string, string>) ?? {};
            selections.push({
                template_slide: templateSlide,
                content,
                notes: s.notes,
            });
        }

        return cloneFromTemplate(templateData, selections);
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

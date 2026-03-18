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
import JSZip from 'jszip';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import { writeBinaryToVault } from './writeBinaryToVault';
import { generateFreshPptx, generateFromHtml } from '../../office';
import type { HtmlPipelineOptions, DekoElementInput } from '../../office/PptxFreshGenerator';
import { cloneFromTemplate } from '../../office/PptxTemplateCloner';
import type { TemplateSlideInput, CloneResult, SlideDiagnostic } from '../../office/PptxTemplateCloner';
import { applyHtmlOverlaysToClonedDeck } from '../../office/PptxTemplateOverlay';
import type { SlideData, HtmlSlideInput, ChartData, ChartSeries, KpiData, ProcessStep, TableData } from '../../office';

/* ------------------------------------------------------------------ */
/*  Input interfaces                                                   */
/* ------------------------------------------------------------------ */

interface SlideInput {
    // Template pipeline (corporate)
    template_slide?: number;
    content?: Record<string, string>;

    // HTML pipeline (preferred)
    html?: string;
    charts?: ChartInput[];
    tables?: TableInput[];

    // Per-composition scaffolding (HTML pipeline with corporate template)
    composition_id?: string;

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
/*  Unified compositions data                                          */
/* ------------------------------------------------------------------ */

interface FullCompositionsData {
    schemaVersion: number;
    repeatableGroups: Map<number, import('../../office/PptxTemplateAnalyzer').RepeatableGroup[]>;
    aliasMap?: Map<string, { slide: number; shapeId: string; originalName: string }>;
    slideSizeInches: { w: number; h: number };
    globalDekoElements?: DekoElementInput[];
    compositionScaffolds?: Map<string, DekoElementInput[]>;
    compositionData?: Map<string, {
        contentArea: { x: number; y: number; w: number; h: number };
        styleGuide: {
            title?: { font_size_pt: number; color: string; font_weight: string };
            body?: { font_size_pt: number; color: string };
            accent_color?: string;
        };
        layoutHint: string;
        slides: number[];
        baseSlideNum: number;
        contentShapeIds: string[];
        contentShapeNames: string[];
    }>;
}

interface TemplateSlideRisk {
    chartCount: number;
    tableCount: number;
    graphicFrameCount: number;
    pictureCount: number;
    chartLikeObjectNames: string[];
    tableLikeObjectNames: string[];
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
                            'When provided, slides may use template_slide + content, html, or a mix of both depending on the composition. ' +
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
                                composition_id: {
                                    type: 'string',
                                    description:
                                        'HTML mode with per-composition scaffolding: ID of the composition from compositions.json. ' +
                                        'When set, the scaffold elements (header, footer, logo, deko) for this composition are ' +
                                        'auto-injected. Design your HTML within the content_area bounds from get_composition_details.',
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
                    footer_text: {
                        type: 'string',
                        description:
                            'Footer text for all slides in template mode (replaces template default footer). ' +
                            'Example: "Projektname | Autor | März 2026". Only works with template_file.',
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
        // Deserialize slides: native array or JSON string (LLMs sometimes stringify)
        let rawSlides: SlideInput[] = [];
        if (Array.isArray(input.slides)) {
            rawSlides = input.slides as SlideInput[];
        } else if (typeof input.slides === 'string') {
            try {
                const parsed = JSON.parse(input.slides as string);
                if (Array.isArray(parsed)) {
                    rawSlides = parsed as SlideInput[];
                } else {
                    callbacks.pushToolResult(this.formatError(new Error(
                        'slides must be a JSON array. Received a string that parsed to a non-array.',
                    )));
                    return;
                }
            } catch (e) {
                callbacks.pushToolResult(this.formatError(new Error(
                    `slides must be a JSON array. JSON parse error: ${(e as Error).message}`,
                )));
                return;
            }
        } else if (input.slides !== undefined) {
            callbacks.pushToolResult(this.formatError(new Error(
                `slides must be an array of slide objects. Received: ${typeof input.slides}`,
            )));
            return;
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

        console.debug(`[CreatePptxTool] ${slides.length} slides, templateFile: ${templateFile ? 'yes' : 'no'}`);

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
            // Detect pipeline: Template vs HTML vs Legacy vs Mixed
            const hasTemplateSlides = templateFile && slides.some(s => s.template_slide);
            const hasHtml = slides.some(s => s.html);
            const isMixed = hasTemplateSlides && hasHtml;
            console.debug(`[CreatePptxTool] Pipeline: ${isMixed ? 'Mixed' : hasTemplateSlides ? 'Template' : hasHtml ? 'HTML' : 'Legacy'}`);

            // ── Tool-Level Enforcement: Gate + Validation for Template Pipeline ──
            if (hasTemplateSlides) {
                // Only validate template_slide slides (not html slides in mixed mode)
                const templateOnlySlides = isMixed
                    ? slides.map((s, i) => s.template_slide ? { ...s } : { ...s, template_slide: undefined } as SlideInput).filter(s => s.template_slide)
                    : slides;
                const gateResult = await this.enforceTemplateGate(templateFile, templateOnlySlides);
                if (gateResult) {
                    callbacks.pushToolResult(gateResult);
                    return;
                }
            }

            // Guard: individual slides must not mix html and template_slide
            for (let i = 0; i < slides.length; i++) {
                const s = slides[i];
                if (s.template_slide && s.html) {
                    callbacks.pushToolResult(this.formatError(new Error(
                        `Slide ${i + 1}: Cannot use both template_slide and html. Use one or the other.`,
                    )));
                    return;
                }
            }

            // Hybrid HTML mode: template_file + html slides is valid.
            // Agent uses BrandDNA/compositions from template for design reference,
            // then generates HTML with full creative freedom.
            if (templateFile && hasHtml && !hasTemplateSlides) {
                console.debug('[CreatePptxTool] Hybrid mode: template_file + html slides (corporate HTML)');
            }

            // Guard: template_file provided but slides use only legacy fields (no template_slide, no html)
            if (templateFile && !hasTemplateSlides && !hasHtml) {
                callbacks.pushToolResult(
                    `**Error: template_file was provided but slides don't use "template_slide" or "html".**\n\n` +
                    `When using a corporate template (template_file), each slide MUST use:\n` +
                    `- \`template_slide\` + \`content\`: Clone and fill shapes from template (pixel-perfect)\n` +
                    `- \`html\` (+ optional \`composition_id\`): Custom HTML layout with corporate scaffolding\n\n` +
                    `The legacy fields (title, bullets, etc.) cannot be used with template_file. ` +
                    `Refer to the Template Skill for the slide catalog and Shape-Name mappings.\n\n` +
                    `Please retry with template_slide + content or html fields.`,
                );
                return;
            }

            let buffer: ArrayBuffer;
            let pipeline: string;
            let diagnostics: SlideDiagnostic[] = [];

            if (isMixed) {
                const fullData = await this.loadFullCompositionsData(templateFile);
                if (!fullData?.compositionData) {
                    throw new Error(
                        'Mixed mode requires compositions.json with composition metadata. ' +
                        'Re-run analyze_pptx_template and retry.',
                    );
                }

                const mixedResult = await this.generateViaMixedOverlay(templateFile, slides, fullData);
                buffer = mixedResult.buffer;
                diagnostics = mixedResult.slideDiagnostics;
                pipeline = 'Mixed';

                console.debug(
                    `[CreatePptxTool] Mixed mode: ${slides.filter(s => s.template_slide).length} template + ` +
                    `${slides.filter(s => s.html).length} HTML slides, template overlay pipeline.`,
                );
            } else if (hasTemplateSlides) {
                // Template Pipeline -- clone from corporate template
                const footerText = ((input.footer_text as string) ?? '').trim() || undefined;
                const cloneResult = await this.generateViaTemplate(templateFile, slides, footerText);
                buffer = cloneResult.buffer;
                diagnostics = cloneResult.slideDiagnostics;
                pipeline = 'Template';
            } else if (hasHtml) {
                // HTML Pipeline (or Hybrid HTML when template_file is set)
                let hybridOptions: HtmlPipelineOptions | undefined;
                if (templateFile) {
                    const fullData = await this.loadFullCompositionsData(templateFile);
                    if (fullData) {
                        hybridOptions = {
                            slideSizeInches: fullData.slideSizeInches,
                            dekoElements: fullData.globalDekoElements,
                        };
                    }
                }
                buffer = await this.generateViaHtml(slides, hybridOptions, templateFile);
                pipeline = hybridOptions ? 'Hybrid HTML' : 'HTML';
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
    /*  Template Gate — enforces analyze_pptx_template prerequisite    */
    /* -------------------------------------------------------------- */

    /**
     * Validates that the template has been analyzed and that slides conform
     * to the composition schema. Returns an error string if validation fails,
     * or undefined if everything is OK.
     *
     * This is the core of "Option B" enforcement: the LLM can ignore skill
     * instructions, but it cannot bypass this tool-level gate.
     */
    private async enforceTemplateGate(
        templateFile: string,
        slides: SlideInput[],
    ): Promise<string | undefined> {
        const templateName = templateFile.split('/').pop()?.replace(/\.(pptx|potx)$/i, '') ?? '';
        const templateSlug = templateName.toLowerCase().replace(/[_\s]+/g, '-');
        const compositionsPath = `.obsilo/templates/${templateSlug}.compositions.json`;
        const adapter = this.app.vault.adapter;

        // Gate 1: compositions.json must exist (= analyze_pptx_template was run)
        if (!await adapter.exists(compositionsPath)) {
            return (
                `**BLOCKED: Template not analyzed.**\n\n` +
                `Before creating a presentation with \`${templateFile}\`, you MUST run:\n` +
                `\`analyze_pptx_template\` with template_path="${templateFile}"\n\n` +
                `This generates the compositions.json with shape mappings and design constraints. ` +
                `Without it, the template pipeline cannot validate your content.\n\n` +
                `Call \`analyze_pptx_template\` first, then retry \`create_pptx\`.`
            );
        }

        // Load compositions for validation
        let compositionsData: {
            compositions: Record<string, {
                slides: number[];
                shapes: Record<string, Record<string, { max_chars?: number; zweck?: string }>>;
            }>;
        };
        try {
            const raw = await adapter.read(compositionsPath);
            compositionsData = JSON.parse(raw);
        } catch {
            return (
                `**BLOCKED: Invalid compositions.json.**\n\n` +
                `The file \`${compositionsPath}\` exists but cannot be parsed. ` +
                `Re-run \`analyze_pptx_template\` with template_path="${templateFile}" to regenerate it.`
            );
        }

        const slideRisks = await this.inspectTemplateSlideRisks(templateFile);

        // Build a set of valid template slide numbers from compositions
        const validSlideNumbers = new Set<number>();
        for (const comp of Object.values(compositionsData.compositions)) {
            for (const num of comp.slides) validSlideNumbers.add(num);
        }

        // Gate 2: Validate each slide
        const errors: string[] = [];
        for (let i = 0; i < slides.length; i++) {
            const s = slides[i];
            if (!s.template_slide) continue;

            // 2a: Valid slide number?
            if (!validSlideNumbers.has(s.template_slide)) {
                errors.push(
                    `Slide ${i + 1}: template_slide=${s.template_slide} does not exist in template. ` +
                    `Valid slides: ${[...validSlideNumbers].sort((a, b) => a - b).join(', ')}`,
                );
                continue;
            }

            const slideRisk = slideRisks.get(s.template_slide);
            if (slideRisk) {
                if (slideRisk.chartCount > 0 || slideRisk.chartLikeObjectNames.length > 0) {
                    const chartNames = slideRisk.chartLikeObjectNames
                        .slice(0, 3)
                        .map(name => `"${name}"`)
                        .join(', ');
                    errors.push(
                        `Slide ${i + 1} (template_slide=${s.template_slide}): ` +
                        `Contains embedded chart objects${chartNames ? ` (${chartNames})` : ''} ` +
                        `with static template data. These cannot be safely reused in text-only clone mode. ` +
                        `Choose a different template_slide or switch to html + composition_id.`,
                    );
                    continue;
                }

                if (slideRisk.tableCount > 0 || slideRisk.tableLikeObjectNames.length > 0) {
                    const tableNames = slideRisk.tableLikeObjectNames
                        .slice(0, 3)
                        .map(name => `"${name}"`)
                        .join(', ');
                    errors.push(
                        `Slide ${i + 1} (template_slide=${s.template_slide}): ` +
                        `Contains embedded table objects${tableNames ? ` (${tableNames})` : ''} ` +
                        `with static template content. These cannot be safely reused in text-only clone mode. ` +
                        `Choose a different template_slide or rebuild this slide via html + composition_id.`,
                    );
                    continue;
                }
            }

            // 2b: Find composition and expected shapes for this slide
            const content = s.content ?? {};
            const contentKeys = Object.keys(content);
            for (const comp of Object.values(compositionsData.compositions)) {
                if (!comp.slides.includes(s.template_slide)) continue;
                const slideShapes = comp.shapes[String(s.template_slide)];
                if (!slideShapes) break;

                const expectedShapes = Object.keys(slideShapes);

                // 2c: Missing shapes (unfilled = blank area on slide)
                const missing = expectedShapes.filter(name => !contentKeys.includes(name));
                if (missing.length > 0) {
                    errors.push(
                        `Slide ${i + 1} (template_slide=${s.template_slide}): ` +
                        `${missing.length} shape(s) not filled: ${missing.map(n => `"${n}"`).join(', ')}. ` +
                        `Unfilled shapes appear as blank areas. Provide content for ALL shapes.`,
                    );
                }

                // 2d: Unknown content keys (typos or wrong shape names)
                const unknown = contentKeys.filter(k => !expectedShapes.includes(k));
                if (unknown.length > 0) {
                    errors.push(
                        `Slide ${i + 1} (template_slide=${s.template_slide}): ` +
                        `Unknown shape name(s): ${unknown.map(n => `"${n}"`).join(', ')}. ` +
                        `Valid shapes: ${expectedShapes.map(n => `"${n}"`).join(', ')}`,
                    );
                }

                // 2e: max_chars violations
                for (const [shapeName, value] of Object.entries(content)) {
                    const shapeDef = slideShapes[shapeName];
                    if (!shapeDef?.max_chars || !value) continue;
                    if (value.length > shapeDef.max_chars) {
                        errors.push(
                            `Slide ${i + 1}, shape "${shapeName}": ` +
                            `Text too long (${value.length} chars, max ${shapeDef.max_chars}). ` +
                            `Shorten the text to fit the shape.`,
                        );
                    }
                }

                break; // Found the matching composition
            }
        }

        if (errors.length > 0) {
            return (
                `**VALIDATION FAILED: ${errors.length} issue(s) found.**\n\n` +
                `Use \`get_composition_details\` to see the correct shape names and constraints.\n\n` +
                errors.map((e, i) => `${i + 1}. ${e}`).join('\n') +
                `\n\nFix these issues and retry \`create_pptx\`.`
            );
        }

        return undefined; // All checks passed
    }

    private async inspectTemplateSlideRisks(templateFile: string): Promise<Map<number, TemplateSlideRisk>> {
        const file = this.app.vault.getAbstractFileByPath(templateFile);
        if (!(file instanceof TFile)) return new Map();

        try {
            const templateData = await this.app.vault.readBinary(file);
            const zip = await JSZip.loadAsync(templateData);
            const presentationXml = await zip.file('ppt/presentation.xml')?.async('string');
            const presentationRelsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
            if (!presentationXml || !presentationRelsXml) return new Map();

            const slideRidMatches = [...presentationXml.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)];
            const targetMatches = [...presentationRelsXml.matchAll(
                /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="slides\/slide(\d+)\.xml"/g,
            )];
            const targetByRid = new Map(targetMatches.map(match => [match[1], Number(match[2])]));

            const result = new Map<number, TemplateSlideRisk>();
            for (let idx = 0; idx < slideRidMatches.length; idx++) {
                const logicalSlideNum = idx + 1;
                const slideRid = slideRidMatches[idx][1];
                const slideFileNum = targetByRid.get(slideRid);
                if (!slideFileNum) continue;

                const slideXml = await zip.file(`ppt/slides/slide${slideFileNum}.xml`)?.async('string');
                if (!slideXml) continue;

                const objectNames = [...slideXml.matchAll(/<p:cNvPr\b[^>]*\bname="([^"]+)"/g)].map(match => match[1]);
                result.set(logicalSlideNum, {
                    chartCount: (slideXml.match(/<c:chart\b/g) ?? []).length,
                    tableCount: (slideXml.match(/<a:tbl\b/g) ?? []).length,
                    graphicFrameCount: (slideXml.match(/<p:graphicFrame\b/g) ?? []).length,
                    pictureCount: (slideXml.match(/<p:pic\b/g) ?? []).length,
                    chartLikeObjectNames: objectNames.filter(name => /diagramm|chart/i.test(name)),
                    tableLikeObjectNames: objectNames.filter(name => /tabelle|table/i.test(name)),
                });
            }

            return result;
        } catch (error) {
            console.debug(
                `[CreatePptxTool] Unable to inspect template slide risks for ${templateFile}: ${(error as Error).message}`,
            );
            return new Map();
        }
    }

    /* -------------------------------------------------------------- */
    /*  Template Pipeline (corporate)                                  */
    /* -------------------------------------------------------------- */

    private async generateViaTemplate(templateFile: string, slides: SlideInput[], footerText?: string): Promise<CloneResult> {
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
        for (let i = 0; i < slides.length; i++) {
            const s = slides[i];
            if (!s.template_slide || typeof s.template_slide !== 'number') {
                throw new Error(
                    `Template mode: slide ${i + 1} must have a template_slide number. ` +
                    'Got: ' + JSON.stringify(Object.keys(s).filter(k => (s as Record<string, unknown>)[k] !== undefined)),
                );
            }

            selections.push({
                template_slide: s.template_slide,
                content: s.content ?? {},
                notes: s.notes,
            });
        }

        // Load all compositions data from compositions.json (if available)
        const fullData = await this.loadFullCompositionsData(templateFile);

        // Resolve aliases to shape IDs for each selection
        if (fullData?.aliasMap) {
            for (const sel of selections) {
                const resolvedIds: Record<string, string> = {};
                for (const key of Object.keys(sel.content)) {
                    const entry = fullData.aliasMap.get(key);
                    if (entry && entry.slide === sel.template_slide) {
                        resolvedIds[key] = entry.shapeId;
                    }
                }
                if (Object.keys(resolvedIds).length > 0) {
                    sel.resolvedIds = resolvedIds;
                }
            }
        }

        const cloneOptions: import('../../office/PptxTemplateCloner').CloneOptions = {
            ...(fullData?.repeatableGroups?.size ? { repeatableGroups: fullData.repeatableGroups } : {}),
            ...(footerText ? { footerText } : {}),
        };
        const hasOptions = cloneOptions.repeatableGroups || cloneOptions.footerText;
        return cloneFromTemplate(templateData, selections, hasOptions ? cloneOptions : undefined);
    }

    private async generateViaMixedOverlay(
        templateFile: string,
        slides: SlideInput[],
        fullData: FullCompositionsData,
    ): Promise<CloneResult> {
        const file = this.app.vault.getAbstractFileByPath(templateFile);
        if (!(file instanceof TFile)) {
            throw new Error(`Template file not found: ${templateFile}`);
        }
        if (!fullData.compositionData) {
            throw new Error('Mixed overlay mode requires composition data.');
        }

        const templateData = await this.app.vault.readBinary(file);
        const imageLoader = (p: string) => this.loadImageAsBase64(p);

        const selections: TemplateSlideInput[] = [];
        const overlaySpecs: Array<{
            selectionIndex: number;
            htmlSlide: HtmlSlideInput;
            clearShapeIds: string[];
            clearShapeNames: string[];
        }> = [];

        for (let i = 0; i < slides.length; i++) {
            const slide = slides[i];
            if (slide.template_slide) {
                selections.push({
                    template_slide: slide.template_slide,
                    content: slide.content ?? {},
                    notes: slide.notes,
                });
                continue;
            }

            if (!slide.html) {
                throw new Error(
                    `Mixed mode: slide ${i + 1} must use either template_slide + content or html.`,
                );
            }
            if (!slide.composition_id) {
                throw new Error(
                    `Mixed mode: HTML slide ${i + 1} requires composition_id so a template base slide can be cloned.`,
                );
            }

            const comp = fullData.compositionData.get(slide.composition_id);
            if (!comp) {
                throw new Error(
                    `Mixed mode: composition_id "${slide.composition_id}" not found in compositions.json.`,
                );
            }

            const selectionIndex = selections.length;
            selections.push({
                template_slide: comp.baseSlideNum,
                content: {},
                // Clear template notes by default for HTML overlay slides.
                notes: slide.notes ?? '',
            });

            overlaySpecs.push({
                selectionIndex,
                htmlSlide: {
                    html: slide.html,
                    charts: slide.charts ? this.convertChartInputs(slide.charts) : undefined,
                    tables: slide.tables ? this.convertTableInputs(slide.tables) : undefined,
                    notes: slide.notes,
                    dekoElements: undefined,
                },
                clearShapeIds: comp.contentShapeIds,
                clearShapeNames: comp.contentShapeNames,
            });
        }

        // Resolve aliases to shape IDs for real template-slide inputs only.
        if (fullData.aliasMap) {
            for (const sel of selections) {
                const resolvedIds: Record<string, string> = {};
                for (const key of Object.keys(sel.content)) {
                    const entry = fullData.aliasMap.get(key);
                    if (entry && entry.slide === sel.template_slide) {
                        resolvedIds[key] = entry.shapeId;
                    }
                }
                if (Object.keys(resolvedIds).length > 0) {
                    sel.resolvedIds = resolvedIds;
                }
            }
        }

        const cloneOptions: import('../../office/PptxTemplateCloner').CloneOptions = {
            ...(fullData.repeatableGroups?.size ? { repeatableGroups: fullData.repeatableGroups } : {}),
        };
        const cloneResult = await cloneFromTemplate(
            templateData,
            selections,
            cloneOptions.repeatableGroups ? cloneOptions : undefined,
        );

        if (overlaySpecs.length === 0) return cloneResult;

        const overlays: Array<import('../../office/PptxTemplateOverlay').HtmlOverlayInput> = [];
        for (const spec of overlaySpecs) {
            const clonedSlide = cloneResult.clonedSlides[spec.selectionIndex];
            if (!clonedSlide) {
                throw new Error(`Mixed mode: cloned slide mapping missing for selection ${spec.selectionIndex + 1}.`);
            }

            const sourcePptxBuffer = await generateFromHtml(
                [spec.htmlSlide],
                imageLoader,
                { slideSizeInches: fullData.slideSizeInches },
            );

            overlays.push({
                targetSlideFileNum: clonedSlide.outputSlideFileNum,
                sourcePptxBuffer,
                clearShapeIds: spec.clearShapeIds,
                clearShapeNames: spec.clearShapeNames,
            });
        }

        const buffer = await applyHtmlOverlaysToClonedDeck(cloneResult.buffer, overlays);
        return {
            ...cloneResult,
            buffer,
        };
    }

    /* -------------------------------------------------------------- */
    /*  Unified compositions.json loader                               */
    /* -------------------------------------------------------------- */

    // No cache -- compositions.json can change between calls (re-analysis)

    /**
     * Load ALL data from compositions.json in one pass.
     * Returns repeatable groups, alias map, hybrid options, scaffold data, and composition metadata.
     */
    private async loadFullCompositionsData(templateFile: string): Promise<FullCompositionsData | undefined> {
        const slug = templateFile
            .split('/').pop()
            ?.replace(/\.(pptx|potx)$/i, '')
            .toLowerCase()
            .replace(/[_\s]+/g, '-') ?? '';

        try {
            const compositionsPath = `.obsilo/templates/${slug}.compositions.json`;
            const adapter = this.app.vault.adapter;
            if (!await adapter.exists(compositionsPath)) return undefined;

            const content = await adapter.read(compositionsPath);
            const data = JSON.parse(content) as {
                schema_version?: number;
                brand_dna?: {
                    slide_size_px?: { w: number; h: number };
                    slide_decorations?: Array<{
                        id?: string;
                        type: string;
                        position: { x: number; y: number; w: number; h: number };
                        shape_name?: string;
                        fill_color?: string;
                        rotation?: number;
                        image_data?: string;
                        image_path?: string;
                    }>;
                };
                alias_map?: Record<string, { slide: number; shape_id: string; original_name: string }>;
                compositions: Record<string, {
                    slides?: number[];
                    content_area?: { x: number; y: number; w: number; h: number };
                    style_guide?: {
                        title?: { font_size_pt: number; color: string; font_weight: string };
                        body?: { font_size_pt: number; color: string };
                        accent_color?: string;
                    };
                    layout_hint?: string;
                    scaffold_elements?: Array<{
                        type: 'image' | 'shape';
                        position: { x: number; y: number; w: number; h: number };
                        shape_name?: string;
                        fill_color?: string;
                        rotation?: number;
                        image_data?: string;
                        image_path?: string;
                    }>;
                    repeatable_groups?: Record<string, Array<{
                        groupId: string;
                        axis: 'horizontal' | 'vertical';
                        shapeNames: string[];
                        shapeIds?: string[];
                        boundingBox: { left: number; top: number; width: number; height: number };
                        gap: number;
                        shapeSize: { cx: number; cy: number };
                        columns: Array<{
                            index: number;
                            primaryShape: string;
                            primaryShapeId?: string;
                            associatedShapes: Array<{ shapeName: string; shapeId?: string; offsetY: number; offsetX: number }>;
                        }>;
                    }>>;
                    shapes?: Record<string, Record<string, {
                        shape_id?: string;
                    }>>;
                }>;
            };

            const schemaVersion = data.schema_version ?? 1;
            const isV4 = schemaVersion >= 4;

            // Build repeatable groups map
            const repeatableGroups = new Map<number, import('../../office/PptxTemplateAnalyzer').RepeatableGroup[]>();
            for (const comp of Object.values(data.compositions)) {
                if (!comp.repeatable_groups) continue;
                for (const [slideNumStr, groups] of Object.entries(comp.repeatable_groups)) {
                    const slideNum = parseInt(slideNumStr);
                    if (isNaN(slideNum) || groups.length === 0) continue;
                    const existing = repeatableGroups.get(slideNum) ?? [];
                    existing.push(...groups);
                    repeatableGroups.set(slideNum, existing);
                }
            }

            // Build alias map (v2+)
            let aliasMap: Map<string, { slide: number; shapeId: string; originalName: string }> | undefined;
            if (schemaVersion >= 2 && data.alias_map) {
                aliasMap = new Map();
                for (const [alias, entry] of Object.entries(data.alias_map)) {
                    aliasMap.set(alias, {
                        slide: entry.slide,
                        shapeId: entry.shape_id,
                        originalName: entry.original_name,
                    });
                }
            }

            // Load global deko elements (with image_path resolution)
            const globalDekoElements: DekoElementInput[] = [];
            for (const d of (data.brand_dna?.slide_decorations ?? [])) {
                const elem: DekoElementInput = {
                    type: d.type as 'image' | 'shape',
                    position: d.position,
                    shapeName: d.shape_name,
                    fillColor: d.fill_color,
                    rotation: d.rotation,
                };
                // Resolve image_path to imageData
                if (d.image_path) {
                    elem.imageData = await this.loadScaffoldImage(adapter, `.obsilo/templates/${d.image_path}`);
                } else if (d.image_data) {
                    elem.imageData = d.image_data;
                }
                globalDekoElements.push(elem);
            }

            // Load per-composition scaffold + metadata (v4)
            let compositionScaffolds: Map<string, DekoElementInput[]> | undefined;
            let compositionData: Map<string, {
                contentArea: { x: number; y: number; w: number; h: number };
                styleGuide: {
                    title?: { font_size_pt: number; color: string; font_weight: string };
                    body?: { font_size_pt: number; color: string };
                    accent_color?: string;
                };
                layoutHint: string;
                slides: number[];
                baseSlideNum: number;
                contentShapeIds: string[];
                contentShapeNames: string[];
            }> | undefined;

            if (isV4) {
                compositionScaffolds = new Map();
                compositionData = new Map();

                for (const [compId, comp] of Object.entries(data.compositions)) {
                    const baseSlideNum = Object.keys(comp.shapes ?? {})
                        .map(n => parseInt(n, 10))
                        .find(n => !isNaN(n))
                        ?? comp.slides?.[0];
                    const baseShapes = baseSlideNum !== undefined
                        ? comp.shapes?.[String(baseSlideNum)] ?? {}
                        : {};
                    const contentShapeIds = Object.values(baseShapes)
                        .map(shape => shape.shape_id)
                        .filter((shapeId): shapeId is string => !!shapeId);
                    const contentShapeNames = Object.keys(baseShapes).map(key => {
                        const aliasEntry = aliasMap?.get(key);
                        return aliasEntry?.originalName ?? key;
                    });

                    // Scaffold elements
                    if (comp.scaffold_elements && comp.scaffold_elements.length > 0) {
                        const elements: DekoElementInput[] = [];
                        for (const se of comp.scaffold_elements) {
                            const elem: DekoElementInput = {
                                type: se.type,
                                position: se.position,
                                shapeName: se.shape_name,
                                fillColor: se.fill_color,
                                rotation: se.rotation,
                            };
                            if (se.image_path) {
                                elem.imageData = await this.loadScaffoldImage(adapter, `.obsilo/templates/${se.image_path}`);
                            } else if (se.image_data) {
                                elem.imageData = se.image_data;
                            }
                            elements.push(elem);
                        }
                        compositionScaffolds.set(compId, elements);
                    }

                    // Composition metadata
                    if (comp.content_area && baseSlideNum !== undefined) {
                        compositionData.set(compId, {
                            contentArea: comp.content_area,
                            styleGuide: comp.style_guide ?? {},
                            layoutHint: comp.layout_hint ?? '',
                            slides: comp.slides ?? [],
                            baseSlideNum,
                            contentShapeIds,
                            contentShapeNames,
                        });
                    }
                }
            }

            const slideSizePx = data.brand_dna?.slide_size_px ?? { w: 1280, h: 720 };
            const result: FullCompositionsData = {
                schemaVersion,
                repeatableGroups,
                aliasMap,
                slideSizeInches: { w: slideSizePx.w / 96, h: slideSizePx.h / 96 },
                globalDekoElements: globalDekoElements.length > 0 ? globalDekoElements : undefined,
                compositionScaffolds: compositionScaffolds?.size ? compositionScaffolds : undefined,
                compositionData: compositionData?.size ? compositionData : undefined,
            };

            return result;
        } catch {
            return undefined;
        }
    }

    /** Load a scaffold image from disk and convert to base64 data URL. */
    private async loadScaffoldImage(
        adapter: { exists: (p: string) => Promise<boolean>; readBinary: (p: string) => Promise<ArrayBuffer> },
        imagePath: string,
    ): Promise<string | undefined> {
        try {
            if (!await adapter.exists(imagePath)) return undefined;
            const imgBuffer = await adapter.readBinary(imagePath);
            return `data:image/png;base64,${bufferToBase64(new Uint8Array(imgBuffer))}`;
        } catch {
            return undefined;
        }
    }

    /* -------------------------------------------------------------- */
    /*  HTML Pipeline                                                  */
    /* -------------------------------------------------------------- */

    private async generateViaHtml(
        slides: SlideInput[],
        hybridOptions?: HtmlPipelineOptions,
        templateFile?: string,
    ): Promise<ArrayBuffer> {
        // Load per-composition scaffold data if any slide uses composition_id
        let compositionScaffolds: Map<string, DekoElementInput[]> | undefined;
        if (templateFile && slides.some(s => s.composition_id)) {
            const fullData = await this.loadFullCompositionsData(templateFile);
            compositionScaffolds = fullData?.compositionScaffolds;
        }

        const htmlSlides: HtmlSlideInput[] = slides.map(s => {
            // Per-slide scaffold from composition_id overrides global deko
            let dekoElements: HtmlSlideInput['dekoElements'] | undefined;
            if (s.composition_id && compositionScaffolds) {
                const scaffoldDeko = compositionScaffolds.get(s.composition_id);
                if (scaffoldDeko) {
                    dekoElements = scaffoldDeko;
                }
            }
            return {
                html: s.html ?? '',
                charts: s.charts ? this.convertChartInputs(s.charts) : undefined,
                tables: s.tables ? this.convertTableInputs(s.tables) : undefined,
                notes: s.notes,
                dekoElements,
            };
        });

        const imageLoader = (path: string) => this.loadImageAsBase64(path);
        return generateFromHtml(htmlSlides, imageLoader, hybridOptions);
    }

    /**
     * Convert a template-slide input to an HtmlSlideInput for mixed-mode.
     * Uses scaffold elements as dekoElements and converts content dict
     * to positioned HTML textboxes within content_area.
     */
    private convertTemplateSlideToHtml(
        slide: SlideInput,
        fullData: FullCompositionsData,
    ): HtmlSlideInput {
        const slideNum = slide.template_slide!;
        const content = slide.content ?? {};

        // Find composition for this slide number
        let dekoElements: DekoElementInput[] | undefined;
        let contentArea = { x: 40, y: 40, w: 1200, h: 640 };
        let styleGuide: {
            title?: { font_size_pt: number; color: string; font_weight: string };
            body?: { font_size_pt: number; color: string };
            accent_color?: string;
        } | undefined;

        if (fullData.compositionData) {
            for (const [compId, comp] of fullData.compositionData) {
                if (comp.slides.includes(slideNum)) {
                    dekoElements = fullData.compositionScaffolds?.get(compId);
                    contentArea = comp.contentArea;
                    styleGuide = comp.styleGuide;
                    break;
                }
            }
        }

        if (!dekoElements) {
            dekoElements = fullData.globalDekoElements;
        }

        const entries = Object.entries(content);
        const titleColor = styleGuide?.title?.color ?? '#333333';
        const titleSize = styleGuide?.title?.font_size_pt ?? 28;
        const bodyColor = styleGuide?.body?.color ?? '#333333';
        const bodySize = styleGuide?.body?.font_size_pt ?? 16;
        const htmlParts: string[] = [];

        // First entry = title, rest = body content stacked vertically
        if (entries.length > 0) {
            const [, titleText] = entries[0];
            htmlParts.push(
                `<div data-object="true" data-object-type="textbox" ` +
                `style="position:absolute;left:${contentArea.x}px;top:${contentArea.y}px;` +
                `width:${contentArea.w}px;height:60px;` +
                `font-size:${titleSize}px;color:${titleColor};font-weight:bold;">` +
                `${this.escapeHtml(titleText)}</div>`,
            );
        }

        const bodyY = contentArea.y + 80;
        const bodyH = contentArea.h - 80;
        const bodyEntries = entries.slice(1);
        const perItemH = bodyEntries.length > 0 ? Math.floor(bodyH / bodyEntries.length) : bodyH;

        for (let i = 0; i < bodyEntries.length; i++) {
            const [, text] = bodyEntries[i];
            htmlParts.push(
                `<div data-object="true" data-object-type="textbox" ` +
                `style="position:absolute;left:${contentArea.x}px;` +
                `top:${bodyY + i * perItemH}px;` +
                `width:${contentArea.w}px;height:${perItemH}px;` +
                `font-size:${bodySize}px;color:${bodyColor};">` +
                `${this.escapeHtml(text)}</div>`,
            );
        }

        return {
            html: htmlParts.join('\n'),
            dekoElements,
            notes: slide.notes,
        };
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
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

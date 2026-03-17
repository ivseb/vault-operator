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
import type { HtmlPipelineOptions, DekoElementInput } from '../../office/PptxFreshGenerator';
import { cloneFromTemplate } from '../../office/PptxTemplateCloner';
import type { TemplateSlideInput, CloneResult, SlideDiagnostic } from '../../office/PptxTemplateCloner';
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
            // Detect pipeline: Template vs HTML vs Legacy
            const hasTemplateSlides = templateFile && slides.some(s => s.template_slide);
            const hasHtml = slides.some(s => s.html);
            console.debug(`[CreatePptxTool] Pipeline: ${hasTemplateSlides ? 'Template' : hasHtml ? 'HTML' : 'Legacy'}`);

            // ── Tool-Level Enforcement: Gate + Validation for Template Pipeline ──
            if (hasTemplateSlides) {
                const gateResult = await this.enforceTemplateGate(templateFile, slides);
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
                    `**Error: template_file was provided but slides don't use "template_slide".**\n\n` +
                    `When using a corporate template (template_file), each slide MUST use:\n` +
                    `- \`template_slide\`: 1-based slide number from the template catalog\n` +
                    `- \`content\`: key-value pairs mapping Shape-Names to replacement text\n\n` +
                    `The legacy fields (title, bullets, etc.) cannot be used with template_file. ` +
                    `Refer to the Template Skill for the slide catalog and Shape-Name mappings.\n\n` +
                    `Please retry with template_slide + content fields.`,
                );
                return;
            }

            let buffer: ArrayBuffer;
            let pipeline: string;
            let diagnostics: SlideDiagnostic[] = [];

            if (hasTemplateSlides) {
                // Template Pipeline -- clone from corporate template
                const footerText = ((input.footer_text as string) ?? '').trim() || undefined;
                const cloneResult = await this.generateViaTemplate(templateFile, slides, footerText);
                buffer = cloneResult.buffer;
                diagnostics = cloneResult.slideDiagnostics;
                pipeline = 'Template';
            } else if (hasHtml) {
                // HTML Pipeline (or Hybrid HTML when template_file is set)
                const hybridOptions = templateFile ? await this.loadHybridOptions(templateFile) : undefined;
                buffer = await this.generateViaHtml(slides, hybridOptions);
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

        // Load repeatable groups + alias map from compositions.json (if available)
        const compositionsData = await this.loadCompositionsData(templateFile);

        // Resolve aliases to shape IDs for each selection
        if (compositionsData?.aliasMap) {
            for (const sel of selections) {
                const resolvedIds: Record<string, string> = {};
                for (const key of Object.keys(sel.content)) {
                    const entry = compositionsData.aliasMap.get(key);
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
            ...compositionsData?.cloneOptions,
            ...(footerText ? { footerText } : {}),
        };
        const hasOptions = cloneOptions.repeatableGroups || cloneOptions.footerText;
        return cloneFromTemplate(templateData, selections, hasOptions ? cloneOptions : undefined);
    }

    /**
     * Load compositions data from the template's compositions.json.
     * Returns repeatable groups (for shape adaptation) and alias map (for ID-based replacement).
     * Supports both v1 (name-based) and v2 (alias+ID-based) schemas.
     */
    private async loadCompositionsData(templateFile: string): Promise<{
        cloneOptions: import('../../office/PptxTemplateCloner').CloneOptions;
        aliasMap?: Map<string, { slide: number; shapeId: string; originalName: string }>;
    } | undefined> {
        try {
            const templateName = templateFile.split('/').pop()?.replace(/\.(pptx|potx)$/i, '') ?? '';
            const templateSlug = templateName.toLowerCase().replace(/[_\s]+/g, '-');
            const compositionsPath = `.obsilo/templates/${templateSlug}.compositions.json`;
            const adapter = this.app.vault.adapter;

            if (!await adapter.exists(compositionsPath)) return undefined;

            const content = await adapter.read(compositionsPath);
            const data = JSON.parse(content) as {
                schema_version?: number;
                alias_map?: Record<string, { slide: number; shape_id: string; original_name: string }>;
                compositions: Record<string, {
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
                }>;
            };

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

            // Build alias map (v2 only)
            let aliasMap: Map<string, { slide: number; shapeId: string; originalName: string }> | undefined;
            if (data.schema_version && data.schema_version >= 2 && data.alias_map) {
                aliasMap = new Map();
                for (const [alias, entry] of Object.entries(data.alias_map)) {
                    aliasMap.set(alias, {
                        slide: entry.slide,
                        shapeId: entry.shape_id,
                        originalName: entry.original_name,
                    });
                }
            }

            const cloneOptions = repeatableGroups.size > 0 ? { repeatableGroups } : {};
            return { cloneOptions, aliasMap };
        } catch {
            // Non-fatal: proceed without shape adaptation
            return undefined;
        }
    }

    /* -------------------------------------------------------------- */
    /*  HTML Pipeline                                                  */
    /* -------------------------------------------------------------- */

    private async generateViaHtml(slides: SlideInput[], hybridOptions?: HtmlPipelineOptions): Promise<ArrayBuffer> {
        const htmlSlides: HtmlSlideInput[] = slides.map(s => ({
            html: s.html ?? '',
            charts: s.charts ? this.convertChartInputs(s.charts) : undefined,
            tables: s.tables ? this.convertTableInputs(s.tables) : undefined,
            notes: s.notes,
        }));

        const imageLoader = (path: string) => this.loadImageAsBase64(path);
        return generateFromHtml(htmlSlides, imageLoader, hybridOptions);
    }

    /**
     * Load hybrid pipeline options from compositions.json for a template file.
     * Extracts slide size and deko elements for auto-injection in HTML pipeline.
     */
    private async loadHybridOptions(templateFile: string): Promise<HtmlPipelineOptions | undefined> {
        try {
            const slug = templateFile
                .split('/').pop()
                ?.replace(/\.(pptx|potx)$/i, '')
                .toLowerCase()
                .replace(/[_\s]+/g, '-') ?? '';
            const compositionsPath = `.obsilo/templates/${slug}.compositions.json`;

            const file = this.app.vault.getAbstractFileByPath(compositionsPath);
            if (!(file instanceof TFile)) return undefined;

            const raw = await this.app.vault.read(file);
            const data = JSON.parse(raw);
            if (!data.brand_dna) return undefined;

            const dekoElements: DekoElementInput[] = (data.brand_dna.slide_decorations ?? []).map(
                (d: Record<string, unknown>) => ({
                    type: d.type as 'image' | 'shape',
                    position: d.position as { x: number; y: number; w: number; h: number },
                    shapeName: d.shape_name as string | undefined,
                    fillColor: d.fill_color as string | undefined,
                    rotation: d.rotation as number | undefined,
                    imageData: d.image_data as string | undefined,
                }),
            );

            return {
                dekoElements: dekoElements.length > 0 ? dekoElements : undefined,
                slideSizeInches: {
                    w: (data.brand_dna.slide_size_px?.w ?? 1280) / 96,
                    h: (data.brand_dna.slide_size_px?.h ?? 720) / 96,
                },
            };
        } catch (e) {
            console.debug('[CreatePptxTool] Failed to load hybrid options:', e);
            return undefined;
        }
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

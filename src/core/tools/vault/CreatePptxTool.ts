/**
 * CreatePptxTool
 *
 * Creates a PowerPoint presentation (.pptx) using template-based generation (ADR-032).
 * Opens a template PPTX, removes content slides, and injects new slides as OOXML XML.
 * The LLM provides high-level input (slide content, layout); the engine handles OOXML.
 */

import { TFile } from 'obsidian';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import { writeBinaryToVault } from './writeBinaryToVault';
import { generatePptx, TemplateManager } from '../../office';
import type { SlideData, LayoutType } from '../../office';

/* ------------------------------------------------------------------ */
/*  Input interfaces                                                   */
/* ------------------------------------------------------------------ */

interface SlideInput {
    title?: string;
    subtitle?: string;
    body?: string;
    bullets?: string[];
    table?: {
        headers?: string[];
        rows?: (string | number | null)[][];
    };
    image?: string;
    notes?: string;
    layout?: string;
    // Legacy two-column / comparison fields
    left?: string;
    right?: string;
    comparison_left_title?: string;
    comparison_right_title?: string;
    comparison_left?: string[];
    comparison_right?: string[];
}

const VALID_LAYOUTS: LayoutType[] = [
    'title', 'content', 'section', 'two_column', 'image_right', 'comparison', 'blank',
];

/* ------------------------------------------------------------------ */
/*  Layout auto-detection                                              */
/* ------------------------------------------------------------------ */

function detectLayout(slide: SlideInput): LayoutType {
    if (slide.layout && VALID_LAYOUTS.includes(slide.layout as LayoutType)) {
        return slide.layout as LayoutType;
    }

    // Title slide: has subtitle, no content
    if (slide.subtitle && !slide.body && !slide.bullets && !slide.table && !slide.image) {
        return 'title';
    }

    // Comparison layout
    if (slide.comparison_left_title || slide.comparison_right_title) {
        return 'comparison';
    }

    // Two column layout
    if (slide.left || slide.right) {
        return 'two_column';
    }

    // Image + text
    if (slide.image && (slide.body || slide.bullets)) {
        return 'image_right';
    }

    return 'content';
}

/* ------------------------------------------------------------------ */
/*  Tool class                                                         */
/* ------------------------------------------------------------------ */

export class CreatePptxTool extends BaseTool<'create_pptx'> {
    readonly name = 'create_pptx' as const;
    readonly isWriteOperation = true;
    private templateManager: TemplateManager;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
        this.templateManager = new TemplateManager(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'create_pptx',
            description:
                'Create a PowerPoint presentation (.pptx) with slides containing text, bullets, tables, and images. ' +
                'Uses template-based generation for professional results. ' +
                'Supports user templates (vault path to .pptx/.potx) or bundled default templates. ' +
                'The file format is handled automatically -- never use write_file or evaluate_expression for .pptx files.',
            input_schema: {
                type: 'object',
                properties: {
                    output_path: {
                        type: 'string',
                        description:
                            'Path for the presentation file (must end with .pptx, e.g. "Presentations/quarterly.pptx")',
                    },
                    slides: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                title: {
                                    type: 'string',
                                    description: 'Slide title (displayed at top)',
                                },
                                subtitle: {
                                    type: 'string',
                                    description: 'Subtitle text (only for title slides)',
                                },
                                body: {
                                    type: 'string',
                                    description: 'Body paragraph text',
                                },
                                bullets: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    description: 'Bullet point list',
                                },
                                table: {
                                    type: 'object',
                                    properties: {
                                        headers: {
                                            type: 'array',
                                            items: { type: 'string' },
                                            description: 'Table column headers',
                                        },
                                        rows: {
                                            type: 'array',
                                            items: {
                                                type: 'array',
                                                items: {},
                                            },
                                            description: 'Table data rows (2D array)',
                                        },
                                    },
                                },
                                image: {
                                    type: 'string',
                                    description: 'Vault path to an image file to embed on the slide',
                                },
                                notes: {
                                    type: 'string',
                                    description: 'Speaker notes for this slide',
                                },
                                layout: {
                                    type: 'string',
                                    enum: ['title', 'content', 'section', 'two_column', 'image_right', 'comparison', 'blank'],
                                    description: 'Slide layout type. Auto-detected if omitted.',
                                },
                            },
                        },
                        description: 'Array of slides (max 50)',
                    },
                    title: {
                        type: 'string',
                        description: 'Presentation title (metadata)',
                    },
                    template: {
                        type: 'string',
                        description:
                            'Template source: vault path to .pptx/.potx file, OR default name ("executive", "modern", "minimal"). ' +
                            'Defaults to "executive" if omitted.',
                    },
                    theme: {
                        type: 'object',
                        properties: {
                            primary_color: {
                                type: 'string',
                                description: 'Primary accent color as hex (e.g. "#1a73e8"). Reserved for future use.',
                            },
                            font_family: {
                                type: 'string',
                                description: 'Font family name. Reserved for future use.',
                            },
                        },
                        description: 'Optional theme overrides (reserved for future use)',
                    },
                },
                required: ['output_path', 'slides'],
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
        if (rawSlides.length === 0) {
            callbacks.pushToolResult(this.formatError(new Error('At least one slide is required')));
            return;
        }

        const slides = rawSlides.slice(0, 50);

        try {
            // 1. Load template
            const templateData = await this.loadTemplate(templateRef);

            // 2. Convert SlideInput[] to SlideData[]
            const slideData: SlideData[] = [];
            for (const s of slides) {
                slideData.push(await this.convertSlideInput(s));
            }

            // 3. Generate PPTX
            const arrayBuffer = await generatePptx(templateData, slideData);

            // 4. Write to vault
            const result = await writeBinaryToVault(
                this.app.vault,
                outputPath,
                arrayBuffer,
                '.pptx',
            );

            const action = result.created ? 'Created' : 'Updated';
            const sizeKB = Math.round(result.size / 1024);
            const templateName = this.getTemplateName(templateRef);
            callbacks.pushToolResult(
                `${action} PowerPoint presentation: **${outputPath}**\n` +
                `- ${slides.length} slide${slides.length !== 1 ? 's' : ''}\n` +
                `- Template: ${templateName}\n` +
                `- Size: ${sizeKB} KB\n\n` +
                `Download or open the file to view the presentation.`,
            );
            callbacks.log(`${action} PPTX: ${outputPath} (${slides.length} slides, ${sizeKB} KB, template: ${templateName})`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('create_pptx', error);
        }
    }

    /* -------------------------------------------------------------- */
    /*  Template loading                                               */
    /* -------------------------------------------------------------- */

    private async loadTemplate(templateRef: string): Promise<ArrayBuffer> {
        if (!templateRef) {
            return this.templateManager.loadDefaultTemplate();
        }

        // Check if it's a default template name
        const defaultNames: Record<string, string> = {
            'executive': 'default-executive',
            'modern': 'default-modern',
            'minimal': 'default-minimal',
        };

        if (defaultNames[templateRef]) {
            return this.templateManager.loadDefaultTemplate(defaultNames[templateRef]);
        }

        // Check if it's a full default name
        if (templateRef.startsWith('default-')) {
            return this.templateManager.loadDefaultTemplate(templateRef);
        }

        // Treat as vault path
        return this.templateManager.loadVaultTemplate(templateRef);
    }

    private getTemplateName(templateRef: string): string {
        if (!templateRef) return 'executive (default)';
        const shortNames = ['executive', 'modern', 'minimal'];
        if (shortNames.includes(templateRef)) return templateRef;
        if (templateRef.startsWith('default-')) return templateRef.replace('default-', '');
        return templateRef;
    }

    /* -------------------------------------------------------------- */
    /*  Slide input conversion                                         */
    /* -------------------------------------------------------------- */

    private async convertSlideInput(input: SlideInput): Promise<SlideData> {
        const layout = detectLayout(input);
        const slide: SlideData = { layout };

        if (input.title) slide.title = input.title;
        if (input.subtitle) slide.subtitle = input.subtitle;
        if (input.notes) slide.notes = input.notes;

        // Handle body: merge body + legacy left/right/comparison fields
        if (input.body) {
            slide.body = input.body;
        } else if (input.left || input.right) {
            // Legacy two-column: merge into body
            const parts: string[] = [];
            if (input.left) parts.push(input.left);
            if (input.right) parts.push(input.right);
            slide.body = parts.join('\n\n');
        } else if (input.comparison_left_title || input.comparison_right_title) {
            // Legacy comparison: merge into body
            const parts: string[] = [];
            if (input.comparison_left_title) parts.push(`**${input.comparison_left_title}**`);
            if (input.comparison_left) parts.push(input.comparison_left.join('\n'));
            if (input.comparison_right_title) parts.push(`\n**${input.comparison_right_title}**`);
            if (input.comparison_right) parts.push(input.comparison_right.join('\n'));
            slide.body = parts.join('\n');
        }

        // Bullets
        if (input.bullets && input.bullets.length > 0) {
            slide.bullets = input.bullets;
        }

        // Table
        if (input.table) {
            slide.table = input.table;
        }

        // Image from vault
        if (input.image) {
            const imageData = await this.loadImage(input.image);
            if (imageData) {
                slide.image = imageData;
            }
        }

        return slide;
    }

    private async loadImage(imagePath: string): Promise<SlideData['image'] | undefined> {
        try {
            const file = this.app.vault.getAbstractFileByPath(imagePath);
            if (!(file instanceof TFile)) {
                console.warn(`[CreatePptxTool] Image not found: ${imagePath}`);
                return undefined;
            }

            const buffer = await this.app.vault.readBinary(file);
            const ext = file.extension.toLowerCase();
            const mimeMap: Record<string, string> = {
                png: 'image/png',
                jpg: 'image/jpeg',
                jpeg: 'image/jpeg',
                gif: 'image/gif',
                svg: 'image/svg+xml',
            };

            return {
                data: new Uint8Array(buffer),
                extension: ext === 'jpg' ? 'jpeg' : ext,
                mime: mimeMap[ext] ?? 'image/png',
            };
        } catch {
            console.warn(`[CreatePptxTool] Error loading image: ${imagePath}`);
            return undefined;
        }
    }
}

/**
 * CreatePptxTool
 *
 * Public tool wrapper for PowerPoint creation.
 * The actual build logic lives in pptx/CreatePptxService to keep the tool
 * interface stable while the feature internals evolve independently.
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import { writeBinaryToVault } from './writeBinaryToVault';
import type ObsidianAgentPlugin from '../../../main';
import { CreatePptxService, type SlideInput } from './pptx/CreatePptxService';
import type { SlideDiagnostic } from '../../office/PptxTemplateCloner';

export class CreatePptxTool extends BaseTool<'create_pptx'> {
    readonly name = 'create_pptx' as const;
    readonly isWriteOperation = true;
    private service: CreatePptxService;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
        this.service = new CreatePptxService(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'create_pptx',
            description:
                'Create a PowerPoint presentation (.pptx). ' +
                'Two modes: (A) Template mode -- provide template_file (vault path to a .pptx) and slides with template_slide + content to clone slides from a corporate template with pixel-perfect precision. ' +
                '(B) Planner/Hybrid mode -- provide composition_id + content to let the planner choose clone vs branded HTML overlay automatically. ' +
                '(C) HTML mode -- provide slides with html field for custom layouts (1280x720px canvas, data-object-type attributes). ' +
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
                                        'Planner/hybrid mode: ID of the composition from compositions.json. ' +
                                        'Use with html for explicit hybrid slides, or with content to let the planner choose clone vs hybrid HTML automatically. ' +
                                        'Scaffold elements (header, footer, logo, deko) for this composition are auto-injected in hybrid HTML mode.',
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
                            'Array of slides (max 50). Use template_slide + content for explicit clone slides, html for full layout control, ' +
                            'or composition_id + content to let the planner choose clone vs hybrid HTML automatically. ' +
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
                    deck_mode: {
                        type: 'string',
                        enum: ['talk', 'reading'],
                        description:
                            'Presentation intent. "talk" prefers lighter, more visual layouts and hybrid HTML when a template sample is too rigid. ' +
                            '"reading" tolerates denser information and keeps stronger template fidelity when helpful.',
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
        let rawSlides: SlideInput[] = [];

        if (Array.isArray(input.slides)) {
            rawSlides = input.slides as SlideInput[];
        } else if (typeof input.slides === 'string') {
            try {
                const parsed = JSON.parse(input.slides);
                if (!Array.isArray(parsed)) {
                    callbacks.pushToolResult(this.formatError(new Error(
                        'slides must be a JSON array. Received a string that parsed to a non-array.',
                    )));
                    return;
                }
                rawSlides = parsed as SlideInput[];
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

        if (!outputPath) {
            callbacks.pushToolResult(this.formatError(new Error('output_path is required')));
            return;
        }
        if (!outputPath.endsWith('.pptx')) {
            callbacks.pushToolResult(this.formatError(new Error('output_path must end with .pptx')));
            return;
        }

        const slides = rawSlides.slice(0, 50);
        const templateName = this.service.getTemplateName(templateRef, templateFile || undefined);

        console.debug(`[CreatePptxTool] ${slides.length} slides, templateFile: ${templateFile ? 'yes' : 'no'}`);

        if (slides.length === 0) {
            if (templateFile) {
                callbacks.pushToolResult(
                    `Template: **${templateName}**\n\n` +
                    `Template-cloning mode active. Provide slides with template_slide (1-based slide number) ` +
                    `and content (key-value text replacements), or composition_id + content to let the planner choose clone vs hybrid HTML.\n` +
                    `Refer to the corporate presentation skill for the available slide catalog.\n\n` +
                    `Now call create_pptx again with your slides.`,
                );
            } else {
                callbacks.pushToolResult(
                    `Theme: **${templateName}**\n\n` +
                    `Canvas: 1280x720px (16:9). Use annotated HTML with data-object-type attributes.\n` +
                    `Element types: shape, textbox, image, chart, table.\n` +
                    `Optional: set deck_mode to "talk" or "reading" so the planner can optimize density and layout strategy.\n` +
                    `Refer to the presentation-design skill for element catalog and layout patterns.\n\n` +
                    `Now call create_pptx again with your slides using HTML format.`,
                );
            }
            callbacks.log(`PPTX info returned for: ${templateName}`);
            return;
        }

        try {
            const footerText = ((input.footer_text as string) ?? '').trim() || undefined;
            const buildResult = await this.service.buildPresentation({
                slides,
                templateFile: templateFile || undefined,
                templateRef,
                footerText,
                deckMode: (input.deck_mode as 'talk' | 'reading' | undefined) ?? 'talk',
            });

            const writeResult = await writeBinaryToVault(this.app.vault, outputPath, buildResult.buffer, '.pptx');
            const action = writeResult.created ? 'Created' : 'Updated';
            const sizeKB = Math.round(writeResult.size / 1024);

            callbacks.pushToolResult(
                `${action} PowerPoint presentation: **${outputPath}**\n` +
                `- ${slides.length} slide${slides.length !== 1 ? 's' : ''}\n` +
                `- Template: ${buildResult.templateName}\n` +
                `- Size: ${sizeKB} KB\n` +
                `- Pipeline: ${buildResult.pipeline}` +
                this.formatWarnings(buildResult.warnings) +
                this.formatDiagnostics(buildResult.diagnostics) +
                `\n\nDownload or open the file to view the presentation.`,
            );
            callbacks.log(`${action} PPTX: ${outputPath} (${slides.length} slides, ${sizeKB} KB, pipeline: ${buildResult.pipeline})`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('create_pptx', error);
        }
    }

    private formatDiagnostics(diagnostics: SlideDiagnostic[]): string {
        if (diagnostics.length === 0) return '';

        const hasUnmatched = diagnostics.some(d => d.unmatchedKeys.length > 0);
        if (!hasUnmatched) return '';

        let output =
            '\n\n**WARNING: Some content keys did not match template text.**\n' +
            'Unmatched keys mean the original template text remains (e.g. "Lorem ipsum").\n' +
            'Fix: Use the EXACT text from the slide catalog in the corporate skill.\n\n';

        for (const diagnostic of diagnostics) {
            if (diagnostic.unmatchedKeys.length === 0) continue;
            output += `Slide ${diagnostic.templateSlide}:\n`;
            output += `  Unmatched keys: ${diagnostic.unmatchedKeys.map(k => `"${k}"`).join(', ')}\n`;
            output += `  Text actually on slide: ${diagnostic.shapeTexts.map(t => `"${t.substring(0, 80)}${t.length > 80 ? '...' : ''}"`).join(', ')}\n`;
        }

        return output;
    }

    private formatWarnings(warnings: string[]): string {
        if (warnings.length === 0) return '';
        const limited = warnings.slice(0, 6);
        let output = '\n\n**Planner Notes:**\n';
        for (const warning of limited) output += `- ${warning}\n`;
        if (warnings.length > limited.length) {
            output += `- ... and ${warnings.length - limited.length} more planning note(s)\n`;
        }
        return output;
    }
}

/**
 * RenderPresentationTool — Visual Intelligence (FEATURE-1115)
 *
 * Renders a PPTX file to PNG images via LibreOffice headless, then returns
 * the images as multimodal tool results so the LLM can visually inspect
 * the presentation and identify layout/text issues.
 *
 * Security: follows ExecuteRecipeTool pattern (child_process.spawn, shell: false,
 * timeout, SIGKILL fallback, no shell expansion).
 */

import * as fs from 'fs';
import * as path from 'path';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type { ToolResultContentBlock } from '../../../api/types';
import type ObsidianAgentPlugin from '../../../main';
import { renderPptxToImages } from '../../office/pptxRenderer';

/** Maximum number of slides to render in one call */
const MAX_SLIDES = 10;

export class RenderPresentationTool extends BaseTool<'render_presentation'> {
    readonly name = 'render_presentation' as const;
    readonly isWriteOperation = false;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'render_presentation',
            description:
                'Render a PPTX presentation to images using LibreOffice. ' +
                'Returns slide images so you can visually inspect the result for text overflow, ' +
                'layout problems, or design issues. Requires LibreOffice to be installed ' +
                '(see Settings > Visual Intelligence). ' +
                'Use this AFTER creating a presentation with create_pptx to verify visual quality.',
            input_schema: {
                type: 'object',
                properties: {
                    file: {
                        type: 'string',
                        description: 'Vault-relative path to the PPTX file to render.',
                    },
                    slides: {
                        type: 'array',
                        description:
                            `Optional: which slide numbers to render (1-based). ` +
                            `Default: all slides, max ${MAX_SLIDES}. ` +
                            `Example: [1, 3, 5] to render only slides 1, 3, and 5.`,
                        items: { type: 'number' },
                    },
                },
                required: ['file'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const filePath = (input.file as string ?? '').trim();
        const requestedSlides = input.slides as number[] | undefined;

        if (!filePath) {
            callbacks.pushToolResult(this.formatError(new Error('Missing required parameter: file')));
            return;
        }

        if (!filePath.endsWith('.pptx')) {
            callbacks.pushToolResult(this.formatError(new Error('File must be a .pptx file')));
            return;
        }

        // 1. Check Visual Intelligence setting
        if (!this.plugin.settings.visualIntelligence?.enabled) {
            callbacks.pushToolResult(this.formatError(new Error(
                'Visual Intelligence is disabled. Enable it in Settings > Visual Intelligence.',
            )));
            return;
        }

        // 2. Resolve vault path to absolute path
        const adapter = this.app.vault.adapter;
        const vaultRoot: string = (adapter as import('obsidian').FileSystemAdapter).basePath
            ?? (adapter as import('obsidian').FileSystemAdapter).getBasePath?.() ?? '';
        if (!vaultRoot) {
            callbacks.pushToolResult(this.formatError(new Error('Cannot determine vault root path')));
            return;
        }

        const absolutePptxPath = path.join(vaultRoot, filePath);
        if (!fs.existsSync(absolutePptxPath)) {
            callbacks.pushToolResult(this.formatError(new Error(`File not found: ${filePath}`)));
            return;
        }

        // 3. Render via shared pipeline
        callbacks.log(`Rendering ${filePath} with LibreOffice...`);
        const customPath = this.plugin.settings.visualIntelligence?.libreOfficePath;

        const result = await renderPptxToImages(absolutePptxPath, {
            customLibreOfficePath: customPath,
            maxSlides: MAX_SLIDES,
            requestedSlides,
        });

        if (!result.success) {
            callbacks.pushToolResult(this.formatError(new Error(result.error ?? 'Rendering failed')));
            return;
        }

        if (result.slides.length === 0) {
            callbacks.pushToolResult(this.formatError(new Error(
                'LibreOffice conversion produced no images. ' +
                'The file might be corrupt or LibreOffice might not support this format.',
            )));
            return;
        }

        // 4. Build multimodal result
        const contentBlocks: ToolResultContentBlock[] = [
            {
                type: 'text',
                text: `Rendered ${result.slides.length} of ${result.totalSlides} slides from ${filePath}. ` +
                    `Inspect each slide image for: text overflow, truncation, bad line breaks, ` +
                    `visual imbalance, or empty shapes. ` +
                    `If you find issues, fix the content and call create_pptx again.`,
            },
        ];

        for (const slide of result.slides) {
            contentBlocks.push(
                { type: 'text', text: `\n--- Slide ${slide.slideNumber} ---` },
                {
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: 'image/png',
                        data: slide.base64,
                    },
                },
            );
        }

        callbacks.pushToolResult(contentBlocks);
        callbacks.log(`Rendered ${result.slides.length} slides successfully.`);
    }
}

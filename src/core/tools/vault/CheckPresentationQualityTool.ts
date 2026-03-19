/**
 * CheckPresentationQualityTool — Visual Selfcheck (Phase 6)
 *
 * Renders a created PPTX via LibreOffice and sends the images to Claude Vision
 * with a quality-check prompt. Returns a structured QA report per slide with
 * pass/warn/fail status and specific fix suggestions.
 *
 * Use AFTER create_pptx to verify quality before delivering to the user.
 */

import * as path from 'path';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type { ToolResultContentBlock, ContentBlock, MessageParam } from '../../../api/types';
import type ObsidianAgentPlugin from '../../../main';
import { renderPptxToImages } from '../../office/pptxRenderer';
import { buildApiHandler } from '../../../api/index';
import { modelToLLMProvider } from '../../../types/settings';
import { QA_SYSTEM_PROMPT, parseQaReport } from './pptx/PresentationReviewLoop';

/** Maximum slides to check in one call */
const MAX_SLIDES = 20;

/* ------------------------------------------------------------------ */
/*  Tool implementation                                                */
/* ------------------------------------------------------------------ */

export class CheckPresentationQualityTool extends BaseTool<'check_presentation_quality'> {
    readonly name = 'check_presentation_quality' as const;
    readonly isWriteOperation = false;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'check_presentation_quality',
            description:
                'Render a created PPTX and perform automated visual quality check using Claude Vision. ' +
                'Returns a structured quality report per slide with pass/fail status ' +
                'and specific fix suggestions. Use AFTER create_pptx to verify quality. ' +
                'Requires Visual Intelligence to be enabled and LibreOffice installed.',
            input_schema: {
                type: 'object',
                properties: {
                    file: {
                        type: 'string',
                        description: 'Vault-relative path to the PPTX file to check.',
                    },
                },
                required: ['file'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const filePath = (input.file as string ?? '').trim();

        if (!filePath) {
            callbacks.pushToolResult(this.formatError(new Error('Missing required parameter: file')));
            return;
        }

        if (!filePath.endsWith('.pptx')) {
            callbacks.pushToolResult(this.formatError(new Error('File must be a .pptx file')));
            return;
        }

        // Check Visual Intelligence is enabled
        if (!this.plugin.settings.visualIntelligence?.enabled) {
            callbacks.pushToolResult(this.formatError(new Error(
                'Visual Intelligence is disabled. Enable it in Settings > Visual Intelligence.',
            )));
            return;
        }

        try {
            // 1. Resolve absolute path
            const adapter = this.plugin.app.vault.adapter;
            // eslint-disable-next-line -- need FileSystemAdapter for basePath
            const vaultRoot: string = (adapter as import('obsidian').FileSystemAdapter).basePath
                ?? (adapter as import('obsidian').FileSystemAdapter).getBasePath?.() ?? '';
            if (!vaultRoot) {
                callbacks.pushToolResult(this.formatError(new Error('Cannot determine vault root path')));
                return;
            }

            const absolutePath = path.join(vaultRoot, filePath);
            const customPath = this.plugin.settings.visualIntelligence?.libreOfficePath;

            // 2. Render slides
            const renderResult = await renderPptxToImages(absolutePath, {
                customLibreOfficePath: customPath,
                maxSlides: MAX_SLIDES,
            });

            if (!renderResult.success || renderResult.slides.length === 0) {
                callbacks.pushToolResult(this.formatError(new Error(
                    `Failed to render presentation: ${renderResult.error ?? 'No slides rendered'}`,
                )));
                return;
            }

            // 3. Get API handler — prefer the task's handler to avoid mode/global model mismatch
            const apiHandler = context.apiHandler ?? (this.plugin.getActiveModel()
                ? buildApiHandler(modelToLLMProvider(this.plugin.getActiveModel()!))
                : undefined);
            if (!apiHandler) {
                callbacks.pushToolResult(this.formatError(new Error(
                    'No active model configured. Set up a model in Settings > Models.',
                )));
                return;
            }

            // 4. Build vision message with all rendered slides
            const contentBlocks: ContentBlock[] = [
                {
                    type: 'text',
                    text: `Qualitaetspruefung fuer: ${filePath}\n${renderResult.slides.length} Folien gerendert.`,
                },
            ];

            for (const slide of renderResult.slides) {
                contentBlocks.push(
                    { type: 'text', text: `\n--- Folie ${slide.slideNumber} ---` },
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

            const messages: MessageParam[] = [
                { role: 'user', content: contentBlocks },
            ];

            // 5. Call Vision API
            const stream = apiHandler.createMessage(QA_SYSTEM_PROMPT, messages, []);
            let responseText = '';
            for await (const chunk of stream) {
                if (chunk.type === 'text') responseText += chunk.text;
            }

            // 6. Parse QA report
            const qaReport = parseQaReport(responseText);

            // 7. Build multimodal output: rendered slides + QA report
            const resultBlocks: ToolResultContentBlock[] = [];

            // Summary text
            const statusLabel = qaReport.overall === 'pass'
                ? 'PASS -- Presentation quality is good'
                : qaReport.overall === 'needs_revision'
                    ? 'NEEDS REVISION -- Some issues found'
                    : 'CRITICAL -- Significant problems detected';

            let reportText = `## Quality Check: ${statusLabel}\n\n`;
            reportText += `**Summary:** ${qaReport.summary}\n\n`;

            // Per-slide details
            for (const slide of qaReport.slides) {
                const icon = slide.status === 'pass' ? '[OK]' : slide.status === 'warn' ? '[WARN]' : '[FAIL]';
                reportText += `### Slide ${slide.slideNumber} ${icon}\n`;
                if (slide.issues.length === 0) {
                    reportText += 'No issues found.\n\n';
                } else {
                    for (const issue of slide.issues) {
                        reportText += `- **${issue.type}** (${issue.severity}): ${issue.description}\n`;
                        reportText += `  Fix: ${issue.fix}\n`;
                    }
                    reportText += '\n';
                }
            }

            // Actionable instructions for the agent
            if (qaReport.overall !== 'pass') {
                reportText += '---\n\n';
                reportText += '**Action Required:** Fix the issues listed above and recreate the affected slides using create_pptx. ';
                reportText += 'Then run check_presentation_quality again to verify. Max 2 revision rounds.\n';
            }

            resultBlocks.push({ type: 'text', text: reportText });

            // Include rendered slide images for visual reference
            for (const slide of renderResult.slides) {
                resultBlocks.push(
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

            callbacks.pushToolResult(resultBlocks);

        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error('[CheckPresentationQualityTool]', msg);
            callbacks.pushToolResult(this.formatError(error));
        }
    }
}

/**
 * AnalyzePptxTemplateTool — public wrapper for PPTX template analysis.
 *
 * The long-running orchestration now lives in pptx/TemplateAnalysisJob so the
 * tool surface remains stable while the implementation is isolated.
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import { TemplateAnalysisJob } from './pptx/TemplateAnalysisJob';

export class AnalyzePptxTemplateTool extends BaseTool<'analyze_pptx_template'> {
    readonly name = 'analyze_pptx_template' as const;
    readonly isWriteOperation = true;
    private job: TemplateAnalysisJob;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
        this.job = new TemplateAnalysisJob(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'analyze_pptx_template',
            description:
                'Analyze a PPTX template to extract its design structure, brand DNA (colors, fonts), and slide compositions. ' +
                'Generates a Template Skill (SKILL.md) and a detailed compositions.json with semantic shape aliases. ' +
                'Uses LibreOffice to render slides and Claude Vision for multimodal analysis. ' +
                'THIS IS THE ONLY WAY to create template skills -- never use manage_skill for templates.',
            input_schema: {
                type: 'object',
                properties: {
                    template_path: {
                        type: 'string',
                        description: 'Vault path to the main .pptx/.potx template file to analyze.',
                    },
                    additional_files: {
                        type: 'array',
                        description: 'Additional PPTX/POTX files that are part of the corporate design system ' +
                            '(Style Guide, Icon Gallery, How-to-Use). The tool auto-detects each file\'s role via multimodal analysis, ' +
                            'or you can specify the role explicitly.',
                        items: {
                            type: 'object',
                            properties: {
                                path: {
                                    type: 'string',
                                    description: 'Vault path to the additional .pptx/.potx file.',
                                },
                                role: {
                                    type: 'string',
                                    enum: ['styleguide', 'icons', 'howto', 'main'],
                                    description: 'Role of this file. If omitted, auto-detected via multimodal analysis.',
                                },
                            },
                            required: ['path'],
                        },
                    },
                    skip_multimodal: {
                        type: 'boolean',
                        description: 'Set to true to skip the multimodal analysis prompt and use deterministic aliases. ' +
                            'Use this when the user has declined multimodal analysis.',
                    },
                },
                required: ['template_path'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        await this.job.run(input, context);
    }
}

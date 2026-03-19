import type ObsidianAgentPlugin from '../../../../main';
import { PresentationBuilder } from './PresentationBuilder';
import { PresentationPlanner } from './PresentationPlanner';
import { PresentationValidator } from './PresentationValidator';
import type { CreatePptxBuildOptions, SlideInput } from './createPptxTypes';
import type { SlideDiagnostic } from '../../../office/PptxTemplateCloner';

export type { SlideInput } from './createPptxTypes';
export type { ChartInput, CreatePptxBuildOptions, DeckMode, TableInput } from './createPptxTypes';

export interface CreatePptxBuildResult {
    buffer: ArrayBuffer;
    pipeline: string;
    diagnostics: SlideDiagnostic[];
    templateName: string;
    warnings: string[];
}

export class CreatePptxService {
    private planner: PresentationPlanner;
    private validator: PresentationValidator;
    private builder: PresentationBuilder;

    constructor(plugin: ObsidianAgentPlugin) {
        this.planner = new PresentationPlanner(plugin);
        this.validator = new PresentationValidator(plugin);
        this.builder = new PresentationBuilder(plugin);
    }

    getTemplateName(templateRef: string, templateFile?: string): string {
        return this.planner.getTemplateName(templateRef, templateFile);
    }

    async buildPresentation(options: CreatePptxBuildOptions): Promise<CreatePptxBuildResult> {
        const plan = await this.planner.plan(options);
        const validation = await this.validator.validate(plan);
        const buildResult = await this.builder.build(plan);

        return {
            buffer: buildResult.buffer,
            pipeline: buildResult.pipeline,
            diagnostics: buildResult.diagnostics,
            templateName: plan.templateName,
            warnings: [...plan.warnings, ...validation.warnings],
        };
    }
}

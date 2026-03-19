import type ObsidianAgentPlugin from '../../../../main';
import { PresentationBuilder } from './PresentationBuilder';
import type { CreatePptxBuildOptions, SlideInput } from './createPptxTypes';

export type { SlideInput } from './createPptxTypes';
export type { ChartInput, CreatePptxBuildOptions, TableInput } from './createPptxTypes';

export interface CreatePptxBuildResult {
    buffer: ArrayBuffer;
    themeName: string;
    warnings: string[];
}

export class CreatePptxService {
    private builder: PresentationBuilder;

    constructor(plugin: ObsidianAgentPlugin) {
        this.builder = new PresentationBuilder(plugin);
    }

    async buildPresentation(options: CreatePptxBuildOptions): Promise<CreatePptxBuildResult> {
        return this.builder.build(options);
    }
}

import type { ChartInput, DeckMode, SlideInput, TableInput } from './createPptxTypes';
import type { FullCompositionsData } from './compositionsSchema';

export interface PlannedTemplateSlide {
    kind: 'template';
    templateSlide: number;
    content: Record<string, string>;
    notes?: string;
    source: 'explicit-template' | 'composition-plan';
    compositionId?: string;
}

export interface PlannedHtmlSlide {
    kind: 'html';
    html: string;
    charts?: ChartInput[];
    tables?: TableInput[];
    notes?: string;
    source: 'explicit-html' | 'skeleton-plan';
    compositionId?: string;
}

export interface PlannedLegacySlide {
    kind: 'legacy';
    source: 'legacy';
    slide: SlideInput;
}

export type PlannedSlide = PlannedTemplateSlide | PlannedHtmlSlide | PlannedLegacySlide;

export interface PresentationPlan {
    templateFile?: string;
    templateRef?: string;
    templateName: string;
    deckMode: DeckMode;
    pipeline: 'Template' | 'Mixed' | 'Hybrid HTML' | 'HTML' | 'Legacy';
    footerText?: string;
    slides: PlannedSlide[];
    warnings: string[];
    fullData?: FullCompositionsData;
}

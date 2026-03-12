export { generateFreshPptx, generateFromHtml } from './PptxFreshGenerator';
export { renderHtmlSlide } from './HtmlSlideParser';
export { TemplateManager } from './TemplateManager';
export { cloneFromTemplate } from './PptxTemplateCloner';
export type { DefaultTemplateName } from './TemplateManager';
export type { TemplateSlideInput } from './PptxTemplateCloner';
export type {
    SlideData, ChartData, ChartSeries, KpiData, ProcessStep,
    HtmlSlideInput, TableData,
} from './types';

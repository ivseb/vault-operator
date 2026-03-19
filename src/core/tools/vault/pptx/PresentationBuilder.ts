import { TFile } from 'obsidian';
import JSZip from 'jszip';
import type ObsidianAgentPlugin from '../../../../main';
import { generateFreshPptx, generateFromHtml } from '../../../office';
import type { HtmlPipelineOptions } from '../../../office/PptxFreshGenerator';
import { cloneFromTemplate } from '../../../office/PptxTemplateCloner';
import type { CloneResult, SlideDiagnostic, TemplateSlideInput } from '../../../office/PptxTemplateCloner';
import { applyHtmlOverlaysToClonedDeck } from '../../../office/PptxTemplateOverlay';
import type { ChartData, ChartSeries, KpiData, ProcessStep, SlideData, TableData } from '../../../office';
import { bufferToBase64, CompositionsRepository } from './CompositionsRepository';
import type { ChartInput, TableInput } from './createPptxTypes';
import type { FullCompositionsData } from './compositionsSchema';
import type { PlannedHtmlSlide, PlannedLegacySlide, PlannedSlide, PlannedTemplateSlide, PresentationPlan } from './presentationPlan';

export interface PresentationBuildResult {
    buffer: ArrayBuffer;
    pipeline: string;
    diagnostics: SlideDiagnostic[];
}

export class PresentationBuilder {
    private repository: CompositionsRepository;

    constructor(private plugin: ObsidianAgentPlugin) {
        this.repository = new CompositionsRepository(plugin.app.vault.adapter);
    }

    async build(plan: PresentationPlan): Promise<PresentationBuildResult> {
        const templateFile = plan.templateFile;
        const templateSlides = plan.slides.filter((s): s is PlannedTemplateSlide => s.kind === 'template');
        const htmlSlides = plan.slides.filter((s): s is PlannedHtmlSlide => s.kind === 'html');
        const legacySlides = plan.slides.filter((s): s is PlannedLegacySlide => s.kind === 'legacy');

        // B1: plan.fullData nutzen – kein erneuter loadFullData-Aufruf
        const fullData = plan.fullData ?? (templateFile ? await this.repository.loadFullData(templateFile) : undefined);

        if (templateSlides.length > 0 && htmlSlides.length > 0) {
            if (!templateFile) throw new Error('Mixed mode requires template_file.');
            if (!fullData?.compositionData) {
                throw new Error('Mixed mode requires compositions.json with composition metadata. Re-run analyze_pptx_template and retry.');
            }
            const mixedResult = await this.generateViaMixedOverlay(templateFile, plan.slides, fullData);
            return {
                buffer: mixedResult.buffer,
                diagnostics: mixedResult.slideDiagnostics,
                pipeline: 'Mixed',
            };
        }

        if (templateSlides.length > 0) {
            if (!templateFile) throw new Error('Template mode requires template_file.');
            const cloneResult = await this.generateViaTemplate(templateFile, templateSlides, plan.footerText, fullData);
            return {
                buffer: cloneResult.buffer,
                diagnostics: cloneResult.slideDiagnostics,
                pipeline: 'Template',
            };
        }

        if (htmlSlides.length > 0) {
            const hybridOptions: HtmlPipelineOptions | undefined = (templateFile && fullData)
                ? { slideSizeInches: fullData.slideSizeInches, dekoElements: fullData.globalDekoElements }
                : undefined;
            const buffer = await this.generateViaHtml(htmlSlides, hybridOptions, fullData);
            return {
                buffer,
                diagnostics: [],
                pipeline: hybridOptions ? 'Hybrid HTML' : 'HTML',
            };
        }

        const buffer = await this.generateViaLegacy(legacySlides, plan.templateRef);
        return {
            buffer,
            diagnostics: [],
            pipeline: 'Legacy',
        };
    }

    private async generateViaTemplate(
        templateFile: string,
        slides: PlannedTemplateSlide[],
        footerText?: string,
        fullData?: FullCompositionsData,
    ): Promise<CloneResult> {
        const file = this.plugin.app.vault.getAbstractFileByPath(templateFile);
        if (!(file instanceof TFile)) throw new Error(`Template file not found: ${templateFile}`);
        if (!file.extension.toLowerCase().match(/^(pptx|potx)$/)) {
            throw new Error(`Template must be a .pptx or .potx file, got: .${file.extension}`);
        }

        const templateData = await this.plugin.app.vault.readBinary(file);
        const selections: TemplateSlideInput[] = slides.map(slide => ({
            template_slide: slide.templateSlide,
            content: slide.content,
            notes: slide.notes,
        }));

        if (fullData?.aliasMap) {
            for (const selection of selections) {
                const resolvedIds: Record<string, string> = {};
                for (const key of Object.keys(selection.content)) {
                    const entry = fullData.aliasMap.get(key);
                    if (entry && entry.slide === selection.template_slide) {
                        resolvedIds[key] = entry.shapeId;
                    }
                }
                if (Object.keys(resolvedIds).length > 0) selection.resolvedIds = resolvedIds;
            }
        }

        const cloneOptions: import('../../../office/PptxTemplateCloner').CloneOptions = {
            ...(fullData?.repeatableGroups?.size ? { repeatableGroups: fullData.repeatableGroups } : {}),
            ...(footerText ? { footerText } : {}),
        };
        const hasOptions = cloneOptions.repeatableGroups || cloneOptions.footerText;
        return cloneFromTemplate(templateData, selections, hasOptions ? cloneOptions : undefined);
    }

    private async generateViaMixedOverlay(
        templateFile: string,
        slides: PlannedSlide[],
        fullData: FullCompositionsData,
    ): Promise<CloneResult> {
        const file = this.plugin.app.vault.getAbstractFileByPath(templateFile);
        if (!(file instanceof TFile)) throw new Error(`Template file not found: ${templateFile}`);
        if (!fullData.compositionData) throw new Error('Mixed overlay mode requires composition data.');

        const templateData = await this.plugin.app.vault.readBinary(file);
        const imageLoader = (path: string) => this.loadImageAsBase64(path);
        const selections: TemplateSlideInput[] = [];
        const overlaySpecs: Array<{
            selectionIndex: number;
            htmlSlide: import('../../../office').HtmlSlideInput;
            clearShapeIds: string[];
            clearShapeNames: string[];
        }> = [];

        for (let i = 0; i < slides.length; i++) {
            const slide = slides[i];
            if (slide.kind === 'template') {
                selections.push({
                    template_slide: slide.templateSlide,
                    content: slide.content,
                    notes: slide.notes,
                });
                continue;
            }

            if (slide.kind !== 'html') {
                throw new Error(`Mixed mode: slide ${i + 1} is neither template nor html.`);
            }

            // B8: HTML-Slides ohne compositionId: Blank-Composition als transparente Basis suchen
            if (!slide.compositionId) {
                const blankEntry = fullData.rawFile
                    ? Object.entries(fullData.rawFile.compositions).find(([, c]) => c.classification === 'blank')
                    : undefined;
                if (!blankEntry) {
                    throw new Error(
                        `Mixed mode: HTML slide ${i + 1} has no composition_id and no 'blank' composition was found in the template. ` +
                        `Either add composition_id (recommended) or ensure the template contains a blank composition to use as base for pure HTML slides.`,
                    );
                }
                const blankComp = fullData.compositionData?.get(blankEntry[0]);
                if (!blankComp) {
                    throw new Error(`Mixed mode: blank composition "${blankEntry[0]}" found but missing from compositionData. Re-run analyze_pptx_template.`);
                }
                const selectionIndex = selections.length;
                selections.push({ template_slide: blankComp.baseSlideNum, content: {}, notes: slide.notes ?? '' });
                overlaySpecs.push({
                    selectionIndex,
                    htmlSlide: {
                        html: slide.html,
                        charts: slide.charts ? this.convertChartInputs(slide.charts) : undefined,
                        tables: slide.tables ? this.convertTableInputs(slide.tables) : undefined,
                        notes: slide.notes,
                        dekoElements: undefined,
                    },
                    clearShapeIds: blankComp.contentShapeIds,
                    clearShapeNames: blankComp.contentShapeNames,
                });
                continue;
            }

            const comp = fullData.compositionData.get(slide.compositionId);
            if (!comp) throw new Error(`Mixed mode: composition_id "${slide.compositionId}" not found in compositions.json.`);

            const selectionIndex = selections.length;
            selections.push({
                template_slide: comp.baseSlideNum,
                content: {},
                notes: slide.notes ?? '',
            });

            overlaySpecs.push({
                selectionIndex,
                htmlSlide: {
                    html: slide.html,
                    charts: slide.charts ? this.convertChartInputs(slide.charts) : undefined,
                    tables: slide.tables ? this.convertTableInputs(slide.tables) : undefined,
                    notes: slide.notes,
                    dekoElements: undefined,
                },
                clearShapeIds: comp.contentShapeIds,
                clearShapeNames: comp.contentShapeNames,
            });
        }

        if (fullData.aliasMap) {
            for (const selection of selections) {
                const resolvedIds: Record<string, string> = {};
                for (const key of Object.keys(selection.content)) {
                    const entry = fullData.aliasMap.get(key);
                    if (entry && entry.slide === selection.template_slide) {
                        resolvedIds[key] = entry.shapeId;
                    }
                }
                if (Object.keys(resolvedIds).length > 0) selection.resolvedIds = resolvedIds;
            }
        }

        const cloneOptions: import('../../../office/PptxTemplateCloner').CloneOptions = {
            ...(fullData.repeatableGroups?.size ? { repeatableGroups: fullData.repeatableGroups } : {}),
        };
        const cloneResult = await cloneFromTemplate(
            templateData,
            selections,
            cloneOptions.repeatableGroups ? cloneOptions : undefined,
        );

        if (overlaySpecs.length === 0) return cloneResult;

        const overlays: Array<import('../../../office/PptxTemplateOverlay').HtmlOverlayInput> = [];
        for (const spec of overlaySpecs) {
            const clonedSlide = cloneResult.clonedSlides[spec.selectionIndex];
            if (!clonedSlide) {
                throw new Error(`Mixed mode: cloned slide mapping missing for selection ${spec.selectionIndex + 1}.`);
            }

            const sourcePptxBuffer = await generateFromHtml(
                [spec.htmlSlide],
                imageLoader,
                { slideSizeInches: fullData.slideSizeInches },
            );

            overlays.push({
                targetSlideFileNum: clonedSlide.outputSlideFileNum,
                sourcePptxBuffer,
                clearShapeIds: spec.clearShapeIds,
                clearShapeNames: spec.clearShapeNames,
            });
        }

        const buffer = await applyHtmlOverlaysToClonedDeck(cloneResult.buffer, overlays);
        return { ...cloneResult, buffer };
    }

    private async generateViaHtml(
        slides: PlannedHtmlSlide[],
        hybridOptions?: HtmlPipelineOptions,
        fullData?: FullCompositionsData,
    ): Promise<ArrayBuffer> {
        const compositionScaffolds = fullData?.compositionScaffolds;

        const htmlSlides = slides.map(slide => {
            let dekoElements;
            if (slide.compositionId && compositionScaffolds) {
                const scaffoldDeko = compositionScaffolds.get(slide.compositionId);
                if (scaffoldDeko) dekoElements = scaffoldDeko;
            }
            return {
                html: slide.html,
                charts: slide.charts ? this.convertChartInputs(slide.charts) : undefined,
                tables: slide.tables ? this.convertTableInputs(slide.tables) : undefined,
                notes: slide.notes,
                dekoElements,
            };
        });

        const imageLoader = (path: string) => this.loadImageAsBase64(path);
        return generateFromHtml(htmlSlides, imageLoader, hybridOptions);
    }

    private async generateViaLegacy(slides: PlannedLegacySlide[], templateRef?: string): Promise<ArrayBuffer> {
        const slideData: SlideData[] = [];
        for (const planned of slides) {
            slideData.push(await this.convertLegacySlideInput(planned.slide));
        }
        return generateFreshPptx(slideData, this.getInternalTemplateName(templateRef) ?? 'default-executive');
    }

    private async convertLegacySlideInput(input: PlannedLegacySlide['slide']): Promise<SlideData> {
        const layout = detectLayout(input);
        const slide: SlideData = { layout };
        if (input.title) slide.title = input.title;
        if (input.subtitle) slide.subtitle = input.subtitle;
        if (input.notes) slide.notes = input.notes;
        if (input.body) slide.body = input.body;
        if (input.bullets?.length) slide.bullets = input.bullets;
        if (input.table) slide.table = input.table;

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
                    name: s.name,
                    values: s.values,
                    color: s.color,
                } as ChartSeries)),
            };
        }

        if (input.kpis?.length) {
            slide.kpis = input.kpis.slice(0, 6).map(k => ({
                value: k.value,
                label: k.label,
                color: k.color,
            } as KpiData));
        }

        if (input.process?.length) {
            slide.process = input.process.slice(0, 8).map(p => ({
                label: p.label,
                description: p.description,
            } as ProcessStep));
        }

        return slide;
    }

    private convertChartInputs(inputs: ChartInput[]): ChartData[] {
        return inputs.map(chart => {
            const validTypes = ['bar', 'pie', 'line'];
            return {
                type: (validTypes.includes(chart.type) ? chart.type : 'bar') as ChartData['type'],
                title: chart.title,
                categories: chart.categories,
                series: chart.series.map(series => ({
                    name: series.name,
                    values: series.values,
                    color: series.color,
                } as ChartSeries)),
            };
        });
    }

    private convertTableInputs(inputs: TableInput[]): TableData[] {
        return inputs.map(table => ({
            headers: table.headers,
            rows: table.rows,
            style: table.style,
        }));
    }

    private async loadImageAsBase64(imagePath: string): Promise<{ data: string; type: string } | undefined> {
        try {
            const file = this.plugin.app.vault.getAbstractFileByPath(imagePath);
            if (!(file instanceof TFile)) return undefined;

            const buffer = await this.plugin.app.vault.readBinary(file);
            const ext = file.extension.toLowerCase();
            const mimeMap: Record<string, string> = {
                png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
                gif: 'image/gif', svg: 'image/svg+xml',
            };
            return {
                data: `data:${mimeMap[ext] ?? 'image/png'};base64,${bufferToBase64(new Uint8Array(buffer))}`,
                type: ext,
            };
        } catch {
            return undefined;
        }
    }

    private async loadImageForLegacy(imagePath: string): Promise<SlideData['image'] | undefined> {
        try {
            const file = this.plugin.app.vault.getAbstractFileByPath(imagePath);
            if (!(file instanceof TFile)) return undefined;

            const buffer = await this.plugin.app.vault.readBinary(file);
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

    private getInternalTemplateName(templateRef?: string): string | undefined {
        if (!templateRef) return 'default-executive';
        const map: Record<string, string> = {
            executive: 'default-executive',
            modern: 'default-modern',
            minimal: 'default-minimal',
        };
        return map[templateRef] ?? (templateRef.startsWith('default-') ? templateRef : undefined);
    }
}

function detectLayout(slide: PlannedLegacySlide['slide']): string {
    if (slide.layout) return slide.layout;
    if (slide.subtitle && !slide.body && !slide.bullets && !slide.table && !slide.image) return 'title';
    if (slide.image && (slide.body || slide.bullets)) return 'image_right';
    return 'content';
}


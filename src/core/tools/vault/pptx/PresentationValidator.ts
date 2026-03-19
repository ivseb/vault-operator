import { TFile } from 'obsidian';
import JSZip from 'jszip';
import { parseShapeName } from '../../../office/ooxml-utils';
import type ObsidianAgentPlugin from '../../../../main';
import { CompositionsRepository } from './CompositionsRepository';
import type { CompositionEntry, RepeatableGroupEntry, ShapeDetailEntry } from './compositionsSchema';
import type { PlannedSlide, PlannedTemplateSlide, PresentationPlan } from './presentationPlan';

interface TemplateSlideRisk {
    chartCount: number;
    tableCount: number;
    graphicFrameCount: number;
    pictureCount: number;
    chartLikeObjectNames: string[];
    tableLikeObjectNames: string[];
}

export interface PresentationValidationResult {
    warnings: string[];
}

export class PresentationValidator {
    private repository: CompositionsRepository;

    constructor(private plugin: ObsidianAgentPlugin) {
        this.repository = new CompositionsRepository(plugin.app.vault.adapter);
    }

    async validate(plan: PresentationPlan): Promise<PresentationValidationResult> {
        const warnings: string[] = [];
        const templateSlides = plan.slides.filter((slide): slide is PlannedTemplateSlide => slide.kind === 'template');
        if (!plan.templateFile || templateSlides.length === 0) return { warnings };

        // B1: plan.fullData primär nutzen – verhindert redundanten Disk-Read
        const rawFile = plan.fullData?.rawFile ?? (await this.repository.read(plan.templateFile))?.data;
        if (!rawFile) {
            throw new Error(
                `**BLOCKED: Template not analyzed.**\n\n` +
                `Before creating a presentation with \`${plan.templateFile}\`, you MUST run:\n` +
                `\`analyze_pptx_template\` with template_path="${plan.templateFile}"\n\n` +
                `This generates the compositions.json with shape mappings and design constraints. ` +
                `Without it, the template pipeline cannot validate your content.\n\n` +
                `Call \`analyze_pptx_template\` first, then retry \`create_pptx\`.`,
            );
        }

        // B2: PPTX-Binary-Inspektion nur wenn Composition-Flags fehlen
        const allCompositionsHaveRiskFlags = templateSlides.every(slide => {
            const comp = this.findCompositionForSlide(rawFile.compositions, slide.templateSlide);
            if (!comp) return true;
            const [, c] = comp;
            return c.has_static_chart !== undefined || c.has_static_table !== undefined;
        });
        const slideRisks = allCompositionsHaveRiskFlags
            ? new Map<number, TemplateSlideRisk>()
            : await this.inspectTemplateSlideRisks(plan.templateFile);

        const validSlideNumbers = new Set<number>();
        for (const comp of Object.values(rawFile.compositions)) {
            for (const num of comp.slides) validSlideNumbers.add(num);
        }

        const errors: string[] = [];
        for (let i = 0; i < plan.slides.length; i++) {
            const plannedSlide = plan.slides[i];
            if (plannedSlide.kind !== 'template') continue;

            if (!validSlideNumbers.has(plannedSlide.templateSlide)) {
                // B7: Präzisere Fehlermeldung – Slide existiert, ist aber keiner Composition zugeordnet
                errors.push(
                    `Slide ${i + 1}: template_slide=${plannedSlide.templateSlide} is not assigned to any composition in compositions.json. ` +
                    `Slides mapped to compositions: ${[...validSlideNumbers].sort((a, b) => a - b).join(', ')}`,
                );
                continue;
            }

            const compEntry = this.findCompositionForSlide(rawFile.compositions, plannedSlide.templateSlide);
            if (!compEntry) continue;

            const [compId, comp] = compEntry;
            const slideShapes = comp.shapes[String(plannedSlide.templateSlide)] ?? {};
            const content = plannedSlide.content ?? {};
            const contentKeys = Object.keys(content);
            const repeatableGroups = comp.repeatable_groups?.[String(plannedSlide.templateSlide)] ?? [];
            const repeatableAnalysis = analyzeRepeatableGroupUsage(repeatableGroups, contentKeys);

            // B2: Composition-Flags bevorzugen, XML-Inspektion als Fallback
            const slideRisk = slideRisks.get(plannedSlide.templateSlide);
            const hasChartRisk = comp.has_static_chart
                ?? (slideRisk ? slideRisk.chartCount > 0 || slideRisk.chartLikeObjectNames.length > 0 : false);
            const hasTableRisk = comp.has_static_table
                ?? (slideRisk ? slideRisk.tableCount > 0 || slideRisk.tableLikeObjectNames.length > 0 : false);

            if (hasChartRisk) {
                const chartNames = slideRisk?.chartLikeObjectNames.slice(0, 3).map(name => `"${name}"`).join(', ') ?? '';
                errors.push(
                    `Slide ${i + 1} (template_slide=${plannedSlide.templateSlide}): ` +
                    `Contains embedded chart objects${chartNames ? ` (${chartNames})` : ''} ` +
                    `with static template data. These cannot be safely reused in text-only clone mode. ` +
                    `Choose a different template_slide or switch to html + composition_id.`,
                );
                continue;
            }

            if (hasTableRisk) {
                const tableNames = slideRisk?.tableLikeObjectNames.slice(0, 3).map(name => `"${name}"`).join(', ') ?? '';
                errors.push(
                    `Slide ${i + 1} (template_slide=${plannedSlide.templateSlide}): ` +
                    `Contains embedded table objects${tableNames ? ` (${tableNames})` : ''} ` +
                    `with static template content. These cannot be safely reused in text-only clone mode. ` +
                    `Choose a different template_slide or rebuild this slide via html + composition_id.`,
                );
                continue;
            }

            const imageKeys = Object.entries(slideShapes)
                .filter(([, detail]) => detail.shape_type === 'image')
                .map(([shapeName]) => shapeName);
            if (imageKeys.length > 0) {
                errors.push(
                    `Slide ${i + 1} (template_slide=${plannedSlide.templateSlide}): ` +
                    `Contains image placeholder shape(s) ${imageKeys.map(name => `"${name}"`).join(', ')}. ` +
                    `Clone mode cannot populate images. Use html + composition_id or a chart/image-free composition instead.`,
                );
                continue;
            }

            const expectedShapes = Object.keys(slideShapes);
            const requiredShapes = expectedShapes.filter(shapeName => !repeatableAnalysis.omittedShapes.has(shapeName));
            const missing = requiredShapes.filter(name => !contentKeys.includes(name));
            if (missing.length > 0) {
                errors.push(
                    `Slide ${i + 1} (template_slide=${plannedSlide.templateSlide}): ` +
                    `${missing.length} required shape(s) not filled: ${missing.map(n => `"${n}"`).join(', ')}. ` +
                    `Provide content for every non-optional shape or switch this composition to html.`,
                );
            }

            const unknown = contentKeys.filter(key => !expectedShapes.includes(key) && !repeatableAnalysis.allowedExtraShapes.has(key));
            if (unknown.length > 0) {
                errors.push(
                    `Slide ${i + 1} (template_slide=${plannedSlide.templateSlide}): ` +
                    `Unknown shape name(s): ${unknown.map(n => `"${n}"`).join(', ')}. ` +
                    `Valid shapes: ${expectedShapes.map(n => `"${n}"`).join(', ')}`,
                );
            }

            for (const [shapeName, value] of Object.entries(content)) {
                const shapeDef = slideShapes[shapeName];
                if (!shapeDef?.max_chars || !value) continue;
                if (value.length > shapeDef.max_chars) {
                    errors.push(
                        `Slide ${i + 1}, shape "${shapeName}": ` +
                        `Text too long (${value.length} chars, max ${shapeDef.max_chars}). ` +
                        `Shorten the text to fit the shape.`,
                    );
                }
            }

            if (repeatableAnalysis.orphanAssociatedShapes.length > 0) {
                errors.push(
                    `Slide ${i + 1} (${compId}): ` +
                    `Associated repeatable-group shapes were filled without their primary item: ${repeatableAnalysis.orphanAssociatedShapes.map(name => `"${name}"`).join(', ')}. ` +
                    `Provide the matching primary group item as well so the slide can adapt cleanly.`,
                );
            }

            if (repeatableGroups.length > 0 && repeatableAnalysis.usedGroups === 0) {
                warnings.push(
                    `Slide ${i + 1} (${compId}) contains repeatable groups, but no primary group items were provided. If this slide should show steps/cards, add the primary item keys so the layout can adapt.`,
                );
            }
        }

        if (errors.length > 0) {
            throw new Error(
                `**VALIDATION FAILED: ${errors.length} issue(s) found.**\n\n` +
                `Use \`get_composition_details\` to see the correct shape names and constraints.\n\n` +
                errors.map((error, index) => `${index + 1}. ${error}`).join('\n') +
                `\n\nFix these issues and retry \`create_pptx\`.`,
            );
        }

        return { warnings };
    }

    private findCompositionForSlide(
        compositions: Record<string, CompositionEntry>,
        templateSlide: number,
    ): [string, CompositionEntry] | undefined {
        for (const entry of Object.entries(compositions)) {
            if (entry[1].slides.includes(templateSlide)) return entry;
        }
        return undefined;
    }

    private async inspectTemplateSlideRisks(templateFile: string): Promise<Map<number, TemplateSlideRisk>> {
        const file = this.plugin.app.vault.getAbstractFileByPath(templateFile);
        if (!(file instanceof TFile)) return new Map();

        try {
            const templateData = await this.plugin.app.vault.readBinary(file);
            const zip = await JSZip.loadAsync(templateData);
            const presentationXml = await zip.file('ppt/presentation.xml')?.async('string');
            const presentationRelsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
            if (!presentationXml || !presentationRelsXml) return new Map();

            const slideRidMatches = [...presentationXml.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)];
            const targetMatches = [...presentationRelsXml.matchAll(
                /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="slides\/slide(\d+)\.xml"/g,
            )];
            const targetByRid = new Map(targetMatches.map(match => [match[1], Number(match[2])]));

            const result = new Map<number, TemplateSlideRisk>();
            for (let idx = 0; idx < slideRidMatches.length; idx++) {
                const logicalSlideNum = idx + 1;
                const slideRid = slideRidMatches[idx][1];
                const slideFileNum = targetByRid.get(slideRid);
                if (!slideFileNum) continue;

                const slideXml = await zip.file(`ppt/slides/slide${slideFileNum}.xml`)?.async('string');
                if (!slideXml) continue;

                const objectNames = [...slideXml.matchAll(/<p:cNvPr\b[^>]*\bname="([^"]+)"/g)].map(match => match[1]);
                result.set(logicalSlideNum, {
                    chartCount: (slideXml.match(/<c:chart\b/g) ?? []).length,
                    tableCount: (slideXml.match(/<a:tbl\b/g) ?? []).length,
                    graphicFrameCount: (slideXml.match(/<p:graphicFrame\b/g) ?? []).length,
                    pictureCount: (slideXml.match(/<p:pic\b/g) ?? []).length,
                    chartLikeObjectNames: objectNames.filter(name => /diagramm|chart/i.test(name)),
                    tableLikeObjectNames: objectNames.filter(name => /tabelle|table/i.test(name)),
                });
            }

            return result;
        } catch (error) {
            console.debug(
                `[PresentationValidator] Unable to inspect template slide risks for ${templateFile}: ${(error as Error).message}`,
            );
            return new Map();
        }
    }
}

function analyzeRepeatableGroupUsage(
    groups: RepeatableGroupEntry[],
    contentKeys: string[],
): {
    usedGroups: number;
    omittedShapes: Set<string>;
    allowedExtraShapes: Set<string>;
    orphanAssociatedShapes: string[];
} {
    const omittedShapes = new Set<string>();
    const allowedExtraShapes = new Set<string>();
    const orphanAssociatedShapes: string[] = [];
    let usedGroups = 0;
    const providedKeys = new Set(contentKeys);

    for (const group of groups) {
        const currentCount = group.shapeNames.length;
        const targetCount = detectTargetCount(group, providedKeys);
        if (targetCount > 0) usedGroups += 1;

        const retainedCount = Math.min(targetCount, currentCount);
        for (let i = retainedCount; i < currentCount; i++) {
            omittedShapes.add(group.shapeNames[i]);
            const column = group.columns[i];
            if (!column) continue;
            for (const assoc of column.associatedShapes) omittedShapes.add(assoc.shapeName);
        }

        for (let i = currentCount; i < targetCount; i++) {
            const lastPrimary = group.shapeNames[currentCount - 1];
            allowedExtraShapes.add(incrementShapeName(lastPrimary, i - currentCount + 1));

            const lastColumn = group.columns[group.columns.length - 1];
            for (const assoc of lastColumn?.associatedShapes ?? []) {
                allowedExtraShapes.add(incrementShapeName(assoc.shapeName, i - currentCount + 1));
            }
        }

        for (let i = 0; i < retainedCount; i++) {
            const column = group.columns[i];
            if (!column) continue;
            const primaryProvided = providedKeys.has(column.primaryShape);
            if (primaryProvided) continue;

            const filledAssociated = column.associatedShapes
                .map(shape => shape.shapeName)
                .filter(shapeName => providedKeys.has(shapeName));
            orphanAssociatedShapes.push(...filledAssociated);
        }
    }

    return { usedGroups, omittedShapes, allowedExtraShapes, orphanAssociatedShapes };
}

function detectTargetCount(group: RepeatableGroupEntry, contentKeys: Set<string>): number {
    let targetCount = 0;
    for (let i = 0; i < group.columns.length; i++) {
        const column = group.columns[i];
        const columnKeys = [
            column.primaryShape,
            ...column.associatedShapes.map(shape => shape.shapeName),
        ];
        if (columnKeys.some(key => contentKeys.has(key))) {
            targetCount = i + 1;
        }
    }

    const lastColumn = group.columns[group.columns.length - 1];
    if (!lastColumn) return targetCount;

    for (let extra = 1; extra <= 10; extra++) {
        const extrapolatedPrimary = incrementShapeName(lastColumn.primaryShape, extra);
        const extrapolatedAssociated = lastColumn.associatedShapes.map(shape => incrementShapeName(shape.shapeName, extra));
        if ([extrapolatedPrimary, ...extrapolatedAssociated].some(key => contentKeys.has(key))) {
            targetCount = group.columns.length + extra;
        }
    }

    return targetCount;
}

function incrementShapeName(name: string, delta: number): string {
    const parsed = parseShapeName(name);
    if (!parsed) return `${name} Copy ${delta}`;
    return `${parsed.base} ${parsed.num + delta}`;
}

import type ObsidianAgentPlugin from '../../../../main';
import { CompositionsRepository } from './CompositionsRepository';
import type { CompositionEntry, CompositionsFile, FullCompositionsData, ShapeDetailEntry } from './compositionsSchema';
import type { CreatePptxBuildOptions, DeckMode, SlideInput } from './createPptxTypes';
import type { PlannedHtmlSlide, PlannedLegacySlide, PlannedSlide, PlannedTemplateSlide, PresentationPlan } from './presentationPlan';

const TALK_MODE_HTML_CLASSES = new Set(['content', 'two-column', 'comparison', 'matrix', 'timeline']);
const BULLET_PREFIX_PATTERN = /^\s*[•▪◦·*\-–]\s+/;

export class PresentationPlanner {
    private repository: CompositionsRepository;

    constructor(private plugin: ObsidianAgentPlugin) {
        this.repository = new CompositionsRepository(plugin.app.vault.adapter);
    }

    async plan(options: CreatePptxBuildOptions): Promise<PresentationPlan> {
        const templateFile = (options.templateFile ?? '').trim() || undefined;
        const templateRef = (options.templateRef ?? '').trim() || undefined;
        const deckMode: DeckMode = options.deckMode ?? 'talk';
        const warnings: string[] = [];

        // B1: Einmaliger loadFullData-Aufruf – enthält rawFile für Compositions-Lookup
        const fullData = templateFile ? await this.repository.loadFullData(templateFile) : undefined;
        const compositions = fullData?.rawFile;

        const plannedSlides: PlannedSlide[] = [];
        for (let i = 0; i < options.slides.length; i++) {
            const slide = options.slides[i];
            plannedSlides.push(await this.planSlide(slide, i, {
                templateFile,
                deckMode,
                compositions,
                fullData,
                warnings,
            }));
        }

        const hasTemplate = plannedSlides.some(s => s.kind === 'template');
        const hasHtml = plannedSlides.some(s => s.kind === 'html');

        let pipeline: PresentationPlan['pipeline'];
        if (hasTemplate && hasHtml) pipeline = 'Mixed';
        else if (hasTemplate) pipeline = 'Template';
        else if (hasHtml && templateFile) pipeline = 'Hybrid HTML';
        else if (hasHtml) pipeline = 'HTML';
        else pipeline = 'Legacy';

        // B10: Dichte einmalig berechnen und für beide Checks wiederverwenden
        const slideDensities = new Map<PlannedSlide, number>();
        for (const s of plannedSlides) {
            if (s.kind === 'template') {
                slideDensities.set(s, this.estimateTextDensity(s.content));
            }
        }

        if (deckMode === 'talk') {
            const denseSlides = plannedSlides.filter(s => (slideDensities.get(s) ?? 0) > 700);
            if (denseSlides.length > 0) {
                warnings.push(
                    `${denseSlides.length} slide(s) look text-dense for talk mode. Consider html/hybrid layouts or splitting content for stronger presentation flow.`,
                );
            }
        }

        warnings.push(...this.collectFlowWarnings(plannedSlides, deckMode, compositions, slideDensities));

        return {
            templateFile,
            templateRef,
            templateName: this.getTemplateName(templateRef ?? '', templateFile),
            deckMode,
            pipeline,
            footerText: options.footerText,
            slides: plannedSlides,
            warnings,
            fullData,
        };
    }

    getTemplateName(templateRef: string, templateFile?: string): string {
        if (templateFile) return templateFile.split('/').pop() ?? templateFile;
        if (!templateRef) return 'executive (default)';
        const shortNames = ['executive', 'modern', 'minimal'];
        if (shortNames.includes(templateRef)) return templateRef;
        if (templateRef.startsWith('default-')) return templateRef.replace('default-', '');
        return templateRef;
    }

    private async planSlide(
        slide: SlideInput,
        index: number,
        context: {
            templateFile?: string;
            deckMode: DeckMode;
            compositions?: CompositionsFile;
            fullData?: FullCompositionsData;
            warnings: string[];
        },
    ): Promise<PlannedSlide> {
        if (slide.template_slide && slide.html) {
            throw new Error(`Slide ${index + 1}: Cannot use both template_slide and html. Use one or the other.`);
        }

        if (slide.template_slide) {
            const resolved = this.resolveCompositionForSlide(slide.template_slide, context.compositions);
            const normalizedContent = this.normalizeTemplateContent(
                slide.content ?? {},
                resolved?.comp.shapes[String(slide.template_slide)] ?? {},
            );
            if (resolved?.comp.has_image_placeholder) {
                context.warnings.push(
                    `Slide ${index + 1} (template_slide=${slide.template_slide}) contains image placeholders. Clone mode cannot populate them; prefer composition_id + content or explicit html when assets matter.`,
                );
            }
            if (resolved?.comp.has_fixed_visuals) {
                context.warnings.push(
                    `Slide ${index + 1} (template_slide=${slide.template_slide}) retains fixed template visuals/icons. Verify that they semantically fit the message.`,
                );
            }
            return {
                kind: 'template',
                templateSlide: slide.template_slide,
                content: normalizedContent,
                notes: slide.notes,
                source: 'explicit-template',
                compositionId: slide.composition_id,
            };
        }

        if (slide.html) {
            return {
                kind: 'html',
                html: slide.html,
                charts: slide.charts,
                tables: slide.tables,
                notes: slide.notes,
                source: 'explicit-html',
                compositionId: slide.composition_id,
            };
        }

        if (context.templateFile && slide.composition_id && slide.content) {
            return this.planCompositionSlide(slide, index, context);
        }

        if (context.templateFile && slide.composition_id && !slide.content) {
            throw new Error(
                `Slide ${index + 1}: composition_id "${slide.composition_id}" requires either html or content.`,
            );
        }

        if (context.templateFile) {
            throw new Error(
                `template_file was provided but slide ${index + 1} uses neither template_slide, html, nor composition_id + content.`,
            );
        }

        return {
            kind: 'legacy',
            source: 'legacy',
            slide,
        } satisfies PlannedLegacySlide;
    }

    private planCompositionSlide(
        slide: SlideInput,
        index: number,
        context: {
            templateFile?: string;
            deckMode: DeckMode;
            compositions?: CompositionsFile;
            fullData?: FullCompositionsData;
            warnings: string[];
        },
    ): PlannedSlide {
        const comp = context.compositions?.compositions[slide.composition_id!];
        if (!comp) {
            throw new Error(`Slide ${index + 1}: composition_id "${slide.composition_id}" not found in compositions.json.`);
        }

        if (comp.has_image_placeholder) {
            context.warnings.push(
                `Slide ${index + 1} (${slide.composition_id}) expects visual/image content. If you do not add real assets, prefer explicit placeholders or custom HTML.`,
            );
        }
        if (comp.has_fixed_visuals) {
            context.warnings.push(
                `Slide ${index + 1} (${slide.composition_id}) keeps fixed template visuals/icons. Verify that they semantically fit the message.`,
            );
        }

        const baseSlideNum = context.fullData?.compositionData?.get(slide.composition_id!)?.baseSlideNum ?? comp.slides[0];
        const normalizedContent = this.normalizeTemplateContent(
            slide.content ?? {},
            baseSlideNum !== undefined ? comp.shapes[String(baseSlideNum)] ?? {} : {},
        );

        const shouldUsePlaceholderHtml = comp.has_image_placeholder;
        const shouldPreferHtmlForTalkMode =
            context.deckMode === 'talk' &&
            comp.supports_html_overlay === true &&
            !!comp.html_skeleton &&
            (
                comp.has_fixed_visuals === true ||
                TALK_MODE_HTML_CLASSES.has(comp.classification ?? '') ||
                this.estimateTextDensity(normalizedContent) > 480
            );

        // B5: Hinweis wenn html_skeleton vorhanden aber supports_html_overlay nicht gesetzt
        if (context.deckMode === 'talk' && !!comp.html_skeleton && comp.supports_html_overlay !== true &&
            !comp.has_image_placeholder && (
                comp.has_fixed_visuals === true ||
                TALK_MODE_HTML_CLASSES.has(comp.classification ?? '') ||
                this.estimateTextDensity(normalizedContent) > 480
            )
        ) {
            context.warnings.push(
                `Slide ${index + 1} (${slide.composition_id}): html_skeleton available but supports_html_overlay is not set – clone mode used. Re-run analyze_pptx_template to enable talk-mode HTML preference.`,
            );
        }

        const plannedPipeline =
            shouldUsePlaceholderHtml ? 'html'
                : shouldPreferHtmlForTalkMode ? 'html'
                    : (comp.recommended_pipeline ?? 'clone');

        if (plannedPipeline === 'clone') {
            if (!baseSlideNum) {
                throw new Error(`Slide ${index + 1}: composition_id "${slide.composition_id}" has no template base slide.`);
            }
            return {
                kind: 'template',
                templateSlide: baseSlideNum,
                content: normalizedContent,
                notes: slide.notes,
                source: 'composition-plan',
                compositionId: slide.composition_id,
            } satisfies PlannedTemplateSlide;
        }

        if (shouldUsePlaceholderHtml) {
            context.warnings.push(
                `Slide ${index + 1} (${slide.composition_id}) was planned as hybrid HTML with explicit asset placeholders instead of clone mode, because the sample slide depends on example images.`,
            );
            return this.planPlaceholderHtmlSlide(slide, comp, normalizedContent);
        }
        if (shouldPreferHtmlForTalkMode) {
            context.warnings.push(
                `Slide ${index + 1} (${slide.composition_id}) was switched to hybrid HTML for talk mode to avoid a rigid template fit and allow a clearer branded layout.`,
            );
        }

        const htmlSkeleton = comp.html_skeleton;
        if (!htmlSkeleton) {
            throw new Error(
                `Slide ${index + 1}: composition_id "${slide.composition_id}" recommends HTML, but no html_skeleton is available. Provide explicit html.`,
            );
        }

        const html = this.fillHtmlSkeleton(htmlSkeleton, normalizedContent, context.warnings);
        return {
            kind: 'html',
            html,
            notes: slide.notes,
            source: 'skeleton-plan',
            compositionId: slide.composition_id,
        } satisfies PlannedHtmlSlide;
    }

    private planPlaceholderHtmlSlide(
        slide: SlideInput,
        comp: CompositionEntry,
        content: Record<string, string>,
    ): PlannedHtmlSlide {
        const contentArea = comp.content_area ?? { x: 80, y: 120, w: 1120, h: 500 };
        const titleStyle = comp.style_guide?.title;
        const bodyStyle = comp.style_guide?.body;
        const accent = comp.style_guide?.accent_color ?? '#E4DAD4';
        const title = content.title ?? Object.values(content)[0] ?? comp.name;
        const bodyEntries = Object.entries(content).filter(([key]) => key !== 'title');
        const leftText = bodyEntries
            .slice(0, 5)
            .map(([, value]) => value)
            .filter(Boolean);

        const titleHtml = `<div data-object="true" data-object-type="textbox" style="position:absolute;left:${contentArea.x}px;top:${contentArea.y}px;width:${contentArea.w}px;height:56px;font-size:${titleStyle?.font_size_pt ?? 30}px;color:${titleStyle?.color ?? '#333333'};font-weight:${titleStyle?.font_weight ?? '700'};">${this.escapeHtml(title)}</div>`;

        const top = contentArea.y + 84;
        const availableH = Math.max(220, contentArea.h - 84);
        const leftW = Math.floor(contentArea.w * 0.48);
        const gap = Math.max(24, Math.floor(contentArea.w * 0.04));
        const rightX = contentArea.x + leftW + gap;
        const rightW = Math.max(240, contentArea.w - leftW - gap);

        const bodyHtml = `<div data-object="true" data-object-type="textbox" style="position:absolute;left:${contentArea.x}px;top:${top}px;width:${leftW}px;height:${availableH}px;font-size:${bodyStyle?.font_size_pt ?? 18}px;color:${bodyStyle?.color ?? '#333333'};line-height:1.35;">${this.formatHtmlParagraphs(leftText)}</div>`;
        const placeholderFrame = `<div data-object="true" data-object-type="shape" style="position:absolute;left:${rightX}px;top:${top}px;width:${rightW}px;height:${availableH}px;border:3px dashed ${accent};border-radius:24px;background:rgba(255,255,255,0.6);"></div>`;
        const placeholderLabel = `<div data-object="true" data-object-type="textbox" style="position:absolute;left:${rightX + 32}px;top:${top + Math.max(24, Math.floor(availableH * 0.35))}px;width:${rightW - 64}px;height:120px;font-size:${bodyStyle?.font_size_pt ?? 18}px;color:${bodyStyle?.color ?? '#333333'};text-align:center;font-weight:600;">${this.escapeHtml('Beispielbild / Screenshot ergänzen')}</div>`;

        return {
            kind: 'html',
            html: [titleHtml, bodyHtml, placeholderFrame, placeholderLabel].join('\n'),
            notes: slide.notes,
            source: 'skeleton-plan',
            compositionId: slide.composition_id,
        } satisfies PlannedHtmlSlide;
    }

    private fillHtmlSkeleton(template: string, content: Record<string, string>, warnings?: string[]): string {
        const values = Object.values(content);
        let index = 0;

        return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
            const direct = content[key];
            if (direct !== undefined) return this.escapeHtml(direct);

            // B3: Mehrere title-Synonyme prüfen, warnen statt blind values[0] nehmen
            if (key === 'title') {
                const titleValue = content.title ?? content.headline ?? content.header ?? content.ueberschrift;
                if (titleValue !== undefined) return this.escapeHtml(titleValue);
                if (warnings && values.length > 0) {
                    warnings.push(`Skeleton has {{title}} but content has no 'title', 'headline', or 'header' key – using first content value as fallback.`);
                }
                return this.escapeHtml(values[0] ?? '');
            }

            index += 1;
            const numbered = content[`content_${index}`];
            if (numbered !== undefined) return this.escapeHtml(numbered);

            const fallback = values[index] ?? values[index - 1] ?? '';
            return this.escapeHtml(fallback);
        });
    }

    private resolveCompositionForSlide(
        slideNum: number,
        compositions: CompositionsFile | undefined,
    ): { id: string; comp: CompositionEntry } | undefined {
        if (!compositions) return undefined;
        for (const [id, comp] of Object.entries(compositions.compositions)) {
            if (comp.slides.includes(slideNum)) return { id, comp };
        }
        return undefined;
    }

    private normalizeTemplateContent(
        content: Record<string, string>,
        shapes: Record<string, ShapeDetailEntry>,
    ): Record<string, string> {
        const normalized: Record<string, string> = {};
        for (const [key, value] of Object.entries(content)) {
            const detail = shapes[key];
            // B4: Keyword-Split vermeidet false positives (z.B. "subtext", "textBox_logo")
            const BODY_PARTS = new Set(['body', 'text', 'beschreibung', 'description', 'inhalt', 'bullet', 'bullets']);
            const isLikelyBodyByKey = key.split('_').some(part => BODY_PARTS.has(part.toLowerCase()));
            const isLikelyBody = isLikelyBodyByKey || /\b(body|text|beschreibung|description)\b/i.test(detail?.zweck ?? '');
            normalized[key] = isLikelyBody ? this.stripInlineBullets(value) : value;
        }
        return normalized;
    }

    private stripInlineBullets(value: string): string {
        const lines = value.split('\n');
        const nonEmpty = lines.filter(line => line.trim().length > 0);
        const bulletLines = nonEmpty.filter(line => BULLET_PREFIX_PATTERN.test(line));
        if (bulletLines.length < 2) return value;
        return lines.map(line => line.replace(BULLET_PREFIX_PATTERN, '')).join('\n');
    }

    private estimateTextDensity(content: Record<string, string>): number {
        return Object.values(content).join(' ').replace(/\s+/g, ' ').trim().length;
    }

    private collectFlowWarnings(
        slides: PlannedSlide[],
        deckMode: DeckMode,
        compositions: CompositionsFile | undefined,
        slideDensities: Map<PlannedSlide, number>,
    ): string[] {
        const warnings: string[] = [];
        if (deckMode !== 'talk') return warnings;

        for (let i = 1; i < slides.length; i++) {
            const previous = slides[i - 1];
            const current = slides[i];
            if (previous.kind !== current.kind) continue;

            if (previous.kind === 'template' && current.kind === 'template') {
                if (previous.compositionId && previous.compositionId === current.compositionId) {
                    warnings.push(
                        `Slides ${i} and ${i + 1} reuse the same composition (${current.compositionId}) back-to-back. Consider more layout variation for talk mode.`,
                    );
                } else if (previous.templateSlide === current.templateSlide) {
                    warnings.push(
                        `Slides ${i} and ${i + 1} clone the same template slide (${current.templateSlide}) consecutively. Consider a hybrid variant for stronger flow.`,
                    );
                }
            }

            if (previous.kind === 'html' && current.kind === 'html' && previous.compositionId && previous.compositionId === current.compositionId) {
                warnings.push(
                    `Slides ${i} and ${i + 1} use the same hybrid composition (${current.compositionId}) consecutively. Check whether the narrative would benefit from more contrast.`,
                );
            }
        }

        const textHeavySlides = slides.filter(slide => {
            if (slide.kind !== 'template') return false;
            const compositionId = slide.compositionId;
            const classification = compositionId ? compositions?.compositions[compositionId]?.classification : undefined;
            return (classification === 'content' || classification === 'two-column' || !compositionId)
                && (slideDensities.get(slide) ?? 0) > 380;
        });
        if (slides.length > 0 && textHeavySlides.length / slides.length > 0.3) {
            warnings.push(
                `More than 30% of the planned slides look like text-heavy template layouts. For talk mode, consider converting some of them to hybrid HTML for stronger visual storytelling.`,
            );
        }

        return warnings;
    }

    private formatHtmlParagraphs(values: string[]): string {
        if (values.length === 0) return this.escapeHtml('Inhalt folgt');
        return values
            .map(value => this.escapeHtml(value).replace(/\n/g, '<br/>'))
            .join('<br/><br/>');
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}

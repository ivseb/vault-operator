/**
 * IngestTemplateTool — analyzes a corporate .pptx template and generates
 * a catalog with slide types, shape names, and content capacity.
 *
 * Pipeline (ADR-046: Direct Template Mode):
 * 1. Structural discovery via pptx-automizer (shapes, positions, types)
 * 2. Grouping by PowerPoint layout name (no clustering, no fuzzy matching)
 * 3. Save catalog.json + template.pptx to .obsilo/themes/{theme_name}/
 *
 * Phase 2 (optional): vision enrichment via LibreOffice + LLM adds
 * visual_description + use_when per slide type.
 */

import * as crypto from 'crypto';
import * as fs from 'fs'; // eslint-disable-line @typescript-eslint/no-require-imports -- Node built-in, needed for vault-path filesystem checks
import * as path from 'path'; // eslint-disable-line @typescript-eslint/no-require-imports -- Node built-in, needed for vault-path filesystem checks
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import { TemplateEngine } from '../../office/pptx/TemplateEngine';
import { TemplateCatalogLoader } from '../../office/pptx/TemplateCatalog';
import type {
    TemplateCatalog,
    LayoutEntry,
    ShapeEntry,
    SlideSemanticFamily,
    SlideType,
    SlideTypeShape,
} from '../../office/pptx/types';
import type { DiscoveredShape, TemplateSlideInfo } from '../../office/pptx/TemplateEngine';
import {
    buildDefaultUseWhen,
    buildSlideTypeGroupingKey,
    inferSlideSemanticFamily,
    inferSlideWarningFlags,
    scoreRepresentativeSlide,
} from '../../office/pptx/slideSemantics';

export class IngestTemplateTool extends BaseTool<'ingest_template'> {
    readonly name = 'ingest_template' as const;
    readonly isWriteOperation = true;

    private templateEngine: TemplateEngine;
    private catalogLoader: TemplateCatalogLoader;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
        this.templateEngine = new TemplateEngine();
        this.catalogLoader = new TemplateCatalogLoader(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'ingest_template',
            description:
                'Analyze a corporate PowerPoint template (.pptx) and generate a slide-type catalog. ' +
                'Extracts shape names, types, and positions per slide, then groups slides by their ' +
                'PowerPoint layout name into slide types. Each slide type shows the representative ' +
                'slide number, all shapes (with REQUIRED/optional status), and a copy-paste JSON example. ' +
                'Run this once per corporate template. ' +
                'Derive theme_name from filename (e.g. "Acme_Vorlage.pptx" -> "acme"). ' +
                'Use render_previews: true for better results (adds visual descriptions via LibreOffice + LLM). ' +
                'Use force: true only when re-analyzing an already ingested template.',
            input_schema: {
                type: 'object',
                properties: {
                    template_path: {
                        type: 'string',
                        description: 'Vault path to the .pptx or .potx template file.',
                    },
                    theme_name: {
                        type: 'string',
                        description: 'Short name for this theme (e.g. "acme", "acme"). Used as folder name and reference in create_pptx.',
                    },
                    sample_slides: {
                        type: 'array',
                        items: { type: 'number' },
                        description: 'Optional: specific slide numbers to analyze (1-based). Default: all slides.',
                    },
                    render_previews: {
                        type: 'boolean',
                        description: 'Render slide screenshots for vision enrichment (requires LibreOffice). Adds visual_description + use_when per slide type. Default: false.',
                    },
                    force: {
                        type: 'boolean',
                        description: 'Force re-ingestion even if theme already exists. Default: false.',
                    },
                },
                required: ['template_path', 'theme_name'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const templatePath = ((input.template_path as string) ?? '').trim();
        const themeName = ((input.theme_name as string) ?? '').trim();
        const sampleSlides = input.sample_slides as number[] | undefined;
        const renderPreviews = input.render_previews === true;
        const force = input.force === true;

        if (!templatePath) {
            callbacks.pushToolResult(this.formatError(new Error('template_path is required')));
            return;
        }
        if (!templatePath.endsWith('.pptx') && !templatePath.endsWith('.potx')) {
            callbacks.pushToolResult(this.formatError(new Error('template_path must end with .pptx or .potx')));
            return;
        }
        if (!themeName) {
            callbacks.pushToolResult(this.formatError(new Error('theme_name is required')));
            return;
        }
        if (!/^[a-z0-9_-]+$/.test(themeName)) {
            callbacks.pushToolResult(this.formatError(new Error(
                'theme_name must be lowercase alphanumeric with hyphens/underscores only.',
            )));
            return;
        }

        try {
            // 0. Check if theme already exists
            const existingThemes = await this.catalogLoader.listThemes();
            const existing = existingThemes.find(t => t.name === themeName);
            if (existing && !force) {
                callbacks.pushToolResult(
                    `Theme "${themeName}" already exists (source: ${existing.source}). ` +
                    `Use it directly with create_pptx: \`template: "${themeName}"\`\n\n` +
                    `To see the slide-type guide, call create_pptx with template: "${themeName}" and no slides.\n\n` +
                    `To re-analyze the template, call ingest_template again with \`force: true\`.`,
                );
                return;
            }
            if (existing && force) {
                callbacks.log(`Force re-ingesting theme "${themeName}" (overwriting existing)...`);
            }

            // 1. Read the template from vault
            callbacks.log(`Reading template: ${templatePath}`);
            const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
            if (!templateFile) {
                callbacks.pushToolResult(this.formatError(new Error(`File not found: ${templatePath}`)));
                return;
            }

            const templateBuffer = await this.app.vault.readBinary(
                templateFile as unknown as import('obsidian').TFile,
            );

            // 2. Discover shapes via pptx-automizer
            callbacks.log('Analyzing template shapes...');
            const discovery = await this.templateEngine.discoverTemplate(
                Buffer.from(templateBuffer),
                sampleSlides,
            );
            const slideInfos = discovery.slides;
            const totalSlides = await this.templateEngine.getSlideCount(Buffer.from(templateBuffer));

            // 3. Build catalog (structural analysis)
            callbacks.log(`Building catalog (${slideInfos.length} slides)...`);
            const catalog = this.buildCatalog(themeName, slideInfos, totalSlides, templateBuffer, discovery.slideSize);

            // 4. Optional: vision enrichment (Phase 2)
            let visionStatus = '';
            if (renderPreviews && catalog.slide_types.length > 0) {
                visionStatus = await this.enrichWithVision(catalog, templatePath, callbacks);
            }

            // 5. Save to vault
            callbacks.log(`Saving theme "${themeName}"...`);
            const themeDir = await this.catalogLoader.saveTheme(themeName, templateBuffer, catalog);

            // 6. Report results
            const guideOutput = TemplateCatalogLoader.formatSlideTypeGuide(catalog);

            callbacks.pushToolResult(
                `Template "${themeName}" ingested successfully.\n\n` +
                `**Location:** ${themeDir}\n` +
                `**Slide size:** ${catalog.slide_size.width}x${catalog.slide_size.height}px\n` +
                `**Total slides:** ${totalSlides}\n` +
                `**Analyzed:** ${slideInfos.length} slides\n` +
                `**Slide types:** ${catalog.slide_types.length}\n` +
                (visionStatus ? `**Vision Enrichment:** ${visionStatus}\n` : '') +
                '\n' +
                guideOutput + '\n\n' +
                `**Usage mit create_pptx:** \`template: "${themeName}"\`\n` +
                `- Verwende \`source_slide\` mit der Slide-Nummer aus dem Guide\n` +
                `- Verwende die exakten Shape-Namen als Content-Keys\n` +
                `- REQUIRED-Shapes müssen immer befüllt werden`,
            );

            callbacks.log(`Template "${themeName}" ingested: ${slideInfos.length} layouts, ${catalog.slide_types.length} slide types`);
        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('ingest_template', error);
        }
    }

    /**
     * Build a TemplateCatalog from discovered slide info.
     * layouts: per-slide shape data (used by TemplateEngine for auto-remove/auto-upgrade)
     * slide_types: grouped by PowerPoint layout name (used by agent for slide selection)
     */
    private buildCatalog(
        themeName: string,
        slideInfos: TemplateSlideInfo[],
        totalSlides: number,
        templateBuffer: ArrayBuffer,
        discoveredSlideSize?: { width: number; height: number },
    ): TemplateCatalog {
        const layouts: Record<number, LayoutEntry> = {};

        for (const slideInfo of slideInfos) {
            // Filter out group shapes (complex nested structures)
            const elements = slideInfo.elements.filter(el => el.type !== 'grpSp');

            // Count duplicate names for #N indexing
            const nameCounts = new Map<string, number>();
            for (const el of elements) {
                nameCounts.set(el.name, (nameCounts.get(el.name) || 0) + 1);
            }

            // Track per-name occurrence index for duplicates
            const nameOccurrence = new Map<string, number>();
            const shapes: ShapeEntry[] = elements.map(el => {
                const count = nameCounts.get(el.name) || 1;
                let dupIndex: number | undefined;
                if (count > 1) {
                    const idx = nameOccurrence.get(el.name) || 0;
                    dupIndex = idx;
                    nameOccurrence.set(el.name, idx + 1);
                }
                return this.classifyShape(el, dupIndex);
            });

            const layoutName = this.generateLayoutName(slideInfo);

            layouts[slideInfo.number] = {
                name: layoutName,
                description: this.generateLayoutDescription(shapes),
                shapes,
            };
        }

        const hash = crypto.createHash('sha256')
            .update(Buffer.from(templateBuffer))
            .digest('hex');

        const slideSize = discoveredSlideSize ?? { width: 1280, height: 720 };

        // Group by PowerPoint layout name (ADR-046: no clustering, no fuzzy matching)
        const slide_types = this.groupByLayoutName(slideInfos, layouts);

        return {
            name: themeName,
            version: new Date().toISOString().split('T')[0],
            slide_size: slideSize,
            template_hash: hash,
            analyzed_slides: slideInfos.length,
            total_slides: totalSlides,
            layouts,
            slide_types,
        };
    }

    /**
     * Groups slides by layout name PLUS structural signature.
     *
     * PowerPoint layout names alone are too coarse for arbitrary templates:
     * one "content" layout can back real content slides, process slides,
     * guide pages, or icon libraries. We therefore keep the original layout
     * name, but split it into separate slide types by semantic structure.
     *
     * Representative = structurally richest reusable slide, penalising
     * likely style-guide/component-library pages.
     */
    private groupByLayoutName(
        slideInfos: TemplateSlideInfo[],
        layouts: Record<number, LayoutEntry>,
    ): SlideType[] {
        const groups = new Map<string, { layoutName: string; slides: number[] }>();
        for (const si of slideInfos) {
            const key = si.layoutName?.trim() || `unbekannt-${si.number}`;
            const layoutEntry = layouts[si.number];
            const groupKey = buildSlideTypeGroupingKey(key, layoutEntry?.shapes ?? []);
            if (!groups.has(groupKey)) {
                groups.set(groupKey, { layoutName: key, slides: [] });
            }
            groups.get(groupKey)!.slides.push(si.number);
        }

        const slideTypes: SlideType[] = [];
        const usedIds = new Set<string>();

        for (const [, group] of groups) {
            const { layoutName, slides: slideNums } = group;

            // Pick representative: richest reusable slide, not simply the busiest one.
            let repSlide = slideNums[0];
            let bestScore = Number.NEGATIVE_INFINITY;
            for (const num of slideNums) {
                const score = scoreRepresentativeSlide(layouts[num]?.shapes ?? []);
                if (score > bestScore) {
                    bestScore = score;
                    repSlide = num;
                }
            }
            const alternates = slideNums.filter(n => n !== repSlide);

            // Build shape list from representative slide (non-decorative only)
            const rawShapes = (layouts[repSlide]?.shapes ?? []).filter(s => s.role !== 'decorative');
            const shapes: SlideTypeShape[] = rawShapes.map(s => {
                const pos = s.dimensions
                    ? this.derivePositionHint(s.dimensions.x, s.dimensions.y, s.dimensions.w, s.dimensions.h)
                    : undefined;
                const st: SlideTypeShape = {
                    name: s.name,
                    role: s.role,
                    content_type: s.content_type,
                    required: !s.removable,
                    max_chars: s.max_chars,
                    duplicate_index: s.duplicate_index,
                    position_hint: pos || undefined,
                    sample_text: s.sample_text || undefined,
                };
                return st;
            });

            // Tag shape groups (sequential same-role clusters)
            this.tagShapeGroups(shapes);
            const semanticFamily = inferSlideSemanticFamily(rawShapes);
            const warningFlags = inferSlideWarningFlags(rawShapes, semanticFamily);

            // Stable ID slug from layout name + semantic family, with collision handling.
            const baseId = [
                layoutName.toLowerCase()
                    .replace(/\s+/g, '-')
                    .replace(/[^a-z0-9-]/g, '')
                    .replace(/^-+|-+$/g, ''),
                semanticFamily !== 'unknown' ? semanticFamily : '',
            ]
                .filter(Boolean)
                .join('--') || `slide-${slideNums[0]}`;
            let id = baseId;
            let suffix = 2;
            while (usedIds.has(id)) {
                id = `${baseId}-${suffix}`;
                suffix++;
            }
            usedIds.add(id);

            slideTypes.push({
                id,
                layout_name: layoutName,
                representative_slide: repSlide,
                alternate_slides: alternates,
                description: this.generateSlideTypeDescription(shapes),
                semantic_family: semanticFamily,
                shapes,
                use_when: buildDefaultUseWhen(semanticFamily, warningFlags),
                warning_flags: warningFlags.length > 0 ? warningFlags : undefined,
            });
        }

        return slideTypes;
    }

    /**
     * Derives a human-readable position hint from shape dimensions on a 1280×720 slide.
     */
    private derivePositionHint(x: number, y: number, w: number, h: number): string {
        if (w === 0 && h === 0) return '';

        const slideW = 1280;
        const slideH = 720;
        const cx = x + w / 2;
        const cy = y + h / 2;

        // Full-width check (≥ 80% of slide width)
        const isFullWidth = w >= slideW * 0.8;

        // Horizontal thirds
        const horizPart = cx < slideW / 3 ? 'links'
            : cx > (slideW * 2) / 3 ? 'rechts'
                : 'Mitte';

        // Vertical zones: top 28% = oben, bottom 28% = unten, rest = Mitte
        const isTop = cy < slideH * 0.28;
        const isBottom = cy > slideH * 0.72;
        const vertPart = isTop ? 'oben' : isBottom ? 'unten' : '';

        if (isFullWidth) {
            return vertPart ? `${vertPart}, volle Breite` : 'volle Breite';
        }

        // Two-column detection: wide shape on left or right half
        const isWide = w > slideW * 0.35;
        if (isWide && cx < slideW / 2) return vertPart ? `${vertPart}, linke Hälfte` : 'linke Hälfte';
        if (isWide && cx >= slideW / 2) return vertPart ? `${vertPart}, rechte Hälfte` : 'rechte Hälfte';

        // Compact position
        if (vertPart && horizPart !== 'Mitte') return `${vertPart} ${horizPart}`;
        if (vertPart) return vertPart;
        return horizPart;
    }

    /**
     * Tags shapes that form visual clusters with a shared group_hint.
     * Detects: horizontal sequences of same-role shapes (≥ 3), two-column body pairs.
     * Mutates the shapes array in place.
     */
    private tagShapeGroups(shapes: SlideTypeShape[]): void {
        // Pass 1: horizontal sequences (≥ 3 shapes, same role, similar Y, increasing X)
        const byRole = new Map<string, SlideTypeShape[]>();
        for (const sh of shapes) {
            if (!byRole.has(sh.role)) byRole.set(sh.role, []);
            byRole.get(sh.role)!.push(sh);
        }

        for (const [role, group] of byRole) {
            if (group.length < 3) continue;
            if (role === 'title' || role === 'subtitle') continue;

            // All shapes in this role group that have a position hint containing "unten" or "Mitte"
            // and are spread horizontally → sequence
            const posHints = group.map(s => s.position_hint ?? '');
            const hasHorizontalSpread = posHints.some(p => p.includes('links')) &&
                posHints.some(p => p.includes('rechts'));

            if (hasHorizontalSpread) {
                const roleLabel = role === 'body' ? 'Content-Felder'
                    : role === 'kpi_value' ? 'KPI-Gruppe'
                        : role === 'step_label' ? 'Prozess-Schritte'
                            : role === 'image' ? 'Bild-Gruppe'
                                : `${role}-Gruppe`;
                const hint = `${roleLabel} (${group.length}×, horizontal)`;
                // ADR-048: Assign machine-readable group_id alongside human-readable group_hint
                const groupId = `${role}_h${group.length}`;
                for (let idx = 0; idx < group.length; idx++) {
                    group[idx].group_hint = hint;
                    group[idx].group_id = groupId;
                }
            }
        }

        // Pass 2: two-column body pairs
        const bodies = shapes.filter(s => s.role === 'body' && !s.group_hint);
        if (bodies.length === 2) {
            const p0 = bodies[0].position_hint ?? '';
            const p1 = bodies[1].position_hint ?? '';
            if ((p0.includes('links') && p1.includes('rechts')) ||
                (p0.includes('rechts') && p1.includes('links'))) {
                bodies[0].group_hint = 'Zwei Spalten';
                bodies[1].group_hint = 'Zwei Spalten';
            }
        }
    }

    private generateSlideTypeDescription(shapes: SlideTypeShape[]): string {
        const roles = shapes.map(s => s.role);
        const parts: string[] = [];
        if (roles.includes('title')) parts.push('Titel');
        if (roles.includes('subtitle')) parts.push('Untertitel');
        const kpiCount = roles.filter(r => r === 'kpi_value').length;
        if (kpiCount) parts.push(`${kpiCount} KPI${kpiCount > 1 ? 's' : ''}`);
        const stepCount = roles.filter(r => r === 'step_label').length;
        if (stepCount) parts.push(`${stepCount}-stufiger Prozess`);
        if (roles.includes('body')) parts.push('Content');
        if (roles.includes('chart')) parts.push('Diagramm');
        if (roles.includes('table')) parts.push('Tabelle');
        if (roles.includes('image')) parts.push('Bild');
        return parts.join(' + ') || 'Dekorativ';
    }

    /**
     * Classify a discovered shape into a ShapeEntry with role and capacity.
     */
    private classifyShape(el: DiscoveredShape, duplicateIndex?: number): ShapeEntry {
        const name = el.name;
        const role = this.inferRole(el);
        const contentType = this.inferContentType(el);
        // EMU to px (1 px = 9525 EMU)
        const xPx = Math.round(el.position.x / 9525);
        const yPx = Math.round(el.position.y / 9525);
        const widthPx = Math.round(el.position.w / 9525);
        const heightPx = Math.round(el.position.h / 9525);

        // 0x0 shapes (inherited from slide master) cannot be individually removed
        const removable = role !== 'title' && role !== 'subtitle' && role !== 'decorative'
            && (widthPx > 0 || heightPx > 0);

        // Estimate max_chars from shape width (rough: 1 char ~ 8px at 14px font).
        // Only when dimensions are known — shapes inheriting from slide layout have w=h=0.
        const charWidth = 8;
        const lineHeight = 20;
        const charsPerLine = Math.floor(widthPx / charWidth);
        const lines = Math.floor(heightPx / lineHeight);
        const maxChars = (widthPx > 0 && heightPx > 0)
            ? Math.max(20, charsPerLine * Math.max(1, lines))
            : undefined;

        // Extract sample text for fallback resolution (max 100 chars)
        const sampleText = el.hasTextBody && el.text.length > 0
            ? el.text.join(' ').substring(0, 100).trim()
            : undefined;

        const entry: ShapeEntry = {
            name,
            role,
            content_type: contentType,
            max_chars: contentType === 'text' && el.hasTextBody ? maxChars : undefined,
            removable,
            dimensions: { x: xPx, y: yPx, w: widthPx, h: heightPx },
            sample_text: sampleText || undefined,
        };

        if (duplicateIndex !== undefined && duplicateIndex > 0) {
            entry.duplicate_index = duplicateIndex;
        }

        // ADR-048: Detect section number shapes (single digit in body shape on divider layouts)
        if (role === 'body' && sampleText && /^\d$/.test(sampleText.trim())) {
            entry.special_role = 'section_number';
        }

        // Extract font info from discovered shape (for hybrid generate() fallback)
        if (el.fontInfo) {
            const fi = el.fontInfo;
            if (fi.fontFace || fi.fontSize || fi.isBold !== undefined || fi.color) {
                entry.font_info = {
                    ...(fi.fontFace ? { font_face: fi.fontFace } : {}),
                    ...(fi.fontSize ? { font_size: fi.fontSize } : {}),
                    ...(fi.isBold !== undefined ? { is_bold: fi.isBold } : {}),
                    ...(fi.color ? { color: fi.color } : {}),
                    ...(fi.alignment ? { alignment: fi.alignment } : {}),
                };
            }
        }

        return entry;
    }

    /**
     * Infer content_type from pptx-automizer element type/visualType.
     */
    private inferContentType(el: DiscoveredShape): ShapeEntry['content_type'] {
        if (el.type === 'chart' || el.type === 'chartEx') return 'chart';
        if (el.type === 'graphicFrame' && el.visualType === 'table') return 'table';
        if (el.type === 'pic' || el.visualType === 'picture') return 'image';
        return 'text';
    }

    /**
     * Infer the semantic role of a shape based on its name, type, position, and size.
     *
     * Priority cascade:
     * 1. Type-based (chart, image, table) -- overrides everything
     * 2. Decorative infrastructure (footer, page number, date, SmartArt)
     * 3. Subtitle (explicit, before generic title match)
     * 4. Name-based heuristics (title, body, kpi, step, etc.)
     * 5. Size-aware text fallback (large shapes → body, small → decorative)
     */
    private inferRole(el: DiscoveredShape): ShapeEntry['role'] {
        const nameLower = el.name.toLowerCase();

        // 1. Type-based checks FIRST
        if (el.type === 'chart' || el.type === 'chartEx') return 'chart';
        if (el.visualType === 'picture' || el.type === 'pic') return 'image';
        if (el.type === 'graphicFrame' && el.visualType === 'table') return 'table';

        // 2. Decorative infrastructure elements
        if (/fu[ßs]zeile|footer|pied.*page|pie.*p[áa]gina/i.test(nameLower)) return 'decorative';
        if (/foliennummer|slide.*number|num[ée]ro/i.test(nameLower)) return 'decorative';
        if (/datumsplatzhalter|date.*placeholder/i.test(nameLower)) return 'decorative';
        if (/smartart/i.test(nameLower)) return 'decorative';

        // Geometric AutoShapes: PowerPoint names drawn rectangles "Rechteck N" and AutoShapes "object N".
        // These are always structural design elements, never content placeholders — even when they
        // happen to contain text. Classifying them as decorative prevents auto-removal when the
        // agent does not address them in the content dict.
        if (/^(rechteck|object)\b/i.test(nameLower)) return 'decorative';

        // 3. Subtitle explicitly first
        if (/untertitel|subtitle|sous-?titre|subt[ií]tulo/i.test(nameLower)) return 'subtitle';

        // 4. Name-based heuristics (multi-language: DE, EN, FR, ES)
        if (/title|titel|titre|t[ií]tulo/i.test(nameLower)) return 'title';
        if (/body|content|inhalt|contenu|contenido/i.test(nameLower)) return 'body';
        if (/kpi|value|wert|zahl|valeur|valor|kennzahl/i.test(nameLower)) return 'kpi_value';
        if (/\blabel\b|beschriftung|[ée]tiquette/i.test(nameLower)) return 'kpi_label';
        if (/step|schritt|[ée]tape|paso/i.test(nameLower)) return 'step_label';
        if (/image|bild|foto|photo|imagen/i.test(nameLower)) return 'image';
        if (/chart|diagramm|graphique|gr[áa]fico/i.test(nameLower)) return 'chart';

        // 5. Size-aware text fallback
        if (el.hasTextBody && el.text.length > 0) {
            const wPx = el.position.w / 9525;
            const hPx = el.position.h / 9525;
            if (wPx === 0 && hPx === 0) return 'decorative';
            if (wPx > 192 && hPx > 58) return 'body';
            return 'decorative';
        }

        return 'decorative';
    }

    /**
     * Generate a human-readable layout name from slide info.
     */
    private generateLayoutName(slideInfo: TemplateSlideInfo): string {
        const layout = slideInfo.layoutName || '';
        if (layout) {
            return layout
                .replace(/[_\s]+/g, '-')
                .replace(/[^a-zA-Z0-9-]/g, '')
                .toLowerCase()
                .replace(/^-+|-+$/g, '') || `slide-${slideInfo.number}`;
        }
        return `slide-${slideInfo.number}`;
    }

    /**
     * Generate a description for a layout based on its shapes.
     */
    private generateLayoutDescription(shapes: ShapeEntry[]): string {
        const roles = shapes.map(s => s.role).filter(r => r !== 'decorative');
        const uniqueRoles = [...new Set(roles)];
        if (uniqueRoles.length === 0) return 'Decorative layout';

        const parts: string[] = [];
        if (uniqueRoles.includes('title')) parts.push('Title');
        if (uniqueRoles.includes('subtitle')) parts.push('Subtitle');
        if (uniqueRoles.includes('kpi_value')) {
            const count = roles.filter(r => r === 'kpi_value').length;
            parts.push(`${count} KPI${count > 1 ? 's' : ''}`);
        }
        if (uniqueRoles.includes('step_label')) {
            const count = roles.filter(r => r === 'step_label').length;
            parts.push(`${count}-step process`);
        }
        if (uniqueRoles.includes('body')) parts.push('Content');
        if (uniqueRoles.includes('image')) parts.push('Image');
        if (uniqueRoles.includes('chart')) parts.push('Chart');
        if (uniqueRoles.includes('table')) parts.push('Table');

        return parts.join(' + ');
    }

    /* ------------------------------------------------------------------ */
    /*  Phase 2: Vision enrichment (optional, requires LibreOffice)        */
    /* ------------------------------------------------------------------ */

    /**
     * Enrich slide types with visual descriptions via LibreOffice + LLM.
     * Returns a human-readable status string for the tool output.
     * Graceful skip if LibreOffice is not available or any step fails.
     */
    private async enrichWithVision(
        catalog: TemplateCatalog,
        templatePath: string,
        callbacks: ToolExecutionContext['callbacks'],
    ): Promise<string> {
        try {
            const { renderPptxToImages } = await import('../../office/pptxRenderer');

            const adapter = this.app.vault.adapter;
            // eslint-disable-next-line -- need FileSystemAdapter for basePath
            const vaultRoot: string = (adapter as import('obsidian').FileSystemAdapter).basePath
                ?? (adapter as import('obsidian').FileSystemAdapter).getBasePath?.() ?? '';
            if (!vaultRoot) {
                return 'Skipped — vault root nicht ermittelbar';
            }

            const absolutePath = path.join(vaultRoot, templatePath);
            if (!fs.existsSync(absolutePath)) {
                return `Skipped — Datei nicht auf Disk gefunden: ${absolutePath}`;
            }

            const repSlides = catalog.slide_types.map(st => st.representative_slide);
            callbacks.log(`Rendering ${repSlides.length} representative slides for vision enrichment...`);

            const result = await renderPptxToImages(absolutePath, {
                requestedSlides: repSlides,
                maxSlides: 50,
            });

            if (!result.success || result.slides.length === 0) {
                return `Skipped — Rendering fehlgeschlagen: ${result.error ?? 'unbekannt'}`;
            }

            const imageMap = new Map<number, string>();
            for (const slide of result.slides) imageMap.set(slide.slideNumber, slide.base64);
            callbacks.log(`Rendered ${imageMap.size} slides — calling LLM for vision enrichment...`);

            const enrichedCount = await this.callVisionEnrichment(catalog, imageMap, callbacks);
            return `${enrichedCount}/${catalog.slide_types.length} Slide-Typen angereichert`;
        } catch (e) {
            return `Fehlgeschlagen — ${(e as Error).message}`;
        }
    }

    private async callVisionEnrichment(
        catalog: TemplateCatalog,
        imageMap: Map<number, string>,
        callbacks: ToolExecutionContext['callbacks'],
    ): Promise<number> {
        const { buildApiHandlerForModel } = await import('../../../api');
        const model = this.plugin.getActiveModel();
        if (!model) {
            throw new Error('Kein aktives Modell konfiguriert');
        }

        const api = buildApiHandlerForModel(model);
        type ContentBlock = import('../../../api/types').ContentBlock;
        const contentBlocks: ContentBlock[] = [];

        contentBlocks.push({
            type: 'text',
            text: `Analyze these ${catalog.slide_types.length} PowerPoint template slides. ` +
                'Each image is followed by the shape names visible on that slide. ' +
                'Return a single JSON object mapping slide-type IDs to their enrichment.',
        });

        for (const st of catalog.slide_types) {
            const image = imageMap.get(st.representative_slide);
            if (!image) continue;

            contentBlocks.push({
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: image },
            });

            // Only non-decorative shapes — these are what the agent needs to understand
            const shapeInfo = st.shapes.map(s => {
                const key = s.duplicate_index != null && s.duplicate_index > 0
                    ? `${s.name}#${s.duplicate_index}` : s.name;
                const pos = s.position_hint ? ` @ ${s.position_hint}` : '';
                return `  - ${key} [${s.role}]${pos}`;
            }).join('\n');

            contentBlocks.push({
                type: 'text',
                text: `--- "${st.id}" (slide ${st.representative_slide}) ---\n${shapeInfo}`,
            });
        }

        const stream = api.createMessage(
            VISION_ENRICHMENT_PROMPT,
            [{ role: 'user', content: contentBlocks }],
            [],
        );

        let responseText = '';
        for await (const chunk of stream) {
            if (chunk.type === 'text') responseText += chunk.text;
        }

        if (!responseText.trim()) {
            throw new Error('Leere LLM-Antwort');
        }

        let cleaned = responseText.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
        }

        const enrichments = JSON.parse(cleaned) as Record<string, {
            visual_description?: string;
            use_when?: string;
            shape_hints?: Record<string, string>;
        }>;

        let enrichedCount = 0;
        for (const st of catalog.slide_types) {
            const e = enrichments[st.id];
            if (!e) continue;
            if (e.visual_description) st.visual_description = e.visual_description;
            if (e.use_when) st.use_when = e.use_when;

            // Apply per-shape semantic hints
            if (e.shape_hints) {
                for (const sh of st.shapes) {
                    const key = sh.duplicate_index != null && sh.duplicate_index > 0
                        ? `${sh.name}#${sh.duplicate_index}` : sh.name;
                    const hint = e.shape_hints[key] ?? e.shape_hints[sh.name];
                    if (hint) sh.semantic_hint = hint;
                }
            }

            enrichedCount++;
        }

        return enrichedCount;
    }
}

const VISION_ENRICHMENT_PROMPT = `You are a presentation design expert analyzing corporate PowerPoint template slides.

For each slide image and its shape list, return a JSON object describing:
1. The slide's visual design and purpose
2. The semantic function of each individual shape — what it IS and HOW a content creator should use it

Return a single JSON object (no markdown fences):

{
  "slide-type-id": {
    "visual_description": "1-2 sentences: visual layout, color scheme, arrangement",
    "use_when": "1 sentence: storytelling context — when to choose this slide type",
    "shape_hints": {
      "ShapeName": "max 15 words: what this shape IS and how to fill it",
      "ShapeName#2": "max 15 words: for duplicate shapes, use the #N key"
    }
  }
}

Rules for shape_hints:
- Describe the DESIGN FUNCTION, not the current content (not "shows Nachhaltigkeit", but "category label for one business domain")
- For grouped identical shapes (e.g. 5 label boxes in a row): annotate each with its position in the group ("label box 1 of 5, leftmost")
- For image placeholders: describe what kind of image fits ("icon from brand library", "portrait photo", "full-bleed background image")
- For title/subtitle shapes: describe expected length and purpose ("main title, max 2 lines", "speaker name and date line")
- Omit shapes where the role is self-evident from the name alone
- Keep each hint to max 15 words

Include all slide types that have images.`;

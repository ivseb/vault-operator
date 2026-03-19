import { COMPOSITION_METADATA, generateDeterministicAliases, groupByComposition } from '../../../office/PptxTemplateAnalyzer';
import type {
    AliasEntry,
    CompositionScaffolding,
    SlideClassification,
    TemplateAnalysis,
} from '../../../office/PptxTemplateAnalyzer';
import type {
    DesignRules,
    IconEntry,
    MultimodalResult,
    UsageGuidelines,
} from '../../../office/MultimodalAnalyzer';
import type { CompositionsFile } from './compositionsSchema';

export interface MultiFileArtifactData {
    sourceFiles?: Array<{ path: string; role: string; slide_count: number }>;
    designRules?: DesignRules;
    iconCatalog?: IconEntry[];
    usageGuidelines?: UsageGuidelines;
}

export function validateGeneratedTemplateArtifacts(
    additionalFiles: Array<{ path: string; role?: string }>,
    multiFileData: MultiFileArtifactData | undefined,
    skillContent: string,
    compositionsContent: CompositionsFile,
): string[] {
    const issues: string[] = [];
    if (additionalFiles.length === 0) return issues;

    if (!multiFileData?.sourceFiles || multiFileData.sourceFiles.length === 0) {
        issues.push('Additional files were provided, but no source_files metadata was produced.');
        return issues;
    }

    const sourcePathSet = new Set(multiFileData.sourceFiles.map(sf => sf.path));
    for (const af of additionalFiles) {
        const filePath = af.path.trim();
        if (!sourcePathSet.has(filePath)) {
            issues.push(`${filePath}: missing from generated source_files metadata.`);
        }
    }

    const totalDesignRules =
        (compositionsContent.design_rules?.color_usage.length ?? 0) +
        (compositionsContent.design_rules?.typography.length ?? 0) +
        (compositionsContent.design_rules?.layout.length ?? 0) +
        (compositionsContent.design_rules?.dos.length ?? 0) +
        (compositionsContent.design_rules?.donts.length ?? 0);
    const totalUsageGuidelines =
        (compositionsContent.usage_guidelines?.layout_guidance.length ?? 0) +
        (compositionsContent.usage_guidelines?.best_practices.length ?? 0) +
        (compositionsContent.usage_guidelines?.common_mistakes.length ?? 0);
    const totalIcons = compositionsContent.icon_catalog?.length ?? 0;
    const producedRoles = new Set(multiFileData.sourceFiles.map(sf => sf.role));

    for (const af of additionalFiles) {
        const role = af.role;
        const filePath = af.path.trim();

        if (role === 'styleguide' && totalDesignRules === 0) {
            issues.push(`${filePath}: explicit role "styleguide" was provided, but no design_rules were extracted.`);
        }
        if (role === 'howto' && totalUsageGuidelines === 0) {
            issues.push(`${filePath}: explicit role "howto" was provided, but no usage_guidelines were extracted.`);
        }
        if (role === 'icons' && totalIcons === 0) {
            issues.push(`${filePath}: explicit role "icons" was provided, but no icon_catalog was extracted.`);
        }
    }

    if (producedRoles.has('styleguide') && totalDesignRules === 0) {
        issues.push('A file was classified as styleguide, but generated design_rules are empty.');
    }
    if (producedRoles.has('howto') && totalUsageGuidelines === 0) {
        issues.push('A file was classified as howto, but generated usage_guidelines are empty.');
    }
    if (producedRoles.has('icons') && totalIcons === 0) {
        issues.push('A file was classified as icons, but generated icon_catalog is empty.');
    }

    if (totalDesignRules > 0 && !skillContent.includes('## Design Rules (from Style Guide)')) {
        issues.push('design_rules were extracted into compositions.json, but SKILL.md does not expose them.');
    }
    if (totalUsageGuidelines > 0 && !skillContent.includes('## Usage Guidelines (from How-to-Use)')) {
        issues.push('usage_guidelines were extracted into compositions.json, but SKILL.md does not expose them.');
    }
    if (totalIcons > 0 && !skillContent.includes('## Available Icons')) {
        issues.push('icon_catalog was extracted into compositions.json, but SKILL.md does not expose it.');
    }

    return issues;
}

export function generateSkillMd(
    analysis: TemplateAnalysis,
    templatePath: string,
    templateName: string,
    templateSlug: string,
    scaffoldingMap?: Map<number, CompositionScaffolding>,
    multiFileData?: MultiFileArtifactData,
): string {
    const compositions = groupByComposition(analysis);
    const contentCompositions = compositions.filter(c => c.classification !== 'blank');
    const lines: string[] = [];

    lines.push('---');
    lines.push(`name: ${templateSlug}`);
    lines.push(`description: ${templateName} -- ${analysis.slideCount} Slides, ${contentCompositions.length} Compositions`);
    lines.push(`trigger: ${templateSlug.replace(/-/g, '|')}`);
    lines.push('source: user');
    lines.push('requiredTools: [create_pptx, get_composition_details]');
    lines.push('---');
    lines.push('');

    lines.push(`# ${templateName} -- Visual Design Language`);
    lines.push('');
    lines.push('## Brand-DNA');
    const { brandDNA } = analysis;
    const primary = brandDNA.colors['dk1'] ?? brandDNA.colors['accent1'] ?? '#000000';
    const accents = ['accent1', 'accent2', 'accent3']
        .map(k => brandDNA.colors[k])
        .filter(Boolean)
        .join(', ');
    lines.push(`- Primary: ${primary} | Accent: ${accents}`);
    lines.push(`- Heading: ${brandDNA.fonts.major} | Body: ${brandDNA.fonts.minor}`);
    lines.push('');

    lines.push('## Compositions');
    lines.push('');
    lines.push('Use `get_composition_details` to load shape mappings for the compositions you need.');
    lines.push('');

    const idMap = assignUniqueIds(contentCompositions);
    for (let i = 0; i < contentCompositions.length; i++) {
        const group = contentCompositions[i];
        const numsStr = group.slideNumbers.length > 5
            ? `${group.slideNumbers.slice(0, 5).join(', ')}... (+${group.slideNumbers.length - 5})`
            : group.slideNumbers.join(', ');
        const compId = idMap.get(i) ?? compositionId(group.classification);
        const scaffolding = scaffoldingMap?.get(i);
        const pipelineStr = scaffolding ? `, Pipeline: ${scaffolding.recommended_pipeline}` : '';
        let compLine = `- **${group.name}** (ID: \`${compId}\`, Slides ${numsStr}${pipelineStr}): ${group.meaning}`;
        const warning = generateCompositionWarnings(group, analysis);
        if (warning) compLine += ` -- WARNING: ${warning}`;
        lines.push(compLine);
    }
    lines.push('');

    lines.push('## Compositions by Narrative Phase');
    lines.push('');
    lines.push('| Phase | Compositions | Rationale |');
    lines.push('|-------|-------------|-----------|');

    const phaseRationale: Record<string, string> = {
        opening: 'Establish facts',
        tension: 'Build contrast',
        resolution: 'Show path forward',
        any: 'Flexible',
    };

    const byPhase = new Map<string, string[]>();
    for (const comp of contentCompositions) {
        const phase = COMPOSITION_METADATA[comp.classification as SlideClassification]?.narrativePhase ?? 'any';
        const list = byPhase.get(phase) ?? [];
        list.push(comp.name);
        byPhase.set(phase, list);
    }

    for (const phase of ['opening', 'tension', 'resolution', 'any']) {
        const names = byPhase.get(phase);
        if (names && names.length > 0) {
            const label = phase === 'any' ? 'Any phase' : phase.charAt(0).toUpperCase() + phase.slice(1);
            lines.push(`| ${label} | ${names.join(', ')} | ${phaseRationale[phase]} |`);
        }
    }
    lines.push('');

    if (multiFileData?.sourceFiles && multiFileData.sourceFiles.length > 1) {
        lines.push('## Source Files');
        for (const sf of multiFileData.sourceFiles) {
            const roleLabel = sf.role === 'main' ? 'Main' : sf.role === 'styleguide' ? 'Style Guide'
                : sf.role === 'icons' ? 'Icons' : sf.role === 'howto' ? 'How-to-Use' : sf.role;
            lines.push(`- ${roleLabel}: ${sf.path.split('/').pop()} (${sf.slide_count} Slides)`);
        }
        lines.push('');
    }

    if (multiFileData?.designRules) {
        const dr = multiFileData.designRules;
        lines.push('## Design Rules (from Style Guide)');
        if (dr.color_usage.length > 0) {
            lines.push('### Color Usage');
            for (const rule of dr.color_usage.slice(0, 8)) lines.push(`- ${rule}`);
        }
        if (dr.typography.length > 0) {
            lines.push('### Typography');
            for (const rule of dr.typography.slice(0, 6)) lines.push(`- ${rule}`);
        }
        if (dr.layout.length > 0) {
            lines.push('### Layout');
            for (const rule of dr.layout.slice(0, 6)) lines.push(`- ${rule}`);
        }
        if (dr.dos.length > 0 || dr.donts.length > 0) {
            lines.push('### Do\'s / Don\'ts');
            for (const d of dr.dos.slice(0, 5)) lines.push(`- DO: ${d}`);
            for (const d of dr.donts.slice(0, 5)) lines.push(`- DON'T: ${d}`);
        }
        lines.push('');
    }

    if (multiFileData?.iconCatalog && multiFileData.iconCatalog.length > 0) {
        lines.push('## Available Icons');
        lines.push('');
        for (const icon of multiFileData.iconCatalog.slice(0, 30)) {
            const hint = icon.usage_hint ? ` -- ${icon.usage_hint}` : '';
            lines.push(`- ${icon.name} (${icon.category}): ${icon.description}${hint}`);
        }
        if (multiFileData.iconCatalog.length > 30) {
            lines.push(`- ... and ${multiFileData.iconCatalog.length - 30} more (use get_composition_details for full catalog)`);
        }
        lines.push('');
    }

    if (multiFileData?.usageGuidelines) {
        const ug = multiFileData.usageGuidelines;
        if (ug.best_practices.length > 0 || ug.layout_guidance.length > 0 || ug.common_mistakes.length > 0) {
            lines.push('## Usage Guidelines (from How-to-Use)');
            if (ug.layout_guidance.length > 0) {
                lines.push('### Layout Guidance');
                for (const g of ug.layout_guidance.slice(0, 6)) lines.push(`- ${g}`);
            }
            if (ug.best_practices.length > 0) {
                lines.push('### Best Practices');
                for (const p of ug.best_practices.slice(0, 6)) lines.push(`- ${p}`);
            }
            if (ug.common_mistakes.length > 0) {
                lines.push('### Common Mistakes');
                for (const m of ug.common_mistakes.slice(0, 6)) lines.push(`- ${m}`);
            }
            lines.push('');
        }
    }

    lines.push('## Design Rules');
    lines.push('');
    lines.push('### Critical Rules');
    lines.push(`- Template file: \`${templatePath}\``);

    if (scaffoldingMap && scaffoldingMap.size > 0) {
        lines.push('- **Mixed decks are PREFERRED** for corporate templates: choose the best mode per slide instead of forcing the whole deck into clone.');
        lines.push('- Pass `deck_mode: "talk"` for presentation decks and `deck_mode: "reading"` for denser reading decks. The planner uses this to decide when hybrid HTML should override a mediocre template fit.');
        lines.push('- **html** (`html` + `composition_id`): Preferred for most text/content slides where the scaffold should stay corporate, but the actual content needs flexible layout, placeholders, image slots, or stronger storytelling.');
        lines.push('- **clone** (`template_slide` + `content`): Use for structural slides and design-carrying layouts whose meaning lives in the template shapes themselves (titles, dividers, chevrons, KPI boxes, pyramids, rigid process flows).');
        lines.push('- **planner-driven mode** (`composition_id` + `content`): Recommended default. The planner chooses clone vs hybrid HTML from `recommended_pipeline`, deck mode, text density, fixed visuals, and image-placeholder risk.');
        lines.push('- **Treat template slides as reference implementations, not strict mandates**: If a composition is only a mediocre fit, create a better branded visual in HTML instead of forcing the content into the sample layout.');
        lines.push('- Use each composition\'s `recommended_pipeline` and `recommended_pipeline_reason` to decide. When in doubt, prefer **html + composition_id** for content-heavy slides and **clone** for rigid structured shapes.');
        lines.push('- Call `get_composition_details` to see exact shape names, content_area, style_guide, layout_hint, and scaffold_elements per composition');
        lines.push('- Mixed decks are allowed: use `template_slide` for explicit clone slides, or let `composition_id` + `content` choose the right path automatically.');
    } else {
        lines.push('- **Template mode** (`template_slide` + `content`): For text replacement in existing shapes. Pixel-perfect corporate design.');
        lines.push('- **HTML mode** (`html` + `template_file`): For creative layouts with Brand-DNA colors/fonts. Deko elements (logo, accent bars) are auto-injected -- do NOT place them manually.');
        lines.push('- Choose mode per slide: title/section dividers -> Template. KPI/charts/creative -> HTML.');
    }

    lines.push('- **Fill EVERY shape** (Template mode): When `get_composition_details` lists N shapes, your `content` object MUST have N keys. Unfilled shapes are CLEARED by the cloner and appear as blank empty areas.');
    lines.push('- **Transform content**: NEVER copy source text verbatim. Restructure: paragraphs -> bullets (max 8 words), numbers -> KPIs, sequences -> process labels (1-3 words per step).');
    lines.push('- **Hybrid over filler**: If a slide really wants screenshots, example plans, or flexible explanatory blocks, prefer `html` + `composition_id` over forcing generic text into an ill-fitting clone layout.');
    lines.push('- **Action titles**: Every title is an ASSERTION ("17% faster through automation"), not a topic ("Technical Solution").');
    lines.push('- Shape names in `content` must match exactly (case-sensitive) from `get_composition_details`');
    lines.push('');

    if (scaffoldingMap && scaffoldingMap.size > 0) {
        lines.push('### Using HTML Mode with Scaffolding');
        lines.push('1. Call `get_composition_details` -> read `content_area`, `style_guide`, `layout_hint`');
        lines.push('2. Generate HTML within `content_area` bounds using `style_guide` colors/fonts');
        lines.push('3. Scaffold (header, footer, logo, deko) is auto-injected per composition');
        lines.push('4. Optional: Use `html_skeleton` from composition as starting point');
        if (multiFileData?.iconCatalog && multiFileData.iconCatalog.length > 0) {
            lines.push('5. Pick icons from Available Icons catalog instead of inheriting fixed template icons');
        }
        lines.push('6. If example images are missing, ASK the user or place explicit placeholders instead of reusing unrelated template visuals');
        lines.push('');
    }

    lines.push('### Composition Selection');
    lines.push('- Match composition to content type: numbers -> KPI, sequence -> process, comparison -> two-column/matrix');
    lines.push('- Choose the BEST visual for the statement, not the closest template sample. If the sample layout limits clarity, create a new branded visual in HTML.');
    lines.push('- Max 30% of content slides may be plain text -- the rest MUST use structured visual layouts');
    lines.push('- Never use the same slide type on consecutive slides');
    lines.push('- Slides with embedded charts (bar/pie/waterfall) contain STATIC template data -- only use when content matches the chart type');
    lines.push('- **NEVER invent data**: All numbers, percentages, dates, and facts MUST come from source material. If a KPI shape has no matching data, use qualitative text or choose a different composition.');
    lines.push('- Compositions with image placeholders (marked `has_image_placeholder: true` in compositions.json) require actual images -- skip them if no images are available');
    lines.push('');
    lines.push('### Verification');
    lines.push('- After creating, use `render_presentation` to visually verify (if Visual Intelligence is enabled)');
    lines.push('- Update compositions.json constraints via edit_file when you find text fitting issues');
    lines.push('');

    return lines.join('\n');
}

export function generateCompositionsJson(
    analysis: TemplateAnalysis,
    templateSlug: string,
    multimodalResult?: MultimodalResult,
    scaffoldingMap?: Map<number, CompositionScaffolding>,
    multiFileData?: MultiFileArtifactData,
): CompositionsFile {
    const compositions = groupByComposition(analysis);
    const contentCompositions = compositions.filter(c => c.classification !== 'blank');

    const aliasMap: Map<string, AliasEntry> = multimodalResult && multimodalResult.aliases.size > 0
        ? multimodalResult.aliases
        : generateDeterministicAliases(analysis.slideCompositions);

    const reverseAliasMap = new Map<string, string>();
    for (const [alias, entry] of aliasMap) {
        reverseAliasMap.set(`${entry.slide}:${entry.shapeId}`, alias);
    }

    const aliasMapJson: Record<string, { slide: number; shape_id: string; original_name: string; purpose?: string }> = {};
    for (const [alias, entry] of aliasMap) {
        const purposeEntry = entry as { purpose?: string };
        aliasMapJson[alias] = {
            slide: entry.slide,
            shape_id: entry.shapeId,
            original_name: entry.originalName,
            ...(purposeEntry.purpose ? { purpose: purposeEntry.purpose } : {}),
        };
    }

    const EMU_TO_PX = 96 / 914400;
    const hasScaffolding = scaffoldingMap && scaffoldingMap.size > 0;
    const result: CompositionsFile = {
        schema_version: hasScaffolding ? 4 : 3,
        template: templateSlug,
        ...(multiFileData?.sourceFiles ? { source_files: multiFileData.sourceFiles } : {}),
        brand_dna: {
            colors: analysis.brandDNA.colors,
            fonts: analysis.brandDNA.fonts,
            slide_size_px: {
                w: Math.round(analysis.brandDNA.slideSize.cx * EMU_TO_PX),
                h: Math.round(analysis.brandDNA.slideSize.cy * EMU_TO_PX),
            },
            ...(analysis.dekoElements.length > 0 ? {
                slide_decorations: analysis.dekoElements.map(d => ({
                    id: d.id,
                    type: d.type,
                    position: d.position,
                    ...(d.shapeName ? { shape_name: d.shapeName } : {}),
                    ...(d.fillColor ? { fill_color: d.fillColor } : {}),
                    ...(d.rotation ? { rotation: d.rotation } : {}),
                    ...(d.imageData ? { image_path: `scaffold-images/${templateSlug}/${d.id}.png` } : {}),
                })),
            } : {}),
        },
        ...(multiFileData?.designRules ? { design_rules: multiFileData.designRules } : {}),
        ...(multiFileData?.iconCatalog?.length ? { icon_catalog: multiFileData.iconCatalog } : {}),
        ...(multiFileData?.usageGuidelines ? { usage_guidelines: multiFileData.usageGuidelines } : {}),
        alias_map: aliasMapJson,
        compositions: {},
    };

    const idMap = assignUniqueIds(contentCompositions);
    for (let i = 0; i < contentCompositions.length; i++) {
        const group = contentCompositions[i];
        const compId = idMap.get(i) ?? compositionId(group.classification);
        const shapes: Record<string, Record<string, import('./compositionsSchema').ShapeDetailEntry>> = {};

        for (const slideNum of group.slideNumbers) {
            const comp = analysis.slideCompositions.find(c => c.slideNumber === slideNum);
            if (!comp) continue;

            const replaceable = comp.shapes.filter(s => s.isReplaceable);
            if (replaceable.length === 0) continue;

            const slideShapes: Record<string, import('./compositionsSchema').ShapeDetailEntry> = {};
            for (const shape of replaceable) {
                const alias = reverseAliasMap.get(`${slideNum}:${shape.shapeId}`);
                const key = alias ?? shape.shapeName;
                const multimodalPurpose = alias
                    ? (aliasMap.get(alias) as { purpose?: string } | undefined)?.purpose
                    : undefined;

                const detail: import('./compositionsSchema').ShapeDetailEntry = {
                    zweck: multimodalPurpose || shape.placeholderType || shape.semanticId,
                    shape_id: shape.shapeId,
                    shape_type: shape.placeholderType === 'pic' ? 'image' : 'text',
                    ...(shape.fillColor ? { fill_color: shape.fillColor } : {}),
                };
                if (shape.textCapacity) {
                    detail.max_chars = shape.textCapacity.maxChars;
                    detail.font_size_pt = shape.textCapacity.fontSize;
                }

                if (!detail.max_chars) {
                    const widthPt = shape.position.width / 12700;
                    const heightPt = shape.position.height / 12700;
                    const defaultFontPt = 18;
                    const charsPerLine = Math.floor(widthPt / (defaultFontPt * 0.55));
                    const maxLines = Math.floor(heightPt / (defaultFontPt * 1.5));
                    if (charsPerLine > 0 && maxLines > 0) {
                        detail.max_chars = charsPerLine * maxLines;
                        detail.font_size_pt = defaultFontPt;
                    }
                }

                slideShapes[key] = detail;
            }

            shapes[String(slideNum)] = slideShapes;
        }

        const repeatableGroupsMap: Record<string, import('./compositionsSchema').RepeatableGroupEntry[]> = {};
        for (const slideNum of group.slideNumbers) {
            const comp = analysis.slideCompositions.find(c => c.slideNumber === slideNum);
            if (!comp || comp.repeatableGroups.length === 0) continue;
            repeatableGroupsMap[String(slideNum)] = comp.repeatableGroups.map(rg => ({
                groupId: rg.groupId,
                axis: rg.axis,
                shapeNames: rg.shapeNames,
                shapeIds: rg.shapeIds,
                boundingBox: rg.boundingBox,
                gap: rg.gap,
                shapeSize: rg.shapeSize,
                columns: rg.columns.map(col => ({
                    index: col.index,
                    primaryShape: col.primaryShape,
                    primaryShapeId: col.primaryShapeId,
                    associatedShapes: col.associatedShapes.map(as => ({
                        shapeName: as.shapeName,
                        shapeId: as.shapeId,
                        offsetY: as.offsetY,
                        offsetX: as.offsetX,
                    })),
                })),
            }));
        }

        const firstSlideStr = String(group.slideNumbers[0]);
        const multiMeta = multimodalResult?.compositionMeta.get(firstSlideStr);
        const slideWarnings = buildSlideWarnings(group, analysis);
        const narrativePhase = COMPOSITION_METADATA[group.classification as SlideClassification]?.narrativePhase ?? 'any';
        const scaffolding = scaffoldingMap?.get(i);

        result.compositions[compId] = {
            name: group.name,
            classification: group.classification,
            narrative_phase: narrativePhase,
            slides: group.slideNumbers,
            bedeutung: multiMeta?.bedeutung ?? group.meaning,
            einsetzen_wenn: multiMeta?.einsetzen_wenn ?? group.useWhen,
            nicht_einsetzen_wenn: multiMeta?.nicht_einsetzen_wenn ?? generateCompositionWarnings(group, analysis),
            has_image_placeholder: hasImagePlaceholder(group, analysis),
            decorative_element_count: group.decorativeElementCount,
            has_fixed_visuals: group.hasFixedVisuals,
            ...(group.staticChartCount > 0 ? { has_static_chart: true } : {}),
            ...(group.staticTableCount > 0 ? { has_static_table: true } : {}),
            ...(group.staticPictureCount > 0 ? { has_static_picture: true } : {}),
            visual_structure: multiMeta?.visual_description ?? buildVisualStructureDescription(group, analysis),
            ...(Object.keys(slideWarnings).length > 0 ? { slide_warnings: slideWarnings } : {}),
            ...(scaffolding ? {
                recommended_pipeline: scaffolding.recommended_pipeline,
                recommended_pipeline_reason: buildPipelineReason(group, scaffolding.recommended_pipeline),
                supports_html_overlay: true,
                scaffold_elements: scaffolding.scaffold_elements.map(d => ({
                    id: d.id,
                    type: d.type,
                    position: d.position,
                    ...(d.shapeName ? { shape_name: d.shapeName } : {}),
                    ...(d.fillColor ? { fill_color: d.fillColor } : {}),
                    ...(d.rotation ? { rotation: d.rotation } : {}),
                    ...(d.imageData ? { image_path: `scaffold-images/${templateSlug}/${i}/${d.id}.png` } : {}),
                })),
                content_area: scaffolding.content_area,
                style_guide: scaffolding.style_guide,
                layout_hint: scaffolding.layout_hint,
                ...(scaffolding.html_skeleton ? { html_skeleton: scaffolding.html_skeleton } : {}),
            } : {}),
            repeatable_groups: repeatableGroupsMap,
            shapes,
        };
    }

    return result;
}

function generateCompositionWarnings(
    group: ReturnType<typeof groupByComposition>[number],
    analysis: TemplateAnalysis,
): string {
    const warnings: string[] = [];

    if (group.staticChartCount > 0 || group.classification === 'chart') {
        warnings.push('Contains embedded chart objects with STATIC template data -- avoid text-only clone; rebuild in HTML or only use when the chart type truly matches');
    }
    if (group.staticTableCount > 0 || group.classification === 'table') {
        warnings.push('Contains embedded table objects with static template content -- only use when the table structure and data match');
    }
    if (group.classification === 'section') {
        warnings.push('Section divider -- only short titles (max 1 line)');
    }

    const hasImagePh = group.slideNumbers.some(slideNum => {
        const comp = analysis.slideCompositions.find(c => c.slideNumber === slideNum);
        return comp?.shapes.some(s => s.placeholderType === 'pic') ?? false;
    });
    if (hasImagePh) warnings.push('Contains image placeholder -- only use when images are available');
    if (group.hasFixedVisuals) {
        warnings.push(`Has ${group.decorativeElementCount} fixed decorative elements (icons/images); only use this composition when those visuals semantically fit your story`);
    }

    return warnings.join('; ');
}

function buildPipelineReason(
    group: ReturnType<typeof groupByComposition>[number],
    pipeline: 'clone' | 'html',
): string {
    if (group.classification === 'title' || group.classification === 'section') {
        return 'Structural corporate slide: cloning preserves the exact master layout and typography.';
    }
    if (group.staticChartCount > 0 || group.classification === 'chart') {
        return 'The template contains static embedded charts, so the content should be rebuilt in HTML while keeping the corporate scaffold.';
    }
    if (group.staticTableCount > 0 || group.classification === 'table') {
        return 'The template contains static embedded tables, so HTML is safer than cloning stale table content.';
    }
    if (pipeline === 'html') {
        return 'This composition works best as scaffold + HTML overlay: keep the corporate chrome, but treat the sample layout as a reference and build the best-fitting branded visual inside the content area.';
    }
    return 'This composition carries meaning in the template shapes themselves, so clone mode preserves the intended geometry, styling, and alignment.';
}

function buildSlideWarnings(
    group: ReturnType<typeof groupByComposition>[number],
    analysis: TemplateAnalysis,
): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const slideNum of group.slideNumbers) {
        const comp = analysis.slideCompositions.find(c => c.slideNumber === slideNum);
        if (!comp) continue;

        const warnings: string[] = [];
        if (comp.embeddedObjects.charts > 0) warnings.push(`Contains ${comp.embeddedObjects.charts} embedded chart object(s) with static template data`);
        if (comp.embeddedObjects.tables > 0) warnings.push(`Contains ${comp.embeddedObjects.tables} embedded table object(s) with static template content`);
        if (comp.embeddedObjects.pictures > 0) warnings.push(`Contains ${comp.embeddedObjects.pictures} fixed picture/icon object(s)`);
        if (comp.embeddedObjects.graphics > 0) warnings.push(`Contains ${comp.embeddedObjects.graphics} additional graphic frame object(s)`);

        if (warnings.length > 0) result[String(slideNum)] = warnings;
    }
    return result;
}

function buildVisualStructureDescription(
    group: ReturnType<typeof groupByComposition>[number],
    analysis: TemplateAnalysis,
): string {
    const firstSlideNum = group.slideNumbers[0];
    const comp = analysis.slideCompositions.find(c => c.slideNumber === firstSlideNum);
    if (!comp) return '';

    const replaceable = comp.shapes.filter(s => s.isReplaceable);
    if (replaceable.length === 0) return '';

    const byPrefix = new Map<string, number>();
    for (const shape of replaceable) {
        const prefix = shape.shapeName.replace(/\s*\d+$/, '') || shape.shapeName;
        byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + 1);
    }

    return [...byPrefix].map(([p, c]) => c > 1 ? `${c}x ${p}` : p).join(' + ');
}

function hasImagePlaceholder(
    group: ReturnType<typeof groupByComposition>[number],
    analysis: TemplateAnalysis,
): boolean {
    return group.slideNumbers.some(slideNum => {
        const comp = analysis.slideCompositions.find(c => c.slideNumber === slideNum);
        return comp?.shapes.some(s => s.placeholderType === 'pic') ?? false;
    });
}

function compositionId(classification: string): string {
    return classification.replace(/\s+/g, '-').toLowerCase();
}

function assignUniqueIds(groups: ReturnType<typeof groupByComposition>): Map<number, string> {
    const idMap = new Map<number, string>();
    const usedIds = new Set<string>();

    for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        let compId = compositionId(group.classification);

        if (usedIds.has(compId)) {
            const suffix = group.name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 30);
            compId = suffix ? `${compId}-${suffix}` : `${compId}-${i}`;
        }

        let finalId = compId;
        let counter = 2;
        while (usedIds.has(finalId)) {
            finalId = `${compId}-${counter}`;
            counter++;
        }

        usedIds.add(finalId);
        idMap.set(i, finalId);
    }

    return idMap;
}

export function deriveNameFromPath(path: string): string {
    const filename = path.split('/').pop() ?? path;
    return filename.replace(/\.(pptx|potx)$/i, '').replace(/[_-]+/g, ' ').trim();
}

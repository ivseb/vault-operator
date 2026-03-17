/**
 * AnalyzePptxTemplateTool — Template Analysis (FEATURE-1115)
 *
 * Analyzes a PPTX template and generates two output files:
 * 1. SKILL.md (~5k chars): Compact Visual Design Language Document for skill import
 * 2. compositions.json: Full shape details loaded on-demand via get_composition_details
 *
 * The agent enriches both files during visual PDF analysis (separate step).
 */

import { TFile } from 'obsidian';
import * as path from 'path';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type { ToolResultContentBlock } from '../../../api/types';
import type ObsidianAgentPlugin from '../../../main';
import { analyzeTemplate, groupByComposition, COMPOSITION_METADATA, generateDeterministicAliases } from '../../office/PptxTemplateAnalyzer';
import type { TemplateAnalysis, SlideClassification, RepeatableGroup, AliasEntry } from '../../office/PptxTemplateAnalyzer';
import { renderPptxToImages } from '../../office/pptxRenderer';
import { analyzeTemplateMultimodal } from '../../office/MultimodalAnalyzer';
import type { MultimodalResult, CompositionVisualMeta } from '../../office/MultimodalAnalyzer';
import { buildApiHandler } from '../../../api/index';
import { modelToLLMProvider } from '../../../types/settings';

export class AnalyzePptxTemplateTool extends BaseTool<'analyze_pptx_template'> {
    readonly name = 'analyze_pptx_template' as const;
    readonly isWriteOperation = true;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'analyze_pptx_template',
            description:
                'Analyze a PPTX template to extract its design structure, brand DNA (colors, fonts), and slide compositions. ' +
                'Generates a compact Template Skill (SKILL.md) and a detailed compositions.json file. ' +
                'After running this tool, visually inspect the template PDF to enrich the compositions ' +
                'with semantic meaning, usage rules, and text constraints.',
            input_schema: {
                type: 'object',
                properties: {
                    template_path: {
                        type: 'string',
                        description: 'Vault path to the .pptx template file to analyze.',
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
        const { callbacks } = context;
        const templatePath = ((input.template_path as string) ?? '').trim();

        if (!templatePath) {
            callbacks.pushToolResult('Error: template_path is required.');
            return;
        }

        if (!templatePath.endsWith('.pptx') && !templatePath.endsWith('.potx')) {
            callbacks.pushToolResult('Error: template_path must point to a .pptx or .potx file.');
            return;
        }

        try {
            const vault = this.plugin.app.vault;
            const file = vault.getAbstractFileByPath(templatePath);
            if (!(file instanceof TFile)) {
                callbacks.pushToolResult(`Error: File not found: ${templatePath}`);
                return;
            }

            const templateData = await vault.readBinary(file);
            const analysis = await analyzeTemplate(templateData);
            const templateName = deriveNameFromPath(templatePath);
            const templateSlug = templateName.toLowerCase().replace(/\s+/g, '-');

            // Render ALL slides for multimodal analysis (no cap)
            const allSlidesResult = await this.renderTemplateSlides(templatePath, { maxSlides: 999 });

            // Capped set for agent display (max 20 to avoid context bloat)
            const displayResult = {
                ...allSlidesResult,
                slides: allSlidesResult.slides.slice(0, 20),
            };

            // Multimodal analysis: if approved and slides rendered, use Claude Vision
            let multimodalResult: MultimodalResult | undefined;
            const viSettings = this.plugin.settings.visualIntelligence;
            const multimodalApproved = viSettings?.multimodalAnalysisApproved ?? false;
            const viEnabled = viSettings?.enabled ?? false;

            const skipMultimodal = (input.skip_multimodal as boolean) ?? false;

            // Early return: when multimodal could run but is not enabled, ask the user FIRST
            // Do NOT generate files or show slides -- force the agent to handle the question before proceeding
            if (!multimodalApproved && !skipMultimodal && allSlidesResult.success && allSlidesResult.slides.length > 0) {
                const batchCount = Math.ceil(allSlidesResult.slides.length / 5);
                const costEstimate = `${allSlidesResult.slides.length} Folien werden in ~${batchCount} Batches analysiert (ca. ${batchCount * 5}-${batchCount * 10}K Token).`;

                const hint = !viEnabled
                    ? 'STOP -- Multimodale Template-Analyse ist verfuegbar aber deaktiviert.\n\n' +
                      'LibreOffice hat erfolgreich ' + allSlidesResult.slides.length + ' von ' + allSlidesResult.totalSlides + ' Folien gerendert. ' +
                      'Die multimodale Analyse nutzt Claude Vision, um diese Folienbilder visuell zu analysieren und generiert ' +
                      'semantische Shape-Aliase, Nutzungsregeln und Kapazitaetslimits -- deutlich bessere Ergebnisse ' +
                      'als deterministische Aliase.\n\n' +
                      costEstimate + '\n\n' +
                      'AKTION ERFORDERLICH: Frage den Nutzer, ob er die multimodale Analyse aktivieren moechte.\n' +
                      'Wenn ja: nutze `update_settings` mit path "visualIntelligence.enabled" = true UND ' +
                      '"visualIntelligence.multimodalAnalysisApproved" = true, dann rufe `analyze_pptx_template` erneut auf.\n' +
                      'Wenn nein: rufe `analyze_pptx_template` erneut auf mit `skip_multimodal: true` -- generiert deterministische Aliase.'
                    : 'STOP -- Multimodale Template-Analyse ist verfuegbar aber nicht freigegeben.\n\n' +
                      'Visual Intelligence ist aktiviert und LibreOffice hat ' + allSlidesResult.slides.length + ' Folien gerendert. ' +
                      'Die multimodale Analyse (Claude Vision) ist jedoch nicht freigegeben.\n' +
                      costEstimate + '\n\n' +
                      'AKTION ERFORDERLICH: Frage den Nutzer, ob er die multimodale Analyse aktivieren moechte.\n' +
                      'Wenn ja: nutze `update_settings` mit path "visualIntelligence.multimodalAnalysisApproved" = true, ' +
                      'dann rufe `analyze_pptx_template` erneut auf.\n' +
                      'Wenn nein: rufe `analyze_pptx_template` erneut auf mit `skip_multimodal: true` -- generiert deterministische Aliase.';
                callbacks.pushToolResult(hint);
                return; // Do NOT continue -- no files generated, no slides shown
            }

            if (multimodalApproved && allSlidesResult.success && allSlidesResult.slides.length > 0) {
                try {
                    const activeModel = this.plugin.getActiveModel();
                    if (activeModel) {
                        const apiHandler = buildApiHandler(modelToLLMProvider(activeModel));
                        callbacks.pushToolResult(`Starting multimodal analysis of ${allSlidesResult.slides.length} slides (all ${allSlidesResult.totalSlides} rendered)...`);

                        multimodalResult = await analyzeTemplateMultimodal(
                            allSlidesResult.slides,
                            analysis.slideCompositions,
                            apiHandler,
                            (msg) => {
                                console.debug('[MultimodalAnalyzer]', msg);
                                callbacks.pushToolResult(msg);
                            },
                        );

                        console.debug(
                            `[MultimodalAnalyzer] Complete: ${multimodalResult.aliases.size} aliases, ` +
                            `${multimodalResult.compositionMeta.size} composition descriptions`,
                        );
                    }
                } catch (err) {
                    console.warn('[AnalyzePptxTemplateTool] Multimodal analysis failed, using deterministic aliases:', err);
                    // Fall through to deterministic aliases
                }
            }

            // Generate both output files (with multimodal data if available)
            const skillContent = generateSkillMd(analysis, templatePath, templateName, templateSlug);
            const compositionsContent = generateCompositionsJson(analysis, templateSlug, multimodalResult);

            // Write SKILL.md to plugin skills directory (where SelfAuthoredSkillLoader reads from)
            const pluginSkillsDir = `${vault.configDir}/plugins/${this.plugin.manifest.id}/skills/${templateSlug}`;
            const skillPath = `${pluginSkillsDir}/SKILL.md`;
            await this.ensureFolder(pluginSkillsDir);
            await this.safeWrite(skillPath, skillContent);

            // Write compositions.json
            const compositionsDir = '.obsilo/templates';
            const compositionsPath = `${compositionsDir}/${templateSlug}.compositions.json`;
            await this.ensureFolder(compositionsDir);
            const compositionsStr = JSON.stringify(compositionsContent, null, 2);
            await this.safeWrite(compositionsPath, compositionsStr);

            // Return summary
            const compositions = groupByComposition(analysis);
            const contentComps = compositions.filter(c => c.classification !== 'blank');

            // Trigger skill reload so the new skill is immediately available
            if (this.plugin.selfAuthoredSkillLoader) {
                await this.plugin.selfAuthoredSkillLoader.loadAll();
            }

            // Build summary text
            const analysisMode = multimodalResult
                ? `Multimodal analysis (${multimodalResult.aliases.size} semantic aliases generated)`
                : 'Deterministic aliases (multimodal analysis not available)';
            const summaryText =
                `Template analysis complete: ${templateName}\n\n` +
                `- ${analysis.slideCount} slides analyzed\n` +
                `- ${contentComps.length} composition types identified\n` +
                `- Brand DNA: ${analysis.brandDNA.fonts.major} / ${analysis.brandDNA.fonts.minor}\n` +
                `- Analysis mode: ${analysisMode}\n\n` +
                `Generated files:\n` +
                `1. **SKILL.md** (${skillContent.length} chars): ${skillPath} (auto-installed as user skill)\n` +
                `2. **compositions.json** (v2): ${compositionsPath}\n\n`;

            if (displayResult.success && displayResult.slides.length > 0) {
                // Multimodal result: text + slide images
                const multimodalStats = multimodalResult
                    ? `Rendered ${allSlidesResult.slides.length} of ${allSlidesResult.totalSlides} slides for multimodal analysis.\n` +
                      `Displaying ${displayResult.slides.length} of ${allSlidesResult.slides.length} slides below for visual reference.\n\n`
                    : `Rendered ${displayResult.slides.length} of ${allSlidesResult.totalSlides} slides.\n\n`;

                const nextStep = multimodalResult
                    ? `Multimodal analysis completed successfully. Compositions are enriched with semantic aliases and visual descriptions.\n` +
                      `You can now proceed to create presentations using these compositions.\n` +
                      `Use \`get_composition_details\` to see the semantic shape aliases for each composition.`
                    : `NEXT STEP (mandatory -- do NOT skip):\n` +
                      `Visually inspect each slide image below. Then update compositions.json via edit_file with:\n` +
                      `- bedeutung (semantic meaning of each composition)\n` +
                      `- einsetzen_wenn / nicht_einsetzen_wenn (usage rules)\n` +
                      `- max_chars per shape (estimated from visual layout)\n` +
                      `Do NOT proceed to presentation creation without visual analysis.`;

                const contentBlocks: ToolResultContentBlock[] = [
                    {
                        type: 'text',
                        text: summaryText + multimodalStats + nextStep,
                    },
                ];

                for (const slide of displayResult.slides) {
                    contentBlocks.push(
                        { type: 'text', text: `\n--- Slide ${slide.slideNumber} ---` },
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: 'image/png',
                                data: slide.base64,
                            },
                        },
                    );
                }

                callbacks.pushToolResult(contentBlocks);
            } else {
                // Text-only fallback with rendering warning
                const renderWarning = allSlidesResult.error
                    ? `Visual rendering unavailable: ${allSlidesResult.error}\n\n`
                    : 'Visual rendering unavailable.\n\n';

                callbacks.pushToolResult(
                    summaryText + renderWarning +
                    `NEXT STEP (mandatory -- do NOT skip):\n` +
                    `Visual rendering failed. Either:\n` +
                    `1. Fix the issue (install LibreOffice + poppler-utils) and call render_presentation manually\n` +
                    `2. Ask the user to provide a PDF export of the template\n\n` +
                    `After visual inspection, update compositions.json via edit_file with:\n` +
                    `- bedeutung (semantic meaning of each composition)\n` +
                    `- einsetzen_wenn / nicht_einsetzen_wenn (usage rules)\n` +
                    `- max_chars per shape (estimated from visual layout)\n` +
                    `Do NOT proceed to presentation creation without visual analysis.`,
                );
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error('[AnalyzePptxTemplateTool]', msg);
            callbacks.pushToolResult(`Error: ${msg}`);
        }
    }

    /**
     * Write a file using vault.adapter.write() which works regardless of
     * whether the file exists in Obsidian's metadata cache.
     * vault.create() throws "File already exists" when the file is on disk
     * but not in cache (stale state after previous runs). adapter.write()
     * bypasses the cache check entirely.
     */
    private async safeWrite(filePath: string, content: string): Promise<void> {
        await this.plugin.app.vault.adapter.write(filePath, content);
    }

    /**
     * Render template slides via LibreOffice + PDF-to-PNG pipeline.
     * Best-effort: returns empty result on failure instead of throwing.
     */
    private async renderTemplateSlides(
        templatePath: string,
        options?: { maxSlides?: number },
    ): Promise<{ success: boolean; slides: { slideNumber: number; base64: string }[]; totalSlides: number; error?: string }> {
        try {
            const adapter = this.plugin.app.vault.adapter;
            // eslint-disable-next-line -- need FileSystemAdapter for basePath
            const vaultRoot: string = (adapter as import('obsidian').FileSystemAdapter).basePath
                ?? (adapter as import('obsidian').FileSystemAdapter).getBasePath?.() ?? '';
            if (!vaultRoot) {
                return { success: false, slides: [], totalSlides: 0, error: 'Cannot determine vault root path' };
            }

            const absolutePptxPath = path.join(vaultRoot, templatePath);
            const customPath = this.plugin.settings.visualIntelligence?.libreOfficePath;

            return await renderPptxToImages(absolutePptxPath, {
                customLibreOfficePath: customPath,
                maxSlides: options?.maxSlides ?? 20,
            });
        } catch (err) {
            return {
                success: false,
                slides: [],
                totalSlides: 0,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }

    private async ensureFolder(folderPath: string): Promise<void> {
        // Use adapter.mkdir() which works at filesystem level,
        // independent of Obsidian's metadata cache.
        // This is essential for paths under .obsidian/ (configDir)
        // which are not indexed by the vault.
        await this.plugin.app.vault.adapter.mkdir(folderPath);
    }
}

/* ------------------------------------------------------------------ */
/*  SKILL.md generation (compact, <16k chars)                          */
/* ------------------------------------------------------------------ */

function generateSkillMd(
    analysis: TemplateAnalysis,
    templatePath: string,
    templateName: string,
    templateSlug: string,
): string {
    const compositions = groupByComposition(analysis);
    const contentCompositions = compositions.filter(c => c.classification !== 'blank');
    const lines: string[] = [];

    // YAML frontmatter
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

    // Brand DNA (compact)
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

    // Composition index (compact: name + slides + one-liner)
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
        let compLine = `- **${group.name}** (ID: \`${compId}\`, Slides ${numsStr}): ${group.meaning}`;
        const warning = generateCompositionWarnings(group, analysis);
        if (warning) compLine += ` -- WARNING: ${warning}`;
        lines.push(compLine);
    }
    lines.push('');

    // Narrative phase mapping
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

    // Design rules
    lines.push('## Design Rules');
    lines.push('');
    lines.push('### Critical Rules');
    lines.push(`- Template file: \`${templatePath}\``);
    lines.push('- **Template mode** (`template_slide` + `content`): For text replacement in existing shapes. Pixel-perfect corporate design.');
    lines.push('- **HTML mode** (`html` + `template_file`): For creative layouts with Brand-DNA colors/fonts. Deko elements (logo, accent bars) are auto-injected -- do NOT place them manually.');
    lines.push('- Choose mode per slide: title/section dividers -> Template. KPI/charts/creative -> HTML.');
    lines.push('- **Fill EVERY shape** (Template mode): When `get_composition_details` lists N shapes, your `content` object MUST have N keys. Unfilled shapes are CLEARED by the cloner and appear as blank empty areas.');
    lines.push('- **Transform content**: NEVER copy source text verbatim. Restructure: paragraphs -> bullets (max 8 words), numbers -> KPIs, sequences -> process labels (1-3 words per step).');
    lines.push('- **Action titles**: Every title is an ASSERTION ("17% faster through automation"), not a topic ("Technical Solution").');
    lines.push('- Shape names in `content` must match exactly (case-sensitive) from `get_composition_details`');
    lines.push('');
    lines.push('### Composition Selection');
    lines.push('- Match composition to content type: numbers -> KPI, sequence -> process, comparison -> two-column/matrix');
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

/* ------------------------------------------------------------------ */
/*  compositions.json generation (detailed)                            */
/* ------------------------------------------------------------------ */

interface CompositionsFile {
    schema_version: number;
    template: string;
    /** Brand colors, fonts, slide dimensions, and decorative elements for HTML generation */
    brand_dna?: {
        colors: Record<string, string>;
        fonts: { major: string; minor: string };
        slide_size_px: { w: number; h: number };
        slide_decorations?: Array<{
            id: string;
            type: 'image' | 'shape';
            position: { x: number; y: number; w: number; h: number };
            shape_name?: string;
            fill_color?: string;
            rotation?: number;
            image_data?: string;
        }>;
    };
    /** Global alias-to-shape mapping. Each alias is unique across the template. */
    alias_map: Record<string, { slide: number; shape_id: string; original_name: string }>;
    compositions: Record<string, CompositionEntry>;
}

interface CompositionEntry {
    name: string;
    classification: string;
    narrative_phase: string;
    slides: number[];
    bedeutung: string;
    einsetzen_wenn: string;
    nicht_einsetzen_wenn: string;
    has_image_placeholder: boolean;
    decorative_element_count: number;
    has_fixed_visuals: boolean;
    visual_structure: string;
    repeatable_groups: Record<string, RepeatableGroupEntry[]>;
    shapes: Record<string, Record<string, ShapeDetailEntry>>;
}

interface RepeatableGroupEntry {
    groupId: string;
    axis: 'horizontal' | 'vertical';
    shapeNames: string[];
    shapeIds?: string[];
    boundingBox: { left: number; top: number; width: number; height: number };
    gap: number;
    shapeSize: { cx: number; cy: number };
    columns: Array<{
        index: number;
        primaryShape: string;
        primaryShapeId?: string;
        associatedShapes: Array<{ shapeName: string; shapeId?: string; offsetY: number; offsetX: number }>;
    }>;
}

interface ShapeDetailEntry {
    zweck: string;
    shape_id: string;
    shape_type?: 'image' | 'text';
    fill_color?: string;
    max_chars?: number;
    font_size_pt?: number;
}

function generateCompositionsJson(
    analysis: TemplateAnalysis,
    templateSlug: string,
    multimodalResult?: MultimodalResult,
): CompositionsFile {
    const compositions = groupByComposition(analysis);
    const contentCompositions = compositions.filter(c => c.classification !== 'blank');

    // Use multimodal aliases if available, otherwise fall back to deterministic
    let aliasMap: Map<string, AliasEntry>;
    if (multimodalResult && multimodalResult.aliases.size > 0) {
        aliasMap = multimodalResult.aliases;
    } else {
        aliasMap = generateDeterministicAliases(analysis.slideCompositions);
    }

    // Build reverse lookup: (slide, shapeId) -> alias
    const reverseAliasMap = new Map<string, string>();
    for (const [alias, entry] of aliasMap) {
        reverseAliasMap.set(`${entry.slide}:${entry.shapeId}`, alias);
    }

    // Build alias_map for JSON output (include purpose from multimodal analysis if available)
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

    // Convert EMU to px for canvas-relative positioning
    const EMU_TO_PX = 96 / 914400;
    const result: CompositionsFile = {
        schema_version: 3,
        template: templateSlug,
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
                    ...(d.imageData ? { image_data: d.imageData } : {}),
                })),
            } : {}),
        },
        alias_map: aliasMapJson,
        compositions: {},
    };

    const idMap = assignUniqueIds(contentCompositions);
    for (let i = 0; i < contentCompositions.length; i++) {
        const group = contentCompositions[i];
        const compId = idMap.get(i) ?? compositionId(group.classification);
        const shapes: Record<string, Record<string, ShapeDetailEntry>> = {};

        for (const slideNum of group.slideNumbers) {
            const comp = analysis.slideCompositions.find(c => c.slideNumber === slideNum);
            if (!comp) continue;

            const replaceable = comp.shapes.filter(s => s.isReplaceable);
            if (replaceable.length === 0) continue;

            const slideShapes: Record<string, ShapeDetailEntry> = {};
            for (const shape of replaceable) {
                // Use alias as key if available, otherwise fall back to shape name
                const alias = reverseAliasMap.get(`${slideNum}:${shape.shapeId}`);
                const key = alias ?? shape.shapeName;

                // Use multimodal purpose (semantic, from Claude Vision) if available,
                // otherwise fall back to generic placeholderType / semanticId
                const multimodalPurpose = alias
                    ? (aliasMap.get(alias) as { purpose?: string } | undefined)?.purpose
                    : undefined;

                const detail: ShapeDetailEntry = {
                    zweck: multimodalPurpose || shape.placeholderType || shape.semanticId,
                    shape_id: shape.shapeId,
                    shape_type: shape.placeholderType === 'pic' ? 'image' : 'text',
                    ...(shape.fillColor ? { fill_color: shape.fillColor } : {}),
                };
                if (shape.textCapacity) {
                    detail.max_chars = shape.textCapacity.maxChars;
                    detail.font_size_pt = shape.textCapacity.fontSize;
                }

                // Dimensions-based fallback for replaceable shapes without textCapacity
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

        // Collect repeatable groups per slide (with shapeIds)
        const repeatableGroupsMap: Record<string, RepeatableGroupEntry[]> = {};
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

        // Enrich with multimodal metadata if available (use first slide as representative)
        const firstSlideStr = String(group.slideNumbers[0]);
        const multiMeta = multimodalResult?.compositionMeta.get(firstSlideStr);

        const narrativePhase = COMPOSITION_METADATA[group.classification as SlideClassification]?.narrativePhase ?? 'any';

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
            visual_structure: multiMeta?.visual_description ?? buildVisualStructureDescription(group, analysis),
            repeatable_groups: repeatableGroupsMap,
            shapes,
        };
    }

    return result;
}

/**
 * Generate automatic warnings for a composition based on its classification and shapes.
 */
function generateCompositionWarnings(
    group: ReturnType<typeof groupByComposition>[number],
    analysis: TemplateAnalysis,
): string {
    const warnings: string[] = [];

    if (group.classification === 'chart') {
        warnings.push('Contains static embedded chart -- only use when data matches chart type');
    }

    if (group.classification === 'section') {
        warnings.push('Section divider -- only short titles (max 1 line)');
    }

    // Check if any slide in this group has image placeholders
    const hasImagePh = group.slideNumbers.some(slideNum => {
        const comp = analysis.slideCompositions.find(c => c.slideNumber === slideNum);
        return comp?.shapes.some(s => s.placeholderType === 'pic') ?? false;
    });

    if (hasImagePh) {
        warnings.push('Contains image placeholder -- only use when images are available');
    }

    if (group.hasFixedVisuals) {
        warnings.push(`Has ${group.decorativeElementCount} fixed decorative elements (icons/images) that cannot be replaced`);
    }

    return warnings.join('; ');
}

/**
 * Build a human-readable description of the visual structure of a composition.
 * E.g. "3x TextBox + 2x Inhaltsplatzhalter + Titel" or "5 chevron shapes + 5 description boxes".
 */
function buildVisualStructureDescription(
    group: ReturnType<typeof groupByComposition>[number],
    analysis: TemplateAnalysis,
): string {
    // Use first slide as representative
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

    return [...byPrefix]
        .map(([p, c]) => c > 1 ? `${c}x ${p}` : p)
        .join(' + ');
}

/**
 * Check if any slide in a composition group has image placeholders.
 */
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

/**
 * Assign unique IDs to composition groups.
 * For non-content groups: uses classification as ID (e.g., "title", "kpi").
 * For content sub-groups: appends a name-derived suffix to avoid collisions.
 */
function assignUniqueIds(groups: ReturnType<typeof groupByComposition>): Map<number, string> {
    const idMap = new Map<number, string>(); // group index → unique ID
    const usedIds = new Set<string>();

    for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        let compId = compositionId(group.classification);

        // If this ID is already taken (multiple content sub-groups), make it unique
        if (usedIds.has(compId)) {
            const suffix = group.name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 30);
            compId = suffix ? `${compId}-${suffix}` : `${compId}-${i}`;
        }

        // Handle edge case: still not unique
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

function deriveNameFromPath(path: string): string {
    const filename = path.split('/').pop() ?? path;
    return filename.replace(/\.(pptx|potx)$/i, '').replace(/[_-]+/g, ' ').trim();
}

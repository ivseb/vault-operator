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
import JSZip from 'jszip';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type { ToolResultContentBlock } from '../../../api/types';
import type ObsidianAgentPlugin from '../../../main';
import { analyzeTemplate, groupByComposition, COMPOSITION_METADATA, generateDeterministicAliases, extractCompositionScaffolding } from '../../office/PptxTemplateAnalyzer';
import type { TemplateAnalysis, SlideClassification, RepeatableGroup, AliasEntry, CompositionScaffolding } from '../../office/PptxTemplateAnalyzer';
import { renderPptxToImages } from '../../office/pptxRenderer';
import { analyzeTemplateMultimodal, detectDocumentRole, extractDesignRules, extractIconCatalog, extractUsageGuidelines, generateVisionSkeletons } from '../../office/MultimodalAnalyzer';
import type { MultimodalResult, CompositionVisualMeta, DesignRules, IconEntry, UsageGuidelines, DocumentRole, VisionSkeletonInput } from '../../office/MultimodalAnalyzer';
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
                'Generates a Template Skill (SKILL.md) and a detailed compositions.json with semantic shape aliases. ' +
                'Uses LibreOffice to render slides and Claude Vision for multimodal analysis. ' +
                'THIS IS THE ONLY WAY to create template skills -- never use manage_skill for templates.',
            input_schema: {
                type: 'object',
                properties: {
                    template_path: {
                        type: 'string',
                        description: 'Vault path to the main .pptx/.potx template file to analyze.',
                    },
                    additional_files: {
                        type: 'array',
                        description: 'Additional PPTX/POTX files that are part of the corporate design system ' +
                            '(Style Guide, Icon Gallery, How-to-Use). The tool auto-detects each file\'s role via multimodal analysis, ' +
                            'or you can specify the role explicitly.',
                        items: {
                            type: 'object',
                            properties: {
                                path: {
                                    type: 'string',
                                    description: 'Vault path to the additional .pptx/.potx file.',
                                },
                                role: {
                                    type: 'string',
                                    enum: ['styleguide', 'icons', 'howto', 'main'],
                                    description: 'Role of this file. If omitted, auto-detected via multimodal analysis.',
                                },
                            },
                            required: ['path'],
                        },
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

            // Parse additional_files input
            const additionalFilesInput = (input.additional_files as Array<{ path: string; role?: string }>) ?? [];

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

            // Extract per-composition scaffolding (Gerüst vs Content classification)
            const compositions = groupByComposition(analysis);
            const contentCompositions = compositions.filter(c => c.classification !== 'blank');
            let scaffoldingMap: Map<number, CompositionScaffolding> | undefined;
            try {
                // Load zip separately for scaffold image extraction
                const zip = await JSZip.loadAsync(templateData);
                scaffoldingMap = await extractCompositionScaffolding(
                    analysis,
                    contentCompositions,
                    analysis.allShapesBySlide,
                    zip,
                );
                console.debug(`[AnalyzePptxTemplateTool] Scaffolding extracted for ${scaffoldingMap.size} compositions`);
            } catch (err) {
                console.warn('[AnalyzePptxTemplateTool] Scaffolding extraction failed:', err);
                // Non-fatal: continue without scaffolding
            }

            // Generate vision-based HTML skeletons (replaces deterministic ones)
            if (scaffoldingMap && multimodalApproved && allSlidesResult.success && allSlidesResult.slides.length > 0) {
                try {
                    const activeModel = this.plugin.getActiveModel();
                    if (activeModel) {
                        const apiHandler = buildApiHandler(modelToLLMProvider(activeModel));
                        const skeletonInputs: VisionSkeletonInput[] = [];

                        for (let i = 0; i < contentCompositions.length; i++) {
                            const group = contentCompositions[i];
                            const scaffolding = scaffoldingMap.get(i);
                            if (!scaffolding || scaffolding.recommended_pipeline !== 'html') continue;
                            skeletonInputs.push({
                                compositionId: String(i),
                                representativeSlide: group.slideNumbers[0],
                                contentArea: scaffolding.content_area,
                                styleGuide: scaffolding.style_guide,
                                recommendedPipeline: 'html',
                            });
                        }

                        if (skeletonInputs.length > 0) {
                            callbacks.pushToolResult(`Generating vision-based HTML skeletons for ${skeletonInputs.length} compositions...`);
                            const visionSkeletons = await generateVisionSkeletons(
                                allSlidesResult.slides,
                                skeletonInputs,
                                apiHandler,
                                (msg) => {
                                    console.debug('[MultimodalAnalyzer]', msg);
                                    callbacks.pushToolResult(msg);
                                },
                            );

                            // Overwrite deterministic skeletons with vision-based ones
                            for (const [idxStr, html] of visionSkeletons) {
                                const idx = parseInt(idxStr);
                                const scaffolding = scaffoldingMap.get(idx);
                                if (scaffolding) {
                                    scaffolding.html_skeleton = html;
                                }
                            }
                            console.debug(`[AnalyzePptxTemplateTool] ${visionSkeletons.size} vision-based skeletons generated`);
                        }
                    }
                } catch (err) {
                    console.warn('[AnalyzePptxTemplateTool] Vision skeleton generation failed:', err);
                    // Non-fatal: keep deterministic skeletons
                }
            }

            // Process additional files (Style Guide, Icon Gallery, How-to-Use)
            let multiFileData: {
                sourceFiles?: Array<{ path: string; role: string; slide_count: number }>;
                designRules?: DesignRules;
                iconCatalog?: IconEntry[];
                usageGuidelines?: UsageGuidelines;
            } | undefined;

            if (additionalFilesInput.length > 0 && multimodalApproved) {
                multiFileData = await this.processAdditionalFiles(
                    additionalFilesInput, analysis, templatePath, callbacks,
                );
            }

            // Generate both output files (with multimodal data, scaffolding, and multi-file data)
            const skillContent = generateSkillMd(
                analysis, templatePath, templateName, templateSlug, scaffoldingMap, multiFileData,
            );
            const compositionsContent = generateCompositionsJson(
                analysis, templateSlug, multimodalResult, scaffoldingMap, multiFileData,
            );

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

            // Write scaffold images as separate files (keeps compositions.json lean)
            let scaffoldImageCount = 0;
            const adapter = this.plugin.app.vault.adapter;
            const scaffoldImgDir = `${compositionsDir}/scaffold-images/${templateSlug}`;

            // Collect all DekoElements with imageData (global + per-composition)
            // Global deko elements go into the base scaffold-images dir
            const globalImages: Array<{ id: string; imageData: string }> = [];
            for (const d of analysis.dekoElements) {
                if (d.imageData) globalImages.push({ id: d.id, imageData: d.imageData });
            }
            // Per-composition scaffold elements go into index-based subdirs to avoid ID collisions
            const perCompImages: Array<{ compIndex: number; id: string; imageData: string }> = [];
            if (scaffoldingMap) {
                for (const [compIndex, scaffolding] of scaffoldingMap) {
                    for (const elem of scaffolding.scaffold_elements) {
                        if (elem.imageData) perCompImages.push({ compIndex, id: elem.id, imageData: elem.imageData });
                    }
                }
            }

            if (globalImages.length > 0 || perCompImages.length > 0) {
                await this.ensureFolder(scaffoldImgDir);
                for (const img of globalImages) {
                    const base64 = img.imageData.replace(/^data:image\/[\w+.-]+;base64,/, '');
                    const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
                    await adapter.writeBinary(`${scaffoldImgDir}/${img.id}.png`, binary.buffer as ArrayBuffer);
                    scaffoldImageCount++;
                }
                for (const img of perCompImages) {
                    const compDir = `${scaffoldImgDir}/${img.compIndex}`;
                    await this.ensureFolder(compDir);
                    const base64 = img.imageData.replace(/^data:image\/[\w+.-]+;base64,/, '');
                    const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
                    await adapter.writeBinary(`${compDir}/${img.id}.png`, binary.buffer as ArrayBuffer);
                    scaffoldImageCount++;
                }
                console.debug(`[AnalyzePptxTemplateTool] ${scaffoldImageCount} scaffold images written to ${scaffoldImgDir}`);
            }

            // Return summary
            const contentComps = contentCompositions;

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
                `2. **compositions.json** (v${compositionsContent.schema_version}): ${compositionsPath}\n` +
                (scaffoldingMap ? `- Scaffolding: ${scaffoldingMap.size} compositions with per-composition scaffold + content area\n` : '') +
                (multiFileData?.designRules ? `- Design Rules: extracted from Style Guide\n` : '') +
                (multiFileData?.iconCatalog?.length ? `- Icon Catalog: ${multiFileData.iconCatalog.length} icons extracted\n` : '') +
                (multiFileData?.usageGuidelines ? `- Usage Guidelines: extracted from How-to-Use\n` : '') +
                '\n';

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

    /**
     * Process additional corporate design files (Style Guide, Icon Gallery, How-to-Use).
     * Each file is rendered, its role detected (or user-provided), and analyzed accordingly.
     */
    private async processAdditionalFiles(
        additionalFiles: Array<{ path: string; role?: string }>,
        mainAnalysis: TemplateAnalysis,
        mainTemplatePath: string,
        callbacks: { pushToolResult: (msg: string | ToolResultContentBlock[]) => void },
    ): Promise<{
        sourceFiles: Array<{ path: string; role: string; slide_count: number }>;
        designRules?: DesignRules;
        iconCatalog?: IconEntry[];
        usageGuidelines?: UsageGuidelines;
    }> {
        const vault = this.plugin.app.vault;
        const activeModel = this.plugin.getActiveModel();
        if (!activeModel) {
            console.warn('[AnalyzePptxTemplateTool] No active model for multi-file analysis');
            return { sourceFiles: [{ path: mainTemplatePath, role: 'main', slide_count: mainAnalysis.slideCount }] };
        }
        const apiHandler = buildApiHandler(modelToLLMProvider(activeModel));

        const sourceFiles: Array<{ path: string; role: string; slide_count: number }> = [
            { path: mainTemplatePath, role: 'main', slide_count: mainAnalysis.slideCount },
        ];

        let designRules: DesignRules | undefined;
        let iconCatalog: IconEntry[] | undefined;
        let usageGuidelines: UsageGuidelines | undefined;

        // Phase 1: Validate and filter files
        const renderJobs = additionalFiles
            .map(af => ({ af, filePath: af.path.trim() }))
            .filter(j => {
                if (!j.filePath.endsWith('.pptx') && !j.filePath.endsWith('.potx')) {
                    callbacks.pushToolResult(`Skipping ${j.filePath}: not a .pptx/.potx file`);
                    return false;
                }
                const afFile = vault.getAbstractFileByPath(j.filePath);
                if (!(afFile instanceof TFile)) {
                    callbacks.pushToolResult(`Skipping ${j.filePath}: file not found`);
                    return false;
                }
                return true;
            });

        // Phase 2: Parallel rendering (LibreOffice -- no API calls)
        callbacks.pushToolResult(`Rendering ${renderJobs.length} additional file(s) in parallel...`);
        const renderResults = await Promise.all(
            renderJobs.map(j => this.renderTemplateSlides(j.filePath, { maxSlides: 999 })),
        );

        // Phase 3: Sequential analysis (API calls)
        for (let i = 0; i < renderJobs.length; i++) {
            const { af, filePath } = renderJobs[i];
            const renderResult = renderResults[i];
            if (!renderResult.success || renderResult.slides.length === 0) {
                callbacks.pushToolResult(`Skipping ${filePath}: rendering failed (${renderResult.error ?? 'no slides'})`);
                continue;
            }

            // Detect or use provided role
            let role: DocumentRole = (af.role as DocumentRole) ?? 'main';
            if (!af.role) {
                try {
                    callbacks.pushToolResult(`Detecting role of ${filePath.split('/').pop()}...`);
                    const detection = await detectDocumentRole(
                        renderResult.slides.slice(0, 3),
                        apiHandler,
                    );
                    role = detection.role;
                    callbacks.pushToolResult(`Detected: ${role} (confidence: ${detection.confidence.toFixed(2)})`);
                } catch (err) {
                    console.warn(`[AnalyzePptxTemplateTool] Role detection failed for ${filePath}:`, err);
                    role = 'main'; // fallback
                }
            }

            sourceFiles.push({ path: filePath, role, slide_count: renderResult.totalSlides });

            // Analyze based on role
            try {
                const slides = renderResult.slides;
                switch (role) {
                    case 'styleguide': {
                        callbacks.pushToolResult(`Analyzing Style Guide (${slides.length} slides)...`);
                        designRules = await extractDesignRules(slides, apiHandler);
                        callbacks.pushToolResult(
                            `Style Guide analyzed: ${designRules.color_usage.length} color rules, ` +
                            `${designRules.typography.length} typography rules, ` +
                            `${designRules.dos.length} do's, ${designRules.donts.length} don'ts`,
                        );
                        break;
                    }
                    case 'icons': {
                        callbacks.pushToolResult(`Analyzing Icon Gallery (${slides.length} slides)...`);
                        iconCatalog = await extractIconCatalog(slides, apiHandler);
                        callbacks.pushToolResult(`Icon Gallery analyzed: ${iconCatalog.length} icons extracted`);
                        break;
                    }
                    case 'howto': {
                        callbacks.pushToolResult(`Analyzing How-to-Use (${slides.length} slides)...`);
                        usageGuidelines = await extractUsageGuidelines(slides, apiHandler);
                        callbacks.pushToolResult(
                            `How-to-Use analyzed: ${usageGuidelines.layout_guidance.length} layout rules, ` +
                            `${usageGuidelines.best_practices.length} best practices, ` +
                            `${usageGuidelines.common_mistakes.length} common mistakes`,
                        );
                        break;
                    }
                    case 'main': {
                        callbacks.pushToolResult(`Additional main template: ${filePath} (${renderResult.totalSlides} slides) -- logged but not merged`);
                        break;
                    }
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn(`[AnalyzePptxTemplateTool] Analysis of ${filePath} (${role}) failed:`, msg);
                callbacks.pushToolResult(`Analysis of ${filePath} failed: ${msg}`);
            }
        }

        return { sourceFiles, designRules, iconCatalog, usageGuidelines };
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
    scaffoldingMap?: Map<number, CompositionScaffolding>,
    multiFileData?: {
        sourceFiles?: Array<{ path: string; role: string; slide_count: number }>;
        designRules?: DesignRules;
        iconCatalog?: IconEntry[];
        usageGuidelines?: UsageGuidelines;
    },
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
        const scaffolding = scaffoldingMap?.get(i);
        const pipelineStr = scaffolding ? `, Pipeline: ${scaffolding.recommended_pipeline}` : '';
        let compLine = `- **${group.name}** (ID: \`${compId}\`, Slides ${numsStr}${pipelineStr}): ${group.meaning}`;
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

    // Source Files section (if multi-file analysis)
    if (multiFileData?.sourceFiles && multiFileData.sourceFiles.length > 1) {
        lines.push('## Source Files');
        for (const sf of multiFileData.sourceFiles) {
            const roleLabel = sf.role === 'main' ? 'Main' : sf.role === 'styleguide' ? 'Style Guide'
                : sf.role === 'icons' ? 'Icons' : sf.role === 'howto' ? 'How-to-Use' : sf.role;
            lines.push(`- ${roleLabel}: ${sf.path.split('/').pop()} (${sf.slide_count} Slides)`);
        }
        lines.push('');
    }

    // Design Rules from Style Guide (if available)
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

    // Available Icons (if icon catalog present)
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

    // Usage Guidelines (if How-to-Use present)
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

    // Design rules
    lines.push('## Design Rules');
    lines.push('');
    lines.push('### Critical Rules');
    lines.push(`- Template file: \`${templatePath}\``);

    // Pipeline selection guidance depends on whether scaffolding is available
    if (scaffoldingMap && scaffoldingMap.size > 0) {
        lines.push('- **HTML is DEFAULT** for all content slides with per-composition scaffolding');
        lines.push('- **clone** (`template_slide` + `content`): Only for title, section divider, closing (<=2 shapes, no icons). Pixel-perfect.');
        lines.push('- **html** + `composition_id`: Scaffold (header, footer, logo, deko) auto-injected per composition. Design within content_area.');
        lines.push('- Call `get_composition_details` to see content_area, style_guide, layout_hint, and scaffold_elements per composition');
    } else {
        lines.push('- **Template mode** (`template_slide` + `content`): For text replacement in existing shapes. Pixel-perfect corporate design.');
        lines.push('- **HTML mode** (`html` + `template_file`): For creative layouts with Brand-DNA colors/fonts. Deko elements (logo, accent bars) are auto-injected -- do NOT place them manually.');
        lines.push('- Choose mode per slide: title/section dividers -> Template. KPI/charts/creative -> HTML.');
    }

    lines.push('- **Fill EVERY shape** (Template mode): When `get_composition_details` lists N shapes, your `content` object MUST have N keys. Unfilled shapes are CLEARED by the cloner and appear as blank empty areas.');
    lines.push('- **Transform content**: NEVER copy source text verbatim. Restructure: paragraphs -> bullets (max 8 words), numbers -> KPIs, sequences -> process labels (1-3 words per step).');
    lines.push('- **Action titles**: Every title is an ASSERTION ("17% faster through automation"), not a topic ("Technical Solution").');
    lines.push('- Shape names in `content` must match exactly (case-sensitive) from `get_composition_details`');
    lines.push('');

    // Using HTML Mode with Scaffolding (only if scaffolding data available)
    if (scaffoldingMap && scaffoldingMap.size > 0) {
        lines.push('### Using HTML Mode with Scaffolding');
        lines.push('1. Call `get_composition_details` -> read `content_area`, `style_guide`, `layout_hint`');
        lines.push('2. Generate HTML within `content_area` bounds using `style_guide` colors/fonts');
        lines.push('3. Scaffold (header, footer, logo, deko) is auto-injected per composition');
        lines.push('4. Optional: Use `html_skeleton` from composition as starting point');
        if (multiFileData?.iconCatalog && multiFileData.iconCatalog.length > 0) {
            lines.push('5. Pick icons from Available Icons catalog instead of inheriting fixed template icons');
        }
        lines.push('');
    }

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
    /** Source files analyzed (main template + additional corporate design files) */
    source_files?: Array<{ path: string; role: string; slide_count: number }>;
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
    /** Design rules extracted from Style Guide (if provided) */
    design_rules?: DesignRules;
    /** Icon catalog extracted from Icon Gallery (if provided) */
    icon_catalog?: IconEntry[];
    /** Usage guidelines extracted from How-to-Use document (if provided) */
    usage_guidelines?: UsageGuidelines;
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
    /** Recommended pipeline for this composition: 'clone' for structural, 'html' for content */
    recommended_pipeline?: 'clone' | 'html';
    /** Per-composition scaffold elements (header, footer, logo, deko) as DekoElement objects */
    scaffold_elements?: Array<{
        id: string;
        type: 'image' | 'shape';
        position: { x: number; y: number; w: number; h: number };
        shape_name?: string;
        fill_color?: string;
        rotation?: number;
        image_data?: string;
    }>;
    /** Content area bounding box in px (1280x720 canvas) */
    content_area?: { x: number; y: number; w: number; h: number };
    /** Style guide derived from the composition's shapes */
    style_guide?: {
        title?: { font_size_pt: number; color: string; font_weight: string };
        body?: { font_size_pt: number; color: string };
        accent_color?: string;
    };
    /** Layout hint: single-column, two-column, grid-NxM, kpi-row, process-horizontal */
    layout_hint?: string;
    /** Optional HTML skeleton with placeholders for complex layouts */
    html_skeleton?: string;
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
    scaffoldingMap?: Map<number, CompositionScaffolding>,
    multiFileData?: {
        sourceFiles?: Array<{ path: string; role: string; slide_count: number }>;
        designRules?: DesignRules;
        iconCatalog?: IconEntry[];
        usageGuidelines?: UsageGuidelines;
    },
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

        // Include scaffolding data if available
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
            visual_structure: multiMeta?.visual_description ?? buildVisualStructureDescription(group, analysis),
            ...(scaffolding ? {
                recommended_pipeline: scaffolding.recommended_pipeline,
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

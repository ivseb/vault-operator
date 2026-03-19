import { TFile } from 'obsidian';
import * as path from 'path';
import JSZip from 'jszip';
import type ObsidianAgentPlugin from '../../../../main';
import type { ToolExecutionContext } from '../../types';
import type { ToolResultContentBlock } from '../../../../api/types';
import { buildApiHandler } from '../../../../api/index';
import { modelToLLMProvider } from '../../../../types/settings';
import {
    analyzeTemplate,
    extractCompositionScaffolding,
    groupByComposition,
} from '../../../office/PptxTemplateAnalyzer';
import type { CompositionScaffolding, TemplateAnalysis } from '../../../office/PptxTemplateAnalyzer';
import { renderPptxToImages } from '../../../office/pptxRenderer';
import {
    analyzeTemplateMultimodal,
    detectDocumentRole,
    extractDesignRules,
    extractIconCatalog,
    extractUsageGuidelines,
    generateVisionSkeletons,
} from '../../../office/MultimodalAnalyzer';
import type {
    DesignRules,
    DocumentRole,
    IconEntry,
    MultimodalResult,
    UsageGuidelines,
    VisionSkeletonInput,
} from '../../../office/MultimodalAnalyzer';
import {
    deriveNameFromPath,
    generateCompositionsJson,
    generateSkillMd,
    type MultiFileArtifactData,
    validateGeneratedTemplateArtifacts,
} from './TemplateAnalysisArtifacts';

type TemplateAnalysisProgressStatus = 'running' | 'complete' | 'blocked' | 'aborted' | 'error';
type TemplateAnalysisPhase =
    'starting' |
    'rendering' |
    'multimodal' |
    'scaffolding' |
    'skeletons' |
    'additional-files' |
    'validating' |
    'writing' |
    'complete';

interface TemplateAnalysisProgress {
    schema_version: 1;
    status: TemplateAnalysisProgressStatus;
    phase: TemplateAnalysisPhase;
    template_path: string;
    template_name: string;
    template_slug: string;
    slide_count: number;
    additional_files: string[];
    started_at: string;
    updated_at: string;
    phase_detail?: string;
    outputs?: {
        skill_path?: string;
        compositions_path?: string;
        scaffold_image_dir?: string;
    };
}

export class TemplateAnalysisJob {
    constructor(private plugin: ObsidianAgentPlugin) {}

    async run(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const abortSignal = context.abortSignal;
        const templatePath = ((input.template_path as string) ?? '').trim();
        let writeProgress:
            | ((patch: Partial<TemplateAnalysisProgress>) => Promise<void>)
            | undefined;

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
            const progressDir = '.obsilo/templates';
            const progressPath = `${progressDir}/${templateSlug}.analysis-progress.json`;
            await this.ensureFolder(progressDir);

            let progressState: TemplateAnalysisProgress = {
                schema_version: 1,
                status: 'running',
                phase: 'starting',
                template_path: templatePath,
                template_name: templateName,
                template_slug: templateSlug,
                slide_count: analysis.slideCount,
                additional_files: ((input.additional_files as Array<{ path: string; role?: string }>) ?? []).map(f => f.path),
                started_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                phase_detail: 'Preparing template analysis...',
            };
            let progressWriteQueue: Promise<void> = Promise.resolve();
            writeProgress = async (patch: Partial<TemplateAnalysisProgress>) => {
                progressState = {
                    ...progressState,
                    ...patch,
                    updated_at: new Date().toISOString(),
                };
                const snapshot = JSON.stringify(progressState, null, 2);
                progressWriteQueue = progressWriteQueue
                    .catch(() => undefined)
                    .then(() => this.safeWrite(progressPath, snapshot));
                await progressWriteQueue;
            };
            const queueProgressUpdate = (patch: Partial<TemplateAnalysisProgress>) => {
                void writeProgress?.(patch).catch((err) => {
                    console.warn('[TemplateAnalysisJob] Progress file update failed:', err);
                });
            };
            const onPhaseProgress = (phase: TemplateAnalysisPhase, msg: string) => {
                console.debug('[MultimodalAnalyzer]', msg);
                callbacks.pushToolResult(msg);
                queueProgressUpdate({ phase, phase_detail: msg });
            };

            this.throwIfAborted(abortSignal);
            await writeProgress({ phase: 'starting', phase_detail: 'Template analysis initialized.' });

            const additionalFilesInput = (input.additional_files as Array<{ path: string; role?: string }>) ?? [];
            const additionalFileIssues = await this.validateAdditionalFilesInput(additionalFilesInput);
            if (additionalFileIssues.length > 0) {
                await writeProgress({
                    status: 'blocked',
                    phase: 'validating',
                    phase_detail: additionalFileIssues.join(' | '),
                });
                callbacks.pushToolResult(
                    `BLOCKED: additional_files are incomplete or invalid.\n\n` +
                    additionalFileIssues.map((issue, idx) => `${idx + 1}. ${issue}`).join('\n') +
                    `\n\nFix the file list and retry analyze_pptx_template.`,
                );
                return;
            }

            this.throwIfAborted(abortSignal);
            await writeProgress({
                phase: 'rendering',
                phase_detail: 'Rendering template slides for multimodal analysis...',
            });

            const allSlidesResult = await this.renderTemplateSlides(templatePath, { maxSlides: 999 }, abortSignal);
            await writeProgress({
                phase: 'rendering',
                phase_detail: allSlidesResult.success
                    ? `Rendered ${allSlidesResult.slides.length} of ${allSlidesResult.totalSlides} slides.`
                    : `Rendering unavailable: ${allSlidesResult.error ?? 'unknown error'}`,
            });
            this.throwIfAborted(abortSignal);

            const displayResult = {
                ...allSlidesResult,
                slides: allSlidesResult.slides.slice(0, 20),
            };

            let multimodalResult: MultimodalResult | undefined;
            const viSettings = this.plugin.settings.visualIntelligence;
            const multimodalApproved = viSettings?.multimodalAnalysisApproved ?? false;
            const viEnabled = viSettings?.enabled ?? false;
            const skipMultimodal = (input.skip_multimodal as boolean) ?? false;

            if (additionalFilesInput.length > 0 && !multimodalApproved) {
                await writeProgress({
                    status: 'blocked',
                    phase: 'validating',
                    phase_detail: 'additional_files provided without multimodal approval',
                });
                callbacks.pushToolResult(
                    `BLOCKED: additional_files were provided but multimodal analysis is not approved.\n\n` +
                    `Corporate sidecar files (Style Guide, Icon Gallery, How-to-Use) are only incorporated ` +
                    `during multimodal analysis. Running with \`skip_multimodal: true\` would create an incomplete ` +
                    `template skill where SKILL.md and compositions.json may drift.\n\n` +
                    `Approve multimodal analysis and rerun, or remove \`additional_files\` to perform a base template analysis only.`,
                );
                return;
            }

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
                await writeProgress({
                    status: 'blocked',
                    phase: 'validating',
                    phase_detail: 'Awaiting multimodal approval before continuing.',
                });
                callbacks.pushToolResult(hint);
                return;
            }

            if (multimodalApproved && allSlidesResult.success && allSlidesResult.slides.length > 0) {
                try {
                    await writeProgress({
                        phase: 'multimodal',
                        phase_detail: `Starting multimodal slide analysis for ${allSlidesResult.slides.length} slides...`,
                    });
                    const apiHandler = context.apiHandler ?? buildApiHandler(modelToLLMProvider(this.plugin.getActiveModel()!));
                    if (apiHandler) {
                        callbacks.pushToolResult(`Starting multimodal analysis of ${allSlidesResult.slides.length} slides (all ${allSlidesResult.totalSlides} rendered)...`);
                        multimodalResult = await analyzeTemplateMultimodal(
                            allSlidesResult.slides,
                            analysis.slideCompositions,
                            apiHandler,
                            (msg) => onPhaseProgress('multimodal', msg),
                            abortSignal,
                        );
                        this.throwIfAborted(abortSignal);
                        console.debug(
                            `[MultimodalAnalyzer] Complete: ${multimodalResult.aliases.size} aliases, ` +
                            `${multimodalResult.compositionMeta.size} composition descriptions`,
                        );
                        await writeProgress({
                            phase: 'multimodal',
                            phase_detail: `Multimodal analysis complete: ${multimodalResult.aliases.size} aliases, ${multimodalResult.compositionMeta.size} composition descriptions.`,
                        });
                    }
                } catch (err) {
                    this.throwIfAborted(abortSignal);
                    console.warn('[TemplateAnalysisJob] Multimodal analysis failed, using deterministic aliases:', err);
                    await writeProgress({
                        phase: 'multimodal',
                        phase_detail: `Multimodal analysis failed, falling back to deterministic aliases: ${
                            err instanceof Error ? err.message : String(err)
                        }`,
                    });
                }
            }

            const compositions = groupByComposition(analysis);
            const contentCompositions = compositions.filter(c => c.classification !== 'blank');
            let scaffoldingMap: Map<number, CompositionScaffolding> | undefined;
            try {
                await writeProgress({
                    phase: 'scaffolding',
                    phase_detail: `Extracting scaffolding for ${contentCompositions.length} compositions...`,
                });
                const zip = await JSZip.loadAsync(templateData);
                scaffoldingMap = await extractCompositionScaffolding(
                    analysis,
                    contentCompositions,
                    analysis.allShapesBySlide,
                    zip,
                );
                this.throwIfAborted(abortSignal);
                await writeProgress({
                    phase: 'scaffolding',
                    phase_detail: `Scaffolding extracted for ${scaffoldingMap.size} compositions.`,
                });
            } catch (err) {
                this.throwIfAborted(abortSignal);
                console.warn('[TemplateAnalysisJob] Scaffolding extraction failed:', err);
                await writeProgress({
                    phase: 'scaffolding',
                    phase_detail: `Scaffolding extraction failed: ${err instanceof Error ? err.message : String(err)}`,
                });
            }

            if (scaffoldingMap && multimodalApproved && allSlidesResult.success && allSlidesResult.slides.length > 0) {
                try {
                    await writeProgress({
                        phase: 'skeletons',
                        phase_detail: 'Preparing vision-based HTML skeleton generation...',
                    });
                    const skeletonApiHandler = context.apiHandler ?? buildApiHandler(modelToLLMProvider(this.plugin.getActiveModel()!));
                    if (skeletonApiHandler) {
                        const apiHandler = skeletonApiHandler;
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
                            await writeProgress({
                                phase: 'skeletons',
                                phase_detail: `Generating vision-based HTML skeletons for ${skeletonInputs.length} compositions...`,
                            });
                            const visionSkeletons = await generateVisionSkeletons(
                                allSlidesResult.slides,
                                skeletonInputs,
                                apiHandler,
                                (msg) => onPhaseProgress('skeletons', msg),
                                abortSignal,
                            );
                            this.throwIfAborted(abortSignal);

                            for (const [idxStr, html] of visionSkeletons) {
                                const idx = parseInt(idxStr, 10);
                                const scaffolding = scaffoldingMap.get(idx);
                                if (scaffolding) scaffolding.html_skeleton = html;
                            }
                            await writeProgress({
                                phase: 'skeletons',
                                phase_detail: `${visionSkeletons.size} vision-based HTML skeletons generated.`,
                            });
                        }
                    }
                } catch (err) {
                    this.throwIfAborted(abortSignal);
                    console.warn('[TemplateAnalysisJob] Vision skeleton generation failed:', err);
                    await writeProgress({
                        phase: 'skeletons',
                        phase_detail: `Vision skeleton generation failed: ${err instanceof Error ? err.message : String(err)}`,
                    });
                }
            }

            let multiFileData: MultiFileArtifactData | undefined;
            if (additionalFilesInput.length > 0 && multimodalApproved) {
                await writeProgress({
                    phase: 'additional-files',
                    phase_detail: `Processing ${additionalFilesInput.length} additional corporate design file(s)...`,
                });
                multiFileData = await this.processAdditionalFiles(
                    additionalFilesInput,
                    analysis,
                    templatePath,
                    callbacks,
                    abortSignal,
                    (msg) => queueProgressUpdate({ phase: 'additional-files', phase_detail: msg }),
                    context.apiHandler,
                );
                this.throwIfAborted(abortSignal);
            }

            await writeProgress({
                phase: 'validating',
                phase_detail: 'Generating SKILL.md and compositions.json artifacts...',
            });
            const skillContent = generateSkillMd(
                analysis,
                templatePath,
                templateName,
                templateSlug,
                scaffoldingMap,
                multiFileData,
            );
            const compositionsContent = generateCompositionsJson(
                analysis,
                templateSlug,
                multimodalResult,
                scaffoldingMap,
                multiFileData,
            );
            const artifactIssues = validateGeneratedTemplateArtifacts(
                additionalFilesInput,
                multiFileData,
                skillContent,
                compositionsContent,
            );
            if (artifactIssues.length > 0) {
                await writeProgress({
                    status: 'blocked',
                    phase: 'validating',
                    phase_detail: artifactIssues.join(' | '),
                });
                callbacks.pushToolResult(
                    `BLOCKED: Template analysis artifacts are incomplete.\n\n` +
                    artifactIssues.map((issue, idx) => `${idx + 1}. ${issue}`).join('\n') +
                    `\n\nNo final template artifacts were written. Resolve the extraction issue and rerun analyze_pptx_template.`,
                );
                return;
            }

            await writeProgress({
                phase: 'writing',
                phase_detail: 'Writing generated template artifacts to disk...',
            });
            const pluginSkillsDir = `${vault.configDir}/plugins/${this.plugin.manifest.id}/skills/${templateSlug}`;
            const skillPath = `${pluginSkillsDir}/SKILL.md`;
            await this.ensureFolder(pluginSkillsDir);
            await this.safeWrite(skillPath, skillContent);

            const compositionsDir = '.obsilo/templates';
            const compositionsPath = `${compositionsDir}/${templateSlug}.compositions.json`;
            await this.ensureFolder(compositionsDir);
            await this.safeWrite(compositionsPath, JSON.stringify(compositionsContent, null, 2));

            let scaffoldImageCount = 0;
            const adapter = this.plugin.app.vault.adapter;
            const scaffoldImgDir = `${compositionsDir}/scaffold-images/${templateSlug}`;
            const globalImages: Array<{ id: string; imageData: string }> = [];
            for (const d of analysis.dekoElements) {
                if (d.imageData) globalImages.push({ id: d.id, imageData: d.imageData });
            }
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
            }

            if (this.plugin.selfAuthoredSkillLoader) {
                await this.plugin.selfAuthoredSkillLoader.loadAll();
            }

            const analysisMode = multimodalResult
                ? `Multimodal analysis (${multimodalResult.aliases.size} semantic aliases generated)`
                : 'Deterministic aliases (multimodal analysis not available)';
            // B9: Alle gequeueten Progress-Writes seriell abschließen vor finalem Status
            await progressWriteQueue;
            await writeProgress({
                status: 'complete',
                phase: 'complete',
                phase_detail: `Template analysis complete: ${analysis.slideCount} slides, ${contentCompositions.length} compositions.`,
                outputs: {
                    skill_path: skillPath,
                    compositions_path: compositionsPath,
                    scaffold_image_dir: scaffoldImageCount > 0 ? scaffoldImgDir : undefined,
                },
            });

            const summaryText =
                `Template analysis complete: ${templateName}\n\n` +
                `- ${analysis.slideCount} slides analyzed\n` +
                `- ${contentCompositions.length} composition types identified\n` +
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

                const contentBlocks: ToolResultContentBlock[] = [{
                    type: 'text',
                    text: summaryText + multimodalStats + nextStep,
                }];

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
            console.error('[TemplateAnalysisJob]', msg);
            if (writeProgress) {
                try {
                    await writeProgress({
                        status: isAbortLike(error) ? 'aborted' : 'error',
                        phase: 'complete',
                        phase_detail: msg,
                    });
                } catch (progressErr) {
                    console.warn('[TemplateAnalysisJob] Failed to persist terminal progress state:', progressErr);
                }
            }
            callbacks.pushToolResult(`Error: ${msg}`);
        }
    }

    private async safeWrite(filePath: string, content: string): Promise<void> {
        await this.plugin.app.vault.adapter.write(filePath, content);
    }

    private throwIfAborted(abortSignal?: AbortSignal): void {
        if (abortSignal?.aborted) {
            throw new Error('Template analysis aborted.');
        }
    }

    private async renderTemplateSlides(
        templatePath: string,
        options?: { maxSlides?: number },
        abortSignal?: AbortSignal,
    ): Promise<{ success: boolean; slides: { slideNumber: number; base64: string }[]; totalSlides: number; error?: string }> {
        try {
            this.throwIfAborted(abortSignal);
            const adapter = this.plugin.app.vault.adapter;
            const vaultRoot: string = (adapter as import('obsidian').FileSystemAdapter).basePath
                ?? (adapter as import('obsidian').FileSystemAdapter).getBasePath?.() ?? '';
            if (!vaultRoot) {
                return { success: false, slides: [], totalSlides: 0, error: 'Cannot determine vault root path' };
            }

            const absolutePptxPath = path.join(vaultRoot, templatePath);
            const customPath = this.plugin.settings.visualIntelligence?.libreOfficePath;
            const result = await renderPptxToImages(absolutePptxPath, {
                customLibreOfficePath: customPath,
                maxSlides: options?.maxSlides ?? 20,
            });
            this.throwIfAborted(abortSignal);
            return result;
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
        await this.plugin.app.vault.adapter.mkdir(folderPath);
    }

    private async processAdditionalFiles(
        additionalFiles: Array<{ path: string; role?: string }>,
        mainAnalysis: TemplateAnalysis,
        mainTemplatePath: string,
        callbacks: { pushToolResult: (msg: string | ToolResultContentBlock[]) => void },
        abortSignal?: AbortSignal,
        onProgress?: (msg: string) => void,
        apiHandler?: import('../../../../api/types').ApiHandler,
    ): Promise<MultiFileArtifactData> {
        const vault = this.plugin.app.vault;
        const resolvedApiHandler = apiHandler ?? (this.plugin.getActiveModel()
            ? buildApiHandler(modelToLLMProvider(this.plugin.getActiveModel()!))
            : undefined);
        if (!resolvedApiHandler) {
            console.warn('[TemplateAnalysisJob] No API handler for multi-file analysis');
            return { sourceFiles: [{ path: mainTemplatePath, role: 'main', slide_count: mainAnalysis.slideCount }] };
        }
        const sourceFiles: Array<{ path: string; role: string; slide_count: number }> = [
            { path: mainTemplatePath, role: 'main', slide_count: mainAnalysis.slideCount },
        ];

        let designRules: DesignRules | undefined;
        let iconCatalog: IconEntry[] | undefined;
        let usageGuidelines: UsageGuidelines | undefined;

        this.throwIfAborted(abortSignal);
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

        callbacks.pushToolResult(`Rendering ${renderJobs.length} additional file(s) in parallel...`);
        onProgress?.(`Rendering ${renderJobs.length} additional file(s) in parallel...`);
        const renderResults = await Promise.all(
            renderJobs.map(j => this.renderTemplateSlides(j.filePath, { maxSlides: 999 }, abortSignal)),
        );

        for (let i = 0; i < renderJobs.length; i++) {
            this.throwIfAborted(abortSignal);
            const { af, filePath } = renderJobs[i];
            const renderResult = renderResults[i];
            if (!renderResult.success || renderResult.slides.length === 0) {
                callbacks.pushToolResult(`Skipping ${filePath}: rendering failed (${renderResult.error ?? 'no slides'})`);
                onProgress?.(`Skipping ${filePath}: rendering failed (${renderResult.error ?? 'no slides'})`);
                continue;
            }

            let role: DocumentRole = (af.role as DocumentRole) ?? 'main';
            if (!af.role) {
                try {
                    callbacks.pushToolResult(`Detecting role of ${filePath.split('/').pop()}...`);
                    onProgress?.(`Detecting role of ${filePath.split('/').pop()}...`);
                    const detection = await detectDocumentRole(
                        renderResult.slides.slice(0, 3),
                        resolvedApiHandler,
                        abortSignal,
                    );
                    role = detection.role;
                    callbacks.pushToolResult(`Detected: ${role} (confidence: ${detection.confidence.toFixed(2)})`);
                    onProgress?.(`Detected ${role} for ${filePath.split('/').pop()} (confidence ${detection.confidence.toFixed(2)})`);
                } catch (err) {
                    this.throwIfAborted(abortSignal);
                    console.warn(`[TemplateAnalysisJob] Role detection failed for ${filePath}:`, err);
                    role = 'main';
                }
            }

            sourceFiles.push({ path: filePath, role, slide_count: renderResult.totalSlides });

            try {
                const slides = renderResult.slides;
                switch (role) {
                    case 'styleguide':
                        callbacks.pushToolResult(`Analyzing Style Guide (${slides.length} slides)...`);
                        onProgress?.(`Analyzing Style Guide (${slides.length} slides)...`);
                        designRules = await extractDesignRules(slides, resolvedApiHandler, onProgress, abortSignal);
                        callbacks.pushToolResult(
                            `Style Guide analyzed: ${designRules.color_usage.length} color rules, ` +
                            `${designRules.typography.length} typography rules, ` +
                            `${designRules.dos.length} do's, ${designRules.donts.length} don'ts`,
                        );
                        break;
                    case 'icons':
                        callbacks.pushToolResult(`Analyzing Icon Gallery (${slides.length} slides)...`);
                        onProgress?.(`Analyzing Icon Gallery (${slides.length} slides)...`);
                        iconCatalog = await extractIconCatalog(slides, resolvedApiHandler, onProgress, abortSignal);
                        callbacks.pushToolResult(`Icon Gallery analyzed: ${iconCatalog.length} icons extracted`);
                        break;
                    case 'howto':
                        callbacks.pushToolResult(`Analyzing How-to-Use (${slides.length} slides)...`);
                        onProgress?.(`Analyzing How-to-Use (${slides.length} slides)...`);
                        usageGuidelines = await extractUsageGuidelines(slides, resolvedApiHandler, onProgress, abortSignal);
                        callbacks.pushToolResult(
                            `How-to-Use analyzed: ${usageGuidelines.layout_guidance.length} layout rules, ` +
                            `${usageGuidelines.best_practices.length} best practices, ` +
                            `${usageGuidelines.common_mistakes.length} common mistakes`,
                        );
                        break;
                    case 'main':
                        callbacks.pushToolResult(`Additional main template: ${filePath} (${renderResult.totalSlides} slides) -- logged but not merged`);
                        onProgress?.(`Additional main template logged: ${filePath}`);
                        break;
                }
            } catch (err) {
                this.throwIfAborted(abortSignal);
                const msg = err instanceof Error ? err.message : String(err);
                console.warn(`[TemplateAnalysisJob] Analysis of ${filePath} (${role}) failed:`, msg);
                callbacks.pushToolResult(`Analysis of ${filePath} failed: ${msg}`);
                onProgress?.(`Analysis of ${filePath} failed: ${msg}`);
            }
        }

        return { sourceFiles, designRules, iconCatalog, usageGuidelines };
    }

    private async validateAdditionalFilesInput(
        additionalFiles: Array<{ path: string; role?: string }>,
    ): Promise<string[]> {
        const issues: string[] = [];
        const vault = this.plugin.app.vault;

        for (const af of additionalFiles) {
            const filePath = af.path.trim();
            if (!filePath) {
                issues.push('An additional file entry is missing its path.');
                continue;
            }
            if (!filePath.endsWith('.pptx') && !filePath.endsWith('.potx')) {
                issues.push(`${filePath}: must be a .pptx or .potx file.`);
                continue;
            }
            const afFile = vault.getAbstractFileByPath(filePath);
            if (!(afFile instanceof TFile)) {
                issues.push(`${filePath}: file not found in the vault.`);
            }
        }

        return issues;
    }
}

function isAbortLike(error: unknown): boolean {
    if (error instanceof Error) {
        return error.name === 'AbortError' || error.message === 'Template analysis aborted.';
    }
    return false;
}

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
import { analyzeTemplate, groupByComposition, COMPOSITION_METADATA } from '../../office/PptxTemplateAnalyzer';
import type { TemplateAnalysis, SlideClassification } from '../../office/PptxTemplateAnalyzer';
import { renderPptxToImages } from '../../office/pptxRenderer';

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

            // Generate both output files
            const skillContent = generateSkillMd(analysis, templatePath, templateName, templateSlug);
            const compositionsContent = generateCompositionsJson(analysis, templateSlug);

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
            const summaryText =
                `Template analysis complete: ${templateName}\n\n` +
                `- ${analysis.slideCount} slides analyzed\n` +
                `- ${contentComps.length} composition types identified\n` +
                `- Brand DNA: ${analysis.brandDNA.fonts.major} / ${analysis.brandDNA.fonts.minor}\n\n` +
                `Generated files:\n` +
                `1. **SKILL.md** (${skillContent.length} chars): ${skillPath} (auto-installed as user skill)\n` +
                `2. **compositions.json**: ${compositionsPath}\n\n`;

            // Attempt integrated visual rendering
            const renderResult = await this.renderTemplateSlides(templatePath);

            if (renderResult.success && renderResult.slides.length > 0) {
                // Multimodal result: text + slide images
                const contentBlocks: ToolResultContentBlock[] = [
                    {
                        type: 'text',
                        text: summaryText +
                            `Rendered ${renderResult.slides.length} of ${renderResult.totalSlides} slides.\n\n` +
                            `NEXT STEP (mandatory -- do NOT skip):\n` +
                            `Visually inspect each slide image below. Then update compositions.json via edit_file with:\n` +
                            `- bedeutung (semantic meaning of each composition)\n` +
                            `- einsetzen_wenn / nicht_einsetzen_wenn (usage rules)\n` +
                            `- max_chars per shape (estimated from visual layout)\n` +
                            `Do NOT proceed to presentation creation without visual analysis.`,
                    },
                ];

                for (const slide of renderResult.slides) {
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
                const renderWarning = renderResult.error
                    ? `Visual rendering unavailable: ${renderResult.error}\n\n`
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
                maxSlides: 20, // Templates can have many slides; render more than default
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
    lines.push('- Use `template_file` + `template_slide` + `content` (NEVER use `html` field)');
    lines.push('- **Fill EVERY shape**: When `get_composition_details` lists N shapes, your `content` object MUST have N keys. Unfilled shapes are CLEARED by the cloner and appear as blank empty areas.');
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
    template: string;
    compositions: Record<string, CompositionEntry>;
}

interface CompositionEntry {
    name: string;
    classification: string;
    slides: number[];
    bedeutung: string;
    einsetzen_wenn: string;
    nicht_einsetzen_wenn: string;
    has_image_placeholder: boolean;
    shapes: Record<string, Record<string, ShapeDetailEntry>>;
}

interface ShapeDetailEntry {
    zweck: string;
    max_chars?: number;
    font_size_pt?: number;
}

function generateCompositionsJson(
    analysis: TemplateAnalysis,
    templateSlug: string,
): CompositionsFile {
    const compositions = groupByComposition(analysis);
    const contentCompositions = compositions.filter(c => c.classification !== 'blank');

    const result: CompositionsFile = {
        template: templateSlug,
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
                const detail: ShapeDetailEntry = {
                    zweck: shape.placeholderType ?? shape.semanticId,
                };
                if (shape.textCapacity) {
                    detail.max_chars = shape.textCapacity.maxChars;
                    detail.font_size_pt = shape.textCapacity.fontSize;
                }
                slideShapes[shape.shapeName] = detail;
            }

            shapes[String(slideNum)] = slideShapes;
        }

        result.compositions[compId] = {
            name: group.name,
            classification: group.classification,
            slides: group.slideNumbers,
            bedeutung: group.meaning,
            einsetzen_wenn: group.useWhen,
            nicht_einsetzen_wenn: generateCompositionWarnings(group, analysis),
            has_image_placeholder: hasImagePlaceholder(group, analysis),
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

    return warnings.join('; ');
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

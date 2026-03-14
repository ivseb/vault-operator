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
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import { analyzeTemplate, groupByComposition } from '../../office/PptxTemplateAnalyzer';
import type { TemplateAnalysis } from '../../office/PptxTemplateAnalyzer';

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

            callbacks.pushToolResult(
                `Template analysis complete: ${templateName}\n\n` +
                `- ${analysis.slideCount} slides analyzed\n` +
                `- ${contentComps.length} composition types identified\n` +
                `- Brand DNA: ${analysis.brandDNA.fonts.major} / ${analysis.brandDNA.fonts.minor}\n\n` +
                `Generated files:\n` +
                `1. **SKILL.md** (${skillContent.length} chars): ${skillPath} (auto-installed as user skill)\n` +
                `2. **compositions.json**: ${compositionsPath}\n\n` +
                `NEXT STEP (mandatory -- do NOT skip):\n` +
                `Visually analyze the template slides to enrich compositions with semantic meaning, ` +
                `usage rules, and text constraints.\n\n` +
                `If Visual Intelligence is enabled: call render_presentation with the template file ` +
                `("${templatePath}") to render all slides, then visually inspect them.\n` +
                `If Visual Intelligence is NOT enabled: ask the user to either enable it ` +
                `(Settings > Visual Intelligence, requires LibreOffice) or provide a PDF export.\n\n` +
                `After visual inspection, update compositions.json via edit_file with:\n` +
                `- bedeutung (semantic meaning of each composition)\n` +
                `- einsetzen_wenn / nicht_einsetzen_wenn (usage rules)\n` +
                `- max_chars per shape (estimated from visual layout)\n` +
                `Do NOT proceed to presentation creation without visual analysis.`,
            );
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

    private async ensureFolder(folderPath: string): Promise<void> {
        const vault = this.plugin.app.vault;
        // Create folder hierarchy recursively (ignore if already exists)
        const parts = folderPath.split('/');
        let current = '';
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            if (!vault.getAbstractFileByPath(current)) {
                try {
                    await vault.createFolder(current);
                } catch {
                    // Folder may already exist on disk but not in vault cache -- ignore
                }
            }
        }
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
        lines.push(`- **${group.name}** (ID: \`${compId}\`, Slides ${numsStr}): ${group.meaning}`);
    }
    lines.push('');

    // Narrative phase mapping
    lines.push('## Compositions by Narrative Phase');
    lines.push('');
    lines.push('| Phase | Compositions | Rationale |');
    lines.push('|-------|-------------|-----------|');

    type ClassSet = Set<string>;
    const openingTypes: ClassSet = new Set(['title', 'kpi']);
    const tensionTypes: ClassSet = new Set(['comparison', 'two-column', 'matrix']);
    const resolutionTypes: ClassSet = new Set(['process', 'pyramid', 'timeline']);

    const opening = contentCompositions.filter(c => openingTypes.has(c.classification)).map(c => c.name);
    const tension = contentCompositions.filter(c => tensionTypes.has(c.classification)).map(c => c.name);
    const resolution = contentCompositions.filter(c => resolutionTypes.has(c.classification)).map(c => c.name);

    if (opening.length > 0) lines.push(`| Opening | ${opening.join(', ')} | Establish facts |`);
    if (tension.length > 0) lines.push(`| Tension | ${tension.join(', ')} | Build contrast |`);
    if (resolution.length > 0) lines.push(`| Resolution | ${resolution.join(', ')} | Show path forward |`);

    const versatile = contentCompositions.filter(c =>
        !openingTypes.has(c.classification) &&
        !tensionTypes.has(c.classification) &&
        !resolutionTypes.has(c.classification) &&
        c.classification !== 'blank' && c.classification !== 'image',
    ).map(c => c.name);
    if (versatile.length > 0) lines.push(`| Any phase | ${versatile.join(', ')} | Flexible |`);
    lines.push('');

    // Design rules
    lines.push('## Design Rules');
    lines.push(`- Template file: \`${templatePath}\``);
    lines.push('- Use `template_file` + `template_slide` + `content` (NEVER use `html` field)');
    lines.push('- Shape names in `content` must match exactly (case-sensitive)');
    lines.push('- Use `get_composition_details` before create_pptx to get shape names and constraints');
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
            nicht_einsetzen_wenn: '',
            shapes,
        };
    }

    return result;
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

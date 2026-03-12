/**
 * AnalyzePptxTemplateTool
 *
 * Analyzes a PPTX template file and extracts:
 * 1. Element Catalog: All unique design elements (shapes, forms) deduplicated
 * 2. Brand DNA: Colors, fonts, spacing from theme and masters
 * 3. Slide Compositions: How elements are combined on each slide with shape names
 *
 * Optionally generates a Template Skill (SKILL.md) for future use.
 */

import { TFile } from 'obsidian';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import { analyzeTemplate, generateTemplateSkill } from '../../office/PptxTemplateAnalyzer';
import type { TemplateAnalysis, SlideComposition } from '../../office/PptxTemplateAnalyzer';

export class AnalyzePptxTemplateTool extends BaseTool<'analyze_pptx_template'> {
    readonly name = 'analyze_pptx_template' as const;
    readonly isWriteOperation = false;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'analyze_pptx_template',
            description:
                'Analyze a PPTX template to extract its design elements, brand DNA (colors, fonts), and slide compositions. ' +
                'Returns a structured catalog of all unique shapes with their names, geometries, and suggested uses. ' +
                'Use this before creating presentations with a new template to understand its available slide types and design elements. ' +
                'Optionally generates a Template Skill for repeated use.',
            input_schema: {
                type: 'object',
                properties: {
                    template_path: {
                        type: 'string',
                        description: 'Vault path to the .pptx template file to analyze.',
                    },
                    generate_skill: {
                        type: 'boolean',
                        description:
                            'If true, generates a Template Skill (SKILL.md) and saves it as a user skill. ' +
                            'The skill can then be loaded automatically in future presentations. Default: false.',
                    },
                    skill_name: {
                        type: 'string',
                        description:
                            'Name for the generated skill (e.g. "Acme", "McKinsey"). ' +
                            'Only used when generate_skill is true.',
                    },
                },
                required: ['template_path'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const templatePath = ((input.template_path as string) ?? '').trim();
        const generateSkill = input.generate_skill === true;
        const skillName = ((input.skill_name as string) ?? '').trim();

        if (!templatePath) {
            callbacks.pushToolResult('Error: template_path is required.');
            return;
        }

        if (!templatePath.endsWith('.pptx') && !templatePath.endsWith('.potx')) {
            callbacks.pushToolResult('Error: template_path must point to a .pptx or .potx file.');
            return;
        }

        try {
            // Load template from vault
            const vault = this.plugin.app.vault;
            const file = vault.getAbstractFileByPath(templatePath);
            if (!(file instanceof TFile)) {
                callbacks.pushToolResult(`Error: File not found: ${templatePath}`);
                return;
            }

            const templateData = await vault.readBinary(file);

            // Run analysis
            const analysis = await analyzeTemplate(templateData);

            // Format result
            const resultParts: string[] = [];
            resultParts.push(formatAnalysisResult(analysis, templatePath));

            // Generate skill if requested
            if (generateSkill) {
                const name = skillName || deriveNameFromPath(templatePath);
                const skillContent = generateTemplateSkill(analysis, name, templatePath);

                // Save as user skill
                const skillDir = `skills/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-template`;
                const skillPath = `${skillDir}/SKILL.md`;

                // Ensure directory exists
                const existingDir = vault.getAbstractFileByPath(skillDir);
                if (!existingDir) {
                    await vault.createFolder(skillDir);
                }

                // Write skill file
                const existingFile = vault.getAbstractFileByPath(skillPath);
                if (existingFile instanceof TFile) {
                    await vault.modify(existingFile, skillContent);
                    resultParts.push(`\nTemplate-Skill aktualisiert: ${skillPath}`);
                } else {
                    await vault.create(skillPath, skillContent);
                    resultParts.push(`\nTemplate-Skill erstellt: ${skillPath}`);
                }
                resultParts.push('Der Skill wird beim naechsten Praesentation-Auftrag automatisch geladen.');
            }

            callbacks.pushToolResult(resultParts.join('\n'));

        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error('[AnalyzePptxTemplateTool]', msg);
            callbacks.pushToolResult(`Error: ${msg}`);
        }
    }
}

/* ------------------------------------------------------------------ */
/*  Result formatting                                                  */
/* ------------------------------------------------------------------ */

function formatAnalysisResult(analysis: TemplateAnalysis, templatePath: string): string {
    const lines: string[] = [];

    lines.push(`# Template-Analyse: ${templatePath}`);
    lines.push(`${analysis.slideCount} Slides, ${analysis.elementCatalog.length} einzigartige Design-Elemente`);
    lines.push('');

    // Brand DNA
    lines.push('## Brand-DNA');
    const { brandDNA } = analysis;
    lines.push(`Fonts: ${brandDNA.fonts.major} (Heading), ${brandDNA.fonts.minor} (Body)`);
    const colorEntries = Object.entries(brandDNA.colors).map(([k, v]) => `${k}=${v}`).join(', ');
    lines.push(`Farben: ${colorEntries}`);
    lines.push('');

    // Element catalog summary
    const contentElements = analysis.elementCatalog.filter(e => e.category === 'content-bearing');
    const decoElements = analysis.elementCatalog.filter(e => e.category === 'decorative');
    lines.push('## Element-Katalog');
    lines.push(`${contentElements.length} content-bearing, ${decoElements.length} dekorativ, ${analysis.elementCatalog.length - contentElements.length - decoElements.length} andere`);
    lines.push('');

    // Content-bearing elements table
    if (contentElements.length > 0) {
        lines.push('### Content-Bearing');
        lines.push('| ID | Name | Geometrie | Geeignet fuer |');
        lines.push('|----|------|-----------|---------------|');
        for (const el of contentElements) {
            lines.push(`| ${el.id} | ${el.name} | ${el.geometry} | ${el.suggestedUse} |`);
        }
        lines.push('');
    }

    // Slide compositions by type
    lines.push('## Slide-Kompositionen');
    const byClass = new Map<string, SlideComposition[]>();
    for (const comp of analysis.slideCompositions) {
        const existing = byClass.get(comp.classification) ?? [];
        existing.push(comp);
        byClass.set(comp.classification, existing);
    }

    for (const [cls, comps] of byClass) {
        const slideNums = comps.map(c => c.slideNumber);
        const numsStr = slideNums.length > 10
            ? `${slideNums.slice(0, 10).join(', ')}... (${slideNums.length} total)`
            : slideNums.join(', ');
        lines.push(`- **${cls}** (${comps.length}x): Slides ${numsStr}`);
    }
    lines.push('');

    // Detailed shape mapping for first slide of each type
    lines.push('## Shape-Name-Mapping (Beispiele)');
    lines.push('');
    lines.push('Nutze Shape-Namen als Keys im `content`-Objekt:');
    lines.push('');

    const shownTypes = new Set<string>();
    for (const comp of analysis.slideCompositions) {
        if (shownTypes.has(comp.classification)) continue;
        shownTypes.add(comp.classification);

        const replaceable = comp.shapes.filter(s => s.isReplaceable);
        if (replaceable.length === 0) continue;

        lines.push(`### Slide ${comp.slideNumber} (${comp.classification}): ${comp.description}`);
        for (const shape of replaceable) {
            const textPreview = shape.text.length > 40 ? shape.text.substring(0, 37) + '...' : shape.text;
            const phInfo = shape.placeholderType ? ` [${shape.placeholderType}]` : '';
            lines.push(`- "${shape.shapeName}"${phInfo}: "${textPreview}"`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

function deriveNameFromPath(path: string): string {
    const filename = path.split('/').pop() ?? path;
    return filename.replace(/\.(pptx|potx)$/i, '').replace(/[_-]+/g, ' ').trim();
}

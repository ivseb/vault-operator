/**
 * IngestTemplateTool — CSS-SVG Theme Ingestion (Phase 2, ADR-044)
 *
 * Converts a corporate PPTX template into a CSS theme + HTML pattern library.
 *
 * Process (~2-5 min):
 *   1. Render slides to PNG via LibreOffice (sample: first 3 + evenly distributed, max 12)
 *   2. Send screenshots to Claude Vision with a structured JSON prompt
 *   3. Vision extracts: colors, fonts, 6-8 layout types → generates CSS + HTML patterns
 *   4. Save theme to: .obsilo/themes/{name}/theme.css + patterns.md + metadata.json
 *   5. Write SKILL.md to plugin skills directory
 *
 * Output structure:
 *   .obsilo/themes/{name}/
 *     theme.css       — CSS custom properties + layout classes
 *     patterns.md     — HTML pattern library (one per layout type)
 *     metadata.json   — colors, fonts, source path, date
 *   .obsidian/plugins/obsilo-agent/skills/{name}/
 *     SKILL.md        — Compact skill: CSS reference + pattern names (~2k chars)
 */

import * as path from 'path';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import { renderPptxToImages } from '../../office/pptxRenderer';
import type { ContentBlock } from '../../../api/types';

// ── Vision response schema ─────────────────────────────────────────────────

interface ThemeColor {
    name: string;      // e.g. "primary", "accent1", "bg-dark"
    hex: string;       // e.g. "#000099"
    usage: string;     // e.g. "Dark backgrounds, headers"
}

interface LayoutPattern {
    id: string;        // e.g. "title-dark"
    name: string;      // e.g. "Title Slide (Dark)"
    description: string;
    html: string;      // Full HTML template for this layout
}

interface VisionThemeResult {
    colors: ThemeColor[];
    fonts: { heading: string; body: string };
    layouts: LayoutPattern[];
    css: string;       // Complete theme.css content
}

// ── Tool ──────────────────────────────────────────────────────────────────

export class IngestTemplateTool extends BaseTool<'ingest_template'> {
    readonly name = 'ingest_template' as const;
    readonly isWriteOperation = true;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'ingest_template',
            description:
                'Convert a corporate PPTX template into a CSS theme + HTML pattern library. ' +
                'Screenshots slides via LibreOffice, sends to Claude Vision, and generates: ' +
                'theme.css (colors, fonts, layout classes), patterns.md (6-8 HTML templates), ' +
                'metadata.json, and a compact SKILL.md. ' +
                'After ingestion, reference the theme via theme_name in create_pptx. ' +
                'Run once per template; re-run only if the corporate design changes.',
            input_schema: {
                type: 'object',
                properties: {
                    template_path: {
                        type: 'string',
                        description: 'Vault path to the .pptx or .potx corporate template file.',
                    },
                    theme_name: {
                        type: 'string',
                        description:
                            'Short name for the theme (lowercase, hyphens). ' +
                            'Used as directory name and theme_name in create_pptx. ' +
                            'If omitted, derived from the filename (e.g. "acme-vorlage").',
                    },
                    max_sample_slides: {
                        type: 'number',
                        description:
                            'Maximum number of slides to render and analyze (default: 12). ' +
                            'Selects first 3 + evenly distributed remaining slides. ' +
                            'More slides = better pattern coverage but longer processing.',
                    },
                    force: {
                        type: 'boolean',
                        description:
                            'Re-ingest even if a theme with this name already exists. ' +
                            'Default: false (returns existing theme info if already ingested).',
                    },
                },
                required: ['template_path'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const templatePath = ((input.template_path as string) ?? '').trim();
        const maxSampleSlides = (input.max_sample_slides as number | undefined) ?? 12;
        const force = (input.force as boolean | undefined) ?? false;

        if (!templatePath) {
            callbacks.pushToolResult(this.formatError(new Error('template_path is required')));
            return;
        }

        // Derive theme name from filename if not provided
        const themeName = ((input.theme_name as string) ?? '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            || path.basename(templatePath, path.extname(templatePath))
                .toLowerCase()
                .replace(/[^a-z0-9-]/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '');

        const themeDir = `.obsilo/themes/${themeName}`;
        const adapter = this.app.vault.adapter;

        // Check if already ingested
        if (!force) {
            const cssExists = await adapter.exists(`${themeDir}/theme.css`);
            if (cssExists) {
                callbacks.pushToolResult(
                    `Theme **${themeName}** is already ingested.\n` +
                    `Location: ${themeDir}/\n\n` +
                    `Use theme_name: "${themeName}" in create_pptx.\n` +
                    `To re-ingest, set force: true.`,
                );
                return;
            }
        }

        // Resolve absolute path for renderer
        const vaultBase = (this.app.vault.adapter as unknown as { basePath: string }).basePath;
        const absolutePath = path.join(vaultBase, templatePath);

        callbacks.pushProgress?.(`Ingesting template: ${templatePath}\nRendering slides...`);

        // Step 1: Render slides
        const renderResult = await renderPptxToImages(absolutePath, {
            maxSlides: maxSampleSlides,
        });

        if (!renderResult.success || renderResult.slides.length === 0) {
            callbacks.pushToolResult(this.formatError(new Error(
                `Failed to render template slides: ${renderResult.error ?? 'no output from LibreOffice'}`,
            )));
            return;
        }

        const slides = this.selectSampleSlides(renderResult.slides, maxSampleSlides);
        callbacks.pushProgress?.(
            `Rendered ${slides.length} slides (of ${renderResult.totalSlides} total).\n` +
            `Sending to Vision for design analysis...`,
        );

        // Step 2: Vision analysis
        const apiHandler = this.plugin.apiHandler;
        if (!apiHandler) {
            callbacks.pushToolResult(this.formatError(new Error('No API handler available')));
            return;
        }

        let rawJson = '';
        try {
            rawJson = await this.runVisionAnalysis(apiHandler, slides, themeName);
        } catch (err) {
            callbacks.pushToolResult(this.formatError(
                new Error(`Vision analysis failed: ${(err as Error).message}`),
            ));
            return;
        }

        // Step 3: Parse Vision result
        let themeResult: VisionThemeResult;
        try {
            themeResult = this.parseVisionResult(rawJson);
        } catch (err) {
            callbacks.pushToolResult(this.formatError(
                new Error(`Could not parse Vision response: ${(err as Error).message}\n\nRaw response (first 500 chars):\n${rawJson.slice(0, 500)}`),
            ));
            return;
        }

        callbacks.pushProgress?.(`Vision analysis complete. Writing theme files...`);

        // Step 4: Write theme files
        await this.writeThemeFiles(themeName, themeDir, templatePath, themeResult);

        // Step 5: Write SKILL.md
        await this.writeSkillFile(themeName, themeResult);

        const layoutNames = themeResult.layouts.map(l => l.id).join(', ');
        callbacks.pushToolResult(
            `Template **${templatePath}** ingested as theme **${themeName}**.\n\n` +
            `**Files written:**\n` +
            `- ${themeDir}/theme.css\n` +
            `- ${themeDir}/patterns.md\n` +
            `- ${themeDir}/metadata.json\n` +
            `- skills/${themeName}/SKILL.md\n\n` +
            `**Colors extracted:** ${themeResult.colors.map(c => `${c.name}(${c.hex})`).join(', ')}\n` +
            `**Fonts:** ${themeResult.fonts.heading} / ${themeResult.fonts.body}\n` +
            `**Layout patterns (${themeResult.layouts.length}):** ${layoutNames}\n\n` +
            `Use \`create_pptx\` with \`theme_name: "${themeName}"\` to create presentations.\n` +
            `The skill is now active — it provides CSS classes and HTML patterns.`,
        );
    }

    // ── Vision analysis ───────────────────────────────────────────────────

    private async runVisionAnalysis(
        apiHandler: NonNullable<ObsidianAgentPlugin['apiHandler']>,
        slides: { slideNumber: number; base64: string }[],
        themeName: string,
    ): Promise<string> {
        const contentBlocks: ContentBlock[] = [];

        // Add all slide images
        for (const slide of slides) {
            contentBlocks.push(
                { type: 'text', text: `--- Slide ${slide.slideNumber} ---` },
                {
                    type: 'image',
                    source: { type: 'base64', media_type: 'image/png', data: slide.base64 },
                },
            );
        }

        contentBlocks.push({ type: 'text', text: VISION_PROMPT(themeName, slides.length) });

        const systemPrompt =
            'You are a professional UI engineer analyzing a corporate PowerPoint template. ' +
            'Your task is to extract its visual design system and convert it into a CSS theme + HTML pattern library. ' +
            'Be precise about colors (extract exact hex codes from the images), ' +
            'and write clean, semantic HTML/CSS that faithfully reproduces each layout type.';

        let response = '';
        for await (const chunk of apiHandler.createMessage(
            systemPrompt,
            [{ role: 'user', content: contentBlocks }],
            [],
        )) {
            if (chunk.type === 'text') response += chunk.text;
        }
        return response.trim();
    }

    private parseVisionResult(raw: string): VisionThemeResult {
        // Extract JSON from the response (may be wrapped in markdown code blocks)
        const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
        const jsonStr = (jsonMatch[1] ?? raw).trim();
        const parsed = JSON.parse(jsonStr) as Partial<VisionThemeResult>;

        if (!parsed.colors || !parsed.fonts || !parsed.layouts || !parsed.css) {
            throw new Error('Missing required fields: colors, fonts, layouts, css');
        }
        if (parsed.layouts.length === 0) {
            throw new Error('No layout patterns extracted');
        }
        return parsed as VisionThemeResult;
    }

    // ── File writing ──────────────────────────────────────────────────────

    private async writeThemeFiles(
        themeName: string,
        themeDir: string,
        sourcePath: string,
        result: VisionThemeResult,
    ): Promise<void> {
        const adapter = this.app.vault.adapter;

        // Ensure directory exists
        if (!(await adapter.exists(themeDir))) {
            await adapter.mkdir(themeDir);
        }

        // theme.css
        await adapter.write(`${themeDir}/theme.css`, result.css);

        // patterns.md
        const patternsContent = this.buildPatternsDoc(themeName, result);
        await adapter.write(`${themeDir}/patterns.md`, patternsContent);

        // metadata.json
        const metadata = {
            themeName,
            sourcePptx: sourcePath,
            createdAt: new Date().toISOString(),
            colors: result.colors,
            fonts: result.fonts,
            layoutIds: result.layouts.map(l => l.id),
        };
        await adapter.write(`${themeDir}/metadata.json`, JSON.stringify(metadata, null, 2));
    }

    private buildPatternsDoc(themeName: string, result: VisionThemeResult): string {
        const lines: string[] = [
            `# ${themeName} — HTML Pattern Library`,
            '',
            '> Generated by `ingest_template`. Each pattern is a complete HTML slide template.',
            '> Use CSS classes from `theme.css`. Canvas: 1280×720px.',
            '',
        ];

        for (const layout of result.layouts) {
            lines.push(`## ${layout.name} (\`${layout.id}\`)`);
            lines.push('');
            lines.push(`_${layout.description}_`);
            lines.push('');
            lines.push('```html');
            lines.push(layout.html);
            lines.push('```');
            lines.push('');
        }

        return lines.join('\n');
    }

    private async writeSkillFile(themeName: string, result: VisionThemeResult): Promise<void> {
        const adapter = this.app.vault.adapter;
        const skillDir = `.obsidian/plugins/obsilo-agent/skills/${themeName}`;

        if (!(await adapter.exists(skillDir))) {
            await adapter.mkdir(skillDir);
        }

        const skill = this.buildSkillMd(themeName, result);
        await adapter.write(`${skillDir}/SKILL.md`, skill);
    }

    private buildSkillMd(themeName: string, result: VisionThemeResult): string {
        const colorRef = result.colors
            .map(c => `- \`${c.name}\`: ${c.hex} — ${c.usage}`)
            .join('\n');

        const layoutRef = result.layouts
            .map(l => `- \`${l.id}\`: ${l.name} — ${l.description}`)
            .join('\n');

        const cssClassHint = result.colors
            .slice(0, 4)
            .map(c => `--${c.name}: ${c.hex}`)
            .join('; ');

        return `---
name: ${themeName}
description: ${themeName} corporate theme — CSS classes and HTML patterns for create_pptx
trigger: ${themeName.replace(/-/g, '|')}
source: ingested
requiredTools: [create_pptx, ingest_template]
---

# ${themeName} — CSS Theme Reference

**Canvas:** 1280×720px | **Engine:** HTML → PptxGenJS

## Colors
${colorRef}

## Fonts
- Heading: ${result.fonts.heading}
- Body: ${result.fonts.body}

## CSS Usage
Theme CSS is auto-applied when you set \`theme_name: "${themeName}"\` in create_pptx.
Custom properties: \`${cssClassHint}\`

## Available Layout Patterns
${layoutRef}

**Full HTML patterns** are in \`.obsilo/themes/${themeName}/patterns.md\`.
Read the patterns file when you need the exact HTML template for a layout.

## How to create a presentation
\`\`\`
create_pptx({
  output_path: "path/to/output.pptx",
  theme_name: "${themeName}",
  slides: [
    { html: "<div class='slide slide-dark'>...</div>" },
    { html: "<div class='slide slide-light'>...</div>" }
  ]
})
\`\`\`
The theme CSS is injected automatically — just use the CSS classes.
`;
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private selectSampleSlides(
        slides: { slideNumber: number; base64: string }[],
        maxSample: number,
    ): { slideNumber: number; base64: string }[] {
        if (slides.length <= maxSample) return slides;

        // Always include first 3 slides (cover, agenda, first content)
        const selected = slides.slice(0, Math.min(3, slides.length));
        const remaining = slides.slice(3);
        const toAdd = maxSample - selected.length;

        if (toAdd <= 0 || remaining.length === 0) return selected;

        // Evenly distribute remaining picks
        const step = remaining.length / toAdd;
        for (let i = 0; i < toAdd; i++) {
            const idx = Math.floor(i * step);
            selected.push(remaining[idx]);
        }

        return selected.sort((a, b) => a.slideNumber - b.slideNumber);
    }
}

// ── Vision prompt ─────────────────────────────────────────────────────────

function VISION_PROMPT(themeName: string, slideCount: number): string {
    return `
You are analyzing ${slideCount} slides from a corporate PowerPoint template called "${themeName}".

Your task: extract the visual design system and convert it into a CSS theme + HTML pattern library.

**Instructions:**

1. **Extract the design system:**
   - Identify all key colors (extract EXACT hex codes from the slide images)
   - Identify font family names for headings and body text
   - Name each color by its role: primary, accent1, accent2, bg-dark, bg-light, text-dark, text-light, etc.

2. **Identify 6-8 distinct layout types** (look for recurring patterns across slides):
   Common types: title-dark, title-light, agenda, section-divider, content-1col, content-2col,
   kpi-cards, process-steps, comparison, closing. Name them descriptively.

3. **For each layout type, write a complete HTML template** (1280×720px canvas):
   - Use \`data-object="true" data-object-type="textbox|shape"\` on interactive elements
   - Use CSS custom properties (var(--primary), var(--accent1), etc.) for colors
   - Use \`{{placeholder}}\` syntax for text content that varies per slide
   - Make it visually match the template slide as closely as possible with CSS
   - Keep it clean — no inline JavaScript

4. **Write the complete theme.css** with:
   - \`:root\` block with all color/font CSS custom properties
   - Base \`.slide\` class (position:relative; width:1280px; height:720px; overflow:hidden)
   - Layout variant classes (\`.slide-dark\`, \`.slide-light\`, etc.)
   - Component classes (\`.kpi-card\`, \`.process-step\`, \`.two-column\`, \`.agenda-list\`, etc.)
   - Corporate chevrons and shapes via CSS \`clip-path\` where applicable

**Return ONLY valid JSON** (no additional text before or after):

\`\`\`json
{
  "colors": [
    { "name": "primary", "hex": "#000099", "usage": "Dark backgrounds, primary headings" },
    { "name": "accent1", "hex": "#E4DAD4", "usage": "Card backgrounds, accent elements" }
  ],
  "fonts": {
    "heading": "Acme Sans Headline, Arial, sans-serif",
    "body": "Acme Sans Text Light, Arial, sans-serif"
  },
  "layouts": [
    {
      "id": "title-dark",
      "name": "Title Slide (Dark)",
      "description": "Opening slide with dark corporate background, centered title and subtitle",
      "html": "<div class=\\"slide slide-dark\\">\\n  <h1 class=\\"slide-title\\">{{title}}</h1>\\n  <p class=\\"slide-subtitle\\">{{subtitle}}</p>\\n</div>"
    }
  ],
  "css": ":root {\\n  --primary: #000099;\\n  --accent1: #E4DAD4;\\n  --font-heading: \\"Acme Sans Headline\\", Arial, sans-serif;\\n  --font-body: \\"Acme Sans Text Light\\", Arial, sans-serif;\\n}\\n.slide { position: relative; width: 1280px; height: 720px; overflow: hidden; box-sizing: border-box; }\\n.slide-dark { background: var(--primary); color: white; }"
}
\`\`\`

Be precise about colors — zoom into the slide images mentally and extract exact hex values.
Write CSS that a developer would be proud of.
`.trim();
}

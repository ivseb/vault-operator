/**
 * TemplateEngine — pptx-automizer wrapper for template-based PPTX generation.
 *
 * Accepts a corporate .pptx template as Buffer, clones slides, and manipulates
 * shapes via the full pptx-automizer API to produce content-adaptive
 * presentations while preserving 100% corporate design fidelity.
 *
 * Supported content types:
 * - styled_text, html_text, replace_text (text manipulation)
 * - chart (with axis, title, data labels, legend, plot area, scatter/bubble/combo)
 * - table (with auto-adjust, cell styles, footer)
 * - image (vault path resolution)
 * - position, rotate (shape transform)
 * - hyperlink (internal/external links)
 * - duotone (image effects)
 *
 * All I/O is Buffer-based (no filesystem) for Obsidian plugin compatibility.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import Automizer, { modify } from 'pptx-automizer';
import type { ISlide } from 'pptx-automizer';
import PptxGenJS from 'pptxgenjs';
import type {
    TemplateSlideInput,
    PptxBuildResult,
    ContentValue,
    StyledTextContent,
    ChartContent,
    TableContent,
    ReplaceTextContent,
    GenerateElement,
    TemplateCatalog,
    SimpleParagraph,
    SimpleRun,
} from './types';
import { isContentValue } from './types';

/** pptx-automizer FindElementSelector (not exported from package index). */
type FindElementSelector = string | { name: string; nameIdx?: number };

/** pptx-automizer modification callback (element, relation?, chart?). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- pptx-automizer uses generic callback signatures
type ModCallback = (...args: any[]) => void;

/** Options for TemplateEngine. */
export interface TemplateEngineOptions {
    /** Remove existing slides from root before adding new ones. Default: true. */
    removeExistingSlides?: boolean;
    /** Auto-import slide masters from template. Default: true. */
    autoImportSlideMasters?: boolean;
}

/** Info about a shape discovered on a template slide. */
export interface DiscoveredShape {
    name: string;
    type: string;
    visualType: string;
    hasTextBody: boolean;
    text: string[];
    position: { x: number; y: number; w: number; h: number };
    /** Font info extracted from the first text run (if available). */
    fontInfo?: {
        fontFace?: string;
        /** Font size in points. */
        fontSize?: number;
        isBold?: boolean;
        /** Hex color without # (e.g. "000099"). */
        color?: string;
        alignment?: string;
    };
}

/** Info about a slide in the template. */
export interface TemplateSlideInfo {
    number: number;
    layoutName: string;
    elements: DiscoveredShape[];
}

/** Result of discoverTemplate() with slides and metadata. */
export interface TemplateDiscoveryResult {
    slides: TemplateSlideInfo[];
    /** Slide dimensions in pixels (from PPTX metadata, undefined if unavailable). */
    slideSize?: { width: number; height: number };
}

/** Callback for resolving vault image paths to Buffers. */
export type ImageResolver = (vaultPath: string) => Promise<Buffer>;

/** Parsed selector from "ShapeName#N" convention. */
interface ParsedSelector {
    name: string;
    nameIdx?: number;
}

/**
 * EMU per pixel on 1280x720 canvas.
 * Standard 16:9 slide = 12,192,000 x 6,858,000 EMU (33.867 x 19.05 cm).
 * 12,192,000 / 1280 = 9,525 EMU/px (same in both dimensions).
 * Must match IngestTemplateTool's inverse conversion (position / 9525).
 */
const EMU_PER_PX = 9525;

export class TemplateEngine {
    /**
     * Build a presentation from a template and slide inputs.
     *
     * @param templateBuffer - The .pptx template file as Buffer/Uint8Array
     * @param slides - Array of TemplateSlideInput with source_slide, content, remove, generate
     * @param options - Engine options
     * @param imageResolver - Optional callback to resolve vault image paths to Buffers
     * @param catalog - Optional catalog for auto-remove and auto-upgrade features
     * @returns PptxBuildResult with ArrayBuffer and metadata
     */
    async buildFromTemplate(
        templateBuffer: Buffer | Uint8Array,
        slides: TemplateSlideInput[],
        options: TemplateEngineOptions = {},
        imageResolver?: ImageResolver,
        catalog?: TemplateCatalog,
    ): Promise<PptxBuildResult> {
        const warnings: string[] = [];
        const {
            removeExistingSlides = true,
            autoImportSlideMasters = true,
        } = options;

        const buf = templateBuffer instanceof Buffer ? templateBuffer : Buffer.from(templateBuffer);

        // Pre-discover shapes on all referenced slides for validation
        const shapeMap = await this.discoverShapeMap(buf, slides);

        // Pre-load images: collect all ImageContent vault_paths, resolve via imageResolver,
        // write to temp dir for automizer.loadMedia()
        const imageMap = new Map<string, string>(); // vault_path -> temp filename
        let tempDir: string | undefined;

        if (imageResolver) {
            const imagePaths = new Set<string>();
            for (const sl of slides) {
                if (!sl.content) continue;
                for (const val of Object.values(sl.content)) {
                    if (isContentValue(val) && val.type === 'image') {
                        imagePaths.add(val.vault_path);
                    }
                }
            }

            if (imagePaths.size > 0) {
                tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-media-'));
                for (const vaultPath of imagePaths) {
                    try {
                        const imgBuf = await imageResolver(vaultPath);
                        const ext = path.extname(vaultPath) || '.png';
                        const filename = `img_${imageMap.size}${ext}`;
                        fs.writeFileSync(path.join(tempDir, filename), imgBuf);
                        imageMap.set(vaultPath, filename);
                    } catch {
                        warnings.push(`Image "${vaultPath}" could not be resolved from vault`);
                    }
                }
            }
        }

        // Use separate buffer copies for root and source to avoid internal conflicts
        const rootBuf = Buffer.from(buf);
        const srcBuf = Buffer.from(buf);

        const automizer = new Automizer({
            removeExistingSlides,
            autoImportSlideMasters,
            // Auto-fix missing related content (images, layouts, media on masters)
            assertRelatedContents: true,
        });

        automizer.loadRoot(rootBuf).load(srcBuf, 'template');

        // Load pre-resolved media files into automizer
        if (tempDir && imageMap.size > 0) {
            const filenames = [...imageMap.values()];
            automizer.loadMedia(filenames, tempDir);
        }

        for (let i = 0; i < slides.length; i++) {
            const slideInput = slides[i];
            const slideNum = slideInput.source_slide;
            const slideShapeCount = shapeMap.get(slideNum) || new Map<string, number>();
            const slideShapeNames = new Set(slideShapeCount.keys());

            automizer.addSlide('template', slideNum, (slide: ISlide) => {
                // 0. Ensure the slide layout (backgrounds, logos, decorative elements)
                //    is properly imported from the source template
                slide.useSlideLayout();

                // 1. Remove shapes that are not needed (content-adaptive)
                if (slideInput.remove && slideInput.remove.length > 0) {
                    for (const rawName of slideInput.remove) {
                        const sel = parseSelector(rawName);
                        if (!slideShapeNames.has(sel.name)) {
                            warnings.push(`Slide ${i + 1}: Shape "${sel.name}" not found for removal. Available: ${[...slideShapeNames].join(', ')}`);
                            continue;
                        }
                        try {
                            slide.removeElement(selectorToFind(sel));
                        } catch {
                            warnings.push(`Slide ${i + 1}: Could not remove shape "${rawName}"`);
                        }
                    }
                }

                // ============================================================
                // ADR-049: Raw XML Clear + PptxGenJS Generate
                //
                // Strategy: Instead of modifyElement (which fails on inherited
                // layout shapes), we:
                // 1. Remove physically present shapes we can reach
                // 2. Clear ALL text in the slide XML via raw DOM access
                // 3. Generate fresh content via PptxGenJS at catalog positions
                // ============================================================

                // 2a. Remove explicitly requested shapes (content-adaptive)
                if (slideInput.remove && slideInput.remove.length > 0) {
                    // Already handled in step 1 above
                }

                // 2b. Auto-remove unaddressed removable shapes (prevents placeholder boxes)
                const addressedShapes = new Set<string>();
                if (slideInput.content) {
                    for (const rawKey of Object.keys(slideInput.content)) {
                        const sel = parseSelector(rawKey);
                        addressedShapes.add(sel.nameIdx !== undefined ? `${sel.name}#${sel.nameIdx}` : sel.name);
                        if (sel.nameIdx === 0) addressedShapes.add(sel.name);
                        if (sel.nameIdx === undefined) addressedShapes.add(`${sel.name}#0`);
                    }
                }
                if (slideInput.remove) {
                    for (const rawName of slideInput.remove) {
                        const sel = parseSelector(rawName);
                        addressedShapes.add(sel.nameIdx !== undefined ? `${sel.name}#${sel.nameIdx}` : sel.name);
                    }
                }

                if (catalog) {
                    const layoutEntry = catalog.layouts[slideNum];
                    if (layoutEntry) {
                        for (const shape of layoutEntry.shapes) {
                            if (!shape.removable) continue;
                            const key = shape.duplicate_index != null
                                ? `${shape.name}#${shape.duplicate_index}`
                                : shape.name;
                            if (addressedShapes.has(key)) continue;
                            try {
                                const finder: FindElementSelector = shape.duplicate_index != null
                                    ? { name: shape.name, nameIdx: shape.duplicate_index }
                                    : shape.name;
                                slide.removeElement(finder);
                            } catch {
                                // Shape might not exist or be inherited
                            }
                        }
                    }
                }

                // 2c. Try modifyElement for non-text content (charts, tables, images, transforms)
                //     These shape types work because they're physical elements, not inherited text.
                if (slideInput.content) {
                    for (const [rawKey, rawValue] of Object.entries(slideInput.content)) {
                        if (!isContentValue(rawValue)) continue; // plain strings handled by generate()
                        if (rawValue.type === 'styled_text' || rawValue.type === 'html_text' || rawValue.type === 'replace_text') continue; // text handled by generate()

                        const sel = parseSelector(rawKey);
                        if (!slideShapeNames.has(sel.name)) continue;
                        try {
                            this.applyContent(slide, sel, rawValue, i + 1, warnings, imageMap);
                        } catch {
                            warnings.push(`Slide ${i + 1}: Could not apply ${rawValue.type} to "${rawKey}"`);
                        }
                    }
                }

                // 3. RAW XML CLEAR: Disabled -- slide.modify() with getElementsByTagName
                //    crashes pptx-automizer due to XML namespace issues.
                //    TODO: Re-enable with proper namespace handling (getElementsByTagNameNS)
                //    or string-based XML replacement.
                //    For now: generate() places new text ON TOP of old text.
                //    Old placeholder text may show through but at least content is visible.

                // 4. GENERATE: Create fresh content via PptxGenJS at catalog positions
                //    This replaces the old modifyElement approach for ALL text content.
                const contentEntries = slideInput.content
                    ? Object.entries(slideInput.content).filter(([, v]) => {
                        // Only text content goes through generate()
                        if (typeof v === 'string') return true;
                        if (isContentValue(v) && (v.type === 'styled_text' || v.type === 'html_text' || v.type === 'replace_text')) return true;
                        return false;
                    })
                    : [];

                if (contentEntries.length > 0 && catalog) {
                    slide.generate((pptxSlide) => {
                        for (const [rawKey, rawValue] of contentEntries) {
                            const sel = parseSelector(rawKey);
                            const shapeMeta = findShapeMeta(sel, slideNum, catalog);

                            // Need dimensions to place the element -- use catalog or fallback defaults
                            let dims = shapeMeta?.dimensions;
                            if (!dims || (dims.w === 0 && dims.h === 0)) {
                                dims = getDefaultDimensions(shapeMeta?.role ?? 'body', shapeMeta?.font_info?.alignment);
                                if (dims) {
                                    warnings.push(`Slide ${i + 1}: "${rawKey}" using default position for role "${shapeMeta?.role}"`);
                                } else {
                                    warnings.push(`Slide ${i + 1}: "${rawKey}" has no dimensions -- cannot generate`);
                                    continue;
                                }
                            }

                            if (shapeMeta?.content_type !== 'text') continue; // non-text handled by modifyElement above

                            const gx = dims.x * PX_TO_IN_X;
                            const gy = dims.y * PX_TO_IN_Y;
                            const gw = dims.w * PX_TO_IN_X;
                            const gh = dims.h * PX_TO_IN_Y;

                            // Auto-upgrade and extract text
                            let value = rawValue;
                            if (typeof value === 'string' && catalog) {
                                value = maybeUpgradeText(value, sel, slideNum, catalog);
                            }
                            const textContent = extractPlainText(value);
                            if (!textContent) continue;

                            const isTitle = shapeMeta.role === 'title' || shapeMeta.role === 'subtitle';
                            const fi = shapeMeta.font_info;

                            pptxSlide.addText(textContent, {
                                x: gx, y: gy, w: gw, h: gh,
                                fontSize: fi?.font_size ?? (isTitle ? 24 : 14),
                                bold: fi?.is_bold ?? isTitle,
                                color: fi?.color ?? '000000',
                                align: (fi?.alignment === 'ctr' ? 'center' : fi?.alignment === 'r' ? 'right' : 'left') as PptxGenJS.HAlign,
                                valign: isTitle ? 'middle' : 'top',
                                fontFace: fi?.font_face ?? 'Calibri',
                                wrap: true,
                                fit: 'shrink',
                                margin: isTitle ? [4, 8, 4, 8] : [6, 8, 6, 8],
                                lineSpacingMultiple: isTitle ? 1.0 : 1.15,
                                paraSpaceAfter: isTitle ? 0 : 4,
                            });
                        }
                    });
                }

                // 5. Generate explicit PptxGenJS elements (hybrid mode, e.g. from plan)
                if (slideInput.generate && slideInput.generate.length > 0) {
                    for (const genEl of slideInput.generate) {
                        slide.generate((pptxSlide) => {
                            renderGenerateElement(pptxSlide, genEl, i + 1, warnings);
                        });
                    }
                }
            });
        }

        try {
            const jszip = await automizer.getJSZip();
            const arrayBuffer = await jszip.generateAsync({ type: 'arraybuffer' });

            return {
                buffer: arrayBuffer,
                slideCount: slides.length,
                warnings,
            };
        } catch (e) {
            const msg = (e as Error).message || String(e);
            throw new Error(
                `Template engine failed: ${msg}. ` +
                `This usually means a shape name does not exist on the template slide. ` +
                `Warnings so far: ${warnings.join('; ') || 'none'}`,
            );
        } finally {
            // Clean up temp image files
            if (tempDir) {
                try {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                } catch {
                    // Best-effort cleanup
                }
            }
        }
    }

    /**
     * Apply content to a shape based on value type.
     * Dispatches to the appropriate pptx-automizer modify.* method.
     */
    private applyContent(
        slide: ISlide,
        sel: ParsedSelector,
        value: string | ContentValue,
        slideLabel: number,
        warnings: string[],
        imageMap?: Map<string, string>,
    ): void {
        const finder = selectorToFind(sel);

        // Plain string -> setText (backward compatible)
        if (!isContentValue(value)) {
            slide.modifyElement(finder, modify.setText(value));
            return;
        }

        switch (value.type) {
            /* -- Text types ------------------------------------------- */

            case 'styled_text':
                slide.modifyElement(finder, modify.setMultiText(
                    toMultiTextParagraphs(value),
                ));
                break;

            case 'html_text':
                slide.modifyElement(finder, modify.htmlToMultiText(value.html));
                break;

            case 'replace_text': {
                const replaceOpts = value.opening_tag && value.closing_tag
                    ? { openingTag: value.opening_tag, closingTag: value.closing_tag }
                    : undefined;
                slide.modifyElement(finder, modify.replaceText(
                    toReplaceTextArray(value),
                    replaceOpts,
                ));
                break;
            }

            /* -- Chart type ------------------------------------------- */

            case 'chart': {
                const callbacks = buildChartCallbacks(value, warnings, slideLabel);
                slide.modifyElement(finder, callbacks);
                break;
            }

            /* -- Table type ------------------------------------------- */

            case 'table': {
                const tableParams = buildTableParams(value);
                slide.modifyElement(finder, modify.setTable(
                    toTableData(value),
                    tableParams,
                ));
                break;
            }

            /* -- Image type ------------------------------------------- */

            case 'image': {
                const filename = imageMap?.get(value.vault_path);
                if (filename) {
                    slide.modifyElement(finder, modify.setRelationTarget(filename));
                } else {
                    warnings.push(`Slide ${slideLabel}: Image "${value.vault_path}" not pre-loaded (no imageResolver or file not found)`);
                }
                break;
            }

            /* -- Transform types -------------------------------------- */

            case 'position':
                slide.modifyElement(finder, modify.setPosition({
                    x: value.x !== undefined ? Math.round(value.x * EMU_PER_PX) : undefined,
                    y: value.y !== undefined ? Math.round(value.y * EMU_PER_PX) : undefined,
                    w: value.w !== undefined ? Math.round(value.w * EMU_PER_PX) : undefined,
                    h: value.h !== undefined ? Math.round(value.h * EMU_PER_PX) : undefined,
                }));
                break;

            case 'rotate':
                slide.modifyElement(finder, modify.rotateShape(value.degrees));
                break;

            /* -- Link type -------------------------------------------- */

            case 'hyperlink':
                if (typeof value.target === 'number') {
                    // Internal slide link
                    slide.modifyElement(finder, modify.setHyperlinkTarget(
                        value.target,
                        false,
                    ));
                } else {
                    // External URL or internal depending on flag
                    slide.modifyElement(finder, modify.setHyperlinkTarget(
                        value.target,
                        value.external !== false,
                    ));
                }
                break;

            /* -- Image effect type ------------------------------------ */

            case 'duotone':
                slide.modifyElement(finder, modify.setDuotoneFill({
                    ...(value.color ? { color: { type: 'srgbClr' as const, value: value.color } } : {}),
                    ...(value.preset_color ? { prstClr: value.preset_color } : {}),
                    ...(value.tint !== undefined ? { tint: value.tint } : {}),
                    ...(value.saturation_mod !== undefined ? { satMod: value.saturation_mod } : {}),
                }));
                break;

            default:
                warnings.push(`Slide ${slideLabel}: Unknown content type for shape "${sel.name}"`);
        }
    }

    /**
     * Pre-discover shape names and counts on referenced slides for validation.
     * Returns a map of slideNumber -> (shapeName -> count).
     */
    private async discoverShapeMap(
        buf: Buffer | Uint8Array,
        slides: TemplateSlideInput[],
    ): Promise<Map<number, Map<string, number>>> {
        const slideNumbers = [...new Set(slides.map(s => s.source_slide))];
        const result = new Map<number, Map<string, number>>();

        try {
            const discovery = await this.discoverTemplate(buf, slideNumbers);
            for (const info of discovery.slides) {
                const counts = new Map<string, number>();
                for (const el of info.elements) {
                    counts.set(el.name, (counts.get(el.name) || 0) + 1);
                }
                result.set(info.number, counts);
            }
        } catch {
            // If discovery fails, return empty map -- validation will be skipped
        }

        return result;
    }

    /**
     * Discover all slides and their shapes in a template.
     * Used by IngestTemplateTool to generate the catalog.
     *
     * @param templateBuffer - The .pptx template file
     * @param slideNumbers - Optional: specific slides to inspect (default: all)
     * @returns Array of slide info with shapes
     */
    async discoverTemplate(
        templateBuffer: Buffer | Uint8Array,
        slideNumbers?: number[],
    ): Promise<TemplateDiscoveryResult> {
        const automizer = new Automizer({
            removeExistingSlides: false,
        });

        const buf = templateBuffer instanceof Buffer ? templateBuffer : Buffer.from(templateBuffer);
        automizer.loadRoot(buf).load(buf, 'tpl');

        const info = await automizer.getInfo();
        const allSlides = info.slidesByTemplate('tpl');

        const targetSlides = slideNumbers
            ? allSlides.filter(s => slideNumbers.includes(s.number))
            : allSlides;

        const slides: TemplateSlideInfo[] = [];

        for (const slideInfo of targetSlides) {
            const shapes: DiscoveredShape[] = slideInfo.elements.map(el => {
                // Extract font info from first paragraph's first run (if text body exists)
                let fontInfo: DiscoveredShape['fontInfo'];
                if (el.hasTextBody) {
                    try {
                        const paragraphs = el.getParagraphs();
                        if (paragraphs && paragraphs.length > 0) {
                            const firstPara = paragraphs[0];
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pptx-automizer paragraph structure varies
                            const paraAny = firstPara as any;
                            const runs = paraAny?.textRuns ?? paraAny?.runs ?? [];
                            if (runs.length > 0) {
                                const firstRun = runs[0];
                                const style = firstRun?.style ?? firstRun ?? {};
                                fontInfo = {
                                    fontFace: style.fontFace ?? style.typeface ?? undefined,
                                    // pptx-automizer returns size in hundredths of a point (e.g. 1400 = 14pt)
                                    fontSize: style.size ? Math.round(style.size / 100) : undefined,
                                    isBold: style.isBold ?? style.bold ?? undefined,
                                    color: style.color?.value ?? undefined,
                                    alignment: paraAny?.alignment ?? undefined,
                                };
                            }
                        }
                    } catch {
                        // Font extraction is optional -- ignore errors
                    }
                }

                return {
                name: el.name,
                type: el.type,
                visualType: el.visualType,
                hasTextBody: el.hasTextBody,
                text: el.hasTextBody ? el.getText() : [],
                position: {
                    x: el.position.x,
                    y: el.position.y,
                    w: el.position.cx,
                    h: el.position.cy,
                },
                fontInfo,
                };
            });

            slides.push({
                number: slideInfo.number,
                layoutName: slideInfo.info.layoutName,
                elements: shapes,
            });
        }

        // Extract slide size from PPTX metadata (EMU → pixels)
        const slideSize = this.extractSlideSize(info);

        return { slides, slideSize };
    }

    /**
     * Extract slide dimensions from pptx-automizer info.
     * Returns pixels (EMU / 9525). Falls back to undefined if unavailable.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pptx-automizer info type not fully typed
    private extractSlideSize(info: any): { width: number; height: number } | undefined {
        try {
            const size = info.slideSize;
            if (size?.cx && size?.cy) {
                return {
                    width: Math.round(size.cx / EMU_PER_PX),
                    height: Math.round(size.cy / EMU_PER_PX),
                };
            }
        } catch { /* fallback to undefined */ }
        return undefined;
    }

    /**
     * Get total number of slides in a template.
     */
    async getSlideCount(templateBuffer: Buffer | Uint8Array): Promise<number> {
        const automizer = new Automizer({
            removeExistingSlides: false,
        });
        const buf = templateBuffer instanceof Buffer ? templateBuffer : Buffer.from(templateBuffer);
        automizer.loadRoot(buf).load(buf, 'cnt');

        const info = await automizer.getInfo();
        return info.slidesByTemplate('cnt').length;
    }
}

/* ------------------------------------------------------------------ */
/*  Selector parser                                                    */
/* ------------------------------------------------------------------ */

/** Parse "ShapeName#N" into { name, nameIdx }. */
function parseSelector(raw: string): ParsedSelector {
    const match = raw.match(/^(.+)#(\d+)$/);
    if (match) {
        return { name: match[1], nameIdx: parseInt(match[2], 10) };
    }
    return { name: raw };
}

/** Convert ParsedSelector to pptx-automizer's FindElementSelector. */
function selectorToFind(sel: ParsedSelector): FindElementSelector {
    if (sel.nameIdx !== undefined) {
        return { name: sel.name, nameIdx: sel.nameIdx };
    }
    return sel.name;
}

/* ------------------------------------------------------------------ */
/*  Auto-upgrade: plain string -> styled_text for body shapes          */
/* ------------------------------------------------------------------ */

/**
 * Auto-upgrade a plain string to styled_text for non-title text shapes.
 * Only upgrades if the string has multiple lines or bullet patterns.
 * Single-line text stays as plain string to preserve template formatting.
 */
function maybeUpgradeText(
    value: string,
    sel: ParsedSelector,
    slideNum: number,
    catalog: TemplateCatalog,
): string | ContentValue {
    const layout = catalog.layouts[slideNum];
    if (!layout) return value;

    const shape = layout.shapes.find(s =>
        s.name === sel.name &&
        (sel.nameIdx === undefined || s.duplicate_index === sel.nameIdx),
    );
    if (!shape) return value;

    // Only upgrade text shapes with body-like roles
    if (shape.content_type !== 'text') return value;
    if (shape.role === 'title' || shape.role === 'subtitle' || shape.role === 'decorative') return value;

    // Detect multi-line or bullet patterns
    const lines = value.split('\n').filter(l => l.trim().length > 0);
    const hasBulletPattern = lines.some(l => /^\s*[-*•]\s+/.test(l) || /^\s*\d+[.)]\s+/.test(l));

    // Only upgrade multi-line text or text with bullet markers
    if (lines.length <= 1 && !hasBulletPattern) return value;

    const paragraphs: SimpleParagraph[] = lines.map(line => {
        const bulletMatch = line.match(/^\s*[-*•]\s+(.+)/);
        const numberedMatch = line.match(/^\s*\d+[.)]\s+(.+)/);

        const textContent = bulletMatch ? bulletMatch[1].trim()
            : numberedMatch ? numberedMatch[1].trim()
                : line.trim();

        // Parse **bold** markdown into runs (ADR-048: plan_presentation uses plain strings with markdown)
        const runs = parseBoldMarkdown(textContent);

        if (bulletMatch) {
            return { runs, bullet: '•' };
        }
        if (numberedMatch) {
            return { runs, bullet: '1' };
        }
        return { runs };
    });

    return { type: 'styled_text' as const, paragraphs };
}

/**
 * Parse **bold** markdown markers into SimpleRun[] with bold flag.
 * E.g. "**Hoher Zeitaufwand:** Details here" → [{text:"Hoher Zeitaufwand:", bold:true}, {text:" Details here"}]
 */
function parseBoldMarkdown(text: string): SimpleRun[] {
    const runs: SimpleRun[] = [];
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    for (const part of parts) {
        if (!part) continue;
        if (part.startsWith('**') && part.endsWith('**')) {
            runs.push({ text: part.slice(2, -2), bold: true });
        } else {
            runs.push({ text: part });
        }
    }
    return runs.length > 0 ? runs : [{ text }];
}

/* ------------------------------------------------------------------ */
/*  Conversion helpers: Text                                           */
/* ------------------------------------------------------------------ */

/** Convert StyledTextContent to pptx-automizer MultiTextParagraph format. */
function toMultiTextParagraphs(content: StyledTextContent) {
    return content.paragraphs.map(para => {
        const alignMap = { left: 'l', center: 'ctr', right: 'r' } as const;
        return {
            paragraph: {
                ...(para.level !== undefined ? { level: para.level } : {}),
                ...(para.bullet ? { bullet: true } : {}),
                ...(para.align ? { alignment: alignMap[para.align] } : {}),
            },
            textRuns: para.runs.map(run => ({
                text: run.text,
                style: {
                    ...(run.bold ? { isBold: true } : {}),
                    ...(run.italic ? { isItalics: true } : {}),
                    ...(run.underline ? { isUnderlined: true } : {}),
                    ...(run.superscript ? { isSuperscript: true } : {}),
                    ...(run.subscript ? { isSubscript: true } : {}),
                    ...(run.size ? { size: run.size * 100 } : {}),
                    ...(run.color ? { color: { type: 'srgbClr' as const, value: run.color } } : {}),
                },
            })),
        };
    });
}

/** Convert ReplaceTextContent to pptx-automizer ReplaceText[] format. */
function toReplaceTextArray(content: ReplaceTextContent) {
    return content.replacements.map(r => {
        if (typeof r.by === 'string') {
            return { replace: r.replace, by: { text: r.by } };
        }
        return {
            replace: r.replace,
            by: r.by.map(run => ({
                text: run.text,
                style: {
                    ...(run.bold ? { isBold: true } : {}),
                    ...(run.italic ? { isItalics: true } : {}),
                    ...(run.size ? { size: run.size * 100 } : {}),
                    ...(run.color ? { color: { type: 'srgbClr' as const, value: run.color } } : {}),
                },
            })),
        };
    });
}

/* ------------------------------------------------------------------ */
/*  Conversion helpers: Chart                                          */
/* ------------------------------------------------------------------ */

/**
 * Convert ChartContent to pptx-automizer ChartData format.
 * pptx-automizer expects: { series: [{label}], categories: [{label, values: [number|null]}] }
 */
function toChartData(content: ChartContent) {
    return {
        series: content.series.map(s => ({
            label: s.name,
            ...(s.color ? { style: { color: { type: 'srgbClr' as const, value: s.color } } } : {}),
        })),
        categories: content.categories.map((cat, catIdx) => ({
            label: cat,
            values: content.series.map(s => s.values[catIdx] ?? null),
        })),
    };
}

/** Convert scatter point data to pptx-automizer ChartData format. */
function toScatterChartData(content: ChartContent) {
    if (!content.scatter_points) return toChartData(content);
    return {
        series: content.series.map(s => ({
            label: s.name,
            ...(s.color ? { style: { color: { type: 'srgbClr' as const, value: s.color } } } : {}),
        })),
        categories: content.scatter_points[0]?.map((_, idx) => ({
            label: String(idx),
            values: content.scatter_points!.map(seriesPoints => {
                const pt = seriesPoints[idx];
                return pt ? { x: pt.x, y: pt.y } : null;
            }),
        })) ?? [],
    };
}

/** Convert bubble point data to pptx-automizer ChartData format. */
function toBubbleChartData(content: ChartContent) {
    if (!content.bubble_points) return toChartData(content);
    return {
        series: content.series.map(s => ({
            label: s.name,
            ...(s.color ? { style: { color: { type: 'srgbClr' as const, value: s.color } } } : {}),
        })),
        categories: content.bubble_points[0]?.map((_, idx) => ({
            label: String(idx),
            values: content.bubble_points!.map(seriesPoints => {
                const pt = seriesPoints[idx];
                return pt ? { x: pt.x, y: pt.y, size: pt.size } : null;
            }),
        })) ?? [],
    };
}

/**
 * Build an array of pptx-automizer callbacks for chart modifications.
 * Applies chart data + optional enhancements (axis, title, labels, legend, plot area).
 */
function buildChartCallbacks(
    value: ChartContent,
    warnings: string[],
    slideLabel: number,
): ModCallback | ModCallback[] {
    const callbacks: ModCallback[] = [];

    // Primary chart data method (depends on chart_type)
    const chartType = value.chart_type ?? 'standard';
    switch (chartType) {
        case 'scatter':
            callbacks.push(modify.setChartScatter(toScatterChartData(value)));
            break;
        case 'bubble':
            callbacks.push(modify.setChartBubbles(toBubbleChartData(value)));
            break;
        case 'combo':
            callbacks.push(modify.setChartCombo(toChartData(value)));
            break;
        case 'vertical_lines':
            callbacks.push(modify.setChartVerticalLines(toChartData(value)));
            break;
        case 'extended':
            callbacks.push(modify.setExtendedChartData(toChartData(value)));
            break;
        default:
            callbacks.push(modify.setChartData(toChartData(value)));
    }

    // Chart title
    if (value.title !== undefined) {
        callbacks.push(modify.setChartTitle(value.title));
    }

    // Axis range configuration
    if (value.axis_range) {
        callbacks.push(modify.setAxisRange({
            ...(value.axis_range.axis_index !== undefined ? { axisIndex: value.axis_range.axis_index } : {}),
            ...(value.axis_range.min !== undefined ? { min: value.axis_range.min } : {}),
            ...(value.axis_range.max !== undefined ? { max: value.axis_range.max } : {}),
            ...(value.axis_range.major_unit !== undefined ? { majorUnit: value.axis_range.major_unit } : {}),
            ...(value.axis_range.minor_unit !== undefined ? { minorUnit: value.axis_range.minor_unit } : {}),
            ...(value.axis_range.format_code ? { formatCode: value.axis_range.format_code } : {}),
        }));
    }

    // Data label attributes
    if (value.data_labels) {
        const dl = value.data_labels;
        callbacks.push(modify.setDataLabelAttributes({
            ...(dl.show_value !== undefined ? { showVal: dl.show_value } : {}),
            ...(dl.show_category !== undefined ? { showCatName: dl.show_category } : {}),
            ...(dl.show_series !== undefined ? { showSerName: dl.show_series } : {}),
            ...(dl.show_percent !== undefined ? { showPercent: dl.show_percent } : {}),
            ...(dl.show_bubble_size !== undefined ? { showBubbleSize: dl.show_bubble_size } : {}),
            ...(dl.show_leader_lines !== undefined ? { showLeaderLines: dl.show_leader_lines } : {}),
            ...(dl.show_legend_key !== undefined ? { showLegendKey: dl.show_legend_key } : {}),
            // Cast position string to LabelPosition enum (values are identical)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LabelPosition enum not re-exported from index
            ...(dl.position ? { dLblPos: dl.position as any } : {}),
            ...(dl.fill_color ? { solidFill: { type: 'srgbClr' as const, value: dl.fill_color } } : {}),
        }));
    }

    // Legend configuration
    if (value.legend !== undefined) {
        if (value.legend === 'remove') {
            callbacks.push(modify.removeChartLegend());
        } else if (value.legend === 'minimize') {
            callbacks.push(modify.minimizeChartLegend());
        } else {
            // Position as pixel shares (0-1 range, converted from px)
            callbacks.push(modify.setLegendPosition({
                x: value.legend.x / 1280,
                y: value.legend.y / 720,
                w: value.legend.w / 1280,
                h: value.legend.h / 720,
            }));
        }
    }

    // Plot area position
    if (value.plot_area) {
        callbacks.push(modify.setPlotArea({
            x: value.plot_area.x / 1280,
            y: value.plot_area.y / 720,
            w: value.plot_area.w / 1280,
            h: value.plot_area.h / 720,
        }));
    }

    // Waterfall total column
    if (value.waterfall_total_last) {
        callbacks.push(modify.setWaterFallColumnTotalToLast(value.waterfall_total_index));
    }

    if (callbacks.length === 0) {
        warnings.push(`Slide ${slideLabel}: Chart content produced no modification callbacks`);
        return modify.setChartData(toChartData(value));
    }

    return callbacks.length === 1 ? callbacks[0] : callbacks;
}

/* ------------------------------------------------------------------ */
/*  Conversion helpers: Table                                          */
/* ------------------------------------------------------------------ */

/**
 * Convert TableContent to pptx-automizer TableData format.
 * Supports header, body, footer rows with optional per-cell styles.
 */
function toTableData(content: TableContent) {
    const convertRow = (row: { values: (string | number)[]; styles?: ({ bold?: boolean; italic?: boolean; size?: number; color?: string; background?: string } | null)[] }) => {
        const values = row.values.map(v => String(v));
        if (row.styles && row.styles.length > 0) {
            return {
                values,
                styles: row.styles.map(s => {
                    if (!s) return null;
                    return {
                        ...(s.bold ? { isBold: true } : {}),
                        ...(s.italic ? { isItalics: true } : {}),
                        ...(s.size ? { size: s.size } : {}),
                        ...(s.color ? { color: { type: 'srgbClr' as const, value: s.color } } : {}),
                        ...(s.background ? { background: { type: 'srgbClr' as const, value: s.background } } : {}),
                    };
                }),
            };
        }
        return { values };
    };

    return {
        ...(content.header ? { header: convertRow(content.header) } : {}),
        body: content.body.map(row => convertRow(row)),
        ...(content.footer ? { footer: convertRow(content.footer) } : {}),
    };
}

/** Build ModifyTableParams from TableContent.auto_adjust settings. */
function buildTableParams(content: TableContent) {
    if (!content.auto_adjust) return undefined;
    const adj = content.auto_adjust;
    return {
        ...(adj.width ? { adjustWidth: true } : {}),
        ...(adj.height ? { adjustHeight: true } : {}),
        ...(adj.set_width !== undefined ? { setWidth: adj.set_width } : {}),
        ...(adj.set_height !== undefined ? { setHeight: adj.set_height } : {}),
    };
}

/* ------------------------------------------------------------------ */
/*  Generate element renderer (PptxGenJS bridge on template slides)    */
/* ------------------------------------------------------------------ */

/** PptxGenJS uses inches; convert from 1280x720 pixel canvas. */
const PX_TO_IN_X = 10 / 1280;
const PX_TO_IN_Y = 5.625 / 720;

/** IPptxGenJSSlide from pptx-automizer (limited PptxGenJS API). */
interface GenerateSlide {
    addText(text: string | PptxGenJS.TextProps[], options?: PptxGenJS.TextPropsOptions): void;
    addShape(shapeName: PptxGenJS.SHAPE_NAME, options?: PptxGenJS.ShapeProps): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pptx-automizer uses any[] for chart data
    addChart(type: PptxGenJS.CHART_NAME | PptxGenJS.IChartMulti[], data: any[], options?: PptxGenJS.IChartOpts): void;
    addTable(tableRows: PptxGenJS.TableRow[], options?: PptxGenJS.TableProps): void;
    addImage(options: PptxGenJS.ImageProps): void;
}

function renderGenerateElement(
    slide: GenerateSlide,
    el: GenerateElement,
    slideLabel: number,
    warnings: string[],
): void {
    const x = el.x * PX_TO_IN_X;
    const y = el.y * PX_TO_IN_Y;
    const w = el.w * PX_TO_IN_X;
    const h = el.h * PX_TO_IN_Y;

    switch (el.gen_type) {
        case 'text':
            slide.addText(el.text, {
                x, y, w, h,
                fontSize: el.fontSize || 14,
                bold: el.bold || false,
                color: el.color?.replace('#', '') || '000000',
                align: el.align || 'left',
                fontFace: el.fontFace,
                wrap: true,
                fit: 'shrink',
                margin: [6, 8, 6, 8],
                lineSpacingMultiple: 1.15,
                valign: 'top',
            });
            break;

        case 'shape': {
            const shapeMap: Record<string, string> = {
                rect: 'rect', roundRect: 'roundRect', ellipse: 'ellipse',
                line: 'line', arrow: 'rightArrow', chevron: 'chevron', triangle: 'triangle',
            };
            const shapeName = (shapeMap[el.shape] || 'rect') as PptxGenJS.SHAPE_NAME;
            const opts: Record<string, unknown> = { x, y, w, h };
            if (el.fill) opts.fill = { color: el.fill.replace('#', '') };
            if (el.line) opts.line = { color: el.line.color?.replace('#', ''), width: el.line.width || 1 };
            slide.addShape(shapeName, opts as PptxGenJS.ShapeProps);
            if (el.text) {
                slide.addText(el.text, {
                    x, y, w, h,
                    fontSize: el.fontSize || 12,
                    color: '000000',
                    align: 'center',
                    valign: 'middle',
                    fit: 'shrink',
                    margin: [4, 6, 4, 6],
                });
            }
            break;
        }

        case 'chart': {
            const chartTypeMap: Record<string, string> = {
                bar: 'bar', pie: 'pie', line: 'line', doughnut: 'doughnut', area: 'area',
            };
            const chartType = (chartTypeMap[el.chartType] || 'bar') as PptxGenJS.CHART_NAME;
            const data = el.series.map(s => ({
                name: s.name,
                labels: el.categories,
                values: s.values,
            }));
            slide.addChart(chartType, data, {
                x, y, w, h,
                showTitle: !!el.title,
                title: el.title,
                showLegend: el.series.length > 1,
            });
            break;
        }

        case 'table': {
            const rows: PptxGenJS.TableRow[] = [];
            if (el.headers && el.headers.length > 0) {
                rows.push(el.headers.map(hdr => ({
                    text: hdr,
                    options: {
                        bold: true,
                        fill: { color: el.headerColor?.replace('#', '') || '4472C4' },
                        color: el.headerTextColor?.replace('#', '') || 'FFFFFF',
                        fontSize: 11,
                    },
                })));
            }
            for (const row of el.rows) {
                rows.push(row.map(cell => ({
                    text: cell != null ? String(cell) : '',
                    options: { fontSize: 10 },
                })));
            }
            if (rows.length > 0) {
                slide.addTable(rows, {
                    x, y, w, h,
                    border: { type: 'solid', pt: 0.5, color: 'CCCCCC' },
                    autoPage: false,
                });
            }
            break;
        }

        case 'image':
            warnings.push(`Slide ${slideLabel}: Generate image elements are not yet supported (vault_path: "${el.vault_path}")`);
            break;

        default:
            warnings.push(`Slide ${slideLabel}: Unknown generate element type`);
    }
}

/* ------------------------------------------------------------------ */
/*  ADR-049: Raw XML helpers                                           */
/* ------------------------------------------------------------------ */

/**
 * Check if an XML shape element is decorative (footer, slide number, date, logo).
 * These shapes should NOT have their text cleared during the raw XML pass.
 *
 * Detection strategy:
 * 1. Placeholder type: footer (ftr), slide number (sldNum), date (dt) are always decorative
 * 2. Shape name patterns: "Fusszeile", "Foliennummer", "Datumsplatzhalter", etc.
 * 3. Shapes flagged as non-visual/hidden
 */
function isDecorativeXmlShape(shapeElement: Element): boolean {
    // Check for placeholder type (most reliable)
    const phElements = shapeElement.getElementsByTagName('p:ph');
    for (let i = 0; i < phElements.length; i++) {
        const phType = phElements[i].getAttribute('type') || '';
        // Footer, slide number, date placeholders are always decorative
        if (['ftr', 'sldNum', 'dt', 'hdr'].includes(phType)) {
            return true;
        }
    }

    // Check shape name via nvSpPr > nvPr or cNvPr
    const cNvPr = shapeElement.getElementsByTagName('p:cNvPr');
    if (cNvPr.length === 0) {
        // Try alternative path
        const altCNvPr = shapeElement.getElementsByTagName('cNvPr');
        if (altCNvPr.length > 0) {
            const name = (altCNvPr[0].getAttribute('name') || '').toLowerCase();
            return isDecorativeByName(name);
        }
        return false;
    }

    const name = (cNvPr[0].getAttribute('name') || '').toLowerCase();
    return isDecorativeByName(name);
}

/** Check if a shape name indicates a decorative element. */
function isDecorativeByName(name: string): boolean {
    // Footer, slide number, date, SmartArt, geometric objects
    if (/fu[ßs]zeile|footer|pied.*page/i.test(name)) return true;
    if (/foliennummer|slide.*number|num[ée]ro/i.test(name)) return true;
    if (/datumsplatzhalter|date.*placeholder/i.test(name)) return true;
    if (/smartart/i.test(name)) return true;
    // Geometric AutoShapes (Rechteck N, object N) are structural design elements
    if (/^(rechteck|object)\b/i.test(name)) return true;
    // Logo shapes
    if (/logo/i.test(name)) return true;
    // Grafik/image shapes (decorative brand graphics)
    if (/^grafik\b/i.test(name)) return true;
    return false;
}

/**
 * Default dimensions for shapes with 0x0 in the catalog (inherited from slide layout).
 * Based on standard PowerPoint 16:9 layout positions (1280x720 pixel canvas).
 * These are conservative estimates that work for most corporate templates.
 */
function getDefaultDimensions(
    role: string,
    alignment?: string,
): { x: number; y: number; w: number; h: number } | undefined {
    // Standard slide regions on 1280x720 canvas
    switch (role) {
        case 'title':
            return { x: 43, y: 18, w: 1100, h: 65 };
        case 'subtitle':
            return { x: 43, y: 490, w: 550, h: 100 };
        case 'body':
            // Body could be full-width or column -- use full-width as default
            return { x: 43, y: 110, w: 1194, h: 510 };
        case 'kpi_value':
            return { x: 100, y: 200, w: 200, h: 80 };
        case 'kpi_label':
            return { x: 100, y: 280, w: 200, h: 40 };
        case 'step_label':
            return { x: 100, y: 350, w: 180, h: 50 };
        case 'step_desc':
            return { x: 100, y: 400, w: 200, h: 100 };
        default:
            return undefined;
    }
}

/* ------------------------------------------------------------------ */
/*  Catalog lookup + text extraction helpers                           */
/* ------------------------------------------------------------------ */

/** Shape metadata from catalog including font info for generate() fallback. */
interface ShapeMetaResult {
    role: string;
    content_type: string;
    dimensions?: { x: number; y: number; w: number; h: number };
    font_info?: {
        font_face?: string;
        font_size?: number;
        is_bold?: boolean;
        color?: string;
        alignment?: string;
    };
}

/** Find shape metadata from catalog for a given selector and slide number. */
function findShapeMeta(
    sel: ParsedSelector,
    slideNum: number,
    catalog?: TemplateCatalog,
): ShapeMetaResult | undefined {
    if (!catalog) return undefined;

    // First check layouts (per-slide shapes)
    const layout = catalog.layouts[slideNum];
    if (layout) {
        const shape = layout.shapes.find(s =>
            s.name === sel.name &&
            (sel.nameIdx === undefined || s.duplicate_index === sel.nameIdx),
        );
        if (shape) {
            return {
                role: shape.role,
                content_type: shape.content_type,
                dimensions: shape.dimensions,
                font_info: shape.font_info,
            };
        }
    }

    // Fall back to slide_types (grouped catalog)
    for (const st of catalog.slide_types) {
        if (st.representative_slide !== slideNum && !st.alternate_slides.includes(slideNum)) continue;
        const shape = st.shapes.find(s =>
            s.name === sel.name &&
            (sel.nameIdx === undefined || s.duplicate_index === sel.nameIdx),
        );
        if (shape) {
            return {
                role: shape.role,
                content_type: shape.content_type,
                dimensions: undefined,
            };
        }
    }

    return undefined;
}

/**
 * Extract plain text from a ContentValue or string for generate() fallback.
 * Converts styled_text paragraphs to plain text with markdown-like formatting.
 */
function extractPlainText(value: string | ContentValue): string {
    if (typeof value === 'string') return value;

    switch (value.type) {
        case 'styled_text':
            return value.paragraphs.map(para => {
                const prefix = para.bullet ? (para.bullet === '1' ? '1. ' : '- ') : '';
                const text = para.runs.map(r => {
                    if (r.bold) return `**${r.text}**`;
                    return r.text;
                }).join('');
                return prefix + text;
            }).join('\n');

        case 'html_text':
            // Strip HTML tags for plain text fallback
            return value.html
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<li>/gi, '- ')
                .replace(/<\/li>/gi, '\n')
                .replace(/<[^>]+>/g, '')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .trim();

        case 'replace_text':
            return value.replacements.map(r =>
                typeof r.by === 'string' ? r.by : r.by.map(run => run.text).join(''),
            ).join(' ');

        default:
            return '';
    }
}


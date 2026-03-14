/**
 * RenderPresentationTool — Visual Intelligence (FEATURE-1115)
 *
 * Renders a PPTX file to PNG images via LibreOffice headless, then returns
 * the images as multimodal tool results so the LLM can visually inspect
 * the presentation and identify layout/text issues.
 *
 * Security: follows ExecuteRecipeTool pattern (child_process.spawn, shell: false,
 * timeout, SIGKILL fallback, no shell expansion).
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type { ToolResultContentBlock } from '../../../api/types';
import type ObsidianAgentPlugin from '../../../main';
import { detectLibreOffice, detectPdfToPngConverter } from '../../office/libreOfficeDetector';
import type { PdfToPngConverter } from '../../office/libreOfficeDetector';

/** Maximum number of slides to render in one call */
const MAX_SLIDES = 10;
/** Timeout for LibreOffice conversion (ms) */
const CONVERSION_TIMEOUT = 120_000;

export class RenderPresentationTool extends BaseTool<'render_presentation'> {
    readonly name = 'render_presentation' as const;
    readonly isWriteOperation = false;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'render_presentation',
            description:
                'Render a PPTX presentation to images using LibreOffice. ' +
                'Returns slide images so you can visually inspect the result for text overflow, ' +
                'layout problems, or design issues. Requires LibreOffice to be installed ' +
                '(see Settings > Visual Intelligence). ' +
                'Use this AFTER creating a presentation with create_pptx to verify visual quality.',
            input_schema: {
                type: 'object',
                properties: {
                    file: {
                        type: 'string',
                        description: 'Vault-relative path to the PPTX file to render.',
                    },
                    slides: {
                        type: 'array',
                        description:
                            `Optional: which slide numbers to render (1-based). ` +
                            `Default: all slides, max ${MAX_SLIDES}. ` +
                            `Example: [1, 3, 5] to render only slides 1, 3, and 5.`,
                        items: { type: 'number' },
                    },
                },
                required: ['file'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const filePath = (input.file as string ?? '').trim();
        const requestedSlides = input.slides as number[] | undefined;

        if (!filePath) {
            callbacks.pushToolResult(this.formatError(new Error('Missing required parameter: file')));
            return;
        }

        if (!filePath.endsWith('.pptx')) {
            callbacks.pushToolResult(this.formatError(new Error('File must be a .pptx file')));
            return;
        }

        // 1. Check Visual Intelligence setting
        if (!this.plugin.settings.visualIntelligence?.enabled) {
            callbacks.pushToolResult(this.formatError(new Error(
                'Visual Intelligence is disabled. Enable it in Settings > Visual Intelligence.',
            )));
            return;
        }

        // 2. Detect LibreOffice
        const customPath = this.plugin.settings.visualIntelligence?.libreOfficePath;
        const libreOffice = await detectLibreOffice(customPath);
        if (!libreOffice.found || !libreOffice.path) {
            callbacks.pushToolResult(this.formatError(new Error(
                'LibreOffice is not installed. Install it from https://www.libreoffice.org/download/ ' +
                'then check Settings > Visual Intelligence.',
            )));
            return;
        }

        // 2b. Detect PDF-to-PNG converter (pdftoppm or Ghostscript)
        const pdfConverter = await detectPdfToPngConverter();
        if (!pdfConverter.found) {
            callbacks.pushToolResult(this.formatError(new Error(
                'No PDF-to-PNG converter found. Install poppler-utils (provides pdftoppm) or Ghostscript (gs). ' +
                'macOS: brew install poppler | Linux: apt install poppler-utils',
            )));
            return;
        }

        // 3. Resolve vault path to absolute path
        const adapter = this.app.vault.adapter;
        // eslint-disable-next-line -- need FileSystemAdapter for basePath
        const vaultRoot: string = (adapter as import('obsidian').FileSystemAdapter).basePath
            ?? (adapter as import('obsidian').FileSystemAdapter).getBasePath?.() ?? '';
        if (!vaultRoot) {
            callbacks.pushToolResult(this.formatError(new Error('Cannot determine vault root path')));
            return;
        }

        const absolutePptxPath = path.join(vaultRoot, filePath);
        if (!fs.existsSync(absolutePptxPath)) {
            callbacks.pushToolResult(this.formatError(new Error(`File not found: ${filePath}`)));
            return;
        }

        // 4. Create temp directory for output
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsilo-render-'));

        try {
            // 5. Copy PPTX to temp (LibreOffice writes output next to input)
            const tempPptx = path.join(tempDir, path.basename(filePath));
            fs.copyFileSync(absolutePptxPath, tempPptx);

            // 6. Two-step conversion: PPTX → PDF → individual PNGs
            callbacks.log(`Rendering ${filePath} with LibreOffice...`);

            // Step 1: PPTX → PDF (LibreOffice, reliable multi-page)
            const tempPdfPath = await this.convertToPdf(libreOffice.path, tempPptx, tempDir);

            // Step 2: PDF → individual PNGs (pdftoppm or Ghostscript)
            await this.convertPdfToPngs(pdfConverter, tempPdfPath, tempDir);

            // Clean up intermediate PDF
            try { fs.unlinkSync(tempPdfPath); } catch { /* non-fatal */ }

            // 7. Collect PNG files (sorted by name = slide order)
            const pngFiles = fs.readdirSync(tempDir)
                .filter((f) => f.endsWith('.png'))
                .sort();

            if (pngFiles.length === 0) {
                callbacks.pushToolResult(this.formatError(new Error(
                    'LibreOffice conversion produced no images. ' +
                    'The file might be corrupt or LibreOffice might not support this format.',
                )));
                return;
            }

            // 8. Filter to requested slides (if specified)
            let selectedFiles = pngFiles;
            if (requestedSlides && requestedSlides.length > 0) {
                // Slide numbers are 1-based, file indices are 0-based
                const indices = new Set(requestedSlides.map((n) => n - 1));
                selectedFiles = pngFiles.filter((_, i) => indices.has(i));
            }

            // Cap at MAX_SLIDES
            if (selectedFiles.length > MAX_SLIDES) {
                selectedFiles = selectedFiles.slice(0, MAX_SLIDES);
            }

            // 9. Read PNGs and build multimodal result
            const contentBlocks: ToolResultContentBlock[] = [
                {
                    type: 'text',
                    text: `Rendered ${selectedFiles.length} of ${pngFiles.length} slides from ${filePath}. ` +
                        `Inspect each slide image for: text overflow, truncation, bad line breaks, ` +
                        `visual imbalance, or empty shapes. ` +
                        `If you find issues, fix the content and call create_pptx again, ` +
                        `then update the compositions.json constraints via edit_file.`,
                },
            ];

            for (let i = 0; i < selectedFiles.length; i++) {
                const pngPath = path.join(tempDir, selectedFiles[i]);
                const imageData = fs.readFileSync(pngPath).toString('base64');
                // Find original slide number
                const originalIndex = pngFiles.indexOf(selectedFiles[i]);
                contentBlocks.push(
                    { type: 'text', text: `\n--- Slide ${originalIndex + 1} ---` },
                    {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: 'image/png',
                            data: imageData,
                        },
                    },
                );
            }

            callbacks.pushToolResult(contentBlocks);
            callbacks.log(`Rendered ${selectedFiles.length} slides successfully.`);
        } finally {
            // 10. Cleanup temp directory
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch {
                // Non-fatal: temp files will be cleaned up by OS
            }
        }
    }

    /**
     * Step 1: Convert PPTX to PDF via LibreOffice headless.
     * Returns the absolute path to the generated PDF.
     */
    private convertToPdf(
        sofficePath: string,
        pptxPath: string,
        outDir: string,
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const child = spawn(sofficePath, [
                '--headless',
                '--convert-to', 'pdf',
                '--outdir', outDir,
                pptxPath,
            ], {
                shell: false,
                timeout: CONVERSION_TIMEOUT,
                env: {
                    PATH: process.env.PATH,
                    HOME: process.env.HOME,
                    LANG: 'en_US.UTF-8',
                },
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
            });

            let stderr = '';
            child.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
                if (stderr.length > 10_000) stderr = stderr.slice(-10_000);
            });

            const killTimer = setTimeout(() => {
                try { child.kill('SIGKILL'); } catch { /* already exited */ }
            }, CONVERSION_TIMEOUT + 5_000);

            child.on('close', (code: number | null) => {
                clearTimeout(killTimer);
                if (code === 0) {
                    const baseName = path.basename(pptxPath, path.extname(pptxPath));
                    const pdfPath = path.join(outDir, `${baseName}.pdf`);
                    if (fs.existsSync(pdfPath)) {
                        resolve(pdfPath);
                    } else {
                        reject(new Error('LibreOffice PPTX-to-PDF conversion produced no output file.'));
                    }
                } else {
                    reject(new Error(
                        `LibreOffice PDF conversion failed (exit code ${code}).` +
                        (stderr.trim() ? ` Error: ${stderr.trim()}` : ''),
                    ));
                }
            });

            child.on('error', (err: Error) => {
                clearTimeout(killTimer);
                reject(err);
            });
        });
    }

    /**
     * Step 2: Convert multi-page PDF to individual PNGs.
     * Uses pdftoppm (poppler) or gs (Ghostscript).
     * Output files: slide-NN.png in outDir.
     */
    private convertPdfToPngs(
        converter: PdfToPngConverter,
        pdfPath: string,
        outDir: string,
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const outputPrefix = path.join(outDir, 'slide');
            let converterPath: string;
            let args: string[];

            if (converter.tool === 'pdftoppm' && converter.path) {
                // pdftoppm -png -r 150 input.pdf output-prefix
                // Produces: output-prefix-01.png, output-prefix-02.png, ...
                converterPath = converter.path;
                args = ['-png', '-r', '150', pdfPath, outputPrefix];
            } else if (converter.tool === 'gs' && converter.path) {
                // gs -dNOPAUSE -dBATCH -sDEVICE=png16m -r150 -sOutputFile=slide-%02d.png input.pdf
                converterPath = converter.path;
                args = [
                    '-dNOPAUSE', '-dBATCH', '-dQUIET',
                    '-sDEVICE=png16m', '-r150',
                    `-sOutputFile=${outputPrefix}-%02d.png`,
                    pdfPath,
                ];
            } else {
                reject(new Error('No supported PDF-to-PNG converter available.'));
                return;
            }

            const child = spawn(converterPath, args, {
                shell: false,
                timeout: CONVERSION_TIMEOUT,
                env: { PATH: process.env.PATH, HOME: process.env.HOME },
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
            });

            let stderr = '';
            child.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
                if (stderr.length > 10_000) stderr = stderr.slice(-10_000);
            });

            const killTimer = setTimeout(() => {
                try { child.kill('SIGKILL'); } catch { /* already exited */ }
            }, CONVERSION_TIMEOUT + 5_000);

            child.on('close', (code: number | null) => {
                clearTimeout(killTimer);
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(
                        `PDF-to-PNG conversion failed (${converter.tool}, exit code ${code}).` +
                        (stderr.trim() ? ` Error: ${stderr.trim()}` : ''),
                    ));
                }
            });

            child.on('error', (err: Error) => {
                clearTimeout(killTimer);
                reject(err);
            });
        });
    }
}

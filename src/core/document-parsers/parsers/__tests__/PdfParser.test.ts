/**
 * Regression-tests for FIX-06-01-01 (parseDocument plugin-ref drift).
 *
 * Pins two invariants:
 *   1. parsePdf without `plugin.bundleLoader` returns the NOT_INSTALLED
 *      placeholder. (current intentional fallback)
 *   2. parsePdf delegates the binary blob to `plugin.bundleLoader
 *      .loadPdfjsBundle()` when the loader is available. (the path the
 *      drift bypassed before the fix -- five call-sites used to pass no
 *      plugin and silently landed in branch 1.)
 *
 * The compile-time guarantee that all call-sites pass a plugin instance
 * is enforced by the required `plugin` parameter on parsePdf and
 * parseDocument; this file pins the runtime behaviour that the type
 * system protects.
 */

import { describe, it, expect, vi } from 'vitest';
import { parsePdf } from '../PdfParser';
import type ObsidianAgentPlugin from '../../../../main';

function makeBuffer(text = 'data'): ArrayBuffer {
    return new TextEncoder().encode(text).buffer;
}

function makePluginWithoutLoader(): ObsidianAgentPlugin {
    return {} as ObsidianAgentPlugin;
}

function makePluginWithLoader(loadPdfjsBundle: () => Promise<unknown>): ObsidianAgentPlugin {
    return {
        bundleLoader: { loadPdfjsBundle },
    } as unknown as ObsidianAgentPlugin;
}

describe('parsePdf (FIX-06-01-01)', () => {
    it('returns NOT_INSTALLED placeholder when plugin has no bundleLoader', async () => {
        const result = await parsePdf(makeBuffer(), makePluginWithoutLoader());
        expect(result.text).toContain('PDF Parser is not installed');
        expect(result.metadata.format).toBe('pdf');
        expect(result.images).toEqual([]);
    });

    it('returns NOT_INSTALLED placeholder when bundleLoader.loadPdfjsBundle() returns null', async () => {
        const loadPdfjsBundle = vi.fn().mockResolvedValue(null);
        const result = await parsePdf(makeBuffer(), makePluginWithLoader(loadPdfjsBundle));
        expect(loadPdfjsBundle).toHaveBeenCalledOnce();
        expect(result.text).toContain('PDF Parser is not installed');
    });

    it('calls bundleLoader.loadPdfjsBundle() exactly once when invoked', async () => {
        const loadPdfjsBundle = vi.fn().mockResolvedValue(null);
        await parsePdf(makeBuffer(), makePluginWithLoader(loadPdfjsBundle));
        expect(loadPdfjsBundle).toHaveBeenCalledOnce();
    });
});

/**
 * Regression-tests for AUDIT-034 L-3 (CWE-400 PDF page/byte cap).
 *
 * Pins MAX_PAGES=2000 and MAX_TEXT_BYTES=50 MB ceilings: a malicious PDF
 * advertising 100k pages must be capped, and a single page with multi-MB
 * of text must trigger an early break with a (truncated) sentinel.
 */
function makePdfStub(numPages: number, pageTextProvider: (page: number) => string) {
    const getPage = vi.fn(async (pageNum: number) => ({
        getTextContent: async () => ({
            items: [{ str: pageTextProvider(pageNum) }],
        }),
    }));
    return {
        getPage,
        numPages,
    };
}

function makePluginWithStubbedPdfjs(pdfStub: { getPage: ReturnType<typeof vi.fn>; numPages: number }): ObsidianAgentPlugin {
    const getDocument = vi.fn(() => ({
        promise: Promise.resolve(pdfStub),
    }));
    return {
        bundleLoader: {
            loadPdfjsBundle: vi.fn().mockResolvedValue({
                pdfjs: {
                    GlobalWorkerOptions: { workerSrc: '' },
                    getDocument,
                },
            }),
        },
    } as unknown as ObsidianAgentPlugin;
}

describe('parsePdf (AUDIT-034 L-3 caps)', () => {
    it('caps numPages at MAX_PAGES (2000) and appends a truncation sentinel', async () => {
        const pdfStub = makePdfStub(100_000, (page) => `page-${page}-body`);
        const plugin = makePluginWithStubbedPdfjs(pdfStub);
        const result = await parsePdf(makeBuffer(), plugin);
        // Loop must stop at 2000 even though the document advertises 100k pages.
        expect(pdfStub.getPage).toHaveBeenCalledTimes(2000);
        expect(result.text).toContain('## Page 2000');
        expect(result.text).not.toContain('## Page 2001');
        expect(result.text).toContain('(truncated: PDF has 100000 pages, only the first 2000 were parsed)');
        // pageCount in metadata stays the advertised value so callers can detect skew.
        expect(result.metadata.pageCount).toBe(100_000);
    });

    it('breaks early when accumulated text exceeds MAX_TEXT_BYTES (50 MB)', async () => {
        // Each page produces ~2 MB of text. 30 pages -> 60 MB total, must abort
        // somewhere before page 30 with the byte-cap sentinel.
        const bigChunk = 'x'.repeat(2 * 1024 * 1024);
        const pdfStub = makePdfStub(50, () => bigChunk);
        const plugin = makePluginWithStubbedPdfjs(pdfStub);
        const result = await parsePdf(makeBuffer(), plugin);
        expect(pdfStub.getPage.mock.calls.length).toBeLessThan(50);
        expect(result.text).toContain('(truncated: text output exceeded');
        // Output length stays under the cap plus the small sentinel string.
        expect(result.text.length).toBeLessThan(50 * 1024 * 1024 + 1024);
    });

    it('does not append a truncation sentinel for a small PDF', async () => {
        const pdfStub = makePdfStub(3, (page) => `page-${page}-body`);
        const plugin = makePluginWithStubbedPdfjs(pdfStub);
        const result = await parsePdf(makeBuffer(), plugin);
        expect(pdfStub.getPage).toHaveBeenCalledTimes(3);
        expect(result.text).not.toContain('(truncated');
        expect(result.text).toContain('## Page 3');
        expect(result.metadata.pageCount).toBe(3);
    });
});

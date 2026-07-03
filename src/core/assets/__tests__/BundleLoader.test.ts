/**
 * Tests for BundleLoader -- runtime loader for the JS Optional Assets
 * (office-bundle.js, pdfjs-bundle.js, reranker-bundle.js).
 *
 * Covers the FIX-42-06-01 additions: loadRerankerBundle (cache semantics,
 * eval path, fail-open), the prompt-aware *WithPrompt variants that raise
 * the in-chat install card via ctx.onOptionalAssetRequired, and the
 * generic requestOptionalAsset raw-buffer path (reranker WASM).
 *
 * OptionalAssetManager is mocked at the class boundary (load()); the spec
 * builders stay real so the tests pin the actual asset ids/filenames.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Plugin from '../../../main';
import type { ToolExecutionContext } from '../../tools/types';
import type { OptionalAssetInstallResult } from '../../tool-execution/ToolExecutionPipeline';
import { BundleLoader } from '../BundleLoader';
import { buildRerankerSpec } from '../OptionalAssetManager';

const { loadMock } = vi.hoisted(() => ({ loadMock: vi.fn() }));

vi.mock('obsidian', () => ({
    requestUrl: vi.fn(),
}));

vi.mock('../OptionalAssetManager', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../OptionalAssetManager')>();
    return {
        ...actual,
        OptionalAssetManager: class {
            load = loadMock;
        },
    };
});

vi.mock('../assetHashes', () => ({
    OFFICE_BUNDLE_SHA256: 'a'.repeat(64),
    PDFJS_BUNDLE_SHA256: 'b'.repeat(64),
    RERANKER_JS_BUNDLE_SHA256: 'c'.repeat(64),
    RERANKER_WASM_SHA256: 'd'.repeat(64),
}));

function toArrayBuffer(text: string): ArrayBuffer {
    const bytes = new TextEncoder().encode(text);
    const out = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(out).set(bytes);
    return out;
}

/** Minimal CJS source matching the reranker-entry.ts export shape. */
const RERANKER_CJS = `module.exports = { transformers: { marker: 'tf' }, ort: { marker: 'ort' } };`;
const OFFICE_CJS = `module.exports = { ExcelJS: { marker: 'xl' }, docx: {}, PptxGenJS: {} };`;

function makePlugin(): Plugin {
    return { manifest: { version: '9.9.9' } } as unknown as Plugin;
}

function makeCtx(
    decision: OptionalAssetInstallResult['decision'] | null,
): { ctx: ToolExecutionContext; prompt: ReturnType<typeof vi.fn> } {
    const prompt = vi.fn().mockResolvedValue({ decision });
    const ctx = (decision === null
        ? {}
        : { onOptionalAssetRequired: prompt }) as unknown as ToolExecutionContext;
    return { ctx, prompt };
}

beforeEach(() => {
    loadMock.mockReset();
});

describe('BundleLoader.loadRerankerBundle', () => {
    it('evaluates the SHA-verified CJS buffer and returns { transformers, ort }', async () => {
        loadMock.mockResolvedValue(toArrayBuffer(RERANKER_CJS));
        const loader = new BundleLoader(makePlugin());

        const bundle = await loader.loadRerankerBundle();

        expect(bundle).not.toBeNull();
        expect((bundle?.transformers as unknown as { marker: string }).marker).toBe('tf');
        expect((bundle?.ort as { marker: string }).marker).toBe('ort');
        // The spec handed to the manager is the reranker-bundle asset.
        const spec = loadMock.mock.calls[0][0] as { id: string; filename: string; expectedSha256: string };
        expect(spec.id).toBe('reranker-bundle');
        expect(spec.filename).toBe('reranker-bundle.js');
        expect(spec.expectedSha256).toBe('c'.repeat(64));
    });

    it('returns null when the asset is not installed and caches the failure', async () => {
        loadMock.mockResolvedValue(null);
        const loader = new BundleLoader(makePlugin());

        expect(await loader.loadRerankerBundle()).toBeNull();
        expect(await loader.loadRerankerBundle()).toBeNull();
        // Failure is cached: the manager is only asked once.
        expect(loadMock).toHaveBeenCalledTimes(1);
    });

    it('caches successful loads for the session (single eval)', async () => {
        loadMock.mockResolvedValue(toArrayBuffer(RERANKER_CJS));
        const loader = new BundleLoader(makePlugin());

        const first = await loader.loadRerankerBundle();
        const second = await loader.loadRerankerBundle();

        expect(second).toBe(first);
        expect(loadMock).toHaveBeenCalledTimes(1);
    });

    it('reset() drops the cache so a reload re-evaluates', async () => {
        loadMock.mockResolvedValue(toArrayBuffer(RERANKER_CJS));
        const loader = new BundleLoader(makePlugin());

        await loader.loadRerankerBundle();
        loader.reset();
        await loader.loadRerankerBundle();

        expect(loadMock).toHaveBeenCalledTimes(2);
    });

    it('fails open (null + cached failure) when the bundle throws on eval', async () => {
        loadMock.mockResolvedValue(toArrayBuffer(`throw new Error('boom');`));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const loader = new BundleLoader(makePlugin());

        expect(await loader.loadRerankerBundle()).toBeNull();
        expect(await loader.loadRerankerBundle()).toBeNull();
        expect(loadMock).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });
});

describe('BundleLoader.loadRerankerBundleWithPrompt', () => {
    it('does not prompt when the bundle is already installed', async () => {
        loadMock.mockResolvedValue(toArrayBuffer(RERANKER_CJS));
        const { ctx, prompt } = makeCtx('installed');
        const loader = new BundleLoader(makePlugin());

        const bundle = await loader.loadRerankerBundleWithPrompt(ctx, 'rerank');

        expect(bundle).not.toBeNull();
        expect(prompt).not.toHaveBeenCalled();
    });

    it('prompts on miss and retries after decision=installed', async () => {
        loadMock
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(toArrayBuffer(RERANKER_CJS));
        const { ctx, prompt } = makeCtx('installed');
        const loader = new BundleLoader(makePlugin());

        const bundle = await loader.loadRerankerBundleWithPrompt(ctx, 'rerank');

        expect(bundle).not.toBeNull();
        expect(prompt).toHaveBeenCalledTimes(1);
        const [spec, toolName] = prompt.mock.calls[0] as [{ id: string }, string];
        expect(spec.id).toBe('reranker-bundle');
        expect(toolName).toBe('rerank');
        expect(loadMock).toHaveBeenCalledTimes(2);
    });

    it('returns null on decision=skipped without retrying', async () => {
        loadMock.mockResolvedValue(null);
        const { ctx, prompt } = makeCtx('skipped');
        const loader = new BundleLoader(makePlugin());

        expect(await loader.loadRerankerBundleWithPrompt(ctx, 'rerank')).toBeNull();
        expect(prompt).toHaveBeenCalledTimes(1);
        expect(loadMock).toHaveBeenCalledTimes(1);
    });

    it('returns null on decision=failed', async () => {
        loadMock.mockResolvedValue(null);
        const { ctx } = makeCtx('failed');
        const loader = new BundleLoader(makePlugin());

        expect(await loader.loadRerankerBundleWithPrompt(ctx, 'rerank')).toBeNull();
    });

    it('returns null when ctx has no onOptionalAssetRequired callback', async () => {
        loadMock.mockResolvedValue(null);
        const { ctx } = makeCtx(null);
        const loader = new BundleLoader(makePlugin());

        expect(await loader.loadRerankerBundleWithPrompt(ctx, 'rerank')).toBeNull();
        expect(await loader.loadRerankerBundleWithPrompt(undefined, 'rerank')).toBeNull();
    });
});

describe('BundleLoader.requestOptionalAsset (raw buffer, reranker WASM)', () => {
    const wasmSpec = buildRerankerSpec('9.9.9', 'd'.repeat(64));

    it('returns the preloaded buffer without prompting', async () => {
        const buf = toArrayBuffer('wasm-bytes');
        loadMock.mockResolvedValue(buf);
        const { ctx, prompt } = makeCtx('installed');
        const loader = new BundleLoader(makePlugin());

        expect(await loader.requestOptionalAsset(ctx, wasmSpec, 'rerank')).toBe(buf);
        expect(prompt).not.toHaveBeenCalled();
    });

    it('prompts on miss and reloads after decision=installed', async () => {
        const buf = toArrayBuffer('wasm-bytes');
        loadMock.mockResolvedValueOnce(null).mockResolvedValueOnce(buf);
        const { ctx, prompt } = makeCtx('installed');
        const loader = new BundleLoader(makePlugin());

        expect(await loader.requestOptionalAsset(ctx, wasmSpec, 'rerank')).toBe(buf);
        expect(prompt).toHaveBeenCalledTimes(1);
    });

    it('returns null on skip or missing callback', async () => {
        loadMock.mockResolvedValue(null);
        const { ctx } = makeCtx('skipped');
        const loader = new BundleLoader(makePlugin());

        expect(await loader.requestOptionalAsset(ctx, wasmSpec, 'rerank')).toBeNull();
        expect(await loader.requestOptionalAsset(undefined, wasmSpec, 'rerank')).toBeNull();
    });
});

describe('BundleLoader.loadOfficeBundleWithPrompt (representative sibling)', () => {
    it('prompts on miss and retries after decision=installed', async () => {
        loadMock
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(toArrayBuffer(OFFICE_CJS));
        const { ctx, prompt } = makeCtx('installed');
        const loader = new BundleLoader(makePlugin());

        const bundle = await loader.loadOfficeBundleWithPrompt(ctx, 'create_xlsx');

        expect(bundle).not.toBeNull();
        expect((bundle?.ExcelJS as unknown as { marker: string }).marker).toBe('xl');
        const [spec] = prompt.mock.calls[0] as [{ id: string }];
        expect(spec.id).toBe('office-bundle');
    });
});

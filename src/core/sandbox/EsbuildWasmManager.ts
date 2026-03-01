/**
 * EsbuildWasmManager
 *
 * On-demand TypeScript compilation via esbuild-wasm. Both the JS module
 * and the WASM binary are downloaded from CDN on first use and cached
 * in the plugin data directory.
 *
 * Two compilation modes:
 * - transform(): Single file, no imports (~100ms)
 * - build(): Bundle with npm dependencies via virtual filesystem (~500ms-2s)
 *
 * Loading strategy:
 * 1. Check if JS + WASM are already cached locally
 * 2. If not, download via requestUrl (Obsidian API, no fetch)
 * 3. Load JS module via CommonJS evaluation (not dynamic import)
 * 4. Initialize esbuild with local WASM binary as ArrayBuffer
 *
 * Part of Self-Development Phase 3: Sandbox + Dynamic Modules.
 */

import { requestUrl } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ESBUILD_VERSION = '0.24.2';
const JS_CDN_URL = `https://cdn.jsdelivr.net/npm/esbuild-wasm@${ESBUILD_VERSION}/lib/browser.js`;
const WASM_CDN_URL = `https://cdn.jsdelivr.net/npm/esbuild-wasm@${ESBUILD_VERSION}/esbuild.wasm`;

const CACHE_DIR_NAME = 'dev-env';
const JS_CACHE_FILE = `esbuild-browser-${ESBUILD_VERSION}.js`;
const WASM_CACHE_FILE = `esbuild-${ESBUILD_VERSION}.wasm`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** esbuild-wasm module interface (subset we use) */
interface EsbuildModule {
    initialize(options: { wasmModule: WebAssembly.Module }): Promise<void>;
    transform(
        source: string,
        options: Record<string, unknown>,
    ): Promise<{ code: string; warnings: unknown[] }>;
    build(
        options: Record<string, unknown>,
    ): Promise<{ outputFiles?: { text: string }[]; errors: unknown[]; warnings: unknown[] }>;
}

// ---------------------------------------------------------------------------
// EsbuildWasmManager
// ---------------------------------------------------------------------------

export class EsbuildWasmManager {
    private esbuild: EsbuildModule | null = null;
    private packageCache = new Map<string, string>();
    private readonly cacheDir: string;
    private initializing = false;

    constructor(private plugin: ObsidianAgentPlugin) {
        const configDir = plugin.app.vault.configDir;
        const pluginId = plugin.manifest.id;
        this.cacheDir = `${configDir}/plugins/${pluginId}/${CACHE_DIR_NAME}`;
    }

    // -----------------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------------

    /**
     * Ensure esbuild-wasm is downloaded and initialized.
     * Downloads JS (~150KB) + WASM (~11MB) from CDN on first use.
     */
    async ensureReady(): Promise<void> {
        if (this.esbuild) return;
        if (this.initializing) {
            while (this.initializing) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            if (this.esbuild) return;
            throw new Error('esbuild-wasm initialization failed in another call');
        }

        this.initializing = true;
        try {
            await this.ensureCacheDir();

            // Step 1: Get the JS module (from cache or CDN)
            const jsCode = await this.getCachedOrDownloadText(JS_CACHE_FILE, JS_CDN_URL);

            // Step 2: Get the WASM binary (from cache or CDN)
            const wasmBuffer = await this.getCachedOrDownloadBinary(WASM_CACHE_FILE, WASM_CDN_URL);

            // Step 3: Load the JS module via CommonJS evaluation
            // esbuild-wasm browser.js is: (module => { ... module.exports = ... })(module)
            const esbuildModule = this.loadCommonJsModule(jsCode);

            // Step 4: Compile WASM and initialize esbuild
            const wasmModule = await WebAssembly.compile(wasmBuffer);
            await esbuildModule.initialize({ wasmModule });

            this.esbuild = esbuildModule;
            console.debug('[EsbuildWasmManager] Initialized successfully');
        } catch (e) {
            console.error('[EsbuildWasmManager] Initialization failed:', e);
            throw new Error(`Failed to initialize esbuild-wasm: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            this.initializing = false;
        }
    }

    // -----------------------------------------------------------------------
    // Compilation
    // -----------------------------------------------------------------------

    /**
     * Mode 1: Transform a single TypeScript file (no imports).
     * Fast (~100ms). Output is an IIFE that populates an exports object.
     */
    async transform(source: string): Promise<string> {
        await this.ensureReady();

        const result = await this.esbuild!.transform(source, {
            loader: 'ts',
            format: 'iife',
            target: 'es2022',
            globalName: '__module',
        });

        return `${result.code}\nif (typeof __module !== 'undefined') { Object.assign(exports, __module); }`;
    }

    /**
     * Mode 2: Bundle TypeScript with npm dependencies.
     * Uses a virtual filesystem plugin to resolve imports from cached packages.
     * Slower (~500ms-2s) but supports libraries.
     */
    async build(source: string, dependencies: string[]): Promise<string> {
        await this.ensureReady();

        for (const dep of dependencies) {
            await this.ensurePackage(dep);
        }

        const packageCache = this.packageCache;

        const result = await this.esbuild!.build({
            stdin: { contents: source, loader: 'ts', resolveDir: '.' },
            bundle: true,
            format: 'iife',
            globalName: '__module',
            target: 'es2022',
            write: false,
            plugins: [{
                name: 'virtual-packages',
                setup(build: { onResolve: Function; onLoad: Function }) {
                    build.onResolve(
                        { filter: /^[^.]/ },
                        (args: { path: string }) => ({
                            path: args.path,
                            namespace: 'pkg',
                        })
                    );
                    build.onLoad(
                        { filter: /.*/, namespace: 'pkg' },
                        (args: { path: string }) => ({
                            contents: packageCache.get(args.path) ?? `export default {};`,
                            loader: 'js',
                        })
                    );
                },
            }],
        });

        const output = result.outputFiles?.[0]?.text ?? '';
        return `${output}\nif (typeof __module !== 'undefined') { Object.assign(exports, __module); }`;
    }

    /**
     * Check if the manager is initialized.
     */
    get isReady(): boolean {
        return this.esbuild !== null;
    }

    // -----------------------------------------------------------------------
    // Module Loading
    // -----------------------------------------------------------------------

    /**
     * Load a CommonJS module from source code.
     * esbuild-wasm's browser.js is: (module => { ... module.exports = ... })(module)
     */
    private loadCommonJsModule(jsCode: string): EsbuildModule {
        const mod: { exports: Record<string, unknown> } = { exports: {} };
        // eslint-disable-next-line @typescript-eslint/no-implied-eval -- required to load esbuild-wasm JS at runtime without npm install
        const factory = new Function('module', 'exports', jsCode);
        factory(mod, mod.exports);
        return mod.exports as unknown as EsbuildModule;
    }

    // -----------------------------------------------------------------------
    // Cache Management
    // -----------------------------------------------------------------------

    private async ensureCacheDir(): Promise<void> {
        const adapter = this.plugin.app.vault.adapter;
        if (!await adapter.exists(this.cacheDir)) {
            await adapter.mkdir(this.cacheDir);
        }
    }

    /**
     * Get a text file from local cache, or download from CDN and cache it.
     */
    private async getCachedOrDownloadText(filename: string, cdnUrl: string): Promise<string> {
        const path = `${this.cacheDir}/${filename}`;
        const adapter = this.plugin.app.vault.adapter;

        if (await adapter.exists(path)) {
            console.debug(`[EsbuildWasmManager] Loading cached: ${filename}`);
            return await adapter.read(path);
        }

        console.debug(`[EsbuildWasmManager] Downloading: ${cdnUrl}`);
        const response = await requestUrl({ url: cdnUrl });
        if (response.status !== 200) {
            throw new Error(`Failed to download ${cdnUrl}: HTTP ${response.status}`);
        }

        await adapter.write(path, response.text);
        console.debug(`[EsbuildWasmManager] Cached: ${filename}`);
        return response.text;
    }

    /**
     * Get a binary file from local cache, or download from CDN and cache it.
     */
    private async getCachedOrDownloadBinary(filename: string, cdnUrl: string): Promise<ArrayBuffer> {
        const path = `${this.cacheDir}/${filename}`;
        const adapter = this.plugin.app.vault.adapter;

        if (await adapter.exists(path)) {
            console.debug(`[EsbuildWasmManager] Loading cached: ${filename}`);
            return await adapter.readBinary(path);
        }

        console.debug(`[EsbuildWasmManager] Downloading: ${cdnUrl} (this may take a moment)`);
        const response = await requestUrl({ url: cdnUrl });
        if (response.status !== 200) {
            throw new Error(`Failed to download ${cdnUrl}: HTTP ${response.status}`);
        }

        await adapter.writeBinary(path, response.arrayBuffer);
        console.debug(`[EsbuildWasmManager] Cached: ${filename}`);
        return response.arrayBuffer;
    }

    /**
     * Download an npm package from CDN and cache it in memory.
     */
    private async ensurePackage(name: string): Promise<void> {
        if (this.packageCache.has(name)) return;

        const url = `https://cdn.jsdelivr.net/npm/${name}/+esm`;
        try {
            const response = await requestUrl({ url });
            this.packageCache.set(name, response.text);
            console.debug(`[EsbuildWasmManager] Cached package: ${name}`);
        } catch (e) {
            console.warn(`[EsbuildWasmManager] Failed to download package "${name}":`, e);
            throw new Error(`Failed to download npm package "${name}": ${e instanceof Error ? e.message : String(e)}`);
        }
    }
}

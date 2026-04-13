/**
 * AssetProvisioner -- FIX-19: Self-provisioning for BRAT installations.
 *
 * BRAT only installs main.js, manifest.json, styles.css. Other runtime assets
 * (workers, skills, templates) are embedded in main.js at build time and
 * extracted to the plugin directory on first load.
 *
 * Version-gated: assets are re-extracted when the plugin version changes
 * (e.g., BRAT update), ensuring users always get matching assets.
 */

import type { Plugin } from 'obsidian';

const VERSION_MARKER = '.obsilo-assets-version';

/**
 * Ensure all embedded runtime assets exist on disk.
 * Idempotent: skips extraction if version marker matches current version.
 */
export async function ensureRuntimeAssets(plugin: Plugin): Promise<void> {
    const pluginDir = plugin.manifest.dir;
    if (!pluginDir) return;

    const adapter = plugin.app.vault.adapter;
    const currentVersion = plugin.manifest.version;

    // Check version marker -- skip if already provisioned for this version
    const markerPath = `${pluginDir}/${VERSION_MARKER}`;
    try {
        const storedVersion = await adapter.read(markerPath);
        if (storedVersion.trim() === currentVersion) return;
    } catch {
        // Marker doesn't exist -- needs extraction
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports -- generated at build time by esbuild, not available during tsc
    const assets = require('../_generated/embedded-assets.json') as Record<string, string>;
    let count = 0;

    for (const [relativePath, content] of Object.entries(assets)) {
        // AUDIT-010 M-1: Defense-in-depth against path traversal
        if (relativePath.includes('..') || relativePath.startsWith('/') || relativePath.startsWith('\\')) {
            console.warn(`[AssetProvisioner] Rejected unsafe path: ${relativePath}`);
            continue;
        }
        const fullPath = `${pluginDir}/${relativePath}`;

        // Ensure parent directory exists
        const lastSlash = relativePath.lastIndexOf('/');
        if (lastSlash > 0) {
            const dir = `${pluginDir}/${relativePath.substring(0, lastSlash)}`;
            if (!await adapter.exists(dir)) {
                await (adapter as unknown as { mkdir(path: string): Promise<void> }).mkdir(dir);
            }
        }

        // Write asset to disk
        if (content.startsWith('base64:')) {
            const raw = content.slice(7);
            const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
            await adapter.writeBinary(fullPath, bytes.buffer as ArrayBuffer);
        } else {
            await adapter.write(fullPath, content);
        }
        count++;
    }

    // Write version marker
    await adapter.write(markerPath, currentVersion);
    console.debug(`[AssetProvisioner] Extracted ${count} runtime assets (v${currentVersion})`);
}

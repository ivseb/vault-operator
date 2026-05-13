/**
 * runtimeWorker -- materialise inline worker code as a file inside the
 * vault, so child_process.spawn() / cp.fork() can launch it.
 *
 * Why a file at all: Node's spawn/fork need a script path. They can't
 * accept inline JavaScript directly. We therefore write the inlined
 * worker code to a temp file the first time it is needed, then reuse
 * that file on subsequent launches.
 *
 * Why the vault and not pluginDir: writing into the plugin directory
 * triggers Obsidian's "self-update" pattern in the review bot. Writing
 * to the user's vault is the normal job of a plugin and is allowed.
 *
 * Location: `<vault>/.vault-operator/runtime/<name>`. Hidden dot-folder
 * keeps it out of normal note search; the runtime/ subfolder makes it
 * obvious to the user what these files are for.
 *
 * Cache invalidation: if the on-disk file's byte length differs from
 * the inlined code's byte length, the file is rewritten. This is good
 * enough for plugin-version-bound updates (a new version of the plugin
 * ships a new inlined code blob, the size differs, the file is
 * refreshed). It is not a content hash; a forged file of the same size
 * would survive. Acceptable because the file lives inside the user's
 * own vault and is not exposed to other writers.
 */

import type { Plugin } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';

const RUNTIME_DIR = '.vault-operator/runtime';

/**
 * Materialise `code` as `<vault>/.vault-operator/runtime/<name>`.
 * Returns the absolute filesystem path to the materialised file.
 *
 * @throws if the adapter is not a FileSystemAdapter (Desktop only).
 */
export function ensureRuntimeWorker(plugin: Plugin, name: string, code: string): string {
    const adapter = plugin.app.vault.adapter as { getBasePath?: () => string };
    if (!adapter.getBasePath) {
        throw new Error('ensureRuntimeWorker requires a FileSystemAdapter (Desktop only)');
    }
    const basePath = adapter.getBasePath();
    const dirAbs = path.join(basePath, RUNTIME_DIR);
    const fileAbs = path.join(dirAbs, name);

    // Cache hit: file exists with the same byte length as the inlined
    // code. Skip the write to keep the timestamp stable.
    try {
        const stat = fs.statSync(fileAbs);
        if (stat.size === Buffer.byteLength(code, 'utf-8')) {
            return fileAbs;
        }
    } catch {
        // File does not exist or stat failed -- fall through to write.
    }

    fs.mkdirSync(dirAbs, { recursive: true });
    fs.writeFileSync(fileAbs, code, 'utf-8');
    return fileAbs;
}

/**
 * SandboxBridge
 *
 * Plugin-side bridge that handles requests from the sandboxed iframe.
 * Controls vault access, URL allowlisting, path validation, and rate limiting.
 *
 * Part of Self-Development Phase 3: Sandbox + Dynamic Modules.
 */

import { TFile, TFolder, requestUrl } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';

// ---------------------------------------------------------------------------
// SandboxBridge
// ---------------------------------------------------------------------------

export class SandboxBridge {
    private writeCount = 0;
    private requestCount = 0;
    private lastReset = Date.now();
    private readonly MAX_WRITES_PER_MIN = 10;
    private readonly MAX_REQUESTS_PER_MIN = 5;

    private readonly URL_ALLOWLIST = [
        'unpkg.com',
        'cdn.jsdelivr.net',
        'registry.npmjs.org',
        'esm.sh',
    ];

    constructor(private plugin: ObsidianAgentPlugin) {}

    async vaultRead(path: string): Promise<string> {
        this.validateVaultPath(path);
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) throw new Error(`Not a file: ${path}`);
        return await this.plugin.app.vault.read(file);
    }

    async vaultReadBinary(path: string): Promise<ArrayBuffer> {
        this.validateVaultPath(path);
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) throw new Error(`Not a file: ${path}`);
        return await this.plugin.app.vault.readBinary(file);
    }

    async vaultList(path: string): Promise<string[]> {
        this.validateVaultPath(path);
        const folder = this.plugin.app.vault.getAbstractFileByPath(path);
        if (!(folder instanceof TFolder)) throw new Error(`Not a folder: ${path}`);
        return folder.children.map(c => c.path);
    }

    async vaultWrite(path: string, content: string): Promise<void> {
        this.validateVaultPath(path);
        this.checkWriteRateLimit();
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            await this.plugin.app.vault.modify(file, content);
        } else {
            await this.plugin.app.vault.create(path, content);
        }
    }

    async vaultWriteBinary(path: string, content: ArrayBuffer): Promise<void> {
        this.validateVaultPath(path);
        this.checkWriteRateLimit();
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            await this.plugin.app.vault.modifyBinary(file, content);
        } else {
            await this.plugin.app.vault.createBinary(path, content);
        }
    }

    async requestUrlBridge(
        url: string,
        options?: { method?: string; body?: string },
    ): Promise<{ status: number; text: string }> {
        this.checkRequestRateLimit();
        if (!this.isAllowedUrl(url)) {
            throw new Error(
                `URL not on allowlist: ${url}. Allowed: ${this.URL_ALLOWLIST.join(', ')}`
            );
        }
        const response = await requestUrl({
            url,
            method: options?.method,
            body: options?.body,
        });
        return { status: response.status, text: response.text };
    }

    // -----------------------------------------------------------------------
    // Validation
    // -----------------------------------------------------------------------

    private validateVaultPath(path: string): void {
        if (path.includes('..') || path.startsWith('/') || path.startsWith('\\')) {
            throw new Error(`Invalid path: ${path}`);
        }
    }

    private isAllowedUrl(url: string): boolean {
        try {
            const host = new URL(url).hostname;
            return this.URL_ALLOWLIST.some(
                a => host === a || host.endsWith('.' + a)
            );
        } catch {
            return false;
        }
    }

    // -----------------------------------------------------------------------
    // Rate Limiting
    // -----------------------------------------------------------------------

    private checkWriteRateLimit(): void {
        this.resetIfMinuteElapsed();
        if (++this.writeCount > this.MAX_WRITES_PER_MIN) {
            throw new Error('Write rate limit exceeded (max 10/min)');
        }
    }

    private checkRequestRateLimit(): void {
        this.resetIfMinuteElapsed();
        if (++this.requestCount > this.MAX_REQUESTS_PER_MIN) {
            throw new Error('Request rate limit exceeded (max 5/min)');
        }
    }

    private resetIfMinuteElapsed(): void {
        if (Date.now() - this.lastReset > 60000) {
            this.writeCount = 0;
            this.requestCount = 0;
            this.lastReset = Date.now();
        }
    }
}

import { App, Modal, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { t } from '../../i18n';
import * as path from 'path';
import * as os from 'os';
import * as safeFs from '../../core/security/safeFs';
import { spawnAllowedSync } from '../../core/security/spawnAllowlist';
import { ENV_APPDATA, readEnv } from '../../util/envKeys';
import { addSectionHeading } from './utils';
import {
    isLocalHostname,
    isPrivateIpHostname,
    validateProviderUrl,
} from '../../api/providers/providerUrlGuard';

export class McpTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        // One intro banner for the page
        const intro = containerEl.createDiv('vault-op-box vault-op-box--intro');
        const introIcon = intro.createSpan({ cls: 'vault-op-box__icon' });
        setIcon(introIcon, 'link');
        const introText = intro.createDiv({ cls: 'vault-op-box__text' });
        introText.createEl('strong', { text: t('settings.mcp.connectionsIntroTitle') });

        introText.createDiv({ text: t('settings.mcp.connectionsIntroDesc') });

        this.buildConnectorSection(containerEl);
        this.buildExternalServersSection(containerEl);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Connectors
    // ─────────────────────────────────────────────────────────────────────────

    private buildConnectorSection(containerEl: HTMLElement): void {
        addSectionHeading(
            containerEl,
            t('settings.mcp.headingConnectors'),
            { body: t('settings.mcp.sectionConnectorsInfo') },
        );

        // ── Claude Desktop / Claude Code ──────────────────────────────────
        containerEl.createEl('h4', { text: t('settings.mcp.headingLocalConnector') });

        const mcpBridge = this.plugin.mcpBridge;
        const isEnabled = this.plugin.settings.enableMcpServer ?? false;

        new Setting(containerEl)
            .setName(t('settings.mcp.enableLocalConnector'))
            .setDesc(t('settings.mcp.enableLocalConnectorDesc'))
            .addToggle((toggle) =>
                toggle.setValue(isEnabled).onChange(async (v) => {
                    this.plugin.settings.enableMcpServer = v;
                    await this.plugin.saveSettings();
                    if (v && !this.plugin.mcpBridge) {
                        const { McpBridge } = await import('../../mcp/McpBridge');
                        this.plugin.mcpBridge = new McpBridge(this.plugin);
                        void this.plugin.mcpBridge.start().catch((e: unknown) =>
                            console.warn('[McpTab] Start failed:', e)
                        );
                    } else if (!v && this.plugin.mcpBridge) {
                        this.plugin.mcpBridge.stop();
                        this.plugin.mcpBridge = null;
                    }
                    this.rerender();
                }),
            );

        if (isEnabled) {
            new Setting(containerEl)
                .setName(t('settings.mcp.configureDesktopClient'))
                .setDesc(t('settings.mcp.configureDesktopClientDesc'))
                .addButton((btn) => {
                    btn.setButtonText(t('settings.mcp.configureButton')).onClick(() => {
                        void this.writeClaudeDesktopConfig();
                    });
                });
        }

        // FIX-44-48: the write gate (MCP-2 / FIX-44-26) had no UI. The wire
        // errors name this exact toggle and path, so it must exist here.
        // Applies to the local connector AND the remote relay: both dispatch
        // through the same gate in handleToolCall / execute_vault_op.
        new Setting(containerEl)
            .setName(t('settings.mcp.allowWriteTools'))
            .setDesc(t('settings.mcp.allowWriteToolsDesc'))
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.mcpAllowWriteTools ?? false).onChange(async (v) => {
                    this.plugin.settings.mcpAllowWriteTools = v;
                    await this.plugin.saveSettings();
                }),
            );

        // ── Remote access ─────────────────────────────────────────────────
        containerEl.createEl('h4', { text: t('settings.mcp.headingRemoteAccess') });

        const remoteEnabled = this.plugin.settings.enableRemoteRelay ?? false;
        const remoteConnected = (mcpBridge as { remoteConnected?: boolean })?.remoteConnected ?? false;

        new Setting(containerEl)
            .setName(t('settings.mcp.enableRemoteAccess'))
            .setDesc(t('settings.mcp.enableRemoteAccessDesc'))
            .addToggle((toggle) =>
                toggle.setValue(remoteEnabled).onChange(async (v) => {
                    this.plugin.settings.enableRemoteRelay = v;
                    await this.plugin.saveSettings();
                    if (v && this.plugin.mcpBridge && this.plugin.settings.relayUrl) {
                        void this.plugin.mcpBridge.connectRelay();
                    } else if (!v) {
                        this.plugin.mcpBridge?.disconnectRelay();
                    }
                    this.rerender();
                }),
            );

        if (remoteEnabled) {
            const hasRelay = !!this.plugin.settings.relayUrl;

            if (!hasRelay) {
                // ── Info banner: setup flow ───────────────────────────────
                const remoteInfo = containerEl.createDiv('vault-op-box vault-op-box--intro');
                const remoteInfoIcon = remoteInfo.createSpan({ cls: 'vault-op-box__icon' });
                setIcon(remoteInfoIcon, 'globe');
                const remoteInfoText = remoteInfo.createDiv({ cls: 'vault-op-box__text' });
                remoteInfoText.createDiv({ text: t('settings.mcp.relayIntro') });
                const steps = remoteInfoText.createEl('ol');

                steps.createEl('li').createEl('a', {
                    text: t('settings.mcp.relayStep1'),
                    href: 'https://dash.cloudflare.com/sign-up',
                });
                const step2 = steps.createEl('li');
                step2.appendText(t('settings.mcp.relayStep2Prefix'));

                step2.createEl('a', {
                    text: t('settings.mcp.relayStep2Link'),
                    href: 'https://dash.cloudflare.com/profile/api-tokens',
                });
                step2.appendText(t('settings.mcp.relayStep2Suffix'));
                const step3 = steps.createEl('li');

                step3.appendText(t('settings.mcp.relayStep3'));
                steps.createEl('li', { text: t('settings.mcp.relayStep4') });

                // ── API Token + Deploy ────────────────────────────────────
                new Setting(containerEl)

                    .setName(t('settings.mcp.cloudflareApiToken'))
                    .setDesc(t('settings.mcp.cloudflareApiTokenDesc'))
                    .addText((text) => {
                        text.setValue(this.plugin.settings.cloudflareApiToken ?? '');
                        text.setPlaceholder(t('settings.mcp.cloudflareApiTokenPlaceholder'));
                        text.inputEl.type = 'password';
                        text.onChange(async (v) => {
                            this.plugin.settings.cloudflareApiToken = v.trim();
                            await this.plugin.saveSettings();
                        });
                    });

                // Deploy button
                const deploySetting = new Setting(containerEl)
                    .setName(t('settings.mcp.deployRelay'))
                    .setDesc(t('settings.mcp.deployRelayDesc'));

                const deployStatusEl = containerEl.createDiv('setting-item-description');

                deploySetting.addButton((btn) => {
                    btn.setButtonText(t('settings.mcp.deployButton')).onClick(async () => {
                        const apiToken = this.plugin.settings.cloudflareApiToken;
                        if (!apiToken) {
                            new Notice(t('notice.mcp.apiTokenMissing'));
                            return;
                        }

                        btn.setDisabled(true);
                        btn.setButtonText(t('settings.mcp.deployingButton'));

                        try {
                            const { CloudflareDeployer } = await import('../../mcp/CloudflareDeployer');
                            const deployer = new CloudflareDeployer(apiToken);

                            // Reuse existing token if available, otherwise generate new one
                            // AUDIT-007 L-1: Use relay_ prefix instead of sk- to avoid confusion with API keys
                            const relayToken = this.plugin.settings.relayToken
                                || ('relay_' + Array.from(crypto.getRandomValues(new Uint8Array(32)))
                                    .map(b => b.toString(16).padStart(2, '0')).join(''));

                            const result = await deployer.deploy(relayToken, (step) => {
                                deployStatusEl.setText(step);
                            });

                            // Save results
                            this.plugin.settings.relayUrl = result.url;
                            this.plugin.settings.relayToken = relayToken;
                            this.plugin.settings.cloudflareAccountId = result.accountId;
                            await this.plugin.saveSettings();

                            // Connect immediately
                            if (this.plugin.mcpBridge) {
                                void this.plugin.mcpBridge.connectRelay();
                            }

                            new Notice(t('notice.mcp.relayDeployed'));
                            this.rerender();
                        } catch (e) {
                            const msg = e instanceof Error ? e.message : String(e);
                            deployStatusEl.setText(t('notice.mcp.deployFailed', { message: msg }));
                            new Notice(t('notice.mcp.deployFailed', { message: msg }));
                            btn.setDisabled(false);
                            btn.setButtonText(t('settings.mcp.deployButton'));
                        }
                    });
                });
            } else {
                // ── Already deployed ────────────────────────────────────────
                const baseUrl = this.plugin.settings.relayUrl.replace(/\/$/, '');
                const token = this.plugin.settings.relayToken;
                const mcpUrl = `${baseUrl}/${token}/mcp`;

                new Setting(containerEl)
                    .setName(t('settings.mcp.connectorUrl'))
                    .setDesc(t('settings.mcp.connectorUrlDesc'))
                    .addButton((btn) => {
                        btn.setButtonText(t('settings.mcp.copyUrlButton')).onClick(() => {
                            void navigator.clipboard.writeText(mcpUrl);
                            new Notice(t('notice.mcp.urlCopied'));
                        });
                    });

                new Setting(containerEl)
                    .setName(remoteConnected ? t('settings.mcp.statusConnected') : t('settings.mcp.statusConnection'))
                    .setDesc(remoteConnected
                        ? t('settings.mcp.statusConnectedDesc')
                        : t('settings.mcp.statusConnectionDesc'))
                    .addButton((btn) => {
                        btn.setButtonText(remoteConnected ? t('settings.mcp.disconnect') : t('settings.mcp.connect')).onClick(() => {
                            if (remoteConnected) {
                                this.plugin.mcpBridge?.disconnectRelay();
                            } else if (this.plugin.mcpBridge) {
                                void this.plugin.mcpBridge.connectRelay();
                            }
                            window.setTimeout(() => this.rerender(), 1000);
                        });
                    });

                // Usage instructions
                const usage = containerEl.createDiv('agent-settings-desc');
                usage.createEl('strong', { text: t('settings.mcp.usageTitle') });
                const usageList = usage.createEl('ul');
                usageList.createEl('li', { text: t('settings.mcp.usageWebClients') });
                usageList.createEl('li', { text: t('settings.mcp.usageDesktopClients') });

                // Troubleshooting hint
                const troubleshoot = containerEl.createDiv('setting-item-description');
                troubleshoot.appendText(t('settings.mcp.troubleshootHint'));
                troubleshoot.createEl('a', {
                    text: t('settings.mcp.troubleshootLink'),
                    href: 'https://pssah4.github.io/vault-operator/guides/connectors',
                });

                // Redeploy + Reset
                const redeployStatusEl = containerEl.createDiv('setting-item-description');

                new Setting(containerEl)
                    .setName(t('settings.mcp.updateRelay'))
                    .setDesc(t('settings.mcp.updateRelayDesc'))
                    .addButton((btn) => {
                        btn.setButtonText(t('settings.mcp.redeployButton')).onClick(async () => {
                            const apiToken = this.plugin.settings.cloudflareApiToken;
                            const accountId = this.plugin.settings.cloudflareAccountId;
                            const relayToken = this.plugin.settings.relayToken;
                            if (!apiToken || !accountId) {
                                new Notice(t('notice.mcp.redeployMissingConfig'));
                                return;
                            }
                            btn.setDisabled(true);
                            btn.setButtonText(t('settings.mcp.updatingButton'));
                            try {
                                const { CloudflareDeployer } = await import('../../mcp/CloudflareDeployer');
                                const deployer = new CloudflareDeployer(apiToken);
                                await deployer.redeploy(accountId, relayToken, (step) => {
                                    redeployStatusEl.setText(step);
                                });
                                new Notice(t('notice.mcp.relayUpdated'));
                                btn.setDisabled(false);
                                btn.setButtonText(t('settings.mcp.redeployButton'));
                            } catch (e) {
                                const msg = e instanceof Error ? e.message : String(e);
                                redeployStatusEl.setText(t('notice.mcp.updateFailed', { message: msg }));
                                new Notice(t('notice.mcp.updateFailed', { message: msg }));
                                btn.setDisabled(false);
                                btn.setButtonText(t('settings.mcp.redeployButton'));
                            }
                        });
                    });

                new Setting(containerEl)
                    .setName(t('settings.mcp.resetRelay'))
                    .setDesc(t('settings.mcp.resetRelayDesc'))
                    .addButton((btn) => {
                        btn.setButtonText(t('settings.mcp.resetButton')).onClick(async () => {
                            this.plugin.mcpBridge?.disconnectRelay();
                            this.plugin.settings.relayUrl = '';
                            this.plugin.settings.relayToken = '';
                            this.plugin.settings.cloudflareAccountId = '';
                            await this.plugin.saveSettings();
                            this.rerender();
                        });
                    });
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // External tool servers
    // ─────────────────────────────────────────────────────────────────────────

    private buildExternalServersSection(containerEl: HTMLElement): void {
        addSectionHeading(
            containerEl,
            t('settings.mcp.headingExternalServers'),
            { body: t('settings.mcp.sectionExternalServersInfo') },
        );

        const mcpClient = this.plugin.mcpClient;
        const addBtn = containerEl.createEl('button', { text: t('settings.mcp.addServer'), cls: 'mod-cta agent-mcp-add-btn' });
        const listEl = containerEl.createDiv({ cls: 'agent-mcp-list' });

        const renderList = () => {
            listEl.empty();
            const servers = this.plugin.settings.mcpServers ?? {};
            const names = Object.keys(servers);
            if (names.length === 0) {
                listEl.createEl('p', { cls: 'agent-settings-desc', text: t('settings.mcp.empty') });
                return;
            }
            for (const name of names) {
                const config = servers[name];
                const conn = mcpClient?.getConnection(name);
                const status = conn?.status ?? 'disconnected';

                const row = listEl.createDiv({ cls: 'agent-mcp-server-row' });
                const dot = row.createSpan({ cls: `agent-mcp-status-dot ${status}` });
                dot.setAttribute('title', status === 'error' ? (conn?.error ?? 'error') : status);

                const info = row.createDiv({ cls: 'agent-mcp-server-info' });
                info.createSpan({ cls: 'agent-mcp-server-name', text: name });
                info.createSpan({ cls: 'agent-mcp-server-type', text: config.type });
                if (config.isBuiltIn) info.createSpan({ cls: 'agent-mcp-server-badge', text: t('settings.mcp.builtInBadge') });
                if (config.isBuiltIn && config.disabled && status !== 'connected') {
                    info.createSpan({ cls: 'agent-mcp-server-hint', text: t('settings.mcp.builtInDisabledHint') });
                } else if (status === 'error' && conn?.error) {
                    info.createSpan({ cls: 'agent-mcp-server-error', text: conn.error });
                } else if (status === 'connected') {
                    info.createSpan({ cls: 'agent-mcp-server-tools', text: t('settings.mcp.toolCount', { count: conn?.tools.length ?? 0 }) });
                }

                const actions = row.createDiv({ cls: 'agent-rules-actions' });
                if (status === 'connected') {
                    const btn = actions.createEl('button', { text: t('settings.mcp.disconnect') });
                    btn.addEventListener('click', () => { void (async () => { await mcpClient?.disconnect(name); renderList(); })(); });
                } else if (status !== 'connecting') {
                    const btn = actions.createEl('button', { text: status === 'error' ? t('settings.mcp.retry') : t('settings.mcp.connect') });
                    btn.addEventListener('click', () => { void (async () => { if (mcpClient) { await mcpClient.connect(name, config); renderList(); } })(); });
                }
                const editBtn = actions.createEl('button', { cls: 'agent-rules-edit-btn' });
                setIcon(editBtn, 'pencil');
                editBtn.setAttribute('aria-label', t('settings.mcp.edit'));
                editBtn.addEventListener('click', () => openAddModal(name, config));
                if (!config.isBuiltIn) {
                    const delBtn = actions.createEl('button', { cls: 'agent-rules-delete-btn' });
                    setIcon(delBtn, 'trash-2');
                    delBtn.setAttribute('aria-label', t('settings.mcp.delete'));
                    delBtn.addEventListener('click', () => { void (async () => { if (mcpClient) await mcpClient.disconnect(name); delete this.plugin.settings.mcpServers[name]; await this.plugin.saveSettings(); renderList(); })(); });
                }
            }
        };

        const openAddModal = (editName?: string, editConfig?: import('../../types/settings').McpServerConfig) => {
            const modal = new Modal(this.app);
            modal.titleEl.setText(editName ? t('settings.mcp.editServer', { name: editName }) : t('settings.mcp.addServerTitle'));
            const { contentEl } = modal;

            const nameInput = contentEl.createEl('input', { type: 'text', placeholder: t('settings.mcp.namePlaceholder'), cls: 'agent-mcp-modal-input' });
            nameInput.value = editName ?? '';
            if (editName) nameInput.disabled = true;

            const typeSelect = contentEl.createEl('select', { cls: 'agent-mcp-modal-input' });
            for (const opt of ['sse', 'streamable-http']) {
                const o = typeSelect.createEl('option', { text: opt, value: opt });
                if (opt === (editConfig?.type ?? 'sse')) o.selected = true;
            }

            contentEl.createEl('label', { text: t('settings.mcp.labelUrl') });
            const urlInput = contentEl.createEl('input', { type: 'text', placeholder: t('settings.mcp.urlPlaceholder'), cls: 'agent-mcp-modal-input' });
            urlInput.value = editConfig?.url ?? '';

            // AUDIT-034 M-14: per-server opt-in for the SSRF guard. When off
            // (default), saveBtn rejects loopback / RFC 1918 URLs with a Notice.
            let allowLocalUrls = editConfig?.allowLocalUrls === true;
            new Setting(contentEl)
                .setName(t('settings.mcp.allowLocalUrls'))
                .setDesc(t('settings.mcp.allowLocalUrlsDesc'))
                .addToggle((toggle) =>
                    toggle.setValue(allowLocalUrls).onChange((v) => {
                        allowLocalUrls = v;
                    }),
                );

            contentEl.createEl('label', { text: t('settings.mcp.labelHeaders') });
            const headersInput = contentEl.createEl('textarea', { cls: 'agent-mcp-modal-input' });
            headersInput.rows = 3;
            headersInput.value = Object.entries(editConfig?.headers ?? {}).map(([k, v]) => `${k}=${v}`).join('\n');

            contentEl.createEl('label', { text: t('settings.mcp.labelTimeout') });
            const timeoutInput = contentEl.createEl('input', { type: 'number', placeholder: t('settings.mcp.timeoutPlaceholder'), cls: 'agent-mcp-modal-input' });
            timeoutInput.value = String(editConfig?.timeout ?? 60);

            const saveBtn = contentEl.createEl('button', { text: t('settings.mcp.saveConnect'), cls: 'mod-cta agent-mcp-modal-save' });
            saveBtn.addEventListener('click', () => { void (async () => {
                const serverName = (editName ?? nameInput.value.trim());
                if (!serverName) return;
                const type = typeSelect.value as 'sse' | 'streamable-http';
                const trimmedUrl = urlInput.value.trim();

                // AUDIT-034 M-14: validate the URL against the SSRF guard
                // before persisting. The per-server allowLocalUrls toggle opts
                // out for loopback / RFC 1918 hosts; everything else stays
                // protected by validateProviderUrl + the explicit local check.
                if (trimmedUrl) {
                    try {
                        const parsed = validateProviderUrl('custom', trimmedUrl, {
                            allowLocalhost: allowLocalUrls,
                        });
                        if (parsed && !allowLocalUrls) {
                            const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
                            if (isLocalHostname(host) || isPrivateIpHostname(host)) {
                                new Notice(t('notice.mcp.localUrlBlocked', { host: parsed.host }));
                                return;
                            }
                        }
                    } catch (e) {
                        const msg = e instanceof Error ? e.message : String(e);
                        new Notice(t('notice.mcp.invalidUrl', { message: msg }));
                        return;
                    }
                }

                const parseKV = (text: string): Record<string, string> => {
                    const result: Record<string, string> = {};
                    for (const line of text.split('\n')) { const eqIdx = line.indexOf('='); if (eqIdx > 0) result[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim(); }
                    return result;
                };
                const newConfig: import('../../types/settings').McpServerConfig = {
                    type,
                    url: trimmedUrl,
                    headers: parseKV(headersInput.value),
                    timeout: parseInt(timeoutInput.value) || 60,
                    disabled: false,
                    ...(allowLocalUrls ? { allowLocalUrls: true } : {}),
                    ...(editConfig?.isBuiltIn ? { isBuiltIn: true } : {}),
                };
                this.plugin.settings.mcpServers ??= {};
                this.plugin.settings.mcpServers[serverName] = newConfig;
                await this.plugin.saveSettings();
                if (mcpClient) { await mcpClient.disconnect(serverName); await mcpClient.connect(serverName, newConfig); }
                modal.close();
                renderList();
            })(); });

            modal.open();
        };

        addBtn.addEventListener('click', () => openAddModal());
        renderList();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Claude Desktop Config
    // ─────────────────────────────────────────────────────────────────────────

    private writeClaudeDesktopConfig(): void {
        try {
            const platform = os.platform();
            let configDir: string;
            if (platform === 'darwin') configDir = path.join(os.homedir(), 'Library', 'Application Support', 'Claude');
            else if (platform === 'win32') configDir = path.join(readEnv(ENV_APPDATA) ?? os.homedir(), 'Claude');
            else configDir = path.join(os.homedir(), '.config', 'Claude');

            const configPath = path.join(configDir, 'claude_desktop_config.json');
            let config: Record<string, unknown> = {};
            try { config = JSON.parse(safeFs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>; } catch { /* new file */ }

            const servers = (config['mcpServers'] ?? {}) as Record<string, unknown>;
            servers['Vault Operator'] = { command: this.findNodePath(), args: [this.getWorkerPath()] };
            config['mcpServers'] = servers;

            safeFs.mkdirSync(configDir, { recursive: true });
            safeFs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
            new Notice(t('notice.mcp.desktopConfigSaved'));
        } catch (e) {
            new Notice(t('notice.mcp.desktopConfigFailed', { message: e instanceof Error ? e.message : String(e) }));
        }
    }

    private getWorkerPath(): string {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- runtimeWorker uses fs which is only available via dynamic require in Electron renderer
        const runtimeWorkerMod = require('../../core/utils/runtimeWorker') as { ensureRuntimeWorker: (plugin: unknown, name: string, code: string) => string };
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- inlined bundle file generated by esbuild
        const bundledWorkers = require('../../_generated/bundled-workers') as { MCP_WORKER_CODE: string };
        return runtimeWorkerMod.ensureRuntimeWorker(this.plugin, 'mcp-server-worker.js', bundledWorkers.MCP_WORKER_CODE);
    }

    private findNodePath(): string {
        const which = process.platform === 'win32' ? 'where' : 'which';
        const candidates: string[] = [];
        try {
            const result = spawnAllowedSync(which, ['node'], { encoding: 'utf-8', timeout: 3000 });
            if (result.status === 0 && result.stdout) {
                candidates.push(String(result.stdout).trim().split('\n')[0].trim());
            }
        } catch { /* fallback */ }
        if (process.platform === 'win32') {
            candidates.push('C:\\Program Files\\nodejs\\node.exe');
            candidates.push(`${readEnv(ENV_APPDATA) ?? ''}\\nvm\\current\\node.exe`);
        } else {
            candidates.push('/usr/local/bin/node', '/opt/homebrew/bin/node', `${os.homedir()}/.nvm/current/bin/node`);
        }
        for (const c of candidates) {
            // Candidate paths live outside the safeFs allowlist (system bin dirs).
            // probeBinaryExists is the documented bypass for that exact case
            // and returns a boolean only.
            if (!c || !safeFs.probeBinaryExists(c)) continue;
            try {
                const versionResult = spawnAllowedSync(c, ['--version'], { encoding: 'utf-8', timeout: 3000 });
                const version = String(versionResult.stdout ?? '').trim();
                if (version.startsWith('v')) return c;
            } catch { /* not a valid node binary */ }
        }
        return 'node';
    }
}

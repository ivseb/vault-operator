import { App, Modal, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { t } from '../../i18n';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export class McpTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        // One info banner at the top explaining the entire page
        const intro = containerEl.createDiv('agent-settings-info-banner');
        const introIcon = intro.createSpan({ cls: 'agent-settings-info-icon' });
        setIcon(introIcon, 'link');
        const introText = intro.createDiv({ cls: 'agent-settings-info-text' });
        introText.createEl('strong', { text: 'Connections' });
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- MCP is an acronym
        introText.createDiv({ text: 'Connect Obsilo to AI assistants like Claude, or extend Obsilo with external tool servers. All connections use the open MCP standard.' });

        this.buildConnectorSection(containerEl);
        this.buildExternalServersSection(containerEl);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Section 1: Connectors (Obsilo as server for AI assistants)
    // ─────────────────────────────────────────────────────────────────────────

    private buildConnectorSection(containerEl: HTMLElement): void {
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'Connectors' });
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            // eslint-disable-next-line obsidianmd/ui/sentence-case -- Claude is a product name
            text: 'Let AI assistants access your vault through Obsilo. Enable a connector, then configure the assistant to connect.',
        });

        // ── Claude Desktop / Claude Code ──────────────────────────────────
        const claudeSection = containerEl.createDiv('agent-mcp-connector-card');

        const claudeHeader = claudeSection.createDiv('agent-mcp-connector-header');
        claudeHeader.createSpan({ text: 'Claude Desktop / Claude Code', cls: 'agent-mcp-connector-name' });

        const mcpBridge = this.plugin.mcpBridge;
        const isRunning = mcpBridge?.running ?? false;
        const isEnabled = this.plugin.settings.enableMcpServer ?? false;

        // Status badge
        const statusBadge = claudeHeader.createSpan({
            cls: `agent-mcp-status-badge ${isRunning ? 'running' : isEnabled ? 'enabled' : 'off'}`,
            text: isRunning ? 'Running' : isEnabled ? 'Starting...' : 'Off',
        });

        // Enable toggle
        new Setting(claudeSection)
            .setName('Enable')
            .setDesc('Obsidian must be running for the connection to work.')
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

        // Setup button (only shown when enabled)
        if (isEnabled) {
            new Setting(claudeSection)
                .setName('Setup')
                // eslint-disable-next-line obsidianmd/ui/sentence-case -- Claude Desktop is a product name
                .setDesc('Writes the connection to Claude Desktop\'s config. Restart Claude Desktop after.')
                .addButton((btn) => {
                    btn.setButtonText('Configure Claude Desktop').onClick(() => {
                        void this.writeClaudeDesktopConfig();
                    });
                });
        }

        // ── Future connectors placeholder ─────────────────────────────────
        // (ChatGPT, Mistral, etc. -- cards will be added here later)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Section 2: External tool servers (Obsilo as client)
    // ─────────────────────────────────────────────────────────────────────────

    private buildExternalServersSection(containerEl: HTMLElement): void {
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'External tool servers' });
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Extend Obsilo with tools from external servers (web search, APIs, databases). These work in standalone mode.',
        });

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
                if (config.isBuiltIn) info.createSpan({ cls: 'agent-mcp-server-badge', text: 'built-in' });
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
                const parseKV = (text: string): Record<string, string> => {
                    const result: Record<string, string> = {};
                    for (const line of text.split('\n')) { const eqIdx = line.indexOf('='); if (eqIdx > 0) result[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim(); }
                    return result;
                };
                const newConfig: import('../../types/settings').McpServerConfig = { type, url: urlInput.value.trim(), headers: parseKV(headersInput.value), timeout: parseInt(timeoutInput.value) || 60, disabled: false, ...(editConfig?.isBuiltIn ? { isBuiltIn: true } : {}) };
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

    private async writeClaudeDesktopConfig(): Promise<void> {
        try {
            const platform = os.platform();
            let configDir: string;
            if (platform === 'darwin') configDir = path.join(os.homedir(), 'Library', 'Application Support', 'Claude');
            else if (platform === 'win32') configDir = path.join(process.env['APPDATA'] ?? os.homedir(), 'Claude');
            else configDir = path.join(os.homedir(), '.config', 'Claude');

            const configPath = path.join(configDir, 'claude_desktop_config.json');
            let config: Record<string, unknown> = {};
            try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>; } catch { /* new file */ }

            const servers = (config['mcpServers'] ?? {}) as Record<string, unknown>;
            servers['Obsilo'] = { command: this.findNodePath(), args: [this.getWorkerPath()] };
            config['mcpServers'] = servers;

            fs.mkdirSync(configDir, { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
            new Notice('Claude Desktop configured. Restart Claude Desktop to connect.');
        } catch (e) {
            new Notice(`Failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private getWorkerPath(): string {
        const adapter = this.plugin.app.vault.adapter as { getBasePath?: () => string };
        return path.join(adapter.getBasePath?.() ?? '', this.plugin.app.vault.configDir, 'plugins', this.plugin.manifest.id, 'mcp-server-worker.js');
    }

    private findNodePath(): string {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- child_process in Electron
        const cp = require('child_process') as typeof import('child_process');
        try { return cp.execSync('which node', { encoding: 'utf-8', timeout: 3000 }).trim(); } catch { /* fallback */ }
        for (const c of ['/usr/local/bin/node', '/opt/homebrew/bin/node', `${os.homedir()}/.nvm/current/bin/node`]) {
            if (fs.existsSync(c)) return c;
        }
        return 'node';
    }
}

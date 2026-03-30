import { App, Notice, Setting, setIcon, TFolder, AbstractInputSuggest, ButtonComponent } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { ModelConfigModal } from './ModelConfigModal';
import { addInfoButton } from './utils';
import { PROVIDER_LABELS, PROVIDER_COLORS } from './constants';
import type { CustomModel } from '../../types/settings';
import { getModelKey } from '../../types/settings';
import type { SemanticIndexService } from '../../core/semantic/SemanticIndexService';
import { t } from '../../i18n';

export class EmbeddingsTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    private buildIntroSection(containerEl: HTMLElement): void {
        const infoBanner = containerEl.createDiv('agent-settings-info-banner');
        const infoIcon = infoBanner.createSpan({ cls: 'agent-settings-info-icon' });
        setIcon(infoIcon, 'lightbulb');
        const infoText = infoBanner.createDiv({ cls: 'agent-settings-info-text' });
        infoText.createEl('strong', { text: t('settings.embeddings.introTitle') });
        infoText.createDiv({ text: t('settings.embeddings.introDesc') });
    }

    build(containerEl: HTMLElement): void {
        this.buildIntroSection(containerEl);
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.embeddings.headingModels') });

        const desc = containerEl.createDiv('model-table-desc');
        desc.setText(t('settings.embeddings.modelsDesc'));

        // Table header
        const table = containerEl.createDiv('model-table embedding-table');
        const header = table.createDiv('model-row model-row-header');
        header.createDiv({ cls: 'mc-name', text: t('settings.embeddings.headerModel') });
        header.createDiv({ cls: 'mc-provider', text: t('settings.embeddings.headerProvider') });
        header.createDiv({ cls: 'mc-key', text: t('settings.embeddings.headerKey') });
        header.createDiv({ cls: 'mc-enable', text: t('settings.embeddings.headerActive') });
        header.createDiv({ cls: 'mc-actions' });

        // Built-in local model (always first)
        if ((this.plugin.settings.embeddingModels ?? []).length === 0) {
            const emptyRow = table.createDiv('model-row');
            emptyRow.createDiv('mc-name').createSpan({
                text: t('settings.embeddings.empty'),
                cls: 'mc-name-text setting-item-description',
            });
        }

        // User-added API models
        const models = this.plugin.settings.embeddingModels ?? [];
        models.forEach((model) => this.renderEmbeddingRow(table, model));

        const footer = containerEl.createDiv('model-table-footer');
        const addBtn = footer.createEl('button', { cls: 'mod-cta model-add-btn', text: t('settings.embeddings.addModel') });
        addBtn.addEventListener('click', () => {
            new ModelConfigModal(this.app, null, (newModel) => { void (async () => {
                const key = getModelKey(newModel);
                if ((this.plugin.settings.embeddingModels ?? []).some((m) => getModelKey(m) === key)) {
                    new Notice(t('settings.embeddings.alreadyExists', { name: newModel.name }));
                    return;
                }
                if (!this.plugin.settings.embeddingModels) this.plugin.settings.embeddingModels = [];
                this.plugin.settings.embeddingModels.push(newModel);
                if (!this.plugin.settings.activeEmbeddingModelKey) {
                    this.plugin.settings.activeEmbeddingModelKey = key;
                }
                await this.plugin.saveSettings();
                this.rerender();
            })(); }, true /* forEmbedding */).open();
        });

        // ── Semantic Index ────────────────────────────────────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.embeddings.headingIndex') });

        const activeEmbModel = this.plugin.getActiveEmbeddingModel();
        const embModelDesc = activeEmbModel
            ? t('settings.embeddings.usingModel', { name: activeEmbModel.displayName ?? activeEmbModel.name, provider: activeEmbModel.provider })
            : t('settings.embeddings.noEmbeddingModel');

        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: t('settings.embeddings.indexDesc', { embModelDesc }),
        });

        if (!activeEmbModel) {
            const guide = containerEl.createDiv({ cls: 'setting-item-description agent-embed-guide' });
            guide.createEl('strong', { text: t('settings.embeddings.quickSetupTitle') });
            guide.createEl('br');
            guide.appendText(t('settings.embeddings.quickSetupStep1'));
            guide.createEl('br');
            guide.appendText(t('settings.embeddings.quickSetupStep2'));
            guide.createEl('br');
            guide.appendText(t('settings.embeddings.quickSetupStep3'));
            guide.createEl('br');
            guide.createEl('br');
            guide.createEl('strong', { text: t('settings.embeddings.quickSetupFreeTitle') });
            guide.appendText(' ' + t('settings.embeddings.quickSetupFreeDesc'));
        }

        const getIdx = (): SemanticIndexService | null => this.plugin.semanticIndex;
        // statusEl: declared here for closure scope, assigned below in "Build index" setting
        let statusEl: HTMLElement = undefined as unknown as HTMLElement;

        const semanticEnableSetting = new Setting(containerEl)
            .setName(t('settings.embeddings.enableIndex'))
            .setDesc(t('settings.embeddings.enableIndexDesc'));
        addInfoButton(semanticEnableSetting, this.app, t('settings.embeddings.infoIndexTitle'), t('settings.embeddings.infoIndexBody'));
        semanticEnableSetting.addToggle((toggle) =>
            toggle.setValue(this.plugin.settings.enableSemanticIndex ?? false).onChange(async (v) => {
                this.plugin.settings.enableSemanticIndex = v;
                await this.plugin.saveSettings();
                if (v) {
                    const { SemanticIndexService } = await import('../../core/semantic/SemanticIndexService');
                    const { KnowledgeDB } = await import('../../core/knowledge/KnowledgeDB');
                    const { VectorStore } = await import('../../core/knowledge/VectorStore');
                    const pluginDir = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
                    const knowledgeDB = new KnowledgeDB(
                        this.plugin.app.vault,
                        pluginDir,
                        'global', // ADR-050: knowledge.db is always global
                    );
                    await knowledgeDB.open().catch(console.warn);
                    const vectorStore = new VectorStore(knowledgeDB);
                    this.plugin.knowledgeDB = knowledgeDB;
                    this.plugin.vectorStore = vectorStore;
                    const svc = new SemanticIndexService(this.plugin.app.vault, knowledgeDB, vectorStore);
                    const embModel = this.plugin.getActiveEmbeddingModel();
                    if (embModel) svc.setEmbeddingModel(embModel);
                    this.plugin.semanticIndex = svc;
                    await svc.initialize().catch(console.warn);
                } else {
                    // Cancel any ongoing build before clearing the reference
                    this.plugin.semanticIndex?.cancelBuild();
                    this.plugin.semanticIndex = null;
                    void this.plugin.knowledgeDB?.close().catch(console.warn);
                    this.plugin.knowledgeDB = null;
                    this.plugin.vectorStore = null;
                }
                refreshStatus();
            }),
        );

        new Setting(containerEl)
            .setName(t('settings.embeddings.indexPdfs'))
            .setDesc(t('settings.embeddings.indexPdfsDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.semanticIndexPdfs ?? false).onChange(async (v) => {
                    this.plugin.settings.semanticIndexPdfs = v;
                    getIdx()?.configure({ indexPdfs: v });
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName('Contextual Retrieval')
            .setDesc('Enrich chunks with LLM-generated context in the background. Improves search quality by 49-67%. Requires a contextual model below.')
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.enableContextualRetrieval ?? true).onChange(async (v) => {
                    this.plugin.settings.enableContextualRetrieval = v;
                    getIdx()?.configure({ enableContextualRetrieval: v });
                    await this.plugin.saveSettings();
                    if (v) {
                        // Auto-start enrichment when toggled on (if index exists + model configured)
                        void this.triggerEnrichmentIfReady();
                    } else {
                        // Cancel enrichment when toggled off
                        getIdx()?.cancelEnrichment();
                    }
                }),
            );

        const ctxModels = this.plugin.settings.activeModels.filter((m) => m.enabled);
        if (ctxModels.length > 0) {
            new Setting(containerEl)
                .setName('Contextual Retrieval Model')
                .setDesc('Chat model for context prefix generation. Use a cheap/fast model (e.g. Haiku, gpt-4o-mini).')
                .addDropdown((d) => {
                    d.addOption('', '-- Select model --');
                    for (const m of ctxModels) {
                        d.addOption(getModelKey(m), m.displayName ?? m.name);
                    }
                    d.setValue(this.plugin.settings.contextualModelKey ?? '');
                    d.onChange(async (v) => {
                        this.plugin.settings.contextualModelKey = v;
                        await this.plugin.saveSettings();
                        // Model changed: reset enrichment status and restart
                        if (v && this.plugin.vectorStore) {
                            getIdx()?.cancelEnrichment();
                            this.plugin.vectorStore.resetEnrichmentStatus();
                            void this.triggerEnrichmentIfReady();
                        }
                    });
                });
        }

        const buildSetting = new Setting(containerEl)
            .setName(t('settings.embeddings.buildIndexName'))
            .setDesc(t('settings.embeddings.buildIndexDesc'));
        statusEl = buildSetting.descEl.createDiv('agent-semantic-status');
        let cancelBtn: ButtonComponent | undefined;

        const refreshStatus = () => {
            statusEl.empty();
            if (!this.plugin.settings.enableSemanticIndex) {
                statusEl.setText(t('settings.embeddings.statusDisabled'));
                return;
            }
            const idx = getIdx();
            if (!idx) {
                statusEl.setText(t('settings.embeddings.statusNotInit'));
                return;
            }
            if (idx.building) {
                const p = idx.progressIndexed ?? idx.docCount;
                const total = idx.progressTotal ?? '?';
                statusEl.setText(t('settings.embeddings.statusBuilding') + ` (${p} / ${total} files)`);
                // Keep cancel button enabled while building (covers auto-index on startup)
                cancelBtn?.setDisabled(false);
                return;
            }
            // Build not running — disable cancel button (unless enrichment is running)
            cancelBtn?.setDisabled(!idx.enriching);
            if (idx.isIndexed) {
                const br = idx.lastBuildResult;
                const base = t('settings.embeddings.statusReady', { docCount: idx.docCount, builtAt: (idx.lastBuiltAt as Date).toLocaleString() });
                if (br && br.errors > 0) {
                    statusEl.setText(`${base} · ${t('settings.embeddings.statusSkipped', { count: br.errors })}`);
                } else {
                    statusEl.setText(base);
                }
                // Enrichment progress (Pass 2)
                if (idx.enriching) {
                    const ep = idx.getEnrichmentProgress();
                    statusEl.createDiv('agent-enrichment-status').setText(
                        `Enriching: ${ep.processed}/${ep.total} chunks (search works -- quality improving)`,
                    );
                } else {
                    const unenriched = this.plugin.vectorStore?.getUnenrichedCount() ?? 0;
                    if (unenriched > 0) {
                        statusEl.createDiv('agent-enrichment-hint').setText(
                            `${unenriched} chunks pending enrichment`,
                        );
                    }
                }
            } else {
                statusEl.setText(t('settings.embeddings.statusNotBuilt'));
            }
        };
        refreshStatus();

        // Poll every second so status stays current
        const pollInterval = window.setInterval(refreshStatus, 1000);
        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of Array.from(m.removedNodes)) {
                    if (node === containerEl || (node as HTMLElement).contains?.(containerEl)) {
                        window.clearInterval(pollInterval);
                        observer.disconnect();
                    }
                }
            }
        });
        if (containerEl.parentElement) observer.observe(containerEl.parentElement, { childList: true });

        buildSetting.addButton((btn) => {
                btn.setButtonText(t('settings.embeddings.buildIndex')).onClick(async () => {
                    const idx = getIdx();
                    if (!idx) { new Notice(t('settings.embeddings.enableFirst')); return; }
                    if (idx.building) { new Notice(t('settings.embeddings.alreadyBuilding')); return; }
                    idx.setEmbeddingModel(this.plugin.getActiveEmbeddingModel() ?? null);
                    btn.setButtonText(t('settings.embeddings.building')).setDisabled(true);
                    cancelBtn?.setDisabled(false);
                    statusEl.setText(t('settings.embeddings.statusBuilding'));
                    try {
                        const result = await idx.buildIndex((indexed: number, total: number) => {
                            statusEl.setText(`${t('settings.embeddings.building')} (${indexed}/${total})`);
                        });
                        if (result.errors > 0) {
                            new Notice(t('settings.embeddings.indexBuilt', { indexed: result.indexed, total: result.total, errors: result.errors }));
                        }
                        refreshStatus();
                    } catch (e) {
                        statusEl.setText(t('settings.embeddings.statusBuildFailed', { error: (e as Error).message }));
                    } finally {
                        btn.setButtonText(t('settings.embeddings.buildIndex')).setDisabled(false);
                        cancelBtn?.setDisabled(true);
                    }
                });
            })
            .addButton((btn) => {
                btn.setButtonText(t('settings.embeddings.forceRebuild')).setWarning().onClick(async () => {
                    const idx = getIdx();
                    if (!idx) { new Notice(t('settings.embeddings.enableFirst')); return; }
                    if (idx.building) { new Notice(t('settings.embeddings.alreadyBuilding')); return; }
                    idx.setEmbeddingModel(this.plugin.getActiveEmbeddingModel() ?? null);
                    btn.setButtonText(t('settings.embeddings.rebuilding')).setDisabled(true);
                    cancelBtn?.setDisabled(false);
                    statusEl.setText(t('settings.embeddings.statusForceRebuild'));
                    try {
                        const result = await idx.buildIndex((indexed: number, total: number) => {
                            statusEl.setText(`${t('settings.embeddings.rebuilding')} (${indexed}/${total})`);
                        }, true);
                        if (result.errors > 0) {
                            new Notice(t('settings.embeddings.indexRebuilt', { indexed: result.indexed, total: result.total, errors: result.errors }));
                        }
                        refreshStatus();
                    } catch (e) {
                        statusEl.setText(t('settings.embeddings.statusRebuildFailed', { error: (e as Error).message }));
                    } finally {
                        btn.setButtonText(t('settings.embeddings.forceRebuild')).setDisabled(false);
                        cancelBtn?.setDisabled(true);
                    }
                });
            });

        new Setting(containerEl)
            .setName(t('settings.embeddings.cancelIndexing'))
            .setDesc(t('settings.embeddings.cancelIndexingDesc'))
            .addButton((btn) => {
                cancelBtn = btn;
                // Enable immediately if a build is already running (e.g. auto-index on startup)
                btn.setButtonText(t('settings.embeddings.cancel'))
                    .setDisabled(!getIdx()?.building)
                    .onClick(() => {
                        getIdx()?.cancelBuild();
                        btn.setDisabled(true);
                        statusEl.setText(t('settings.embeddings.statusCancelling'));
                    });
            });

        new Setting(containerEl)
            .setName(t('settings.embeddings.deleteIndexName'))
            .setDesc(t('settings.embeddings.deleteIndexDesc'))
            .addButton((btn) => {
                btn.setButtonText(t('settings.embeddings.deleteIndex')).setWarning().onClick(async () => {
                    const idx = getIdx();
                    if (idx) await idx.deleteIndex();
                    refreshStatus();
                });
            });

        // ── Index configuration ───────────────────────────────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.embeddings.headingConfig') });

        const batchSetting = new Setting(containerEl)
            .setName(t('settings.embeddings.checkpointInterval'))
            .setDesc(t('settings.embeddings.checkpointIntervalDesc'));
        addInfoButton(batchSetting, this.app, t('settings.embeddings.infoCheckpointTitle'), t('settings.embeddings.infoCheckpointBody'));
        batchSetting.addSlider((s) =>
            s.setLimits(10, 200, 10)
                .setValue(this.plugin.settings.semanticBatchSize ?? 50)
                .setDynamicTooltip()
                .onChange(async (v) => {
                    this.plugin.settings.semanticBatchSize = v;
                    getIdx()?.configure({ batchSize: v });
                    await this.plugin.saveSettings();
                }),
        );

        const chunkSizeSetting = new Setting(containerEl)
            .setName(t('settings.embeddings.chunkSize'))
            .setDesc(t('settings.embeddings.chunkSizeDesc'));
        chunkSizeSetting.addDropdown((d) =>
            d.addOptions({
                '800':  t('settings.embeddings.chunkSmall'),
                '1200': t('settings.embeddings.chunkMedium'),
                '2000': t('settings.embeddings.chunkStandard'),
                '3000': t('settings.embeddings.chunkLarge'),
            })
                .setValue(String(this.plugin.settings.semanticChunkSize ?? 2000))
                .onChange(async (v) => {
                    const newSize = parseInt(v, 10);
                    this.plugin.settings.semanticChunkSize = newSize;
                    getIdx()?.configure({ chunkSize: newSize });
                    await this.plugin.saveSettings();
                    new Notice(t('settings.embeddings.chunkSizeUpdated'));
                }),
        );

        const hydeSetting = new Setting(containerEl)
            .setName(t('settings.embeddings.hyde'))
            .setDesc(t('settings.embeddings.hydeDesc'));
        addInfoButton(hydeSetting, this.app, t('settings.embeddings.infoHydeTitle'), t('settings.embeddings.infoHydeBody'));
        hydeSetting.addToggle((toggle) =>
            toggle.setValue(this.plugin.settings.hydeEnabled ?? false).onChange(async (v) => {
                this.plugin.settings.hydeEnabled = v;
                await this.plugin.saveSettings();
            }),
        );

        const autoIndexOnChangeSetting = new Setting(containerEl)
            .setName(t('settings.embeddings.autoIndexOnChange'))
            .setDesc(t('settings.embeddings.autoIndexOnChangeDesc'));
        autoIndexOnChangeSetting.descEl.createDiv({
            cls: 'setting-risk-note',
            text: t('settings.embeddings.riskNote'),
        });
        addInfoButton(autoIndexOnChangeSetting, this.app, t('settings.embeddings.infoAutoChangeTitle'), t('settings.embeddings.infoAutoChangeBody'));
        autoIndexOnChangeSetting.addToggle((toggle) =>
            toggle.setValue(this.plugin.settings.semanticAutoIndexOnChange ?? false).onChange(async (v) => {
                this.plugin.settings.semanticAutoIndexOnChange = v;
                await this.plugin.saveSettings();
                new Notice(v ? t('settings.embeddings.autoIndexEnabled') : t('settings.embeddings.autoIndexDisabled'));
            }),
        );

        const autoIndexSetting = new Setting(containerEl)
            .setName(t('settings.embeddings.autoIndexStrategy'))
            .setDesc(t('settings.embeddings.autoIndexStrategyDesc'));
        addInfoButton(autoIndexSetting, this.app, t('settings.embeddings.infoAutoStrategyTitle'), t('settings.embeddings.infoAutoStrategyBody'));
        autoIndexSetting.addDropdown((d) =>
            d.addOptions({
                never: t('settings.embeddings.autoIndexNever'),
                startup: t('settings.embeddings.autoIndexStartup'),
                'mode-switch': t('settings.embeddings.autoIndexModeSwitch'),
            })
                .setValue(this.plugin.settings.semanticAutoIndex ?? 'never')
                .onChange(async (v) => {
                    this.plugin.settings.semanticAutoIndex = v as 'startup' | 'mode-switch' | 'never';
                    await this.plugin.saveSettings();
                }),
        );

        const excludedSetting = new Setting(containerEl)
            .setName(t('settings.embeddings.excludedFolders'))
            .setDesc(t('settings.embeddings.excludedFoldersDesc'));
        addInfoButton(excludedSetting, this.app, t('settings.embeddings.infoExcludedTitle'), t('settings.embeddings.infoExcludedBody'));

        const excludedFolders = this.plugin.settings.semanticExcludedFolders ?? [];

        // Chip list as a separate row below the setting, full width
        const excludedListEl = containerEl.createDiv('excluded-folder-list');
        const renderExcludedList = () => {
            excludedListEl.empty();
            const current = this.plugin.settings.semanticExcludedFolders ?? [];
            for (const folder of current) {
                const chip = excludedListEl.createDiv('excluded-folder-chip');
                chip.createSpan({ text: folder });
                const removeBtn = chip.createSpan({ cls: 'excluded-folder-remove' });
                setIcon(removeBtn, 'x');
                removeBtn.addEventListener('click', () => {
                    this.plugin.settings.semanticExcludedFolders =
                        (this.plugin.settings.semanticExcludedFolders ?? []).filter((f) => f !== folder);
                    getIdx()?.configure({ excludedFolders: this.plugin.settings.semanticExcludedFolders });
                    void this.plugin.saveSettings();
                    renderExcludedList();
                });
            }
        };
        renderExcludedList();

        const folderInput = excludedSetting.controlEl.createEl('input', {
            cls: 'excluded-folder-input',
            attr: { type: 'text', placeholder: t('settings.embeddings.folderPlaceholder') },
        });

        // Folder suggest dropdown
        const suggest = new FolderInputSuggest(this.app, folderInput, excludedFolders);
        suggest.onPick = (folderPath: string) => { void (async () => {
            if (!this.plugin.settings.semanticExcludedFolders) this.plugin.settings.semanticExcludedFolders = [];
            if (!this.plugin.settings.semanticExcludedFolders.includes(folderPath)) {
                this.plugin.settings.semanticExcludedFolders.push(folderPath);
                getIdx()?.configure({ excludedFolders: this.plugin.settings.semanticExcludedFolders });
                await this.plugin.saveSettings();
                renderExcludedList();
            }
            folderInput.value = '';
        })(); };

        folderInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const val = folderInput.value.trim();
                if (val) {
                    void suggest.onPick(val);
                }
            }
        });

        // Storage location removed from UI (ADR-050: knowledge.db is always global)

        // ── Graph Expansion (FEATURE-1502) ─────────────────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'Graph Expansion' });

        new Setting(containerEl)
            .setName('Graph Expansion')
            .setDesc('Expand search results via Wikilinks and MOC-Properties (Themen, Konzepte, etc.). Extracts your vault graph into the Knowledge DB.')
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.enableGraphExpansion ?? true).onChange(async (v) => {
                    this.plugin.settings.enableGraphExpansion = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName('Expansion Hops')
            .setDesc('How many link-hops to follow (1 = direct links, 2 = links of links, 3 = broad). Higher values include more context.')
            .addDropdown((d) => {
                d.addOption('1', '1 hop (direct links)');
                d.addOption('2', '2 hops');
                d.addOption('3', '3 hops (broad)');
                d.setValue(String(this.plugin.settings.graphExpansionHops ?? 1));
                d.onChange(async (v) => {
                    this.plugin.settings.graphExpansionHops = parseInt(v, 10);
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName('MOC Property Names')
            .setDesc('Frontmatter properties to extract as graph edges (comma-separated). E.g. Themen, Konzepte, Personen.')
            .addText((text) => {
                text.setValue((this.plugin.settings.mocPropertyNames ?? []).join(', '));
                text.setPlaceholder('Themen, Konzepte, Personen');
                text.inputEl.addEventListener('blur', () => { void (async () => {
                    const names = text.getValue().split(',').map(s => s.trim()).filter(Boolean);
                    this.plugin.settings.mocPropertyNames = names;
                    this.plugin.graphExtractor?.setMocProperties(names);
                    await this.plugin.saveSettings();
                })(); });
            });

        // Graph statistics
        const graphStats = containerEl.createDiv('agent-settings-desc');
        if (this.plugin.graphStore) {
            const edges = this.plugin.graphStore.getEdgeCount();
            const tags = this.plugin.graphStore.getTagCount();
            graphStats.setText(`Graph: ${edges} edges, ${tags} unique tags extracted`);
        } else {
            graphStats.setText('Graph: not initialized (enable Semantic Index first)');
        }

        // ── Implicit Connections (FEATURE-1503) ──────────────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'Implicit Connections' });

        new Setting(containerEl)
            .setName('Implicit Connections')
            .setDesc('Discover semantically similar notes that have no direct Wikilink. Computed in the background after indexing.')
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.enableImplicitConnections ?? true).onChange(async (v) => {
                    this.plugin.settings.enableImplicitConnections = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName('Similarity Threshold')
            .setDesc('Minimum cosine similarity to count as an implicit connection (0.5 = loose, 0.9 = strict).')
            .addSlider((s) =>
                s.setLimits(0.5, 0.9, 0.05)
                    .setValue(this.plugin.settings.implicitThreshold ?? 0.7)
                    .setDynamicTooltip()
                    .onChange(async (v) => {
                        this.plugin.settings.implicitThreshold = v;
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName('Suggestion Banner')
            .setDesc('Show implicit connection suggestions in the sidebar. Disable if the suggestions are distracting.')
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.enableSuggestionBanner ?? true).onChange(async (v) => {
                    this.plugin.settings.enableSuggestionBanner = v;
                    await this.plugin.saveSettings();
                }),
            );

        const implicitStats = containerEl.createDiv('agent-settings-desc');
        const implicitCount = this.plugin.implicitConnectionService?.getCount() ?? 0;
        if (implicitCount > 0) {
            implicitStats.setText(`${implicitCount} implicit connections discovered`);
        } else if (this.plugin.implicitConnectionService?.computing) {
            implicitStats.setText('Computing implicit connections...');
        } else {
            implicitStats.setText('No implicit connections computed yet (build index first)');
        }

        // ── Local Reranking (FEATURE-1504) ───────────────────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'Local Reranking' });

        new Setting(containerEl)
            .setName('Local Reranking')
            .setDesc('Re-score search results with a local cross-encoder model (ms-marco-MiniLM). Runs entirely on-device via WASM. Desktop only.')
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.enableReranking ?? true).onChange(async (v) => {
                    this.plugin.settings.enableReranking = v;
                    await this.plugin.saveSettings();
                    if (v && !this.plugin.rerankerService) {
                        const { RerankerService } = await import('../../core/knowledge/RerankerService');
                        this.plugin.rerankerService = new RerankerService();
                        void this.plugin.rerankerService.loadModel();
                    }
                }),
            );

        new Setting(containerEl)
            .setName('Rerank Candidates')
            .setDesc('How many candidates to rerank (more = better quality but slower).')
            .addSlider((s) =>
                s.setLimits(10, 30, 5)
                    .setValue(this.plugin.settings.rerankCandidates ?? 20)
                    .setDynamicTooltip()
                    .onChange(async (v) => {
                        this.plugin.settings.rerankCandidates = v;
                        await this.plugin.saveSettings();
                    }),
            );

    }

    /** Start background enrichment if all prerequisites are met. */
    private async triggerEnrichmentIfReady(): Promise<void> {
        const idx = this.plugin.semanticIndex;
        if (!idx || !idx.isIndexed || idx.enriching || idx.building) return;
        if (!this.plugin.settings.enableContextualRetrieval) return;
        if (!this.plugin.settings.contextualModelKey) return;

        const ctxModel = this.plugin.settings.activeModels.find(
            (m) => getModelKey(m) === this.plugin.settings.contextualModelKey && m.enabled,
        );
        if (!ctxModel) return;

        const { buildApiHandlerForModel } = await import('../../api/index');
        idx.setContextualApiHandler(buildApiHandlerForModel(ctxModel));
        void idx.runBackgroundEnrichment();
    }

    renderEmbeddingRow(table: HTMLElement, model: CustomModel): void {
        const key = getModelKey(model);
        const hasKey = !!model.apiKey || model.provider === 'ollama' || model.provider === 'lmstudio';
        const isActive = this.plugin.settings.activeEmbeddingModelKey === key;

        const row = table.createDiv(`model-row${isActive ? ' model-row-active' : ''}`);

        row.createDiv('mc-name').createSpan({ text: model.displayName ?? model.name, cls: 'mc-name-text' });

        const provEl = row.createDiv('mc-provider');
        const badge = provEl.createSpan({ cls: 'provider-badge', text: PROVIDER_LABELS[model.provider] ?? model.provider });
        badge.setCssProps({ '--provider-bg': PROVIDER_COLORS[model.provider] ?? '#607d8b' });

        const keyEl = row.createDiv('mc-key');
        const keyIcon = keyEl.createSpan('mc-key-icon');
        setIcon(keyIcon, hasKey ? 'check' : 'minus');
        keyEl.addClass(hasKey ? 'mc-key-ok' : 'mc-key-missing');

        // Active radio-style toggle
        const enableEl = row.createDiv('mc-enable');
        const toggle = enableEl.createEl('input', { attr: { type: 'radio', name: 'active-embedding' } });
        toggle.checked = isActive;
        toggle.addEventListener('change', () => { void (async () => {
            if (toggle.checked) {
                this.plugin.settings.activeEmbeddingModelKey = key;
                await this.plugin.saveSettings();
                this.rerender();
            }
        })(); });

        const actionsEl = row.createDiv('mc-actions');
        const configBtn = actionsEl.createEl('button', { cls: 'mc-action-btn', attr: { title: t('settings.embeddings.configureModel') } });
        setIcon(configBtn, 'settings');
        configBtn.addEventListener('click', () => {
            new ModelConfigModal(this.app, { ...model }, (updated) => { void (async () => {
                const idx = (this.plugin.settings.embeddingModels ?? []).findIndex((m) => getModelKey(m) === key);
                if (idx !== -1) this.plugin.settings.embeddingModels[idx] = updated;
                if (this.plugin.settings.activeEmbeddingModelKey === key) {
                    this.plugin.settings.activeEmbeddingModelKey = getModelKey(updated);
                }
                await this.plugin.saveSettings();
                this.rerender();
            })(); }, true /* forEmbedding */).open();
        });

        const delBtn = actionsEl.createEl('button', { cls: 'mc-action-btn mc-action-del', attr: { title: t('settings.embeddings.removeModel') } });
        setIcon(delBtn, 'trash');
        delBtn.addEventListener('click', () => { void (async () => {
            this.plugin.settings.embeddingModels = (this.plugin.settings.embeddingModels ?? []).filter(
                (m) => getModelKey(m) !== key,
            );
            if (this.plugin.settings.activeEmbeddingModelKey === key) {
                this.plugin.settings.activeEmbeddingModelKey = this.plugin.settings.embeddingModels[0]
                    ? getModelKey(this.plugin.settings.embeddingModels[0])
                    : '';
            }
            await this.plugin.saveSettings();
            this.rerender();
        })(); });
    }


    // ---------------------------------------------------------------------------
    // Web Search tab (under Providers)
    // ---------------------------------------------------------------------------

}

/** Suggest dropdown that lists vault folders, filtered by input text. */
class FolderInputSuggest extends AbstractInputSuggest<string> {
    private excluded: string[];
    onPick: (folderPath: string) => void = () => {};

    constructor(app: App, inputEl: HTMLInputElement, excluded: string[]) {
        super(app, inputEl);
        this.excluded = excluded;
    }

    getSuggestions(query: string): string[] {
        const lower = query.toLowerCase().replace(/^\//, '');
        return this.app.vault
            .getAllFolders()
            .map((f: TFolder) => f.path)
            .filter((p: string) => !this.excluded.includes(p) && p.toLowerCase().includes(lower))
            .sort();
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        el.setText(value);
    }

    selectSuggestion(value: string): void {
        this.onPick(value);
        this.close();
    }
}

/**
 * FirstRunWizardModal -- Phase 2.3.
 *
 * One-shot setup wizard that walks new users through the seven
 * choices that the plugin can't sensibly default to: LLM model,
 * embedding model, role models (titling/internal calls/memory/
 * contextual), search provider, and the two optional asset downloads
 * (reranker, self-development source).
 *
 * Auto-opens on plugin load for the first three sessions unless the
 * user has dismissed it or completed it. Can also be triggered
 * manually from a Settings button. Each step is skippable; skipped
 * steps appear as inline banners in their respective settings tabs so
 * the user can pick them up later.
 *
 * After the final step closes the modal, the existing OnboardingFlow
 * is started in the sidebar to fill the user's Memory + Soul through
 * a conversational chat.
 */

import { App, Modal, Notice, Setting } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { ModelConfigModal } from '../settings/ModelConfigModal';
import type { CustomModel } from '../../types/settings';
import { getModelKey } from '../../types/settings';

type StepId =
    | 'welcome'
    | 'llm-model'
    | 'embedding-model'
    | 'role-models'
    | 'search-provider'
    | 'optional-downloads'
    | 'done';

const STEPS: { id: StepId; title: string; canSkip: boolean }[] = [
    { id: 'welcome',            title: 'Welcome',             canSkip: false },
    { id: 'llm-model',          title: 'LLM model',           canSkip: true  },
    { id: 'embedding-model',    title: 'Embedding model',     canSkip: true  },
    { id: 'role-models',        title: 'Role models',         canSkip: true  },
    { id: 'search-provider',    title: 'Search provider',     canSkip: true  },
    { id: 'optional-downloads', title: 'Optional downloads',  canSkip: true  },
    { id: 'done',               title: 'Done',                canSkip: false },
];

export class FirstRunWizardModal extends Modal {
    private stepIndex = 0;
    private headerEl!: HTMLElement;
    private progressEl!: HTMLElement;
    private bodyEl!: HTMLElement;
    private footerEl!: HTMLElement;

    constructor(app: App, private readonly plugin: ObsidianAgentPlugin) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('vault-operator-wizard');
        // The modal is wide enough to hold the configuration steps comfortably
        this.modalEl.style.maxWidth = '720px';

        this.headerEl   = contentEl.createDiv({ cls: 'wizard-header' });
        this.progressEl = contentEl.createDiv({ cls: 'wizard-progress' });
        this.bodyEl     = contentEl.createDiv({ cls: 'wizard-body' });
        this.footerEl   = contentEl.createDiv({ cls: 'wizard-footer' });

        // Minimal inline styling -- avoids touching styles.css for the first cut
        this.progressEl.style.display = 'flex';
        this.progressEl.style.gap = '4px';
        this.progressEl.style.margin = '8px 0 16px 0';
        this.bodyEl.style.minHeight = '300px';
        this.bodyEl.style.padding = '8px 0';
        this.footerEl.style.display = 'flex';
        this.footerEl.style.justifyContent = 'space-between';
        this.footerEl.style.marginTop = '16px';

        void this.renderStep();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    /** Render the current step + chrome. */
    private async renderStep(): Promise<void> {
        const step = STEPS[this.stepIndex];

        this.headerEl.empty();
        const title = this.headerEl.createEl('h2');
        title.setText(`Vault Operator Setup: ${step.title}`);
        const subtitle = this.headerEl.createDiv();
        subtitle.style.fontSize = '0.85em';
        subtitle.style.opacity = '0.7';
        subtitle.setText(`Step ${this.stepIndex + 1} of ${STEPS.length}`);

        this.renderProgress();
        this.bodyEl.empty();
        this.footerEl.empty();

        await this.renderStepBody(step.id);
        this.renderFooter(step);
    }

    private renderProgress(): void {
        this.progressEl.empty();
        STEPS.forEach((_step, idx) => {
            const dot = this.progressEl.createDiv();
            dot.style.flex = '1';
            dot.style.height = '4px';
            dot.style.borderRadius = '2px';
            dot.style.background = idx <= this.stepIndex
                ? 'var(--interactive-accent)'
                : 'var(--background-modifier-border)';
        });
    }

    private renderFooter(step: { id: StepId; canSkip: boolean }): void {
        // Left-side controls: Back / Don't show again
        const leftGroup = this.footerEl.createDiv();
        leftGroup.style.display = 'flex';
        leftGroup.style.gap = '8px';

        if (this.stepIndex > 0 && step.id !== 'done') {
            const backBtn = leftGroup.createEl('button', { text: '< Back' });
            backBtn.addEventListener('click', () => {
                this.stepIndex = Math.max(0, this.stepIndex - 1);
                void this.renderStep();
            });
        }

        if (step.id === 'welcome') {
            const dismissBtn = leftGroup.createEl('button', { text: "Don't show again" });
            dismissBtn.addEventListener('click', async () => {
                this.plugin.settings.onboarding.dontShowFirstRunAgain = true;
                await this.plugin.saveSettings();
                this.close();
            });
        }

        // Right-side controls: Skip / Next / Finish
        const rightGroup = this.footerEl.createDiv();
        rightGroup.style.display = 'flex';
        rightGroup.style.gap = '8px';

        if (step.canSkip) {
            const skipBtn = rightGroup.createEl('button', { text: 'Skip' });
            skipBtn.addEventListener('click', () => { void this.skipStep(); });
        }

        if (step.id === 'done') {
            const finishBtn = rightGroup.createEl('button', { cls: 'mod-cta', text: 'Start chat to set up memory' });
            finishBtn.addEventListener('click', () => { void this.finishAndStartChat(); });
            const closeBtn = rightGroup.createEl('button', { text: 'Close' });
            closeBtn.addEventListener('click', () => { void this.finishWithoutChat(); });
        } else {
            const nextBtn = rightGroup.createEl('button', { cls: 'mod-cta', text: this.stepIndex === 0 ? 'Get started' : 'Next >' });
            nextBtn.addEventListener('click', () => { void this.advance(); });
        }
    }

    private async skipStep(): Promise<void> {
        const step = STEPS[this.stepIndex];
        const skipped = this.plugin.settings.onboarding.skippedSteps;
        if (!skipped.includes(step.id as never)) {
            (skipped as string[]).push(step.id);
            await this.plugin.saveSettings();
        }
        await this.advance();
    }

    private async advance(): Promise<void> {
        if (this.stepIndex < STEPS.length - 1) {
            this.stepIndex++;
            await this.plugin.saveSettings();
            await this.renderStep();
        }
    }

    private async finishAndStartChat(): Promise<void> {
        this.plugin.settings.onboarding.modalCompleted = true;
        await this.plugin.saveSettings();
        this.close();
        try {
            await this.plugin.startOnboarding();
        } catch (e) {
            console.warn('[FirstRunWizard] Could not start onboarding chat:', e);
        }
    }

    private async finishWithoutChat(): Promise<void> {
        this.plugin.settings.onboarding.modalCompleted = true;
        await this.plugin.saveSettings();
        this.close();
    }

    // -----------------------------------------------------------------------
    // Step bodies
    // -----------------------------------------------------------------------

    private async renderStepBody(id: StepId): Promise<void> {
        switch (id) {
            case 'welcome':             return this.renderWelcome();
            case 'llm-model':           return this.renderLlmStep();
            case 'embedding-model':     return this.renderEmbeddingStep();
            case 'role-models':         return this.renderRoleModelsStep();
            case 'search-provider':     return this.renderSearchProviderStep();
            case 'optional-downloads':  return this.renderOptionalDownloadsStep();
            case 'done':                return this.renderDoneStep();
        }
    }

    private renderWelcome(): void {
        const p = (text: string): HTMLElement => {
            const el = this.bodyEl.createEl('p');
            el.setText(text);
            return el;
        };
        p('Vault Operator is an AI agent for this vault. A few quick choices to get going.');
        p('Every step is skippable. You can configure anything later in Settings.');
        p('Nothing leaves your machine until you set up a provider. Then only the messages you send to that provider are transmitted to it.');
    }

    private async renderLlmStep(): Promise<void> {
        const intro = this.bodyEl.createEl('p');
        intro.setText('Vault Operator talks to a large language model. Pick a provider, grab a free or paid API key, paste it here.');

        // Status block: how many enabled models the user already has.
        const status = this.bodyEl.createDiv();
        status.style.padding = '8px 12px';
        status.style.margin = '12px 0';
        status.style.borderRadius = '4px';
        status.style.background = 'var(--background-secondary)';
        const renderStatus = () => {
            status.empty();
            const count = this.plugin.settings.activeModels.filter(m => m.enabled).length;
            if (count === 0) {
                const txt = status.createEl('strong');
                txt.setText('No model configured yet.');
                const hint = status.createDiv();
                hint.style.fontSize = '0.85em';
                hint.style.marginTop = '4px';
                hint.setText('Pick one of the options below, click "Add model", paste your API key.');
            } else {
                const txt = status.createEl('strong');
                txt.setText(`You have ${count} model${count === 1 ? '' : 's'} configured. You can skip this step.`);
            }
        };
        renderStatus();

        // Provider recommendations with where to get the API key.
        const heading = this.bodyEl.createEl('h4');
        heading.setText('Where to get an API key');
        heading.style.marginTop = '16px';
        heading.style.marginBottom = '6px';

        const providers: { name: string; tier: string; url: string; note: string }[] = [
            {
                name: 'Google Gemini',
                tier: 'Free tier, no credit card',
                url: 'https://aistudio.google.com/app/apikey',
                note: 'Easiest start. Click the link, sign in with Google, create an API key.',
            },
            {
                name: 'Anthropic Claude',
                tier: 'Paid, best for tool use',
                url: 'https://console.anthropic.com/settings/keys',
                note: 'Highest quality for agent tasks. $5 starting credit on new accounts.',
            },
            {
                name: 'OpenAI',
                tier: 'Paid',
                url: 'https://platform.openai.com/api-keys',
                note: 'Good general purpose. GPT-5 and GPT-4o.',
            },
            {
                name: 'Ollama (local)',
                tier: 'Free, fully local',
                url: 'https://ollama.com',
                note: 'Installs models on your machine. Privacy by default, no data leaves your computer.',
            },
        ];

        for (const p of providers) {
            const row = this.bodyEl.createDiv();
            row.style.padding = '8px 0';
            row.style.borderBottom = '1px solid var(--background-modifier-border)';

            const top = row.createDiv();
            top.style.display = 'flex';
            top.style.justifyContent = 'space-between';
            top.style.alignItems = 'center';
            const name = top.createEl('strong');
            name.setText(p.name);
            const tier = top.createEl('span');
            tier.setText(p.tier);
            tier.style.fontSize = '0.8em';
            tier.style.opacity = '0.7';

            const link = row.createEl('a', { text: p.url, href: p.url });
            link.style.fontSize = '0.85em';
            link.setAttr('target', '_blank');
            link.setAttr('rel', 'noopener noreferrer');

            const note = row.createDiv();
            note.style.fontSize = '0.85em';
            note.style.opacity = '0.8';
            note.style.marginTop = '4px';
            note.setText(p.note);
        }

        // Add Model button
        const addRow = this.bodyEl.createDiv();
        addRow.style.marginTop = '16px';
        const addBtn = addRow.createEl('button', { cls: 'mod-cta', text: '+ Add model' });
        addBtn.addEventListener('click', () => {
            new ModelConfigModal(this.app, null, async (newModel: CustomModel) => {
                this.plugin.settings.activeModels.push(newModel);
                if (!this.plugin.settings.activeModelKey) {
                    this.plugin.settings.activeModelKey = getModelKey(newModel);
                }
                await this.plugin.saveSettings();
                renderStatus();
            }, false).open();
        });
    }

    private async renderEmbeddingStep(): Promise<void> {
        const intro = this.bodyEl.createEl('p');
        intro.setText('Embeddings turn your notes into numbers so the agent can find them by meaning, not just by exact words. Needed for semantic search and memory retrieval. You can skip this step. The agent still works without it, just with less powerful search.');

        // Status block
        const status = this.bodyEl.createDiv();
        status.style.padding = '8px 12px';
        status.style.margin = '12px 0';
        status.style.borderRadius = '4px';
        status.style.background = 'var(--background-secondary)';
        const renderStatus = () => {
            status.empty();
            const count = (this.plugin.settings.embeddingModels ?? []).filter(m => m.enabled).length;
            if (count === 0) {
                const txt = status.createEl('strong');
                txt.setText('No embedding model configured yet.');
            } else {
                const txt = status.createEl('strong');
                txt.setText(`You have ${count} embedding model${count === 1 ? '' : 's'} configured. You can skip this step.`);
            }
        };
        renderStatus();

        const heading = this.bodyEl.createEl('h4');
        heading.setText('Recommended providers');
        heading.style.marginTop = '16px';
        heading.style.marginBottom = '6px';

        const providers: { name: string; tier: string; url: string; note: string }[] = [
            {
                name: 'OpenAI text-embedding-3-small',
                tier: 'Paid, cheap',
                url: 'https://platform.openai.com/api-keys',
                note: 'About $0.02 per million tokens. Solid quality, runs on OpenAI servers.',
            },
            {
                name: 'Google text-embedding-004',
                tier: 'Free tier',
                url: 'https://aistudio.google.com/app/apikey',
                note: 'Free for moderate usage. Same key as Google Gemini if you set that up in the previous step.',
            },
            {
                name: 'Ollama (local)',
                tier: 'Free, fully local',
                url: 'https://ollama.com',
                note: 'No API key. Install Ollama, pull "nomic-embed-text" or similar. Privacy by default.',
            },
        ];

        for (const p of providers) {
            const row = this.bodyEl.createDiv();
            row.style.padding = '8px 0';
            row.style.borderBottom = '1px solid var(--background-modifier-border)';

            const top = row.createDiv();
            top.style.display = 'flex';
            top.style.justifyContent = 'space-between';
            top.style.alignItems = 'center';
            const name = top.createEl('strong');
            name.setText(p.name);
            const tier = top.createEl('span');
            tier.setText(p.tier);
            tier.style.fontSize = '0.8em';
            tier.style.opacity = '0.7';

            const link = row.createEl('a', { text: p.url, href: p.url });
            link.style.fontSize = '0.85em';
            link.setAttr('target', '_blank');
            link.setAttr('rel', 'noopener noreferrer');

            const note = row.createDiv();
            note.style.fontSize = '0.85em';
            note.style.opacity = '0.8';
            note.style.marginTop = '4px';
            note.setText(p.note);
        }

        const addRow = this.bodyEl.createDiv();
        addRow.style.marginTop = '16px';
        const addBtn = addRow.createEl('button', { cls: 'mod-cta', text: '+ Add embedding model' });
        addBtn.addEventListener('click', () => {
            new ModelConfigModal(this.app, null, async (newModel: CustomModel) => {
                if (!this.plugin.settings.embeddingModels) this.plugin.settings.embeddingModels = [];
                this.plugin.settings.embeddingModels.push(newModel);
                if (!this.plugin.settings.activeEmbeddingModelKey) {
                    this.plugin.settings.activeEmbeddingModelKey = getModelKey(newModel);
                }
                await this.plugin.saveSettings();
                renderStatus();
            }, true).open();
        });
    }

    private renderRoleModelsStep(): void {
        const hint = this.bodyEl.createEl('p');
        hint.setText('Background tasks (titling, internal classification, memory extraction, contextual retrieval) can run on a smaller cheaper model. Leave on "Use main LLM" if you do not care about the cost split.');

        const llmModels = this.plugin.settings.activeModels.filter(m => m.enabled);
        if (llmModels.length === 0) {
            const empty = this.bodyEl.createDiv();
            empty.style.padding = '12px';
            empty.style.background = 'var(--background-secondary)';
            empty.style.borderRadius = '4px';
            empty.style.marginTop = '12px';
            empty.setText('Go back to step 2 and add at least one LLM model. Then this step can offer you choices.');
            return;
        }

        const options: Record<string, string> = { '': 'Use main LLM' };
        for (const m of llmModels) {
            options[getModelKey(m)] = `${m.displayName ?? m.name} (${m.provider})`;
        }

        new Setting(this.bodyEl)
            .setName('Titling')
            .setDesc('Generates chat titles and semantic titles for notes the agent edited.')
            .addDropdown((d) => {
                Object.entries(options).forEach(([k, label]) => d.addOption(k, label));
                d.setValue(this.plugin.settings.chatLinking?.titlingModelKey ?? '');
                d.onChange(async (v) => {
                    if (this.plugin.settings.chatLinking) {
                        this.plugin.settings.chatLinking.titlingModelKey = v;
                        await this.plugin.saveSettings();
                    }
                });
            });

        new Setting(this.bodyEl)
            .setName('Internal calls')
            .setDesc('Plugin-internal classification, context condensing, fast-path planner, recipe promotion.')
            .addDropdown((d) => {
                Object.entries(options).forEach(([k, label]) => d.addOption(k, label));
                d.setValue(this.plugin.settings.helperModelKey ?? '');
                d.onChange(async (v) => {
                    this.plugin.settings.helperModelKey = v;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(this.bodyEl)
            .setName('Memory extraction')
            .setDesc('Extracts long-term facts from conversation history.')
            .addDropdown((d) => {
                Object.entries(options).forEach(([k, label]) => d.addOption(k, label));
                d.setValue(this.plugin.settings.memory?.memoryModelKey ?? '');
                d.onChange(async (v) => {
                    if (this.plugin.settings.memory) {
                        this.plugin.settings.memory.memoryModelKey = v;
                        await this.plugin.saveSettings();
                    }
                });
            });

        new Setting(this.bodyEl)
            .setName('Contextual retrieval')
            .setDesc('Adds context-aware embeddings during semantic indexing.')
            .addDropdown((d) => {
                Object.entries(options).forEach(([k, label]) => d.addOption(k, label));
                d.setValue(this.plugin.settings.contextualModelKey ?? '');
                d.onChange(async (v) => {
                    this.plugin.settings.contextualModelKey = v;
                    await this.plugin.saveSettings();
                });
            });
    }

    private renderSearchProviderStep(): void {
        const intro = this.bodyEl.createEl('p');
        intro.setText('A search provider lets the agent look things up on the web. The agent uses this when you ask it to research a topic, check facts, or pull in recent information that is not in your vault.');

        const why = this.bodyEl.createDiv();
        why.style.padding = '8px 12px';
        why.style.margin = '8px 0 16px 0';
        why.style.borderRadius = '4px';
        why.style.background = 'var(--background-secondary)';
        why.style.fontSize = '0.9em';
        const whyTitle = why.createEl('strong');
        whyTitle.setText('Why this is useful');
        why.createDiv({ text: 'Without a search provider the agent can only work with what is in your vault. With one, you can say "look up the latest on X" or "summarize three recent articles about Y" and the agent will fetch and read them for you.' });
        why.createDiv({ text: 'You can skip this step. Web search stays off until you configure a key.' }).style.marginTop = '4px';

        const heading = this.bodyEl.createEl('h4');
        heading.setText('Pick a provider');
        heading.style.marginTop = '8px';
        heading.style.marginBottom = '6px';

        const providers: { id: 'tavily' | 'brave' | 'none'; label: string; tier: string; url: string; note: string }[] = [
            { id: 'tavily', label: 'Tavily',  tier: '1000 free searches per month', url: 'https://app.tavily.com',           note: 'Built for AI agents. Returns clean, summarised results. Easiest to get started.' },
            { id: 'brave',  label: 'Brave',   tier: '2000 free searches per month', url: 'https://api.search.brave.com/app/keys', note: 'Higher free tier, broader index. A bit noisier results.' },
            { id: 'none',   label: 'None',    tier: 'No web search',                 url: '',                                  note: 'The agent will only use vault content. Pick this if you do not want any web access.' },
        ];

        const wt = this.plugin.settings.webTools;
        let currentProvider: 'tavily' | 'brave' | 'none' = wt.provider ?? 'none';

        const apiKeyRowsByProvider: Record<string, HTMLElement> = {};

        for (const p of providers) {
            const card = this.bodyEl.createDiv();
            card.style.border = '1px solid var(--background-modifier-border)';
            card.style.borderRadius = '6px';
            card.style.padding = '10px 12px';
            card.style.margin = '6px 0';

            const header = card.createDiv();
            header.style.display = 'flex';
            header.style.gap = '10px';
            header.style.alignItems = 'center';

            const radio = header.createEl('input', { type: 'radio' });
            radio.name = 'search-provider';
            radio.value = p.id;
            radio.checked = currentProvider === p.id;

            const label = header.createEl('label');
            label.style.flex = '1';
            label.style.cursor = 'pointer';
            const labelTop = label.createDiv();
            labelTop.style.display = 'flex';
            labelTop.style.justifyContent = 'space-between';
            const name = labelTop.createEl('strong');
            name.setText(p.label);
            const tier = labelTop.createEl('span');
            tier.setText(p.tier);
            tier.style.fontSize = '0.8em';
            tier.style.opacity = '0.7';
            const note = label.createDiv();
            note.style.fontSize = '0.85em';
            note.style.opacity = '0.85';
            note.style.marginTop = '4px';
            note.setText(p.note);
            label.addEventListener('click', () => { radio.checked = true; radio.dispatchEvent(new Event('change')); });

            radio.addEventListener('change', async () => {
                if (!radio.checked) return;
                currentProvider = p.id;
                wt.provider = p.id;
                wt.enabled = p.id !== 'none';
                await this.plugin.saveSettings();
                for (const [pid, row] of Object.entries(apiKeyRowsByProvider)) {
                    row.style.display = (pid === currentProvider && pid !== 'none') ? '' : 'none';
                }
            });

            if (p.id !== 'none') {
                const keyRow = card.createDiv();
                keyRow.style.display = currentProvider === p.id ? '' : 'none';
                keyRow.style.marginTop = '8px';
                keyRow.style.display = 'flex';
                keyRow.style.gap = '8px';
                keyRow.style.alignItems = 'center';

                const linkRow = card.createDiv();
                linkRow.style.fontSize = '0.85em';
                linkRow.style.marginTop = '4px';
                const link = linkRow.createEl('a', { text: `Get a ${p.label} API key`, href: p.url });
                link.setAttr('target', '_blank');
                link.setAttr('rel', 'noopener noreferrer');

                const input = keyRow.createEl('input', { type: 'password', placeholder: `${p.label} API key` });
                input.style.flex = '1';
                input.value = p.id === 'tavily' ? (wt.tavilyApiKey ?? '') : (wt.braveApiKey ?? '');
                input.addEventListener('input', async () => {
                    if (p.id === 'tavily') wt.tavilyApiKey = input.value.trim();
                    else if (p.id === 'brave') wt.braveApiKey = input.value.trim();
                    await this.plugin.saveSettings();
                });

                apiKeyRowsByProvider[p.id] = keyRow;
                // hide non-current provider key rows
                if (currentProvider !== p.id) keyRow.style.display = 'none';
            }
        }
    }

    private async renderOptionalDownloadsStep(): Promise<void> {
        const intro = this.bodyEl.createEl('p');
        intro.setText('Two features need a one-time download from this plugin\'s GitHub release page. Files land in your vault under .vault-operator/assets/ and are verified by SHA256 before they are used.');

        const { OptionalAssetManager, buildRerankerSpec, buildSelfDevSourceSpec } = await import('../../core/assets/OptionalAssetManager');
        const { RERANKER_WASM_SHA256 } = await import('../../core/assets/assetHashes');
        const { SELF_DEV_SOURCE_SHA256 } = await import('../../_generated/source-hash');

        const manager = new OptionalAssetManager(this.plugin);
        const items: { label: string; recommended: boolean; what: string; size: string; sha: string; spec: ReturnType<typeof buildRerankerSpec> }[] = [
            {
                label: 'Semantic Reranker',
                recommended: true,
                what: 'Reorders semantic-search results by how relevant they actually are to your question. The agent finds your notes much more accurately, especially for long or vague queries. Without it, semantic search still works but matches are noisier.',
                size: '12 MB',
                sha: RERANKER_WASM_SHA256,
                spec: buildRerankerSpec(this.plugin.manifest.version, RERANKER_WASM_SHA256),
            },
            {
                label: 'Self-Development Source',
                recommended: false,
                what: 'Lets the agent read its own source code. Useful if you want to ask "how does feature X work?" or have the agent help with extending the plugin itself. Most users do not need this.',
                size: '5 MB',
                sha: SELF_DEV_SOURCE_SHA256,
                spec: buildSelfDevSourceSpec(this.plugin.manifest.version, SELF_DEV_SOURCE_SHA256),
            },
        ];

        for (const item of items) {
            const card = this.bodyEl.createDiv();
            card.style.border = item.recommended
                ? '2px solid var(--interactive-accent)'
                : '1px solid var(--background-modifier-border)';
            card.style.borderRadius = '6px';
            card.style.padding = '12px';
            card.style.margin = '10px 0';

            const titleRow = card.createDiv();
            titleRow.style.display = 'flex';
            titleRow.style.justifyContent = 'space-between';
            titleRow.style.alignItems = 'center';

            const titleGroup = titleRow.createDiv();
            const title = titleGroup.createEl('strong');
            title.setText(`${item.label} (${item.size})`);
            if (item.recommended) {
                const badge = titleGroup.createEl('span');
                badge.setText('Recommended');
                badge.style.marginLeft = '8px';
                badge.style.padding = '2px 8px';
                badge.style.fontSize = '0.75em';
                badge.style.background = 'var(--interactive-accent)';
                badge.style.color = 'var(--text-on-accent)';
                badge.style.borderRadius = '10px';
            }
            const installBtn = titleRow.createEl('button', { cls: 'mod-cta' });
            installBtn.setText('Install');

            const what = card.createDiv();
            what.style.fontSize = '0.9em';
            what.style.marginTop = '8px';
            what.setText(item.what);

            const safety = card.createDiv();
            safety.style.fontSize = '0.8em';
            safety.style.opacity = '0.7';
            safety.style.marginTop = '6px';
            safety.setText('Open source, runs locally on your machine, no API calls, no subscription. One-time download, verified by SHA256.');

            const statusEl = card.createDiv();
            statusEl.style.fontSize = '0.8em';
            statusEl.style.marginTop = '6px';
            const refreshStatus = async () => {
                if (!item.sha) {
                    statusEl.setText('Status: not available in this dev build');
                    statusEl.style.color = 'var(--text-muted)';
                    installBtn.disabled = true;
                    return;
                }
                const snap = await manager.snapshot(item.spec);
                if (snap.status === 'installed') {
                    statusEl.setText('Status: Installed');
                    statusEl.style.color = 'var(--text-success)';
                    installBtn.setText('Re-install');
                } else if (snap.status === 'outdated') {
                    statusEl.setText('Status: Installed but hash differs, re-install to be safe');
                    statusEl.style.color = 'var(--text-warning)';
                } else {
                    statusEl.setText('Status: Not installed');
                    statusEl.style.color = 'var(--text-muted)';
                }
            };
            await refreshStatus();

            installBtn.addEventListener('click', async () => {
                installBtn.disabled = true;
                installBtn.setText('Downloading...');
                try {
                    await manager.install(item.spec);
                    new Notice(`${item.label} installed.`);
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    new Notice(`Install failed: ${msg}`);
                } finally {
                    installBtn.disabled = false;
                    await refreshStatus();
                }
            });
        }
    }

    private renderDoneStep(): void {
        const p = (text: string): HTMLElement => {
            const el = this.bodyEl.createEl('p');
            el.setText(text);
            return el;
        };
        p('Setup is complete.');
        p('Next the agent opens a chat in the sidebar and asks a few questions to fill your personal memory and identity profile: your role, the projects you work on, the way you like things done. Everything you tell it stays inside this vault.');
        p('You can skip the chat too. Just close the modal and start chatting whenever you like.');

        const skipped = this.plugin.settings.onboarding.skippedSteps;
        if (skipped && skipped.length > 0) {
            const note = this.bodyEl.createDiv();
            note.style.marginTop = '12px';
            note.style.fontSize = '0.85em';
            note.style.opacity = '0.8';
            note.setText('You skipped: ' + skipped.join(', ') + '. The relevant settings tabs show an inline hint so you can revisit them later.');
        }
    }
}

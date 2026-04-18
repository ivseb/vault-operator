import type { App, TFile } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';

interface AutocompleteItem {
    label: string;
    sub?: string;
    tag?: string;
    onSelect: () => void;
}

/**
 * AutocompleteHandler — manages the / and @ autocomplete dropdown.
 *
 * Extracted from AgentSidebarView to reduce file size.
 */
export class AutocompleteHandler {
    private items: AutocompleteItem[] = [];
    private selectedIndex = 0;
    private dropdownEl: HTMLElement | null = null;

    constructor(
        private plugin: ObsidianAgentPlugin,
        private app: App,
        private getTextarea: () => HTMLTextAreaElement | null,
        private getInputArea: () => HTMLElement | null,
        private addVaultFile: (file: TFile) => Promise<void>,
    ) {}

    async handleInput(): Promise<void> {
        const textarea = this.getTextarea();
        if (!textarea) return;
        const value = textarea.value;

        // / at the very start → workflow + prompt autocomplete
        if (value.startsWith('/')) {
            const query = value.slice(1).split(' ')[0].toLowerCase();

            const workflowLoader = this.plugin.workflowLoader;
            const workflows: { path: string; slug: string; displayName: string }[] = workflowLoader
                ? await workflowLoader.discoverWorkflows()
                : [];
            const wfToggles = this.plugin.settings.workflowToggles ?? {};
            const workflowItems = workflows
                .filter((w) => wfToggles[w.path] !== false && (query === '' || w.slug.startsWith(query)))
                .map((w) => ({
                    label: w.displayName,
                    sub: `/${w.slug}`,
                    tag: 'Workflow',
                    onSelect: () => {
                        const ta = this.getTextarea();
                        if (!ta) return;
                        const rest = value.includes(' ') ? value.slice(value.indexOf(' ') + 1) : '';
                        ta.value = `/${w.slug}${rest ? ' ' + rest : ''}`;
                        this.hide();
                        ta.focus();
                    },
                }));

            const activeMode = this.plugin.settings.currentMode;
            const customItems = (this.plugin.settings.customPrompts ?? [])
                .filter((p) =>
                    p.enabled !== false &&
                    (query === '' || p.slug.startsWith(query)) &&
                    (!p.mode || p.mode === activeMode)
                )
                .map((p) => ({
                    label: p.name,
                    sub: `/${p.slug}`,
                    tag: 'Prompt',
                    onSelect: () => {
                        const ta = this.getTextarea();
                        if (!ta) return;
                        const rest = value.includes(' ') ? value.slice(value.indexOf(' ') + 1) : '';
                        ta.value = `/${p.slug}${rest ? ' ' + rest : ''}`;
                        this.hide();
                        ta.focus();
                    },
                }));

            // Skills: activate the skill's body as explicit instructions for this turn.
            // FEATURE-2205 (EPIC-022 follow-up): align with Claude Code's slash UX.
            const skillLoader = this.plugin.selfAuthoredSkillLoader;
            const skillItems = skillLoader
                ? skillLoader.getAllSkills()
                    .map((s) => ({ skill: s, slug: slugifySkillName(s.name) }))
                    .filter(({ slug }) => query === '' || slug.startsWith(query))
                    .map(({ skill, slug }) => ({
                        label: skill.name,
                        sub: `/${slug}`,
                        tag: 'Skill',
                        onSelect: () => {
                            const ta = this.getTextarea();
                            if (!ta) return;
                            const rest = value.includes(' ') ? value.slice(value.indexOf(' ') + 1) : '';
                            ta.value = `/${slug}${rest ? ' ' + rest : ''}`;
                            this.hide();
                            ta.focus();
                        },
                    }))
                : [];

            this.items = [...workflowItems, ...customItems, ...skillItems];
            if (this.items.length === 0) { this.hide(); return; }
            this.selectedIndex = 0;
            this.render();
            return;
        }

        // @ anywhere in the text → file mention autocomplete
        const cursorPos = textarea.selectionStart ?? value.length;
        const beforeCursor = value.slice(0, cursorPos);
        const atIdx = beforeCursor.lastIndexOf('@');
        if (atIdx !== -1 && (atIdx === 0 || /\s/.test(beforeCursor[atIdx - 1]))) {
            const query = beforeCursor.slice(atIdx + 1).toLowerCase();

            const makeFileOnSelect = (f: TFile) => async () => {
                const ta = this.getTextarea();
                if (!ta) return;
                // FEATURE-2206: keep the @-reference inline so the sentence
                // reads naturally ("Lese @Referenznote und ..."). The file is
                // still added as an attachment; the inline text is just a
                // human-readable anchor.
                const inlineRef = `@${f.basename}`;
                const before = value.slice(0, atIdx);
                const after = value.slice(atIdx + 1 + query.length);
                const needsTrailingSpace = after.length === 0 || !after.startsWith(' ');
                const replacement = `${inlineRef}${needsTrailingSpace ? ' ' : ''}`;
                const newValue = before + replacement + after;
                ta.value = newValue;
                // Put the cursor just after the inlined reference so typing continues naturally.
                const newCursor = (before + replacement).length;
                ta.setSelectionRange(newCursor, newCursor);
                this.hide();
                await this.addVaultFile(f);
                ta.focus();
            };

            const currentFile = this.app.workspace.getActiveFile();
            const activeOption = (currentFile && (query === '' || 'active'.startsWith(query)))
                ? [{ label: 'Active note', sub: `@active → ${currentFile.basename}`, onSelect: makeFileOnSelect(currentFile) }]
                : [];

            const allFiles = this.app.vault.getMarkdownFiles();
            const filtered = allFiles
                .filter((f) => f.path.toLowerCase().includes(query))
                .slice(0, 10);

            this.items = [
                ...activeOption,
                ...filtered.map((f) => ({ label: f.basename, sub: f.path, onSelect: makeFileOnSelect(f) })),
            ];
            if (this.items.length === 0) { this.hide(); return; }
            this.selectedIndex = 0;
            this.render();
            return;
        }

        this.hide();
    }

    /** Returns true if the event was consumed by the autocomplete. */
    handleKeyDown(e: KeyboardEvent): boolean {
        if (!this.dropdownEl) return false;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.selectedIndex = Math.min(this.selectedIndex + 1, this.items.length - 1);
            this.render();
            return true;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
            this.render();
            return true;
        }
        if (e.key === 'Tab' || e.key === 'Enter') {
            e.preventDefault();
            this.items[this.selectedIndex]?.onSelect();
            return true;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            this.hide();
            return true;
        }
        return false;
    }

    hide(): void {
        this.dropdownEl?.remove();
        this.dropdownEl = null;
        this.items = [];
        this.selectedIndex = 0;
    }

    /** Re-slugifies a skill name to a URL-safe slash command token. Public so
     * the send-message pipeline can re-run the same transformation when it
     * resolves `/skill-slug`. */
    static slugifySkillName(name: string): string {
        return slugifySkillName(name);
    }

    private render(): void {
        const inputArea = this.getInputArea();
        if (!inputArea) return;

        if (!this.dropdownEl) {
            this.dropdownEl = inputArea.createDiv('autocomplete-dropdown');
            document.addEventListener('click', (e) => {
                if (this.dropdownEl && !this.dropdownEl.contains(e.target as Node)) {
                    this.hide();
                }
            }, { once: true });
        }

        this.dropdownEl.empty();
        this.items.forEach((item, idx) => {
            const row = this.dropdownEl!.createDiv({
                cls: `autocomplete-item${idx === this.selectedIndex ? ' active' : ''}`,
            });
            row.createSpan({ cls: 'autocomplete-label', text: item.label });
            if (item.tag) row.createSpan({ cls: 'autocomplete-tag', text: item.tag });
            if (item.sub) row.createSpan({ cls: 'autocomplete-sub', text: item.sub });
            row.addEventListener('mousedown', (e) => {
                e.preventDefault();
                item.onSelect();
            });
        });
    }
}

function slugifySkillName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * AgentFolderPickerModal
 *
 * FEATURE-0507 follow-up: a FuzzySuggestModal that lists every folder in the
 * current vault plus a "Create new folder…" option. Used by the VaultTab
 * "Agent folder" setting so the user never has to hand-type paths (no
 * platform-specific quirks — Obsidian's vault API is uniform on
 * Windows / macOS / Linux).
 *
 * The user can also keep hand-typing into the text input; this modal is an
 * opt-in convenience. Paths stay vault-relative.
 */

import { App, FuzzySuggestModal, Notice, TFolder, normalizePath, type FuzzyMatch } from 'obsidian';

interface FolderEntry {
    path: string;
    label: string;
    isCreateNew?: boolean;
}

export class AgentFolderPickerModal extends FuzzySuggestModal<FolderEntry> {
    private readonly onPick: (path: string) => void;

    constructor(app: App, onPick: (path: string) => void) {
        super(app);
        this.onPick = onPick;
        this.setPlaceholder('Pick or type a vault-relative folder for the agent…');
    }

    getItems(): FolderEntry[] {
        const entries: FolderEntry[] = [];
        const seen = new Set<string>();

        // Walk the whole vault root to get every folder, including hidden ones
        // that Obsidian's index skips (dot-folders like .obsidian-agent).
        // vault.adapter.list gives us those.
        const collect = (folder: TFolder, depth = 0) => {
            if (depth > 10) return; // paranoia
            for (const child of folder.children) {
                if (child instanceof TFolder) {
                    const path = child.path;
                    if (!seen.has(path)) {
                        seen.add(path);
                        entries.push({ path, label: path });
                    }
                    collect(child, depth + 1);
                }
            }
        };

        const root = this.app.vault.getRoot();
        collect(root);

        // Promote the legacy default to the top if present
        entries.sort((a, b) => a.path.localeCompare(b.path));

        // Always offer "Create new folder…" — the text the user types in the
        // search box becomes the folder name. FuzzySuggestModal won't match
        // items that don't exist, so we add a stub that always ranks.
        entries.unshift({ path: '.obsidian-agent', label: '.obsidian-agent (default)' });

        return entries;
    }

    getItemText(item: FolderEntry): string {
        return item.label;
    }

    renderSuggestion(match: FuzzyMatch<FolderEntry>, el: HTMLElement): void {
        const { item } = match;
        el.createEl('div', { text: item.label });
        if (item.path !== item.label) {
            el.createEl('small', { text: item.path, cls: 'agent-folder-picker-path' });
        }
    }

    onChooseItem(item: FolderEntry): void {
        // FuzzySuggestModal.onChooseItem is void — do the async work in an IIFE
        // and prefix with `void` so the Promise isn't surfaced to the caller.
        void (async () => {
            const path = normalizePath(item.path);
            if (!(await this.app.vault.adapter.exists(path))) {
                try {
                    await this.app.vault.adapter.mkdir(path);
                    new Notice(`Created folder: ${path}`);
                } catch (e) {
                    new Notice(`Failed to create folder "${path}": ${(e as Error).message}`);
                    return;
                }
            }
            this.onPick(path);
        })();
    }
}

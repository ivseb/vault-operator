/**
 * MemoryV2UpgradeModal -- one-time announcement after upgrading from a
 * v1-memory install to a v2-capable Obsilo build.
 *
 * Triggered from `main.ts` ON FIRST PLUGIN LOAD AFTER UPDATE when the
 * detector finds legacy `memory/<name>.md` files and no v2 facts in
 * the DB yet (status: 'pending'). Fresh installs never see this modal
 * (status: 'not-applicable').
 *
 * Three exits:
 *   1. "Migrate now"    -> caller opens the migration UI flow
 *   2. "Later"          -> caller marks status='skipped' so the modal
 *                          doesn't reappear; user can run it any time
 *                          via Settings -> Memory -> Memory v2 Migration
 *   3. close (X)        -> same as Later
 *
 * The modal explains the v2 improvements (atomic facts, hybrid search,
 * communication styles) and reassures that originals are backed up,
 * not deleted -- so users feel safe clicking "Migrate now" without
 * reading the docs.
 */

import { App, Modal, Setting } from 'obsidian';

export type MemoryV2UpgradeChoice = 'migrate' | 'later';

export interface MemoryV2UpgradeOptions {
    /** Reason the modal is being shown (informational, not enforced). */
    reason?: 'auto-on-load' | 'manual-from-settings';
}

class MemoryV2UpgradeModalImpl extends Modal {
    private decided = false;

    constructor(
        app: App,
        private opts: MemoryV2UpgradeOptions,
        private resolve: (choice: MemoryV2UpgradeChoice) => void,
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('agent-memory-v2-upgrade-modal');

        contentEl.createEl('h2', { text: 'Memory v2 is here' });

        const intro = contentEl.createEl('p');
        intro.appendText(
            'Obsilo just upgraded its memory subsystem. Your existing memory ' +
            '(user-profile, projects, patterns, errors, custom-tools, soul) ' +
            'still works as before. Memory v2 adds new capabilities on top:',
        );

        const benefits = contentEl.createEl('ul');
        const items: Array<[string, string]> = [
            ['Atomic facts', 'Memory is split into self-contained statements with topics, importance, and provenance — not free-form Markdown blocks.'],
            ['Hybrid search', 'Search now fuses semantic similarity, keyword match, and tag-match (Reciprocal Rank Fusion). Notes with the right tag rank up even when the body misses the query.'],
            ['Communication style', 'Your soul.md becomes a structured style row, queryable per topic / context / thread.'],
            ['Audit trail', 'Every state change (insert, confirm, supersede, deprecate) is logged for transparency.'],
            ['Engine-extract ready', 'The new engine has zero Obsidian coupling, so the same memory can later power the Unified Chat Memory across other interfaces.'],
        ];
        for (const [title, body] of items) {
            const li = benefits.createEl('li');
            li.createEl('strong', { text: title + ': ' });
            li.appendText(body);
        }

        const safety = contentEl.createEl('p', { cls: 'agent-memory-v2-upgrade-safety' });
        safety.createEl('strong', { text: 'Safe upgrade: ' });
        safety.appendText(
            'The migration copies your originals into memory-v1-backup/{timestamp}/ ' +
            'before touching anything. Your original memory files are NOT deleted -- ' +
            'they keep working in parallel until a future release retires them.',
        );

        const later = contentEl.createEl('p');
        later.appendText('You can run the migration any time from ');
        later.createEl('em', { text: 'Settings → Memory → Memory v2 Migration' });
        later.appendText('.');

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Later')
                .onClick(() => this.decide('later')))
            .addButton(btn => btn
                .setButtonText('Migrate now')
                .setCta()
                .onClick(() => this.decide('migrate')));
    }

    private decide(choice: MemoryV2UpgradeChoice): void {
        this.decided = true;
        this.resolve(choice);
        this.close();
    }

    onClose(): void {
        this.contentEl.empty();
        if (!this.decided) this.resolve('later');
    }
}

/**
 * Open the upgrade modal and return the user's choice. The caller is
 * responsible for honouring it (running the migration or marking
 * settings.memory.v2MigrationStatus='skipped').
 */
export function memoryV2UpgradeModal(
    app: App,
    opts: MemoryV2UpgradeOptions = {},
): Promise<MemoryV2UpgradeChoice> {
    return new Promise(resolve => new MemoryV2UpgradeModalImpl(app, opts, resolve).open());
}

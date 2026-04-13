/**
 * VaultHealthRepairModal -- Detailed findings view with selective repair.
 *
 * Shows each finding individually with affected notes, fix preview,
 * and per-finding checkboxes. User selects which findings to repair.
 * Non-repairable findings show a "discuss with agent" option.
 *
 * FEATURE-1901: Vault Health Check
 * FIX-15: Detailed findings + selective repair
 */

import { Modal, Notice } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import type { HealthFinding, HealthCheckType } from '../../core/knowledge/VaultHealthService';
import type { CheckpointInfo } from '../../core/checkpoints/GitCheckpointService';
import { t } from '../../i18n';

const REPAIRABLE_CHECKS = new Set<HealthCheckType>([
    'missing_backlinks', 'category_mismatch', 'inconsistent_tags',
]);

const CHECK_LABELS: Record<string, string> = {
    orphans: 'Orphaned notes',
    missing_backlinks: 'Missing backlinks',
    broken_links: 'Broken links',
    weak_clusters: 'Semantically similar but unlinked',
    inconsistent_tags: 'Inconsistent tags',
    category_mismatch: 'Category mismatches',
    god_nodes: 'Overloaded hub notes',
};

export class VaultHealthRepairModal extends Modal {
    private plugin: ObsidianAgentPlugin;
    private findings: HealthFinding[];
    private selectedFindings = new Set<number>();

    constructor(plugin: ObsidianAgentPlugin, findings: HealthFinding[]) {
        super(plugin.app);
        this.plugin = plugin;
        this.findings = findings;
    }

    onOpen(): void {
        this.showFindings();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    // -----------------------------------------------------------------------
    // Phase 1: Detailed findings view
    // -----------------------------------------------------------------------

    private showFindings(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('vault-health-modal');

        const repairableCount = this.findings.filter(f => REPAIRABLE_CHECKS.has(f.check)).length;
        const totalCount = this.findings.length;

        contentEl.createEl('h3', { text: `Vault health check (${totalCount} findings)` });

        // Group findings by check type
        const grouped = new Map<HealthCheckType, { findings: HealthFinding[]; indices: number[] }>();
        this.findings.forEach((f, idx) => {
            const entry = grouped.get(f.check) ?? { findings: [], indices: [] };
            entry.findings.push(f);
            entry.indices.push(idx);
            grouped.set(f.check, entry);
        });

        // Render each check type as a collapsible section
        for (const [check, { findings: checkFindings, indices }] of grouped) {
            const isRepairable = REPAIRABLE_CHECKS.has(check);
            const label = CHECK_LABELS[check] ?? check;
            const severity = checkFindings[0].severity;

            const details = contentEl.createEl('details', { cls: 'vault-health-section' });
            if (isRepairable) details.setAttribute('open', '');

            const summary = details.createEl('summary', { cls: 'vault-health-section-header' });
            summary.createSpan({ cls: `vault-health-severity severity-${severity}`, text: severity });
            summary.createSpan({ text: ` ${label} (${checkFindings.length})` });
            if (!isRepairable) {
                summary.createSpan({ cls: 'vault-health-tag-info', text: ' -- manual review' });
            }

            const content = details.createDiv('vault-health-section-content');

            for (let i = 0; i < checkFindings.length; i++) {
                const finding = checkFindings[i];
                const globalIdx = indices[i];

                const row = content.createDiv('vault-health-finding-row');

                if (isRepairable) {
                    const checkbox = row.createEl('input', { type: 'checkbox' });
                    checkbox.checked = true;
                    this.selectedFindings.add(globalIdx);
                    checkbox.addEventListener('change', () => {
                        if (checkbox.checked) {
                            this.selectedFindings.add(globalIdx);
                        } else {
                            this.selectedFindings.delete(globalIdx);
                        }
                        this.updateRepairButton();
                    });
                }

                // Primary note (first path)
                const primaryPath = finding.paths[0];
                if (primaryPath) {
                    const noteLink = row.createSpan({ cls: 'vault-health-note-link' });
                    noteLink.setText(this.formatPath(primaryPath));
                    noteLink.addEventListener('click', () => {
                        this.close();
                        const file = this.app.vault.getAbstractFileByPath(primaryPath);
                        if (file) void this.app.workspace.openLinkText(primaryPath, '');
                    });
                }

                // Additional paths count
                if (finding.paths.length > 1) {
                    row.createSpan({
                        cls: 'vault-health-path-count',
                        text: ` + ${finding.paths.length - 1} related`,
                    });
                }

                // Fix preview or description
                const preview = content.createDiv('vault-health-fix-preview');
                if (isRepairable) {
                    preview.setText(this.getFixPreview(finding));
                } else {
                    preview.setText(this.getInfoText(finding));
                }
            }

            // "Discuss with agent" button for non-repairable sections
            if (!isRepairable && checkFindings.length > 0) {
                const discussBtn = content.createEl('button', {
                    text: 'Discuss with agent',
                    cls: 'vault-health-discuss-btn',
                });
                discussBtn.addEventListener('click', () => {
                    const text = this.buildDiscussText(check, checkFindings);
                    void navigator.clipboard.writeText(text);
                    new Notice('Finding copied to clipboard -- paste in the chat to discuss with the agent.');
                    this.close();
                });
            }
        }

        // Bottom buttons
        const btnRow = contentEl.createDiv('vault-health-btn-row');

        if (repairableCount > 0) {
            const repairBtn = btnRow.createEl('button', {
                cls: 'mod-cta vault-health-repair-btn',
                text: `Repair selected (${this.selectedFindings.size})`,
            });
            repairBtn.addEventListener('click', () => {
                if (this.selectedFindings.size === 0) {
                    new Notice('No findings selected for repair.');
                    return;
                }
                repairBtn.disabled = true;
                repairBtn.setText('Repairing...');
                void this.runRepair();
            });
        }

        const closeBtn = btnRow.createEl('button', { text: 'Close' });
        closeBtn.addEventListener('click', () => this.close());
    }

    private updateRepairButton(): void {
        const btn = this.contentEl.querySelector('.vault-health-repair-btn') as HTMLButtonElement | null;
        if (btn) {
            btn.setText(`Repair selected (${this.selectedFindings.size})`);
        }
    }

    // -----------------------------------------------------------------------
    // Fix preview text generators
    // -----------------------------------------------------------------------

    private getFixPreview(finding: HealthFinding): string {
        switch (finding.check) {
            case 'missing_backlinks': {
                const target = finding.paths[0];
                const sources = finding.paths.slice(1);
                if (sources.length > 10) {
                    return `Fix: Create backlinks base file for ${this.formatPath(target)} (${sources.length} notes)`;
                }
                return `Fix: Add backlink properties to ${this.formatPath(target)} from ${sources.slice(0, 3).map(s => this.formatPath(s)).join(', ')}${sources.length > 3 ? ` +${sources.length - 3} more` : ''}`;
            }
            case 'category_mismatch':
                return `Fix: Move ${this.formatPath(finding.paths[0])} to correct category property`;
            case 'inconsistent_tags':
                return `Fix: Unify tag spelling`;
            default:
                return finding.description.slice(0, 120);
        }
    }

    private getInfoText(finding: HealthFinding): string {
        switch (finding.check) {
            case 'orphans':
                return finding.description.split('\n')[0];
            case 'weak_clusters':
                return finding.description;
            case 'god_nodes':
                return finding.description;
            case 'broken_links':
                return `${this.formatPath(finding.paths[0])} is referenced but does not exist`;
            default:
                return finding.description.slice(0, 150);
        }
    }

    private buildDiscussText(check: HealthCheckType, findings: HealthFinding[]): string {
        const label = CHECK_LABELS[check] ?? check;
        const paths = findings.flatMap(f => f.paths).slice(0, 10);
        return `I need help with vault health findings (${label}):\n\n${findings.map(f => `- ${f.description.split('\n')[0]}`).join('\n')}\n\nAffected notes: ${paths.map(p => `[[${this.formatPath(p)}]]`).join(', ')}`;
    }

    private formatPath(path: string): string {
        return path.replace(/\.md$/, '').split('/').pop() ?? path;
    }

    // -----------------------------------------------------------------------
    // Phase 2: Run repair (selected findings only)
    // -----------------------------------------------------------------------

    private async runRepair(): Promise<void> {
        const { contentEl } = this;
        const healthService = this.plugin.vaultHealthService;
        if (!healthService) return;

        contentEl.empty();
        contentEl.createEl('h3', { text: 'Repair in progress...' });
        const progress = contentEl.createEl('p', { cls: 'vault-health-progress' });

        // Checkpoint
        progress.setText('Creating checkpoint...');
        const taskId = `health-repair-${Date.now()}`;
        const affectedPaths = this.collectAffectedPaths();

        let checkpoint: CheckpointInfo | undefined;
        if (this.plugin.checkpointService && affectedPaths.length > 0) {
            try {
                const cp = await this.plugin.checkpointService.snapshot(
                    taskId, affectedPaths, 'vault_health_repair',
                );
                if (cp && cp.commitOid !== 'empty') checkpoint = cp;
            } catch (e) {
                console.warn('[VaultHealthRepair] Checkpoint failed (non-fatal):', e);
            }
        }

        // Determine which repair types are selected
        const selectedTypes = new Set<HealthCheckType>();
        for (const idx of this.selectedFindings) {
            selectedTypes.add(this.findings[idx].check);
        }

        let edgesResult = { edgesRemoved: 0 };
        let backlinksResult = { entitiesFixed: 0, linksAdded: 0, basesCreated: 0 };
        let categoriesResult = { notesFixed: 0, valuesMovied: 0 };
        let cleanupResult = { notesProcessed: 0, linksRemoved: 0 };

        // Only run repairs for selected types
        if (selectedTypes.has('missing_backlinks') || selectedTypes.has('category_mismatch')) {
            progress.setText('Cleaning up orphaned edges...');
            edgesResult = healthService.cleanupOrphanedEdges();
        }

        if (selectedTypes.has('missing_backlinks')) {
            progress.setText('Inserting missing backlinks...');
            backlinksResult = await healthService.fixMissingBacklinks(
                'Notizen',
                this.plugin.settings.categoryProperty ?? 'Kategorie',
            );
        }

        if (selectedTypes.has('category_mismatch')) {
            progress.setText('Correcting category assignments...');
            categoriesResult = await healthService.fixCategoryMismatches();
        }

        if (selectedTypes.has('missing_backlinks')) {
            progress.setText('Cleaning up invalid links...');
            cleanupResult = await healthService.cleanupInvalidBacklinks(
                'Notizen',
                this.plugin.settings.categoryProperty ?? 'Kategorie',
            );
        }

        // Re-extract graph data BEFORE re-checking (FIX-13)
        progress.setText('Verifying result...');
        if (this.plugin.graphExtractor) {
            this.plugin.graphExtractor.extractAll(this.app.vault);
            if (this.plugin.ontologyStore) {
                const catProp = this.plugin.settings.categoryProperty ?? 'Kategorie';
                const categoryMap = new Map<string, string>();
                for (const file of this.app.vault.getMarkdownFiles()) {
                    const cache = this.app.metadataCache.getFileCache(file);
                    if (cache?.frontmatter?.[catProp]) {
                        const cat = Array.isArray(cache.frontmatter[catProp])
                            ? (cache.frontmatter[catProp][0] ?? '').toString().trim()
                            : cache.frontmatter[catProp].toString().trim();
                        if (cat) categoryMap.set(file.path, cat);
                    }
                }
                this.plugin.ontologyStore.bootstrapFromEdges(
                    this.plugin.settings.mocPropertyNames ?? [],
                    catProp,
                    categoryMap,
                );
            }
        }

        const newFindings = await healthService.runChecks();
        this.showResult(edgesResult, backlinksResult, categoriesResult, cleanupResult, newFindings, checkpoint);
    }

    // -----------------------------------------------------------------------
    // Phase 3: Show result + undo
    // -----------------------------------------------------------------------

    private showResult(
        edges: { edgesRemoved: number },
        backlinks: { entitiesFixed: number; linksAdded: number; basesCreated: number },
        categories: { notesFixed: number; valuesMovied: number },
        cleanup: { notesProcessed: number; linksRemoved: number },
        newFindings: HealthFinding[],
        checkpoint: CheckpointInfo | undefined,
    ): void {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h3', { text: 'Repair complete' });

        const results = contentEl.createEl('ul', { cls: 'vault-health-results' });

        if (edges.edgesRemoved > 0) {
            results.createEl('li', { text: `${edges.edgesRemoved} orphaned edges removed` });
        }
        if (backlinks.linksAdded > 0 || backlinks.basesCreated > 0) {
            results.createEl('li', {
                text: `${backlinks.entitiesFixed} entities: ${backlinks.linksAdded} backlinks, ${backlinks.basesCreated} bases created`,
            });
        }
        if (categories.notesFixed > 0) {
            results.createEl('li', { text: `${categories.notesFixed} notes: category assignment corrected` });
        }
        if (cleanup.linksRemoved > 0) {
            results.createEl('li', { text: `${cleanup.linksRemoved} invalid links removed` });
        }

        const totalFixes = edges.edgesRemoved + backlinks.linksAdded + backlinks.basesCreated +
            categories.valuesMovied + cleanup.linksRemoved;

        if (totalFixes === 0) {
            contentEl.createEl('p', { text: 'No repairs needed -- all clean.' });
        }

        // Remaining findings (only repairable count for user)
        const remainingRepairable = newFindings.filter(f => REPAIRABLE_CHECKS.has(f.check)).length;
        const totalRemaining = newFindings.length;
        contentEl.createEl('p', {
            cls: 'vault-health-remaining',
            text: `Remaining: ${totalRemaining} finding(s) (${remainingRepairable} repairable).`,
        });

        // Buttons
        const btnRow = contentEl.createDiv('vault-health-btn-row');

        if (checkpoint && totalFixes > 0) {
            const undoBtn = btnRow.createEl('button', {
                text: 'Undo',
                cls: 'mod-warning',
            });
            undoBtn.addEventListener('click', () => {
                void this.runUndo(checkpoint);
            });
        }

        const doneBtn = btnRow.createEl('button', { text: 'Done', cls: 'mod-cta' });
        doneBtn.addEventListener('click', () => {
            this.updateBadge(newFindings);
            this.close();
        });
    }

    // -----------------------------------------------------------------------
    // Undo
    // -----------------------------------------------------------------------

    private async runUndo(checkpoint: CheckpointInfo): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: 'Restoring checkpoint...' });

        try {
            const result = await this.plugin.checkpointService.restore(checkpoint);

            contentEl.empty();
            contentEl.createEl('h3', { text: 'Restored' });
            contentEl.createEl('p', {
                text: `${result.restored.length} file(s) restored.`,
            });

            if (result.errors.length > 0) {
                contentEl.createEl('p', {
                    cls: 'vault-health-error',
                    text: `${result.errors.length} error(s): ${result.errors.join(', ')}`,
                });
            }

            // Re-extract graph after restore
            if (this.plugin.graphExtractor) {
                this.plugin.graphExtractor.extractAll(this.app.vault);
            }
            if (this.plugin.ontologyStore) {
                const catProp = this.plugin.settings.categoryProperty ?? 'Kategorie';
                const categoryMap = new Map<string, string>();
                for (const file of this.app.vault.getMarkdownFiles()) {
                    const cache = this.app.metadataCache.getFileCache(file);
                    if (cache?.frontmatter?.[catProp]) {
                        const cat = Array.isArray(cache.frontmatter[catProp])
                            ? (cache.frontmatter[catProp][0] ?? '').toString().trim()
                            : cache.frontmatter[catProp].toString().trim();
                        if (cat) categoryMap.set(file.path, cat);
                    }
                }
                this.plugin.ontologyStore.bootstrapFromEdges(
                    this.plugin.settings.mocPropertyNames ?? [],
                    catProp,
                    categoryMap,
                );
            }

            const findings = await this.plugin.vaultHealthService?.runChecks() ?? [];
            this.updateBadge(findings);

            const doneBtn = contentEl.createEl('button', { text: 'Done', cls: 'mod-cta' });
            doneBtn.addEventListener('click', () => this.close());
        } catch (e) {
            contentEl.empty();
            contentEl.createEl('h3', { text: 'Restore failed' });
            contentEl.createEl('p', {
                cls: 'vault-health-error',
                text: e instanceof Error ? e.message : String(e),
            });
            const closeBtn = contentEl.createEl('button', { text: 'Close' });
            closeBtn.addEventListener('click', () => this.close());
        }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private collectAffectedPaths(): string[] {
        const paths = new Set<string>();
        for (const idx of this.selectedFindings) {
            const f = this.findings[idx];
            for (const p of f.paths) {
                if (p.endsWith('.md')) paths.add(p);
            }
        }
        return [...paths].slice(0, 100);
    }

    private updateBadge(findings: HealthFinding[]): void {
        const leaves = this.app.workspace.getLeavesOfType('obsilo-agent-sidebar');
        if (leaves.length > 0) {
            const view = leaves[0].view as unknown as { updateHealthBadge(count: number, severity: string | null): void };
            // Badge counts only repairable findings -- non-repairable need manual intervention
            const repairableFindings = findings.filter(f => REPAIRABLE_CHECKS.has(f.check));
            const highCount = repairableFindings.filter(f => f.severity === 'high').length;
            const count = repairableFindings.length;
            view.updateHealthBadge(count, highCount > 0 ? 'high' : (count > 0 ? 'medium' : null));
        }
    }
}

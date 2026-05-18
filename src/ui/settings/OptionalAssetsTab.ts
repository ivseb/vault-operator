import { App, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { t } from '../../i18n';
import { addSectionHeading } from './utils';


export class OptionalAssetsTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    private buildIntroSection(containerEl: HTMLElement): void {
        const infoBanner = containerEl.createDiv('vault-op-box vault-op-box--intro');
        const infoIcon = infoBanner.createSpan({ cls: 'vault-op-box__icon' });
        setIcon(infoIcon, 'lightbulb');
        const infoText = infoBanner.createDiv({ cls: 'vault-op-box__text' });
        infoText.createEl('strong', { text: t('settings.optionalAssets.introTitle') });
        infoText.createDiv({ text: t('settings.optionalAssets.introDesc') });
    }

    build(containerEl: HTMLElement): void {
        this.buildIntroSection(containerEl);

        addSectionHeading(
            containerEl,
            t('settings.optionalAssets.headingOffice'),
            { body: t('settings.optionalAssets.sectionOfficeInfo') },
        );
        void this.renderOfficeBundle(containerEl);

        addSectionHeading(
            containerEl,
            t('settings.optionalAssets.headingPdf'),
            { body: t('settings.optionalAssets.sectionPdfInfo') },
        );
        void this.renderPdfjsBundle(containerEl);

        addSectionHeading(
            containerEl,
            t('settings.optionalAssets.headingSelfDev'),
            { body: t('settings.optionalAssets.sectionSelfDevInfo') },
        );
        void this.renderSelfDevSource(containerEl);
    }

    private async renderOfficeBundle(containerEl: HTMLElement): Promise<void> {
        const { buildOfficeBundleSpec } = await import('../../core/assets/OptionalAssetManager');
        const { OFFICE_BUNDLE_SHA256 } = await import('../../core/assets/assetHashes');
        const { renderOptionalAssetBlock } = await import('./renderOptionalAssetBlock');
        const version = this.plugin.manifest.version;
        renderOptionalAssetBlock({
            plugin: this.plugin,
            containerEl,
            spec: buildOfficeBundleSpec(version, OFFICE_BUNDLE_SHA256),
            notInstalledStatus: t('settings.optionalAssets.officeNotInstalled'),
            onPostInstall: async () => {
                this.plugin.bundleLoader?.reset();
                await Promise.resolve();
            },
        });
    }

    private async renderPdfjsBundle(containerEl: HTMLElement): Promise<void> {
        const { buildPdfjsBundleSpec } = await import('../../core/assets/OptionalAssetManager');
        const { PDFJS_BUNDLE_SHA256 } = await import('../../core/assets/assetHashes');
        const { renderOptionalAssetBlock } = await import('./renderOptionalAssetBlock');
        const version = this.plugin.manifest.version;
        renderOptionalAssetBlock({
            plugin: this.plugin,
            containerEl,
            spec: buildPdfjsBundleSpec(version, PDFJS_BUNDLE_SHA256),
            notInstalledStatus: t('settings.optionalAssets.pdfNotInstalled'),
            onPostInstall: async () => {
                this.plugin.bundleLoader?.reset();
                await Promise.resolve();
            },
        });
    }

    private async renderSelfDevSource(containerEl: HTMLElement): Promise<void> {
        const { buildSelfDevSourceSpec } = await import('../../core/assets/OptionalAssetManager');
        const { SELF_DEV_SOURCE_SHA256 } = await import('../../_generated/source-hash');
        const { renderOptionalAssetBlock } = await import('./renderOptionalAssetBlock');
        const version = this.plugin.manifest.version;
        renderOptionalAssetBlock({
            plugin: this.plugin,
            containerEl,
            spec: buildSelfDevSourceSpec(version, SELF_DEV_SOURCE_SHA256),
            notInstalledStatus: t('settings.optionalAssets.selfDevNotInstalled'),
            allowInstallFromFile: true,
            onPostInstall: async () => {
                if (this.plugin.embeddedSourceManager) {
                    const { EmbeddedSourceManager } = await import('../../core/self-development/EmbeddedSourceManager');
                    this.plugin.embeddedSourceManager = new EmbeddedSourceManager(this.plugin);
                    void this.plugin.embeddedSourceManager.load();
                }
            },
        });
    }
}

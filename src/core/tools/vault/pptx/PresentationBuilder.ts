/**
 * PresentationBuilder — HTML-only PPTX generation.
 *
 * Each slide is either:
 *   - HTML: annotated HTML rendered via HtmlSlideParser → PptxGenJS
 *   - Legacy: simple fields (title/bullets/etc.) converted to HTML and rendered
 *
 * Corporate themes: CSS from an ingested theme is prepended to each slide's HTML.
 */

import type ObsidianAgentPlugin from '../../../../main';
import { generateFreshPptx, generateFromHtml } from '../../../office';
import type { ChartData, ChartSeries, KpiData, ProcessStep, SlideData, TableData } from '../../../office';
import type { ChartInput, CreatePptxBuildOptions, SlideInput, TableInput } from './createPptxTypes';

const DEFAULT_THEME_NAMES: Record<string, string> = {
    executive: 'Executive (Dark)',
    modern: 'Modern (Blue)',
    minimal: 'Minimal (Clean)',
};

export class PresentationBuilder {
    constructor(private plugin: ObsidianAgentPlugin) {}

    async build(options: CreatePptxBuildOptions): Promise<{ buffer: ArrayBuffer; themeName: string; warnings: string[] }> {
        const { slides, themeName, templateRef } = options;
        const warnings: string[] = [];

        // Resolve theme CSS (if a named theme is referenced)
        const themeCSS = await this.loadThemeCSS(themeName);

        const htmlSlides = slides.filter(s => s.html);
        const legacySlides = slides.filter(s => !s.html);

        // All-HTML path (most common for corporate themes)
        if (legacySlides.length === 0) {
            const htmlPipelineSlides = slides.map((s, i) => this.toHtmlPipelineSlide(s, themeCSS, i));
            const buffer = await generateFromHtml(htmlPipelineSlides);
            return {
                buffer,
                themeName: this.resolveThemeName(themeName, templateRef),
                warnings,
            };
        }

        // Mixed or legacy-only path: convert everything to SlideData for PptxFreshGenerator
        if (htmlSlides.length === 0) {
            const slideDataList = slides.map(s => this.toLegacySlideData(s));
            const buffer = await generateFreshPptx(slideDataList, templateRef ?? 'executive');
            return {
                buffer,
                themeName: this.resolveThemeName(themeName, templateRef),
                warnings,
            };
        }

        // Mixed: some slides have HTML, some are legacy — convert all to HTML
        warnings.push('Mixed slide types detected — legacy slides converted to HTML automatically.');
        const allHtml = slides.map((s, i) => {
            const slide = s.html ? s : { ...s, html: this.legacyToHtml(s) };
            return this.toHtmlPipelineSlide(slide, themeCSS, i);
        });
        const buffer = await generateFromHtml(allHtml);
        return {
            buffer,
            themeName: this.resolveThemeName(themeName, templateRef),
            warnings,
        };
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    private toHtmlPipelineSlide(slide: SlideInput, themeCSS: string, index: number) {
        const html = themeCSS
            ? `<style>${themeCSS}</style>\n${slide.html ?? ''}`
            : (slide.html ?? '');
        return {
            html,
            charts: slide.charts?.map(c => this.toChartData(c)) ?? [],
            tables: slide.tables?.map(t => this.toTableData(t)) ?? [],
            notes: slide.notes,
        };
    }

    private toLegacySlideData(slide: SlideInput): SlideData {
        const kpis: KpiData[] | undefined = slide.kpis?.map(k => ({
            value: k.value,
            label: k.label,
            color: k.color,
        }));
        const process: ProcessStep[] | undefined = slide.process?.map(p => ({
            label: p.label,
            description: p.description,
        }));
        const tableData: TableData | undefined = slide.table
            ? { headers: slide.table.headers ?? [], rows: (slide.table.rows ?? []) as (string | number | null)[][] }
            : undefined;
        const chartData: ChartData | undefined = slide.chart
            ? {
                type: slide.chart.type as 'bar' | 'pie' | 'line',
                title: slide.chart.title,
                categories: slide.chart.categories,
                series: slide.chart.series.map(s => ({
                    name: s.name,
                    values: s.values,
                    color: s.color,
                })) as ChartSeries[],
            }
            : undefined;

        return {
            title: slide.title,
            subtitle: slide.subtitle,
            body: slide.body,
            bullets: slide.bullets,
            layout: slide.layout as SlideData['layout'],
            table: tableData,
            chart: chartData,
            kpis,
            process,
            notes: slide.notes,
        };
    }

    private legacyToHtml(slide: SlideInput): string {
        const parts: string[] = ['<div style="position:relative;width:1280px;height:720px;padding:60px;box-sizing:border-box;font-family:sans-serif;">'];
        if (slide.title) {
            parts.push(`<h1 style="font-size:36px;margin:0 0 16px;">${this.esc(slide.title)}</h1>`);
        }
        if (slide.subtitle) {
            parts.push(`<h2 style="font-size:24px;margin:0 0 24px;">${this.esc(slide.subtitle)}</h2>`);
        }
        if (slide.body) {
            parts.push(`<p style="font-size:18px;">${this.esc(slide.body)}</p>`);
        }
        if (slide.bullets && slide.bullets.length > 0) {
            parts.push('<ul style="font-size:18px;line-height:1.6;">');
            for (const b of slide.bullets) parts.push(`<li>${this.esc(b)}</li>`);
            parts.push('</ul>');
        }
        parts.push('</div>');
        return parts.join('\n');
    }

    private toChartData(c: ChartInput): ChartData {
        return {
            type: c.type as 'bar' | 'pie' | 'line',
            title: c.title,
            categories: c.categories,
            series: c.series.map(s => ({ name: s.name, values: s.values, color: s.color })) as ChartSeries[],
        };
    }

    private toTableData(t: TableInput): TableData {
        return {
            headers: t.headers ?? [],
            rows: (t.rows ?? []) as (string | number | null)[][],
            style: t.style,
        };
    }

    private async loadThemeCSS(themeName?: string): Promise<string> {
        if (!themeName) return '';
        try {
            const adapter = this.plugin.app.vault.adapter;
            // Theme CSS stored by ingest_template at: .obsilo/themes/{name}/theme.css
            const cssPath = `.obsilo/themes/${themeName}/theme.css`;
            const exists = await adapter.exists(cssPath);
            if (!exists) return '';
            return await adapter.read(cssPath);
        } catch {
            return '';
        }
    }

    private resolveThemeName(themeName?: string, templateRef?: string): string {
        if (themeName) return themeName;
        if (templateRef && DEFAULT_THEME_NAMES[templateRef]) return DEFAULT_THEME_NAMES[templateRef];
        return templateRef ?? 'Default';
    }

    private esc(s: string): string {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
}

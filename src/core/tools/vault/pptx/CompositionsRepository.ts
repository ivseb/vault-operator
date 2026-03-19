import type { DataAdapter } from 'obsidian';
import type { DekoElementInput } from '../../../office/PptxFreshGenerator';
import type { RepeatableGroup } from '../../../office/PptxTemplateAnalyzer';
import { getCompositionsFilePath, listAvailableCompositionTemplates, readCompositionsFile } from '../compositionsFile';
import type { CompositionsFile, FullCompositionsData } from './compositionsSchema';

export class CompositionsRepository {
    constructor(private adapter: DataAdapter) {}

    getPath(template: string): string {
        return getCompositionsFilePath(template);
    }

    async exists(template: string): Promise<boolean> {
        return await this.adapter.exists(this.getPath(template));
    }

    async listTemplates(): Promise<string[]> {
        return await listAvailableCompositionTemplates(this.adapter);
    }

    async read(template: string): Promise<{ path: string; data: CompositionsFile } | undefined> {
        return await readCompositionsFile<CompositionsFile>(this.adapter, template);
    }

    async loadFullData(template: string): Promise<FullCompositionsData | undefined> {
        const loaded = await this.read(template);
        if (!loaded) return undefined;

        const data = loaded.data;
        const schemaVersion = data.schema_version ?? 1;
        const isV4 = schemaVersion >= 4;

        const repeatableGroups = new Map<number, RepeatableGroup[]>();
        for (const comp of Object.values(data.compositions)) {
            if (!comp.repeatable_groups) continue;
            for (const [slideNumStr, groups] of Object.entries(comp.repeatable_groups)) {
                const slideNum = parseInt(slideNumStr, 10);
                if (isNaN(slideNum) || groups.length === 0) continue;
                const existing = repeatableGroups.get(slideNum) ?? [];
                existing.push(...(groups as RepeatableGroup[]));
                repeatableGroups.set(slideNum, existing);
            }
        }

        let aliasMap: Map<string, { slide: number; shapeId: string; originalName: string }> | undefined;
        if (schemaVersion >= 2 && data.alias_map) {
            aliasMap = new Map();
            for (const [alias, entry] of Object.entries(data.alias_map)) {
                aliasMap.set(alias, {
                    slide: entry.slide,
                    shapeId: entry.shape_id,
                    originalName: entry.original_name,
                });
            }
        }

        const globalDekoElements: DekoElementInput[] = [];
        for (const d of (data.brand_dna?.slide_decorations ?? [])) {
            const elem: DekoElementInput = {
                type: d.type,
                position: d.position,
                shapeName: d.shape_name,
                fillColor: d.fill_color,
                rotation: d.rotation,
            };
            if (d.image_path) {
                elem.imageData = await this.loadScaffoldImage(`.obsilo/templates/${d.image_path}`);
            } else if (d.image_data) {
                elem.imageData = d.image_data;
            }
            globalDekoElements.push(elem);
        }

        let compositionScaffolds: Map<string, DekoElementInput[]> | undefined;
        let compositionData: FullCompositionsData['compositionData'] | undefined;

        if (isV4) {
            compositionScaffolds = new Map();
            compositionData = new Map();

            for (const [compId, comp] of Object.entries(data.compositions)) {
                const baseSlideNum = Object.keys(comp.shapes ?? {})
                    .map(n => parseInt(n, 10))
                    .find(n => !isNaN(n))
                    ?? comp.slides?.[0];
                const baseShapes = baseSlideNum !== undefined
                    ? comp.shapes?.[String(baseSlideNum)] ?? {}
                    : {};
                const contentShapeIds = Object.values(baseShapes)
                    .map(shape => shape.shape_id)
                    .filter((shapeId): shapeId is string => !!shapeId);
                const contentShapeNames = Object.keys(baseShapes).map(key => {
                    const aliasEntry = aliasMap?.get(key);
                    return aliasEntry?.originalName ?? key;
                });

                if (comp.scaffold_elements && comp.scaffold_elements.length > 0) {
                    const elements: DekoElementInput[] = [];
                    for (const se of comp.scaffold_elements) {
                        const elem: DekoElementInput = {
                            type: se.type,
                            position: se.position,
                            shapeName: se.shape_name,
                            fillColor: se.fill_color,
                            rotation: se.rotation,
                        };
                        if (se.image_path) {
                            elem.imageData = await this.loadScaffoldImage(`.obsilo/templates/${se.image_path}`);
                        } else if (se.image_data) {
                            elem.imageData = se.image_data;
                        }
                        elements.push(elem);
                    }
                    compositionScaffolds.set(compId, elements);
                }

                if (comp.content_area && baseSlideNum !== undefined) {
                    compositionData.set(compId, {
                        contentArea: comp.content_area,
                        styleGuide: comp.style_guide ?? {},
                        layoutHint: comp.layout_hint ?? '',
                        slides: comp.slides ?? [],
                        baseSlideNum,
                        contentShapeIds,
                        contentShapeNames,
                    });
                }
            }
        }

        const slideSizePx = data.brand_dna?.slide_size_px ?? { w: 1280, h: 720 };
        return {
            schemaVersion,
            repeatableGroups,
            aliasMap,
            slideSizeInches: { w: slideSizePx.w / 96, h: slideSizePx.h / 96 },
            globalDekoElements: globalDekoElements.length > 0 ? globalDekoElements : undefined,
            compositionScaffolds: compositionScaffolds?.size ? compositionScaffolds : undefined,
            compositionData: compositionData?.size ? compositionData : undefined,
            rawFile: data,
        };
    }

    private async loadScaffoldImage(imagePath: string): Promise<string | undefined> {
        try {
            if (!('readBinary' in this.adapter)) return undefined;
            if (!await this.adapter.exists(imagePath)) return undefined;
            const imgBuffer = await this.adapter.readBinary(imagePath);
            return `data:image/png;base64,${bufferToBase64(new Uint8Array(imgBuffer))}`;
        } catch {
            return undefined;
        }
    }
}

export function bufferToBase64(data: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < data.length; i++) {
        binary += String.fromCharCode(data[i]);
    }
    return btoa(binary);
}

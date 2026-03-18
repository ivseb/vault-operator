import * as path from 'path';
import JSZip from 'jszip';
import { findClosingTag, findMaxShapeId, escapeRegex, escapeXml } from './ooxml-utils';

const CONTENT_TYPES = '[Content_Types].xml';
const SLIDE_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout';
const NOTES_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide';

export interface HtmlOverlayInput {
    targetSlideFileNum: number;
    sourcePptxBuffer: ArrayBuffer;
    clearShapeIds?: string[];
    clearShapeNames?: string[];
}

interface RelationshipEntry {
    id: string;
    type: string;
    target: string;
    targetMode?: string;
}

export async function applyHtmlOverlaysToClonedDeck(
    basePptxBuffer: ArrayBuffer,
    overlays: HtmlOverlayInput[],
): Promise<ArrayBuffer> {
    if (overlays.length === 0) return basePptxBuffer;

    const targetZip = await JSZip.loadAsync(basePptxBuffer);
    const targetContentTypes = await readContentTypes(targetZip);

    for (const overlay of overlays) {
        const sourceZip = await JSZip.loadAsync(overlay.sourcePptxBuffer);
        const sourceContentTypes = await readContentTypes(sourceZip);
        await applySingleOverlay(targetZip, targetContentTypes, overlay, sourceZip, sourceContentTypes);
    }

    targetZip.file(CONTENT_TYPES, targetContentTypes.xml);
    return targetZip.generateAsync({
        type: 'arraybuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
    });
}

async function applySingleOverlay(
    targetZip: JSZip,
    targetContentTypes: ContentTypesState,
    overlay: HtmlOverlayInput,
    sourceZip: JSZip,
    sourceContentTypes: ContentTypesState,
): Promise<void> {
    const targetSlidePath = `ppt/slides/slide${overlay.targetSlideFileNum}.xml`;
    const targetSlideFile = targetZip.file(targetSlidePath);
    if (!targetSlideFile) {
        throw new Error(`Target slide not found for HTML overlay: ${targetSlidePath}`);
    }

    let targetSlideXml = await targetSlideFile.async('text');
    for (const shapeId of overlay.clearShapeIds ?? []) {
        targetSlideXml = removeDrawingObjectByShapeId(targetSlideXml, shapeId);
    }
    for (const shapeName of overlay.clearShapeNames ?? []) {
        targetSlideXml = removeDrawingObjectByShapeName(targetSlideXml, shapeName);
    }

    const sourceSlideXml = await readZipText(sourceZip, 'ppt/slides/slide1.xml');
    let importedContent = extractSpTreePayload(sourceSlideXml);

    const targetSlideRelsPath = `ppt/slides/_rels/slide${overlay.targetSlideFileNum}.xml.rels`;
    const targetSlideRelsXml = targetZip.file(targetSlideRelsPath)
        ? await readZipText(targetZip, targetSlideRelsPath)
        : RELS_SKELETON;
    const targetSlideRels = parseRelationships(targetSlideRelsXml);
    let nextTargetRelId = findNextRelId(targetSlideRelsXml);

    const sourceSlideRelsPath = 'ppt/slides/_rels/slide1.xml.rels';
    const sourceSlideRelsXml = sourceZip.file(sourceSlideRelsPath)
        ? await readZipText(sourceZip, sourceSlideRelsPath)
        : RELS_SKELETON;
    const sourceSlideRels = parseRelationships(sourceSlideRelsXml);

    const relIdMap = new Map<string, string>();
    for (const rel of sourceSlideRels) {
        if (rel.type === SLIDE_REL_TYPE || rel.type === NOTES_REL_TYPE) continue;

        const newRelId = `rId${nextTargetRelId++}`;
        relIdMap.set(rel.id, newRelId);

        if (rel.targetMode === 'External') {
            targetSlideRels.push({
                id: newRelId,
                type: rel.type,
                target: rel.target,
                targetMode: rel.targetMode,
            });
            continue;
        }

        const sourcePartPath = resolveRelationshipTarget('ppt/slides/slide1.xml', rel.target);
        const targetPartPath = allocateUniquePartPath(targetZip, sourcePartPath);
        await copyPartWithRelationships(
            sourceZip,
            targetZip,
            sourceContentTypes,
            targetContentTypes,
            sourcePartPath,
            targetPartPath,
        );

        targetSlideRels.push({
            id: newRelId,
            type: rel.type,
            target: buildRelationshipTarget(targetSlidePath, targetPartPath),
        });
    }

    importedContent = remapRelationshipIds(importedContent, relIdMap);
    importedContent = reassignShapeIds(importedContent, findMaxShapeId(targetSlideXml));
    targetSlideXml = insertIntoSpTree(targetSlideXml, importedContent);

    targetZip.file(targetSlidePath, targetSlideXml);
    targetZip.file(targetSlideRelsPath, serializeRelationships(targetSlideRels));
}

interface ContentTypesState {
    xml: string;
    defaults: Map<string, string>;
    overrides: Map<string, string>;
}

async function readContentTypes(zip: JSZip): Promise<ContentTypesState> {
    const xml = await readZipText(zip, CONTENT_TYPES);
    const defaults = new Map<string, string>();
    const overrides = new Map<string, string>();

    let match: RegExpExecArray | null;
    const defaultPattern = /<Default\b[^>]*Extension="([^"]+)"[^>]*ContentType="([^"]+)"[^>]*\/>/g;
    while ((match = defaultPattern.exec(xml)) !== null) {
        defaults.set(match[1], match[2]);
    }
    const overridePattern = /<Override\b[^>]*PartName="([^"]+)"[^>]*ContentType="([^"]+)"[^>]*\/>/g;
    while ((match = overridePattern.exec(xml)) !== null) {
        overrides.set(normalizePartPath(match[1]), match[2]);
    }

    return { xml, defaults, overrides };
}

async function copyPartWithRelationships(
    sourceZip: JSZip,
    targetZip: JSZip,
    sourceContentTypes: ContentTypesState,
    targetContentTypes: ContentTypesState,
    sourcePartPath: string,
    targetPartPath: string,
): Promise<void> {
    const sourceFile = sourceZip.file(sourcePartPath);
    if (!sourceFile) throw new Error(`Missing overlay part: ${sourcePartPath}`);

    const data = await sourceFile.async('uint8array');
    targetZip.file(targetPartPath, data);
    ensureContentTypeForPart(sourceContentTypes, targetContentTypes, sourcePartPath, targetPartPath);

    const sourceRelsPath = getRelsPathForPart(sourcePartPath);
    const sourceRelsFile = sourceZip.file(sourceRelsPath);
    if (!sourceRelsFile) return;

    const relsXml = await sourceRelsFile.async('text');
    const rels = parseRelationships(relsXml);
    const targetRels: RelationshipEntry[] = [];

    for (const rel of rels) {
        if (rel.targetMode === 'External') {
            targetRels.push(rel);
            continue;
        }

        const childSourcePartPath = resolveRelationshipTarget(sourcePartPath, rel.target);
        const childTargetPartPath = allocateUniquePartPath(targetZip, childSourcePartPath);
        await copyPartWithRelationships(
            sourceZip,
            targetZip,
            sourceContentTypes,
            targetContentTypes,
            childSourcePartPath,
            childTargetPartPath,
        );

        targetRels.push({
            ...rel,
            target: buildRelationshipTarget(targetPartPath, childTargetPartPath),
        });
    }

    targetZip.file(getRelsPathForPart(targetPartPath), serializeRelationships(targetRels));
}

function ensureContentTypeForPart(
    sourceState: ContentTypesState,
    targetState: ContentTypesState,
    sourcePartPath: string,
    targetPartPath: string,
): void {
    const normalizedSource = normalizePartPath(sourcePartPath);
    const normalizedTarget = normalizePartPath(targetPartPath);

    const overrideType = sourceState.overrides.get(normalizedSource);
    if (overrideType) {
        if (!targetState.overrides.has(normalizedTarget)) {
            targetState.overrides.set(normalizedTarget, overrideType);
            targetState.xml = targetState.xml.replace(
                '</Types>',
                `<Override PartName="${normalizedTarget}" ContentType="${overrideType}"/>\n</Types>`,
            );
        }
        return;
    }

    const ext = path.posix.extname(normalizedTarget).replace(/^\./, '');
    if (!ext) return;

    const defaultType = sourceState.defaults.get(ext);
    if (defaultType && !targetState.defaults.has(ext)) {
        targetState.defaults.set(ext, defaultType);
        targetState.xml = targetState.xml.replace(
            '</Types>',
            `<Default Extension="${ext}" ContentType="${defaultType}"/>\n</Types>`,
        );
    }
}

function extractSpTreePayload(slideXml: string): string {
    const spTreeStart = slideXml.indexOf('<p:spTree>');
    const spTreeEnd = slideXml.indexOf('</p:spTree>');
    if (spTreeStart < 0 || spTreeEnd < 0) return '';

    let inner = slideXml.substring(spTreeStart + '<p:spTree>'.length, spTreeEnd);

    const nvStart = inner.indexOf('<p:nvGrpSpPr>');
    if (nvStart >= 0) {
        const nvEnd = findClosingTag(inner, nvStart, 'p:nvGrpSpPr');
        if (nvEnd > nvStart) inner = inner.substring(0, nvStart) + inner.substring(nvEnd);
    }
    const grpStart = inner.indexOf('<p:grpSpPr>');
    if (grpStart >= 0) {
        const grpEnd = findClosingTag(inner, grpStart, 'p:grpSpPr');
        if (grpEnd > grpStart) inner = inner.substring(0, grpStart) + inner.substring(grpEnd);
    }

    return inner.trim();
}

function insertIntoSpTree(slideXml: string, contentXml: string): string {
    if (!contentXml.trim()) return slideXml;
    const insertPoint = slideXml.indexOf('</p:spTree>');
    if (insertPoint < 0) return slideXml;
    return slideXml.substring(0, insertPoint) + contentXml + slideXml.substring(insertPoint);
}

function reassignShapeIds(contentXml: string, maxExistingId: number): string {
    let nextId = maxExistingId + 1;
    return contentXml.replace(/(<p:cNvPr\b[^>]*\bid=")\d+(")/g, (_match, prefix, suffix) => {
        const id = nextId++;
        return `${prefix}${id}${suffix}`;
    });
}

function remapRelationshipIds(xml: string, relIdMap: Map<string, string>): string {
    let result = xml;
    for (const [oldId, newId] of relIdMap) {
        const pattern = new RegExp(`(r:(?:embed|id|link)="${escapeRegex(oldId)}")`, 'g');
        result = result.replace(pattern, (match) => match.replace(oldId, newId));
    }
    return result;
}

function removeDrawingObjectByShapeId(xml: string, shapeId: string): string {
    const idPattern = new RegExp(`<p:cNvPr\\b[^>]*\\bid="${escapeRegex(shapeId)}"[^>]*/?>`);
    const match = idPattern.exec(xml);
    if (!match) return xml;
    return removeDrawingObjectAt(xml, match.index);
}

function removeDrawingObjectByShapeName(xml: string, shapeName: string): string {
    const namePattern = new RegExp(`<p:cNvPr\\b[^>]*\\bname="${escapeRegex(escapeXml(shapeName))}"[^>]*/?>`);
    const match = namePattern.exec(xml);
    if (!match) return xml;
    return removeDrawingObjectAt(xml, match.index);
}

function removeDrawingObjectAt(xml: string, markerPos: number): string {
    const block = findEnclosingDrawingObject(xml, markerPos);
    if (!block) return xml;
    return xml.substring(0, block.start) + xml.substring(block.end);
}

function findEnclosingDrawingObject(
    xml: string,
    markerPos: number,
): { start: number; end: number } | null {
    const candidates: Array<{ start: number; tag: string }> = [
        { start: xml.lastIndexOf('<p:sp', markerPos), tag: 'p:sp' },
        { start: xml.lastIndexOf('<p:pic', markerPos), tag: 'p:pic' },
        { start: xml.lastIndexOf('<p:graphicFrame', markerPos), tag: 'p:graphicFrame' },
        { start: xml.lastIndexOf('<p:cxnSp', markerPos), tag: 'p:cxnSp' },
        { start: xml.lastIndexOf('<p:grpSp', markerPos), tag: 'p:grpSp' },
    ].filter(c => c.start >= 0).sort((a, b) => b.start - a.start);

    for (const candidate of candidates) {
        const end = findClosingTag(xml, candidate.start, candidate.tag);
        if (end > markerPos) {
            return { start: candidate.start, end };
        }
    }

    return null;
}

function parseRelationships(xml: string): RelationshipEntry[] {
    const entries: RelationshipEntry[] = [];
    const pattern = /<Relationship\b([^>]*)\/>/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(xml)) !== null) {
        const attrs = match[1];
        const id = attrs.match(/\bId="([^"]+)"/)?.[1];
        const type = attrs.match(/\bType="([^"]+)"/)?.[1];
        const target = attrs.match(/\bTarget="([^"]+)"/)?.[1];
        const targetMode = attrs.match(/\bTargetMode="([^"]+)"/)?.[1];
        if (!id || !type || !target) continue;
        entries.push({ id, type, target, ...(targetMode ? { targetMode } : {}) });
    }

    return entries;
}

function serializeRelationships(entries: RelationshipEntry[]): string {
    const lines = entries.map(rel => {
        const targetMode = rel.targetMode ? ` TargetMode="${rel.targetMode}"` : '';
        return `<Relationship Id="${rel.id}" Type="${rel.type}" Target="${rel.target}"${targetMode}/>`;
    });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `${lines.join('')}` +
        `</Relationships>`;
}

function findNextRelId(xml: string): number {
    const ids = [...xml.matchAll(/\bId="rId(\d+)"/g)].map(m => parseInt(m[1], 10));
    return Math.max(0, ...ids) + 1;
}

function allocateUniquePartPath(zip: JSZip, sourcePartPath: string): string {
    const normalized = normalizePartPath(sourcePartPath).replace(/^\//, '');
    if (!zip.file(normalized)) return normalized;

    const dir = path.posix.dirname(normalized);
    const ext = path.posix.extname(normalized);
    const base = path.posix.basename(normalized, ext);

    let counter = 1;
    while (true) {
        const candidate = path.posix.join(dir, `${base}-overlay-${counter}${ext}`);
        if (!zip.file(candidate)) return candidate;
        counter++;
    }
}

function resolveRelationshipTarget(ownerPartPath: string, target: string): string {
    if (target.startsWith('/')) return normalizePartPath(target).replace(/^\//, '');
    return path.posix.normalize(path.posix.join(path.posix.dirname(ownerPartPath), target));
}

function buildRelationshipTarget(ownerPartPath: string, targetPartPath: string): string {
    const relative = path.posix.relative(path.posix.dirname(ownerPartPath), targetPartPath);
    return relative || path.posix.basename(targetPartPath);
}

function getRelsPathForPart(partPath: string): string {
    const dir = path.posix.dirname(partPath);
    const base = path.posix.basename(partPath);
    return path.posix.join(dir, '_rels', `${base}.rels`);
}

function normalizePartPath(partName: string): string {
    const normalized = partName.startsWith('/') ? partName : `/${partName}`;
    return path.posix.normalize(normalized);
}

async function readZipText(zip: JSZip, partPath: string): Promise<string> {
    const file = zip.file(partPath);
    if (!file) throw new Error(`Missing zip part: ${partPath}`);
    return file.async('text');
}

const RELS_SKELETON =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';

/**
 * PptxTemplateEngine -- template-based PPTX generation (ADR-032).
 *
 * Opens a template PPTX (ZIP), removes existing content slides,
 * injects new slides as OOXML XML, and updates all relationships.
 *
 * IMPORTANT: Uses string-based XML manipulation for existing files
 * (presentation.xml, .rels, [Content_Types].xml) to avoid XMLSerializer
 * corrupting namespace prefixes in Electron's DOMParser/XMLSerializer.
 * DOM parsing is only used for read-only analysis (layout detection, max IDs).
 */

import JSZip from 'jszip';
import { openZipSafe, getXmlDoc, getElementsByLocalName } from '../document-parsers/parsers/ooxmlHelpers';
import { buildSlideXml, buildNotesSlideXml, buildSlideRelsXml } from './SlideXmlBuilder';
import type { SlideData, LayoutType, LayoutMap, LayoutInfo, PlaceholderInfo } from './types';

/** JSZip option to prevent directory entry creation (PowerPoint compatibility). */
const NO_DIRS: JSZip.JSZipFileOptions = { createFolders: false };

/* ------------------------------------------------------------------ */
/*  String-based XML helpers (avoid XMLSerializer corruption)          */
/* ------------------------------------------------------------------ */

/** Read a file from ZIP as text string. */
async function readText(zip: JSZip, path: string): Promise<string | null> {
    const file = zip.file(path);
    if (!file) return null;
    return await file.async('text');
}

/** Extract highest rId number from a .rels XML string. */
function getMaxRIdFromString(xml: string): number {
    let max = 0;
    const re = /Id="rId(\d+)"/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
    }
    return max;
}

/** Extract highest sldId number from presentation.xml string. */
function getMaxSlideIdFromString(xml: string): number {
    let max = 255; // OOXML spec: sldId starts at 256
    const re = /<[^>]*sldId[^>]*\bid="(\d+)"/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
    }
    return max;
}

/** Find the relative path from a slide to its layout. */
function relativeLayoutPath(layoutPath: string): string {
    return '../slideLayouts/' + layoutPath.split('/').pop();
}

/* ------------------------------------------------------------------ */
/*  Layout analysis (read-only DOM, safe)                              */
/* ------------------------------------------------------------------ */

const LAYOUT_HEURISTICS: { type: LayoutType; match: (phs: PlaceholderInfo[]) => boolean }[] = [
    {
        type: 'title',
        match: (phs) => {
            const types = phs.map(p => p.type);
            return types.includes('title') && (types.includes('subTitle') || types.includes('ctrTitle'));
        },
    },
    {
        type: 'section',
        match: (phs) => {
            const types = phs.map(p => p.type);
            return types.includes('title') && phs.length <= 4 && !types.includes('body');
        },
    },
    {
        type: 'content',
        match: (phs) => {
            const types = phs.map(p => p.type);
            return types.includes('title') && types.includes('body');
        },
    },
    {
        type: 'blank',
        match: (phs) => {
            const contentPhs = phs.filter(p => !['dt', 'ftr', 'sldNum'].includes(p.type));
            return contentPhs.length === 0;
        },
    },
];

async function analyzeLayouts(zip: JSZip): Promise<LayoutMap> {
    const sizeTracker = { total: 0 };
    const layoutInfos: LayoutInfo[] = [];

    const layoutPaths = Object.keys(zip.files)
        .filter(p => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(p))
        .sort();

    // Read slideMaster1.xml.rels to get layout rIds (read-only DOM, safe)
    const masterRelsDoc = await getXmlDoc(zip, 'ppt/slideMasters/_rels/slideMaster1.xml.rels', sizeTracker);
    const layoutRIds = new Map<string, string>();
    if (masterRelsDoc) {
        const rels = getElementsByLocalName(masterRelsDoc, 'Relationship');
        for (const rel of rels) {
            const target = rel.getAttribute('Target') ?? '';
            const rId = rel.getAttribute('Id') ?? '';
            if (target.includes('slideLayout')) {
                const fileName = target.split('/').pop() ?? '';
                layoutRIds.set(`ppt/slideLayouts/${fileName}`, rId);
            }
        }
    }

    for (const layoutPath of layoutPaths) {
        const doc = await getXmlDoc(zip, layoutPath, sizeTracker);
        if (!doc) continue;

        const placeholders: PlaceholderInfo[] = [];
        const phElements = getElementsByLocalName(doc, 'ph');
        for (const ph of phElements) {
            placeholders.push({
                type: ph.getAttribute('type') ?? 'body',
                idx: ph.getAttribute('idx') ?? undefined,
            });
        }

        layoutInfos.push({
            path: layoutPath,
            rId: layoutRIds.get(layoutPath) ?? '',
            placeholders,
        });
    }

    const layouts = new Map<LayoutType, LayoutInfo>();
    for (const info of layoutInfos) {
        for (const heuristic of LAYOUT_HEURISTICS) {
            if (!layouts.has(heuristic.type) && heuristic.match(info.placeholders)) {
                layouts.set(heuristic.type, info);
                break;
            }
        }
    }

    const fallback = layoutInfos.reduce((best, current) => {
        const bestContent = best.placeholders.filter(p => !['dt', 'ftr', 'sldNum'].includes(p.type)).length;
        const currentContent = current.placeholders.filter(p => !['dt', 'ftr', 'sldNum'].includes(p.type)).length;
        return currentContent > bestContent ? current : best;
    }, layoutInfos[0]);

    return { layouts, fallback };
}

/* ------------------------------------------------------------------ */
/*  Slide removal (string-based XML manipulation)                      */
/* ------------------------------------------------------------------ */

async function removeContentSlides(zip: JSZip): Promise<{
    presXml: string;
    presRelsXml: string;
    ctXml: string;
}> {
    // 1. Remove slide files from ZIP
    const slidePaths = Object.keys(zip.files)
        .filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p));
    const notesPaths = Object.keys(zip.files)
        .filter(p => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p));

    for (const p of slidePaths) {
        zip.remove(p);
        const relsPath = p.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels';
        if (zip.file(relsPath)) zip.remove(relsPath);
    }
    for (const p of notesPaths) {
        zip.remove(p);
        const relsPath = p.replace('ppt/notesSlides/', 'ppt/notesSlides/_rels/') + '.rels';
        if (zip.file(relsPath)) zip.remove(relsPath);
    }

    // 2. Clean presentation.xml: empty the sldIdLst
    let presXml = (await readText(zip, 'ppt/presentation.xml')) ?? '';
    // Remove all <p:sldId.../> entries (self-closing and with children)
    presXml = presXml.replace(/<[^>]*:sldId\b[^>]*\/>/g, '');
    // Also handle non-self-closing: <p:sldId ...>...</p:sldId>
    presXml = presXml.replace(/<[^>]*:sldId\b[^>]*>.*?<\/[^>]*:sldId>/g, '');

    // 3. Clean presentation.xml.rels: remove slide relationships
    let presRelsXml = (await readText(zip, 'ppt/_rels/presentation.xml.rels')) ?? '';
    // Remove Relationship entries that target slides/ or notesSlides/ but NOT slideMasters/ or slideLayouts/
    presRelsXml = presRelsXml.replace(
        /<Relationship[^>]*Target="slides\/slide\d+\.xml"[^>]*\/>/g,
        '',
    );
    presRelsXml = presRelsXml.replace(
        /<Relationship[^>]*Target="notesSlides\/[^"]*"[^>]*\/>/g,
        '',
    );

    // 4. Clean [Content_Types].xml: remove slide overrides + fix template content type
    let ctXml = (await readText(zip, '[Content_Types].xml')) ?? '';
    // If the source was a .potx template, change the content type to .pptx presentation
    // (otherwise PowerPoint rejects the file extension mismatch)
    ctXml = ctXml.replace(
        'application/vnd.openxmlformats-officedocument.presentationml.template.main+xml',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
    );
    ctXml = ctXml.replace(
        /<Override[^>]*PartName="\/ppt\/slides\/slide\d+\.xml"[^>]*\/>/g,
        '',
    );
    ctXml = ctXml.replace(
        /<Override[^>]*PartName="\/ppt\/notesSlides\/notesSlide\d+\.xml"[^>]*\/>/g,
        '',
    );

    return { presXml, presRelsXml, ctXml };
}

/* ------------------------------------------------------------------ */
/*  Slide injection (string-based XML manipulation)                    */
/* ------------------------------------------------------------------ */

function injectSlides(
    zip: JSZip,
    slides: SlideData[],
    layoutMap: LayoutMap,
    presXml: string,
    presRelsXml: string,
    ctXml: string,
): void {
    let nextRId = getMaxRIdFromString(presRelsXml) + 1;
    let nextSldId = getMaxSlideIdFromString(presXml) + 1;
    let nextMediaIdx = 1;

    // Collect new entries to insert
    const sldIdEntries: string[] = [];
    const presRelEntries: string[] = [];
    const ctOverrides: string[] = [];
    const ctDefaults: string[] = [];

    // Track which image extensions we've already added
    const addedImageExts = new Set<string>();
    // Check existing Default entries
    const existingDefaults = ctXml.match(/<Default[^>]*Extension="([^"]*)"[^>]*\/>/g) ?? [];
    for (const d of existingDefaults) {
        const m = /Extension="([^"]*)"/.exec(d);
        if (m) addedImageExts.add(m[1].toLowerCase());
    }

    for (let i = 0; i < slides.length; i++) {
        const slide = slides[i];
        const slideNum = i + 1;
        const slidePath = `ppt/slides/slide${slideNum}.xml`;
        const slideRelsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;

        // Determine layout
        const layout = slide.layout ?? 'content';
        const layoutInfo = layoutMap.layouts.get(layout) ?? layoutMap.fallback;
        const layoutRelPath = relativeLayoutPath(layoutInfo.path);

        const relsExtras: { rId: string; target: string; type: string }[] = [];
        const layoutRelRId = 'rId1';

        // Handle image embedding
        let imageRId: string | undefined;
        if (slide.image) {
            const mediaFileName = `image${nextMediaIdx++}.${slide.image.extension}`;
            zip.file(`ppt/media/${mediaFileName}`, slide.image.data, NO_DIRS);

            imageRId = `rId${2 + relsExtras.length}`;
            relsExtras.push({
                rId: imageRId,
                target: `../media/${mediaFileName}`,
                type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
            });

            const ext = slide.image.extension.toLowerCase();
            if (!addedImageExts.has(ext)) {
                addedImageExts.add(ext);
                ctDefaults.push(
                    `<Default Extension="${ext}" ContentType="${slide.image.mime}"/>`,
                );
            }
        }

        // Handle notes
        if (slide.notes) {
            const notesPath = `ppt/notesSlides/notesSlide${slideNum}.xml`;
            const notesRelsPath = `ppt/notesSlides/_rels/notesSlide${slideNum}.xml.rels`;

            const notesRId = `rId${2 + relsExtras.length}`;
            relsExtras.push({
                rId: notesRId,
                target: `../notesSlides/notesSlide${slideNum}.xml`,
                type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide',
            });

            zip.file(notesPath, buildNotesSlideXml(slide.notes, 'rId1'), NO_DIRS);
            zip.file(notesRelsPath,
                `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
                `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
                `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide${slideNum}.xml"/>` +
                `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/>` +
                `</Relationships>`,
                NO_DIRS,
            );

            ctOverrides.push(
                `<Override PartName="/${notesPath}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`,
            );
        }

        // Build slide XML + rels
        zip.file(slidePath, buildSlideXml(slide, layoutRelRId, imageRId), NO_DIRS);
        zip.file(slideRelsPath, buildSlideRelsXml(layoutRelRId, layoutRelPath, relsExtras), NO_DIRS);

        // presentation.xml entry
        const presSlideRId = `rId${nextRId++}`;
        sldIdEntries.push(
            `<p:sldId id="${nextSldId++}" r:id="${presSlideRId}"/>`,
        );

        // presentation.xml.rels entry
        presRelEntries.push(
            `<Relationship Id="${presSlideRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${slideNum}.xml"/>`,
        );

        // [Content_Types].xml entry
        ctOverrides.push(
            `<Override PartName="/${slidePath}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
        );
    }

    // Insert sldId entries into presentation.xml
    // Find the closing tag of sldIdLst and insert before it
    if (presXml.includes('sldIdLst')) {
        // Match the closing tag (could be </p:sldIdLst> or similar with namespace prefix)
        presXml = presXml.replace(
            /(<[^>]*sldIdLst[^/>]*>)([\s\S]*?)(<\/[^>]*sldIdLst>)/,
            `$1${sldIdEntries.join('')}$3`,
        );
    } else {
        // No sldIdLst exists -- insert after sldMasterIdLst closing tag
        presXml = presXml.replace(
            /(<\/[^>]*sldMasterIdLst>)/,
            `$1<p:sldIdLst>${sldIdEntries.join('')}</p:sldIdLst>`,
        );
    }

    // Insert Relationship entries into presentation.xml.rels
    presRelsXml = presRelsXml.replace(
        /<\/Relationships>/,
        presRelEntries.join('') + '</Relationships>',
    );

    // Insert Override + Default entries into [Content_Types].xml
    ctXml = ctXml.replace(
        /<\/Types>/,
        ctDefaults.join('') + ctOverrides.join('') + '</Types>',
    );

    // Write modified XML back to ZIP (NO_DIRS prevents directory entry creation)
    zip.file('ppt/presentation.xml', presXml, NO_DIRS);
    zip.file('ppt/_rels/presentation.xml.rels', presRelsXml, NO_DIRS);
    zip.file('[Content_Types].xml', ctXml, NO_DIRS);
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Ensure a notesMaster exists if any slide has notes.
 * PowerPoint requires ppt/notesMasters/notesMaster1.xml when notesSlides are present.
 */
async function ensureNotesMaster(
    zip: JSZip,
    slides: SlideData[],
    presRelsXml: string,
    ctXml: string,
): Promise<{ presRelsXml: string; ctXml: string }> {
    const hasNotes = slides.some(s => s.notes);
    if (!hasNotes) return { presRelsXml, ctXml };

    // Check if notesMaster already exists
    if (zip.file('ppt/notesMasters/notesMaster1.xml')) return { presRelsXml, ctXml };

    // Create notesMaster
    zip.file('ppt/notesMasters/notesMaster1.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<p:notesMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
        `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
        `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
        `<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>` +
        `<p:spTree>` +
        `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
        `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>` +
        `<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
        `<p:sp>` +
        `<p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr>` +
        `<p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr>` +
        `<p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="3086100"/></a:xfrm></p:spPr>` +
        `</p:sp>` +
        `<p:sp>` +
        `<p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
        `<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>` +
        `<p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm></p:spPr>` +
        `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="de-DE"/></a:p></p:txBody>` +
        `</p:sp>` +
        `</p:spTree></p:cSld>` +
        `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" ` +
        `accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
        `</p:notesMaster>`,
        NO_DIRS,
    );

    // notesMaster rels (points to theme)
    zip.file('ppt/notesMasters/_rels/notesMaster1.xml.rels',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>` +
        `</Relationships>`,
        NO_DIRS,
    );

    // Add notesMaster relationship to presentation.xml.rels
    const nmRId = `rId${getMaxRIdFromString(presRelsXml) + 1}`;
    presRelsXml = presRelsXml.replace(
        /<\/Relationships>/,
        `<Relationship Id="${nmRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="notesMasters/notesMaster1.xml"/>` +
        `</Relationships>`,
    );

    // Add notesMaster content type
    ctXml = ctXml.replace(
        /<\/Types>/,
        `<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>` +
        `</Types>`,
    );

    return { presRelsXml, ctXml };
}

/**
 * Generate a PPTX file from a template and slide data.
 */
export async function generatePptx(
    templateData: ArrayBuffer,
    slides: SlideData[],
): Promise<ArrayBuffer> {
    const zip = await openZipSafe(templateData);

    // 1. Analyze layouts (read-only DOM, safe)
    const layoutMap = await analyzeLayouts(zip);

    // 2. Remove existing content slides (string-based)
    let { presXml, presRelsXml, ctXml } = await removeContentSlides(zip);

    // 3. Ensure notesMaster exists if any slide has notes
    ({ presRelsXml, ctXml } = await ensureNotesMaster(zip, slides, presRelsXml, ctXml));

    // 4. Inject new slides (string-based)
    injectSlides(zip, slides, layoutMap, presXml, presRelsXml, ctXml);

    // 5. Generate output (use uint8array for reliable cross-environment handling,
    //    then convert to ArrayBuffer -- JSZip may return a Node.js Buffer slice
    //    when platform is "node", which vault.createBinary cannot handle directly)
    const uint8 = await zip.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
    });
    return uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength);
}

/**
 * Get available layout types from a template.
 */
export async function getTemplateLayouts(templateData: ArrayBuffer): Promise<LayoutType[]> {
    const zip = await openZipSafe(templateData);
    const layoutMap = await analyzeLayouts(zip);
    return Array.from(layoutMap.layouts.keys());
}

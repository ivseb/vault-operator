/**
 * Shared types for the template-based PPTX engine (ADR-032).
 */

export interface SlideData {
    title?: string;
    subtitle?: string;
    body?: string;
    bullets?: string[];
    table?: { headers?: string[]; rows?: (string | number | null)[][] };
    image?: { data: Uint8Array; extension: string; mime: string };
    notes?: string;
    layout?: LayoutType;
}

export type LayoutType =
    | 'title'
    | 'content'
    | 'section'
    | 'two_column'
    | 'image_right'
    | 'comparison'
    | 'blank';

export interface LayoutMap {
    layouts: Map<LayoutType, LayoutInfo>;
    fallback: LayoutInfo;
}

export interface LayoutInfo {
    /** Path inside ZIP, e.g. "ppt/slideLayouts/slideLayout2.xml" */
    path: string;
    /** Relationship ID in slideMaster1.xml.rels */
    rId: string;
    /** Placeholders found in this layout */
    placeholders: PlaceholderInfo[];
}

export interface PlaceholderInfo {
    /** Placeholder type: "title", "body", "subTitle", "dt", "ftr", "sldNum" */
    type: string;
    /** Placeholder index attribute */
    idx?: string;
}

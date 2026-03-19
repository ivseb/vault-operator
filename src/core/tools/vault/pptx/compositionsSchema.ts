import type { DekoElementInput } from '../../../office/PptxFreshGenerator';
import type { RepeatableGroup } from '../../../office/PptxTemplateAnalyzer';
import type { DesignRules, IconEntry, UsageGuidelines } from '../../../office/MultimodalAnalyzer';

export interface AliasMapEntry {
    slide: number;
    shape_id: string;
    original_name: string;
    purpose?: string;
}

export interface ShapeDetailEntry {
    zweck: string;
    shape_id?: string;
    shape_type?: 'image' | 'text';
    fill_color?: string;
    max_chars?: number;
    min_chars?: number;
    font_size_pt?: number;
    width_cm?: number;
    notes?: string;
}

export interface RepeatableGroupEntry {
    groupId: string;
    axis: 'horizontal' | 'vertical';
    shapeNames: string[];
    shapeIds?: string[];
    boundingBox: { left: number; top: number; width: number; height: number };
    gap: number;
    shapeSize: { cx: number; cy: number };
    columns: Array<{
        index: number;
        primaryShape: string;
        primaryShapeId?: string;
        associatedShapes: Array<{ shapeName: string; shapeId?: string; offsetY: number; offsetX: number }>;
    }>;
}

export interface CompositionStyleGuide {
    title?: { font_size_pt: number; color: string; font_weight: string };
    body?: { font_size_pt: number; color: string };
    accent_color?: string;
}

export interface CompositionScaffoldElement {
    id?: string;
    type: 'image' | 'shape';
    position: { x: number; y: number; w: number; h: number };
    shape_name?: string;
    fill_color?: string;
    rotation?: number;
    image_data?: string;
    image_path?: string;
}

export interface CompositionEntry {
    name: string;
    classification?: string;
    narrative_phase?: string;
    slides: number[];
    bedeutung?: string;
    einsetzen_wenn?: string;
    nicht_einsetzen_wenn?: string;
    has_image_placeholder?: boolean;
    decorative_element_count?: number;
    has_fixed_visuals?: boolean;
    has_static_chart?: boolean;
    has_static_table?: boolean;
    has_static_picture?: boolean;
    visual_structure?: string;
    recommended_pipeline?: 'clone' | 'html';
    recommended_pipeline_reason?: string;
    supports_html_overlay?: boolean;
    scaffold_elements?: CompositionScaffoldElement[];
    content_area?: { x: number; y: number; w: number; h: number };
    style_guide?: CompositionStyleGuide;
    layout_hint?: string;
    html_skeleton?: string;
    slide_warnings?: Record<string, string[]>;
    repeatable_groups?: Record<string, RepeatableGroupEntry[]>;
    shapes: Record<string, Record<string, ShapeDetailEntry>>;
}

export interface CompositionsFile {
    schema_version?: number;
    template: string;
    source_files?: Array<{ path: string; role: string; slide_count: number }>;
    brand_dna?: {
        colors: Record<string, string>;
        fonts: { major: string; minor: string };
        slide_size_px: { w: number; h: number };
        slide_decorations?: CompositionScaffoldElement[];
    };
    design_rules?: DesignRules;
    icon_catalog?: IconEntry[];
    usage_guidelines?: UsageGuidelines;
    alias_map?: Record<string, AliasMapEntry>;
    compositions: Record<string, CompositionEntry>;
}

export interface FullCompositionsData {
    schemaVersion: number;
    repeatableGroups: Map<number, RepeatableGroup[]>;
    aliasMap?: Map<string, { slide: number; shapeId: string; originalName: string }>;
    slideSizeInches: { w: number; h: number };
    globalDekoElements?: DekoElementInput[];
    compositionScaffolds?: Map<string, DekoElementInput[]>;
    compositionData?: Map<string, {
        contentArea: { x: number; y: number; w: number; h: number };
        styleGuide: CompositionStyleGuide;
        layoutHint: string;
        slides: number[];
        baseSlideNum: number;
        contentShapeIds: string[];
        contentShapeNames: string[];
    }>;
    rawFile?: CompositionsFile;
}

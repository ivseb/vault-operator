/**
 * Shared types for the PPTX generation engine.
 */

/* ------------------------------------------------------------------ */
/*  Slide data types (used by legacy PptxFreshGenerator)               */
/* ------------------------------------------------------------------ */

export interface SlideData {
    title?: string;
    subtitle?: string;
    body?: string;
    bullets?: string[];
    table?: { headers?: string[]; rows?: (string | number | null)[][] };
    image?: { data: Uint8Array; extension: string; mime: string };
    chart?: ChartData;
    kpis?: KpiData[];
    process?: ProcessStep[];
    notes?: string;
    layout?: string;
}

export interface ChartData {
    type: 'bar' | 'pie' | 'line';
    title?: string;
    categories: string[];
    series: ChartSeries[];
}

export interface ChartSeries {
    name: string;
    values: number[];
    color?: string;
}

export interface KpiData {
    value: string;
    label: string;
    color?: string;
}

export interface ProcessStep {
    label: string;
    description?: string;
}

/* ------------------------------------------------------------------ */
/*  HTML-based slide input (unified pipeline)                          */
/* ------------------------------------------------------------------ */

/** HTML-based slide input for the unified HTML-to-PptxGenJS pipeline. */
export interface HtmlSlideInput {
    /** Annotated HTML (1280x720 canvas, data-object-type attributes). */
    html: string;
    /** Structured chart data referenced by data-chart-index in HTML. */
    charts?: ChartData[];
    /** Structured table data referenced by data-table-index in HTML. */
    tables?: TableData[];
    /** Speaker notes for this slide. */
    notes?: string;
    /** Per-slide scaffold/deko elements (overrides global dekoElements from options). */
    dekoElements?: Array<{
        type: 'image' | 'shape';
        position: { x: number; y: number; w: number; h: number };
        shapeName?: string;
        fillColor?: string;
        rotation?: number;
        imageData?: string;
    }>;
}

/** Structured table data for hybrid rendering (position from HTML, data from here). */
export interface TableData {
    headers?: string[];
    rows?: (string | number | null)[][];
    style?: {
        headerColor?: string;
        headerTextColor?: string;
        zebraColor?: string;
    };
}

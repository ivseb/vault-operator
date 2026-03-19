export interface SlideInput {
    html?: string;
    charts?: ChartInput[];
    tables?: TableInput[];
    notes?: string;
    // Legacy simple-mode fields
    title?: string;
    subtitle?: string;
    body?: string;
    bullets?: string[];
    table?: { headers?: string[]; rows?: (string | number | null)[][] };
    image?: string;
    chart?: { type: string; title?: string; categories: string[]; series: { name: string; values: number[]; color?: string }[] };
    kpis?: { value: string; label: string; color?: string }[];
    process?: { label: string; description?: string }[];
    layout?: string;
}

export interface ChartInput {
    type: string;
    title?: string;
    categories: string[];
    series: { name: string; values: number[]; color?: string }[];
}

export interface TableInput {
    headers?: string[];
    rows?: (string | number | null)[][];
    style?: { headerColor?: string; headerTextColor?: string; zebraColor?: string };
}

export interface CreatePptxBuildOptions {
    slides: SlideInput[];
    themeName?: string;
    templateRef?: string;
}

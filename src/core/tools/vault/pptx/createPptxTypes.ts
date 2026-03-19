export type DeckMode = 'talk' | 'reading';

export interface SlideInput {
    template_slide?: number;
    content?: Record<string, string>;
    html?: string;
    charts?: ChartInput[];
    tables?: TableInput[];
    composition_id?: string;
    title?: string;
    subtitle?: string;
    body?: string;
    bullets?: string[];
    table?: { headers?: string[]; rows?: (string | number | null)[][] };
    image?: string;
    chart?: { type: string; title?: string; categories: string[]; series: { name: string; values: number[]; color?: string }[] };
    kpis?: { value: string; label: string; color?: string }[];
    process?: { label: string; description?: string }[];
    notes?: string;
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
    templateFile?: string;
    templateRef?: string;
    footerText?: string;
    deckMode?: DeckMode;
}

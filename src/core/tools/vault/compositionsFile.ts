import type { DataAdapter } from 'obsidian';

const COMPOSITIONS_DIR = '.obsilo/templates';

export function normalizeTemplateSlug(template: string): string {
    return template
        .split('/')
        .pop()
        ?.replace(/\.(pptx|potx)$/i, '')
        .toLowerCase()
        .replace(/[_\s]+/g, '-') ?? '';
}

export function getCompositionsFilePath(template: string): string {
    return `${COMPOSITIONS_DIR}/${normalizeTemplateSlug(template)}.compositions.json`;
}

export async function readCompositionsFile<T>(
    adapter: DataAdapter,
    template: string,
): Promise<{ path: string; data: T } | undefined> {
    const filePath = getCompositionsFilePath(template);
    if (!await adapter.exists(filePath)) return undefined;
    const content = await adapter.read(filePath);
    return {
        path: filePath,
        data: JSON.parse(content) as T,
    };
}

export async function listAvailableCompositionTemplates(adapter: DataAdapter): Promise<string[]> {
    if (!await adapter.exists(COMPOSITIONS_DIR)) return [];

    try {
        const listed = await adapter.list(COMPOSITIONS_DIR);
        return (listed.files ?? [])
            .filter((f: string) => f.endsWith('.compositions.json'))
            .map((f: string) => f.replace(`${COMPOSITIONS_DIR}/`, '').replace('.compositions.json', ''));
    } catch {
        return [];
    }
}

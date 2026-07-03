import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { TaskNoteCreator } from '../TaskNoteCreator';
import type { TaskItem, TaskExtractionSettings } from '../types';

function makeApp(): { app: App; files: Map<string, string> } {
    const files = new Map<string, string>();
    const vault = {
        getAbstractFileByPath: () => null,
        createFolder: async () => undefined,
        create: async (path: string, content: string) => {
            files.set(path, content);
            return {};
        },
    };
    return { app: { vault } as unknown as App, files };
}

const SETTINGS: TaskExtractionSettings = {
    enabled: true,
    taskFolder: 'Tasks',
    preferTaskNotesPlugin: false,
    taskNotesHintDismissed: true,
};

const ITEM: TaskItem = {
    text: 'Create budget analysis (due: 2026-03-10)',
    assignee: '@Sebastian',
    dueDate: '2026-03-10',
    cleanText: 'Create budget analysis',
};

async function createOne(vocab?: {
    categoryProperty: string;
    summaryProperty: string;
    backlinksProperty: string;
}): Promise<string> {
    const { app, files } = makeApp();
    const creator = new TaskNoteCreator(app, vocab);
    const created = await creator.createNotes([ITEM], SETTINGS, 'Meeting 2026-03-01');
    expect(created).toHaveLength(1);
    return files.get(created[0]) ?? '';
}

describe('TaskNoteCreator frontmatter vocabulary (FIX-42-01-01)', () => {
    it('writes OKF property names by default', async () => {
        const content = await createOne();
        expect(content).toContain('type:');
        expect(content).toContain('  - task');
        expect(content).toContain('description: Create budget analysis');
        expect(content).toContain('related: []');
        expect(content).toContain('resource: "[[Meeting 2026-03-01]]"');
    });

    it('writes non-OKF task properties in English lowercase', async () => {
        const content = await createOne();
        expect(content).toContain('status: todo');
        expect(content).toContain('urgent: false');
        expect(content).toContain('important: false');
        expect(content).toContain('due: 2026-03-10');
        expect(content).toContain('assignee: "@Sebastian"');
    });

    it('contains no German property names or headings by default', async () => {
        const content = await createOne();
        for (const german of ['Kategorie', 'Zusammenfassung', 'Fälligkeit', 'Quelle', 'Notizen', 'Beschreibung', 'Extrahiert']) {
            expect(content).not.toContain(german);
        }
    });

    it('respects user-configured property names from settings', async () => {
        const content = await createOne({
            categoryProperty: 'Kategorie',
            summaryProperty: 'Zusammenfassung',
            backlinksProperty: 'Notizen',
        });
        expect(content).toContain('Kategorie:');
        expect(content).toContain('Zusammenfassung: Create budget analysis');
        expect(content).toContain('Notizen: []');
    });

    it('renders body headings through the i18n layer (English default)', async () => {
        const content = await createOne();
        expect(content).toContain('## Description');
        expect(content).toContain('## Notes');
        expect(content).toContain('Extracted from agent conversation');
    });
});

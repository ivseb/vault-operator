import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { TFile } from 'obsidian';
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

describe('TaskNoteCreator frontmatter edge cases', () => {
    it('emits an empty resource and omits the source callout when sourceNote is blank', async () => {
        const { app, files } = makeApp();
        const created = await new TaskNoteCreator(app).createNotes([ITEM], SETTINGS, '');
        const content = files.get(created[0]) ?? '';
        expect(content).toContain('resource: ""');
        // The "> Source: [[...]]" body callout is skipped for a blank source.
        expect(content).not.toContain('[[]]');
        expect(content).not.toMatch(/Source:\s*\[\[/);
    });

    it('YAML-escapes values with embedded quotes and whitespace', async () => {
        const { app, files } = makeApp();
        const item: TaskItem = { ...ITEM, assignee: 'Jon "JJ" Doe' };
        const created = await new TaskNoteCreator(app).createNotes([item], SETTINGS, 'Meeting');
        const content = files.get(created[0]) ?? '';
        expect(content).toContain('assignee: "Jon \\"JJ\\" Doe"');
    });

    it('quotes an empty assignee as ""', async () => {
        const { app, files } = makeApp();
        const item: TaskItem = { ...ITEM, assignee: '' };
        const created = await new TaskNoteCreator(app).createNotes([item], SETTINGS, 'Meeting');
        const content = files.get(created[0]) ?? '';
        expect(content).toContain('assignee: ""');
    });

    it('suffixes the path when the slug already exists (collision)', async () => {
        const files = new Map<string, string>();
        const vault = {
            // Report existing paths as real TFiles so uniquePath's instanceof
            // check triggers the -2 suffix for the second note.
            getAbstractFileByPath: (p: string) => files.has(p) ? new TFile() : null,
            createFolder: async () => undefined,
            create: async (path: string, content: string) => { files.set(path, content); return {}; },
        };
        const app = { vault } as unknown as App;
        const item: TaskItem = { ...ITEM, cleanText: 'Same title' };
        const created = await new TaskNoteCreator(app).createNotes([item, item], SETTINGS, 'Meeting');
        expect(created).toHaveLength(2);
        expect(created[1]).toMatch(/Same-title-2\.md$/);
    });

    it('keeps partial success when vault.create throws for one item', async () => {
        const files = new Map<string, string>();
        let calls = 0;
        const vault = {
            getAbstractFileByPath: () => null,
            createFolder: async () => undefined,
            create: async (path: string, content: string) => {
                calls++;
                if (calls === 1) throw new Error('disk full');
                files.set(path, content);
                return {};
            },
        };
        const app = { vault } as unknown as App;
        const a: TaskItem = { ...ITEM, cleanText: 'First task' };
        const b: TaskItem = { ...ITEM, cleanText: 'Second task' };
        const created = await new TaskNoteCreator(app).createNotes([a, b], SETTINGS, 'Meeting');
        // The failing item is skipped; the surviving one is still created.
        expect(created).toHaveLength(1);
        expect(created[0]).toMatch(/Second-task\.md$/);
    });
});

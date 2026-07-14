/**
 * FIX-44-13b: ingest_document and ingest_deep announce their file scope on
 * the gate instead of a bare name card.
 *
 * Both are scope-only previews by design:
 * - ingest_document composes its note from a parsed source document; the
 *   composed content routinely runs to hundreds of thousands of characters
 *   (that is the tool's purpose: bypassing output-token limits), which no
 *   gate diff can render. The scope names the output file and the source.
 * - ingest_deep's per-file results (block-anchor IDs, marker positions) are
 *   computed inside DeepIngestPipeline during the run. The scope names the
 *   files the source-only pass touches: the source note and, when a cluster
 *   MOC page with an auto block exists, that MOC page.
 *
 * Modes whose file set is NOT computable up front return null and keep the
 * plain card (documented limitation, not a gate bypass).
 */

import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { IngestDocumentTool } from '../IngestDocumentTool';
import { IngestDeepTool } from '../IngestDeepTool';

describe('FIX-44-13b: ingest_document scope preview', () => {
    function makeTool(existingPaths: string[] = []) {
        const plugin = {
            app: {
                vault: {
                    getAbstractFileByPath: (p: string) =>
                        (existingPaths.includes(p) ? Object.assign(new TFile(), { path: p }) : null),
                },
            },
        };
        return new IngestDocumentTool(plugin as never);
    }

    it('names the output note and the source as a single scope entry', async () => {
        const tool = makeTool();
        const batch = await tool.previewBatch({
            output_path: 'Notes/Webb-2026.md',
            header_content: '---\ntitle: x\n---',
            source_path: 'Attachments/report.pdf',
        });

        expect(batch).not.toBeNull();
        expect(batch!.scopeOnly).toBe(true);
        expect(batch!.entries).toEqual([
            { path: 'Notes/Webb-2026.md', before: '', after: '', isNew: true },
        ]);
        expect(batch!.summary).toContain('Attachments/report.pdf');
    });

    it('names the attachment when no source_path is given', async () => {
        const tool = makeTool();
        const batch = await tool.previewBatch({
            output_path: 'Notes/N.md',
            header_content: 'h',
            attachment_index: 0,
        });
        expect(batch!.summary).toContain('0');
    });

    it('returns null without an output path', async () => {
        const tool = makeTool();
        expect(await tool.previewBatch({ header_content: 'h' })).toBeNull();
    });
});

describe('FIX-44-13b: ingest_deep scope preview', () => {
    function makeTool(opts: {
        files?: Record<string, { extension: string; body?: string }>;
        pdfStrategy?: string;
    } = {}) {
        const files = opts.files ?? { 'Notes/Source.md': { extension: 'md' } };
        const byPath = new Map(Object.entries(files).map(([p, meta]) => [
            p,
            Object.assign(new TFile(), { path: p, extension: meta.extension, basename: p.split('/').pop()!.replace(/\.\w+$/, '') }),
        ]));
        const plugin = {
            app: {
                vault: {
                    getAbstractFileByPath: (p: string) => byPath.get(p) ?? null,
                    read: (f: TFile) => Promise.resolve(files[f.path]?.body ?? ''),
                },
                metadataCache: { getFileCache: () => null },
            },
            settings: {
                defaultOutputFolder: 'Inbox/',
                vaultIngest: opts.pdfStrategy ? { pdfStrategy: opts.pdfStrategy } : {},
            },
            knowledgeDB: undefined,
        };
        return new IngestDeepTool(plugin as never);
    }

    it('source-only: lists the source note as the write target', async () => {
        const tool = makeTool();
        const batch = await tool.previewBatch({ source_path: 'Notes/Source.md' });

        expect(batch).not.toBeNull();
        expect(batch!.scopeOnly).toBe(true);
        expect(batch!.entries.map((e) => e.path)).toEqual(['Notes/Source.md']);
    });

    it('includes the cluster MOC page when it exists and carries the auto block', async () => {
        const tool = makeTool({
            files: {
                'Notes/Source.md': { extension: 'md' },
                'Tech.md': { extension: 'md', body: 'x\n<!-- obsilo:auto-start id="moc-header" -->\nold\n<!-- obsilo:auto-end -->\n' },
            },
        });
        const batch = await tool.previewBatch({ source_path: 'Notes/Source.md', cluster: 'Tech' });

        expect(batch!.entries.map((e) => e.path).sort()).toEqual(['Notes/Source.md', 'Tech.md']);
    });

    it('leaves the MOC page out when it has no auto block (execute would not touch it)', async () => {
        const tool = makeTool({
            files: {
                'Notes/Source.md': { extension: 'md' },
                'Tech.md': { extension: 'md', body: 'plain MOC page' },
            },
        });
        const batch = await tool.previewBatch({ source_path: 'Notes/Source.md', cluster: 'Tech' });

        expect(batch!.entries.map((e) => e.path)).toEqual(['Notes/Source.md']);
    });

    it('returns null for multi-file output modes (file set not computable up front)', async () => {
        const tool = makeTool();
        expect(await tool.previewBatch({
            source_path: 'Notes/Source.md',
            output_mode: 'source-plus-multi-zettel',
        })).toBeNull();
    });

    it('returns null for the PDF markdown-mirror path (mirror file named at run time)', async () => {
        const tool = makeTool({
            files: { 'Docs/paper.pdf': { extension: 'pdf' } },
            pdfStrategy: 'markdown-mirror',
        });
        expect(await tool.previewBatch({ source_path: 'Docs/paper.pdf' })).toBeNull();
    });

    it('returns null for a missing source (execute errors, card stays)', async () => {
        const tool = makeTool();
        expect(await tool.previewBatch({ source_path: 'Notes/Nope.md' })).toBeNull();
    });
});

import { describe, it, expect } from 'vitest';
import { FileDossier } from '../FileDossier';

/**
 * IMP-41-03-06: per-file dossiers for hierarchical condensing.
 *
 * The flat LLM condense summary swallows per-file detail, so the model
 * re-reads files it already knew after every condense. The dossier is a
 * DETERMINISTIC (no-LLM, no hallucination risk) record of which file was
 * touched with which outcome; condenseHistory appends its rendering to the
 * summary. Budgets: 200 chars per file, 30 files LRU, 3000 chars rendered.
 */

describe('FileDossier', () => {
    it('records reads and renders them deterministically', () => {
        const dossier = new FileDossier();
        dossier.record('Notes/Kant.md', { detail: 'L1-L120: categorical imperative overview', kind: 'read' });
        dossier.record('Notes/Hegel.md', { detail: 'L1-L80: dialectics intro', kind: 'read' });

        const rendered = dossier.render();
        expect(rendered).toContain('[FILE DOSSIER]');
        expect(rendered).toContain('Notes/Kant.md');
        expect(rendered).toContain('categorical imperative');
        // Deterministic: same input, same output
        expect(dossier.render()).toBe(rendered);
    });

    it('merges repeated records per path, latest detail wins, write state sticks', () => {
        const dossier = new FileDossier();
        dossier.record('a.md', { detail: 'first read', kind: 'read' });
        dossier.record('a.md', { detail: 'wrote new section', kind: 'write' });
        dossier.record('a.md', { detail: 'second read', kind: 'read' });

        const rendered = dossier.render();
        expect(rendered).toContain('second read');
        expect(rendered).toContain('(written)'); // write marker survives later reads
        expect((rendered.match(/a\.md/g) ?? []).length).toBe(1);
    });

    it('caps per-file detail at 200 chars', () => {
        const dossier = new FileDossier();
        dossier.record('big.md', { detail: 'x'.repeat(500), kind: 'read' });
        const line = dossier.render().split('\n').find((l) => l.includes('big.md'));
        expect(line).toBeDefined();
        expect(line!.length).toBeLessThanOrEqual(260); // 200 detail + path + markers
    });

    it('evicts the least recently touched file beyond 30 entries', () => {
        const dossier = new FileDossier();
        for (let i = 0; i < 31; i++) {
            dossier.record(`file-${i}.md`, { detail: `read ${i}`, kind: 'read' });
        }
        const rendered = dossier.render();
        expect(rendered).not.toContain('file-0.md'); // oldest evicted
        expect(rendered).toContain('file-30.md');
        // Touching an old entry protects it
        const dossier2 = new FileDossier();
        for (let i = 0; i < 30; i++) dossier2.record(`f${i}.md`, { detail: 'r', kind: 'read' });
        dossier2.record('f0.md', { detail: 'touched again', kind: 'read' });
        dossier2.record('f-new.md', { detail: 'new', kind: 'read' });
        expect(dossier2.render()).toContain('f0.md');   // refreshed, survives
        expect(dossier2.render()).not.toContain('f1.md'); // now the oldest
    });

    it('bounds the rendered section to 3000 chars', () => {
        const dossier = new FileDossier();
        for (let i = 0; i < 30; i++) {
            dossier.record(`some/rather/long/path/file-${i}.md`, { detail: 'y'.repeat(200), kind: 'read' });
        }
        expect(dossier.render().length).toBeLessThanOrEqual(3000);
    });

    it('renders empty string when nothing was recorded', () => {
        expect(new FileDossier().render()).toBe('');
    });
});

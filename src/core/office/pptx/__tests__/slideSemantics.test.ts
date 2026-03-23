import { describe, expect, it } from 'vitest';
import type { ShapeEntry } from '../types';
import {
    buildDefaultUseWhen,
    buildSlideTypeGroupingKey,
    inferSlideSemanticFamily,
    inferSlideWarningFlags,
    scoreRepresentativeSlide,
} from '../slideSemantics';

function makeShape(overrides: Partial<ShapeEntry> = {}): ShapeEntry {
    return {
        name: 'Titel 1',
        role: 'title',
        content_type: 'text',
        removable: false,
        ...overrides,
    };
}

describe('slideSemantics', () => {
    it('detects comparison slides from left/right body columns', () => {
        const family = inferSlideSemanticFamily([
            makeShape({ role: 'title', name: 'Titel 1' }),
            makeShape({
                role: 'body',
                name: 'Body Left',
                dimensions: { x: 40, y: 180, w: 420, h: 260 },
            }),
            makeShape({
                role: 'body',
                name: 'Body Right',
                dimensions: { x: 720, y: 180, w: 420, h: 260 },
            }),
        ]);

        expect(family).toBe('comparison');
    });

    it('detects process slides from horizontal body sequences', () => {
        const family = inferSlideSemanticFamily([
            makeShape({ role: 'title', name: 'Titel 1' }),
            makeShape({ role: 'body', name: 'Step 1', dimensions: { x: 40, y: 420, w: 180, h: 110 } }),
            makeShape({ role: 'body', name: 'Step 2', dimensions: { x: 280, y: 420, w: 180, h: 110 } }),
            makeShape({ role: 'body', name: 'Step 3', dimensions: { x: 520, y: 420, w: 180, h: 110 } }),
            makeShape({ role: 'body', name: 'Step 4', dimensions: { x: 760, y: 420, w: 180, h: 110 } }),
        ]);

        expect(family).toBe('process');
    });

    it('flags likely style-guide slides from guide vocabulary', () => {
        const warnings = inferSlideWarningFlags([
            makeShape({
                role: 'title',
                sample_text: 'Allgemeine Vorgaben',
            }),
            makeShape({
                role: 'body',
                sample_text: 'Linien, Pfeile und Formen in der Folienbibliothek',
            }),
        ]);

        expect(warnings).toContain('possible-style-guide');
    });

    it('flags component libraries and marks them as image-dependent', () => {
        const shapes: ShapeEntry[] = [
            makeShape({ role: 'title', sample_text: 'Icons' }),
            ...Array.from({ length: 8 }, (_, index) => makeShape({
                name: `Grafik ${index + 1}`,
                role: 'image',
                content_type: 'image',
            })),
        ];

        expect(inferSlideSemanticFamily(shapes)).toBe('library');
        expect(inferSlideWarningFlags(shapes)).toEqual(
            expect.arrayContaining(['possible-component-library', 'image-dependent']),
        );
    });

    it('splits grouping keys for same layout name with different structures', () => {
        const leftRight = buildSlideTypeGroupingKey('Nur Titel', [
            makeShape({ role: 'title' }),
            makeShape({ role: 'body', dimensions: { x: 40, y: 160, w: 420, h: 250 } }),
            makeShape({ role: 'body', dimensions: { x: 720, y: 160, w: 420, h: 250 } }),
        ]);

        const iconLibrary = buildSlideTypeGroupingKey('Nur Titel', [
            makeShape({ role: 'title', sample_text: 'Icons' }),
            ...Array.from({ length: 10 }, (_, index) => makeShape({
                name: `Grafik ${index + 1}`,
                role: 'image',
                content_type: 'image',
            })),
        ]);

        expect(leftRight).not.toBe(iconLibrary);
    });

    it('prefers reusable content slides over style-guide variants when scoring representatives', () => {
        const reusableScore = scoreRepresentativeSlide([
            makeShape({ role: 'title', sample_text: 'Platzhalter Titelbereich' }),
            makeShape({ role: 'body', dimensions: { x: 40, y: 160, w: 420, h: 250 } }),
            makeShape({ role: 'body', dimensions: { x: 720, y: 160, w: 420, h: 250 } }),
        ]);

        const guideScore = scoreRepresentativeSlide([
            makeShape({ role: 'title', sample_text: 'Allgemeine Vorgaben' }),
            makeShape({ role: 'body', sample_text: 'Linien und Pfeile in der Folienbibliothek' }),
            makeShape({ role: 'image', content_type: 'image', name: 'Grafik 1' }),
            makeShape({ role: 'image', content_type: 'image', name: 'Grafik 2' }),
        ]);

        expect(reusableScore).toBeGreaterThan(guideScore);
    });

    it('provides a default usage hint for process slides', () => {
        expect(buildDefaultUseWhen('process')).toContain('Ablauf');
    });
});

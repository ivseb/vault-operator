import { describe, it, expect } from 'vitest';
import { isTemplateSlide, isAdhocSlide, isContentValue } from '../types';
import type { SlideInput, TemplateSlideInput, AdhocSlideInput, ContentValue } from '../types';

describe('isTemplateSlide', () => {
    it('returns true for slides with source_slide number', () => {
        const slide: SlideInput = { source_slide: 3 };
        expect(isTemplateSlide(slide)).toBe(true);
    });

    it('returns true for template slides with content', () => {
        const slide: SlideInput = { source_slide: 1, content: { 'Titel 1': 'Hello' } };
        expect(isTemplateSlide(slide)).toBe(true);
    });

    it('returns false for adhoc slides', () => {
        const slide: SlideInput = { html: '<div>test</div>' };
        expect(isTemplateSlide(slide)).toBe(false);
    });

    it('returns false when source_slide is missing', () => {
        const slide = { content: { 'Titel 1': 'test' } } as unknown as SlideInput;
        expect(isTemplateSlide(slide)).toBe(false);
    });
});

describe('isAdhocSlide', () => {
    it('returns true for slides with html string', () => {
        const slide: SlideInput = { html: '<div>content</div>' };
        expect(isAdhocSlide(slide)).toBe(true);
    });

    it('returns false for template slides', () => {
        const slide: SlideInput = { source_slide: 5 };
        expect(isAdhocSlide(slide)).toBe(false);
    });

    it('returns false when html field is missing', () => {
        const slide = { charts: [] } as unknown as SlideInput;
        expect(isAdhocSlide(slide)).toBe(false);
    });
});

describe('isContentValue', () => {
    it('returns true for styled_text objects', () => {
        const value: ContentValue = { type: 'styled_text', paragraphs: [] };
        expect(isContentValue(value)).toBe(true);
    });

    it('returns true for chart objects', () => {
        const value: ContentValue = { type: 'chart', series: [], categories: [] };
        expect(isContentValue(value)).toBe(true);
    });

    it('returns true for position objects', () => {
        const value: ContentValue = { type: 'position', x: 0, y: 0 };
        expect(isContentValue(value)).toBe(true);
    });

    it('returns false for plain strings', () => {
        expect(isContentValue('plain text')).toBe(false);
    });

    it('returns false for null', () => {
        expect(isContentValue(null as unknown as ContentValue)).toBe(false);
    });

    it('returns false for numbers', () => {
        expect(isContentValue(42 as unknown as ContentValue)).toBe(false);
    });

    it('returns false for objects without type field', () => {
        const value = { data: 'something' } as unknown as ContentValue;
        expect(isContentValue(value)).toBe(false);
    });
});

describe('TemplateSlideInput and AdhocSlideInput mutual exclusivity', () => {
    it('template slides are never adhoc slides', () => {
        const slides: TemplateSlideInput[] = [
            { source_slide: 1 },
            { source_slide: 5, content: { 'KPI': '42%' } },
            { source_slide: 10, remove: ['Logo'], notes: 'speaker note' },
        ];
        for (const slide of slides) {
            expect(isTemplateSlide(slide)).toBe(true);
            expect(isAdhocSlide(slide as unknown as SlideInput)).toBe(false);
        }
    });

    it('adhoc slides are never template slides', () => {
        const slides: AdhocSlideInput[] = [
            { html: '<p>slide 1</p>' },
            { html: '<div class="kpi"></div>', charts: [] },
        ];
        for (const slide of slides) {
            expect(isAdhocSlide(slide)).toBe(true);
            expect(isTemplateSlide(slide as unknown as SlideInput)).toBe(false);
        }
    });
});

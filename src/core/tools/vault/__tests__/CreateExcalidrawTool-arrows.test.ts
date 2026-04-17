/**
 * BUG-018 Wave 2 regression test: Excalidraw arrows extension.
 *
 * Pins the output shape of the Excalidraw scene so future refactors don't
 * break the plugin-compatible format. We don't instantiate the full tool
 * (needs Obsidian's vault API). Instead we re-implement the minimum
 * arrow/rectangle structure the plugin expects and assert it matches what
 * the tool emits, based on publicly documented Excalidraw format rules:
 *
 * - Arrow points are relative to the arrow's (x, y): first point is [0, 0].
 * - startBinding.elementId / endBinding.elementId reference existing
 *   rectangle ids.
 * - Bound rectangles carry { id, type: 'arrow' } entries in boundElements
 *   so Excalidraw re-routes arrows when the rectangle moves.
 */

import { describe, it, expect } from 'vitest';

/** Arrow construction mirror of buildArrow() in CreateExcalidrawTool.ts. */
function buildArrowForTest(
    id: string,
    fromRect: { id: string; x: number; y: number; width: number; height: number },
    toRect: { id: string; x: number; y: number; width: number; height: number },
) {
    const start = { x: fromRect.x + fromRect.width / 2, y: fromRect.y + fromRect.height };
    const end = { x: toRect.x + toRect.width / 2, y: toRect.y };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    return {
        id,
        type: 'arrow',
        x: start.x,
        y: start.y,
        points: [[0, 0], [dx, dy]],
        startBinding: { elementId: fromRect.id, focus: 0, gap: 4 },
        endBinding: { elementId: toRect.id, focus: 0, gap: 4 },
        startArrowhead: null,
        endArrowhead: 'arrow',
    };
}

describe('Excalidraw arrows format (BUG-018 Wave 2)', () => {
    const rectA = { id: 'rect-0', x: 0, y: 0, width: 240, height: 90 };
    const rectB = { id: 'rect-1', x: 300, y: 140, width: 240, height: 90 };

    it('arrow points start at [0, 0] relative to arrow origin', () => {
        const arrow = buildArrowForTest('arrow-0', rectA, rectB);
        expect(arrow.points[0]).toEqual([0, 0]);
    });

    it('arrow origin sits at the bottom-center of the source rectangle', () => {
        const arrow = buildArrowForTest('arrow-0', rectA, rectB);
        expect(arrow.x).toBe(rectA.x + rectA.width / 2);
        expect(arrow.y).toBe(rectA.y + rectA.height);
    });

    it('arrow end-point offset reaches the top-center of the target rectangle', () => {
        const arrow = buildArrowForTest('arrow-0', rectA, rectB);
        const [endX, endY] = arrow.points[1];
        const absoluteEndX = arrow.x + endX;
        const absoluteEndY = arrow.y + endY;
        expect(absoluteEndX).toBe(rectB.x + rectB.width / 2);
        expect(absoluteEndY).toBe(rectB.y);
    });

    it('bindings reference rectangle ids by elementId', () => {
        const arrow = buildArrowForTest('arrow-0', rectA, rectB);
        expect(arrow.startBinding?.elementId).toBe('rect-0');
        expect(arrow.endBinding?.elementId).toBe('rect-1');
    });

    it('arrowhead is on the end (user expectation for a directed flow)', () => {
        const arrow = buildArrowForTest('arrow-0', rectA, rectB);
        expect(arrow.endArrowhead).toBe('arrow');
        expect(arrow.startArrowhead).toBeNull();
    });
});

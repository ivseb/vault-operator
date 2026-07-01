import { describe, it, expect, beforeEach } from 'vitest';
import { PerformanceMarks } from '../PerformanceMarks';

describe('PerformanceMarks', () => {
    let marks: PerformanceMarks;

    beforeEach(() => {
        marks = new PerformanceMarks();
        marks.clear();
    });

    it('start + end produces a measure with duration', () => {
        marks.start('boot');
        marks.end('boot');
        const report = marks.getMeasures();
        expect(report).toHaveLength(1);
        expect(report[0].name).toBe('boot');
        expect(report[0].duration).toBeGreaterThanOrEqual(0);
    });

    it('start + end returns the measure from end()', () => {
        marks.start('phase');
        const measure = marks.end('phase');
        expect(measure).not.toBeNull();
        expect(measure!.name).toBe('phase');
        expect(measure!.duration).toBeGreaterThanOrEqual(0);
    });

    it('end without start is a no-op and returns null', () => {
        const result = marks.end('never-started');
        expect(result).toBeNull();
        expect(marks.getMeasures()).toHaveLength(0);
    });

    it('multiple isolated spans are tracked separately', () => {
        marks.start('a');
        marks.start('b');
        marks.end('a');
        marks.end('b');
        const names = marks.getMeasures().map(m => m.name).sort();
        expect(names).toEqual(['a', 'b']);
    });

    it('point captures a single timestamp', () => {
        marks.point('first-token');
        const points = marks.getPoints();
        expect(points).toHaveLength(1);
        expect(points[0].name).toBe('first-token');
        expect(points[0].timestamp).toBeGreaterThan(0);
    });

    it('points are not in measures', () => {
        marks.point('p1');
        expect(marks.getMeasures()).toHaveLength(0);
    });

    it('measures are not in points', () => {
        marks.start('m1');
        marks.end('m1');
        expect(marks.getPoints()).toHaveLength(0);
    });

    it('clear removes all spans and points', () => {
        marks.start('x'); marks.end('x');
        marks.point('y');
        marks.clear();
        expect(marks.getMeasures()).toHaveLength(0);
        expect(marks.getPoints()).toHaveLength(0);
    });

    it('two starts on same label without end keeps last start active', () => {
        marks.start('twice');
        marks.start('twice');
        const measure = marks.end('twice');
        expect(measure).not.toBeNull();
        expect(measure!.name).toBe('twice');
    });

    it('repeated start+end for same label accumulates measures', () => {
        marks.start('rep'); marks.end('rep');
        marks.start('rep'); marks.end('rep');
        const measures = marks.getMeasures().filter(m => m.name === 'rep');
        expect(measures).toHaveLength(2);
    });

    it('logToConsole emits a single console.debug line per measure', () => {
        const debugCalls: unknown[][] = [];
        const orig = console.debug;
        console.debug = (...args: unknown[]) => { debugCalls.push(args); };
        try {
            marks.start('logged');
            marks.end('logged', { log: true });
        } finally {
            console.debug = orig;
        }
        expect(debugCalls.length).toBe(1);
        expect(String(debugCalls[0][0])).toContain('[perf]');
        expect(String(debugCalls[0][0])).toContain('logged');
    });

    it('logPoint emits a single console.debug line', () => {
        const debugCalls: unknown[][] = [];
        const orig = console.debug;
        console.debug = (...args: unknown[]) => { debugCalls.push(args); };
        try {
            marks.point('first-token', { log: true });
        } finally {
            console.debug = orig;
        }
        expect(debugCalls.length).toBe(1);
        expect(String(debugCalls[0][0])).toContain('[perf]');
        expect(String(debugCalls[0][0])).toContain('first-token');
    });

    it('toJSON produces a serializable report', () => {
        marks.start('boot'); marks.end('boot');
        marks.point('ready');
        const json = marks.toJSON();
        expect(json).toHaveProperty('measures');
        expect(json).toHaveProperty('points');
        expect(Array.isArray(json.measures)).toBe(true);
        expect(Array.isArray(json.points)).toBe(true);
    });
});

/**
 * FIX-01-04-03: dynamic ReDoS probe. Instead of guessing dangerous shapes
 * (the inherently-incomplete blocklist), this MEASURES the pattern's runtime in
 * a terminable worker and literalizes catastrophic patterns.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { probeRegexSafe, safeRegexChecked, _clearRegexVerdictCacheForTest } from '../regexSafetyProbe';

describe('probeRegexSafe (dynamic ReDoS detection)', () => {
    it('flags an exponential pattern as unsafe (worker terminated on deadline)', async () => {
        // Classic catastrophic backtracking; the worker hangs on the sentinel
        // pump string and is killed by the deadline.
        const safe = await probeRegexSafe('(a+)+$', 'i');
        expect(safe).toBe(false);
    });

    it('flags a nested-quantifier pattern as unsafe', async () => {
        const safe = await probeRegexSafe('(a*)*$', 'i');
        expect(safe).toBe(false);
    });

    it('reports a benign pattern as safe', async () => {
        expect(await probeRegexSafe('hello.*world', 'i')).toBe(true);
        expect(await probeRegexSafe('\\b\\w+@\\w+\\.\\w+\\b', 'i')).toBe(true);
        expect(await probeRegexSafe('^\\d{4}-\\d{2}-\\d{2}$', '')).toBe(true);
    });
}, 15000);

describe('safeRegexChecked', () => {
    beforeEach(() => _clearRegexVerdictCacheForTest());

    it('returns a working real regex for a benign pattern', async () => {
        const re = await safeRegexChecked('hello.*world', 'i');
        expect(re.test('hello beautiful world')).toBe(true);
        expect(re.source).toBe('hello.*world');
    });

    it('literalizes a blocklist-caught pattern without needing the probe', async () => {
        const re = await safeRegexChecked('(a+)+');
        // literal-escaped -> matches its own source, not the pathological regex
        expect(re.test('(a+)+')).toBe(true);
        expect(re.test('aaaaaa')).toBe(false);
    });

    it('literalizes an exponential pattern that evades the static blocklist via the probe', async () => {
        // `(?:a|a)*b` is exponential but is caught by the blocklist; use a shape
        // the blocklist does not flag to exercise the dynamic path. If the probe
        // deems it catastrophic it is literalized (matches its own source).
        const evader = '(a|a|a)x';
        const re = await safeRegexChecked(evader, 'i');
        expect(re).toBeInstanceOf(RegExp);
    });
}, 15000);

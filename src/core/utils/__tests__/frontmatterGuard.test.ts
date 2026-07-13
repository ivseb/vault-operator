/**
 * FIX-44-09: guard against edits that destroy the YAML frontmatter fence.
 *
 * Live incident 2026-07-11 (interview-insights skill, "Theresa Pace" note):
 * the note had a closing frontmatter fence immediately followed by a stray
 * horizontal rule:
 *
 *     ---
 *     uid: ...
 *     timestamp: ...
 *     ---            <- closing fence of the frontmatter
 *     ---            <- stray horizontal rule in the body
 *
 * The model picked `old_str: "---\n---\n\n\n\n\n\n---\n\n### Transkript"` and
 * edit_file happily consumed BOTH fences. The frontmatter was left unterminated,
 * the whole summary body was swallowed into the YAML block, and Obsidian threw
 * "Implicit map keys need to be followed by map values".
 *
 * edit_file did exactly what it was told. Nothing checked that the result was
 * still a structurally intact note. That check is what this guard adds.
 */

import { describe, it, expect } from 'vitest';
import { checkFrontmatterIntegrity } from '../frontmatterGuard';

const INTACT = [
    '---',
    'uid: 09ee14ee-f1af-47f9-b87b-ec26b38cf130',
    'title: Interview Theresa Pace',
    'type:',
    '  - interview',
    'timestamp: 2026-07-09T16:30:00',
    '---',
    '---',      // stray horizontal rule, exactly as in the live note
    '',
    '',
    '---',
    '',
    '### Transkript',
    '',
    'Hallo Theresa.',
    '',
].join('\n');

/** What edit_file actually produced: the closing fence is gone. */
const CORRUPTED = [
    '---',
    'uid: 09ee14ee-f1af-47f9-b87b-ec26b38cf130',
    'title: Interview Theresa Pace',
    'type:',
    '  - interview',
    'timestamp: 2026-07-09T16:30:00',
    '',
    '# Interview Acme Cowork Beta-Test 1 - Theresa Pace',
    '',
    '## Kontext',
    '',
    'Theresa Pace ist seit Oktober 2024 Projektleitung der Initiative "finanzierte Energiewelt".',
    '',
    '---',
    '',
    '### Transkript',
    '',
    'Hallo Theresa.',
    '',
].join('\n');

describe('FIX-44-09: frontmatter integrity guard', () => {
    it('refuses the exact edit that destroyed the live note', () => {
        const reason = checkFrontmatterIntegrity(INTACT, CORRUPTED);
        expect(reason).not.toBeNull();
        expect(reason).toMatch(/frontmatter/i);
    });

    it('allows a normal body edit that leaves the frontmatter alone', () => {
        const after = INTACT.replace('Hallo Theresa.', 'Hallo Theresa. Wie geht es dir?');
        expect(checkFrontmatterIntegrity(INTACT, after)).toBeNull();
    });

    it('allows a legitimate frontmatter change', () => {
        const after = INTACT.replace('title: Interview Theresa Pace', 'title: Interview T. Pace');
        expect(checkFrontmatterIntegrity(INTACT, after)).toBeNull();
    });

    it('allows adding keys to the frontmatter', () => {
        const after = INTACT.replace(
            'timestamp: 2026-07-09T16:30:00',
            'timestamp: 2026-07-09T16:30:00\ndescription: Eine Zusammenfassung',
        );
        expect(checkFrontmatterIntegrity(INTACT, after)).toBeNull();
    });

    it('refuses an unterminated frontmatter block', () => {
        const after = '---\nuid: x\ntitle: y\n\nBody ohne jeden weiteren Zaun.\n';
        expect(checkFrontmatterIntegrity(INTACT, after)).not.toBeNull();
    });

    it('refuses swallowing a markdown heading into the frontmatter', () => {
        const after = [
            '---',
            'uid: x',
            '# Eine Ueberschrift, die im Body stehen muesste',
            'timestamp: 2026-07-09T16:30:00',
            '---',
            '',
            'Body',
        ].join('\n');
        expect(checkFrontmatterIntegrity(INTACT, after)).not.toBeNull();
    });

    it('stays out of the way when the file never had frontmatter', () => {
        const before = '# Just a note\n\nSome text.\n';
        const after = '# Just a note\n\nSome other text.\n';
        expect(checkFrontmatterIntegrity(before, after)).toBeNull();
    });

    it('allows deliberately adding frontmatter to a file that had none', () => {
        const before = '# Just a note\n\nSome text.\n';
        const after = '---\ntitle: Just a note\n---\n\n# Just a note\n\nSome text.\n';
        expect(checkFrontmatterIntegrity(before, after)).toBeNull();
    });

    it('allows deliberately removing the whole frontmatter block', () => {
        // Removing the block cleanly is a legitimate edit: what we refuse is
        // leaving it UNTERMINATED, not removing it.
        const after = '### Transkript\n\nHallo Theresa.\n';
        expect(checkFrontmatterIntegrity(INTACT, after)).toBeNull();
    });

    it('refuses when the resulting frontmatter no longer parses as YAML', () => {
        const after = [
            '---',
            'uid: x',
            'this line is prose and has no key at all, so YAML chokes on it',
            '---',
            '',
            'Body',
        ].join('\n');
        expect(checkFrontmatterIntegrity(INTACT, after)).not.toBeNull();
    });
});

/**
 * FIX-44-09: refuse edits that destroy a note's YAML frontmatter.
 *
 * Live incident 2026-07-11: a note had its closing frontmatter fence directly
 * followed by a stray horizontal rule:
 *
 *     ---
 *     uid: ...
 *     timestamp: ...
 *     ---        <- closing fence
 *     ---        <- stray horizontal rule (body)
 *
 * The model asked edit_file to replace `"---\n---\n\n\n\n\n\n---\n\n### Transkript"`.
 * The match was real, the replacement was performed exactly as requested, and it
 * ate the closing fence. The frontmatter was left unterminated, the entire body
 * got swallowed into the YAML block, and the note broke.
 *
 * The tool was not wrong -- it did what it was told. Nothing verified that the
 * RESULT was still a structurally intact note. That is what this guard does. It
 * is a last line of defence at the write path, not a replacement for approval.
 *
 * Deliberately narrow: it only fires when the file HAD a well-formed frontmatter
 * block and the edit would leave it broken. Adding, changing, or cleanly
 * removing frontmatter all pass.
 */

import { parseYaml } from 'obsidian';

interface FrontmatterBlock {
    /** Raw YAML text between the fences, without the fences themselves. */
    raw: string;
    /** Index of the line holding the closing fence. */
    closingLine: number;
}

/**
 * Extract the frontmatter block. Returns null when the text does not open with
 * a fence, or when the opening fence is never closed (an unterminated block is
 * exactly the corruption we are hunting, so the caller distinguishes the two).
 */
function extractFrontmatter(text: string): FrontmatterBlock | null {
    const lines = text.split('\n');
    if (lines[0] !== '---') return null;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i] === '---') {
            return { raw: lines.slice(1, i).join('\n'), closingLine: i };
        }
    }
    return null;
}

/** A markdown heading has no business inside a frontmatter block. */
const MARKDOWN_HEADING = /^#{1,6}\s+\S/;

function hasMarkdownHeading(raw: string): boolean {
    return raw.split('\n').some((l) => MARKDOWN_HEADING.test(l));
}

/**
 * Check whether an edit would leave the note's frontmatter broken.
 *
 * @returns a human-readable reason when the edit must be refused, or `null`
 *          when the edit is safe to write.
 */
export function checkFrontmatterIntegrity(before: string, after: string): string | null {
    const openedBefore = before.split('\n')[0] === '---';
    if (!openedBefore) return null;

    const beforeBlock = extractFrontmatter(before);
    // The file was already broken before this edit. Not our business to block
    // an edit that might well be the repair.
    if (!beforeBlock) return null;

    // The edit removed the frontmatter block cleanly. That is a legitimate,
    // intentional operation, not corruption.
    if (after.split('\n')[0] !== '---') return null;

    const afterBlock = extractFrontmatter(after);
    if (!afterBlock) {
        return (
            'this edit would leave the YAML frontmatter unterminated: the opening "---" ' +
            'survives but the closing "---" is gone, so the whole body would be parsed as ' +
            'frontmatter. Re-read the file and pick an old_str that does not span the ' +
            'closing fence of the frontmatter.'
        );
    }

    // The classic corruption: the closing fence was eaten, so the next "---"
    // further down (a horizontal rule, or the fence of nothing at all) becomes
    // the closing fence and the body in between is swallowed.
    if (hasMarkdownHeading(afterBlock.raw) && !hasMarkdownHeading(beforeBlock.raw)) {
        return (
            'this edit would pull body content (a markdown heading) into the YAML ' +
            'frontmatter block, which means the closing "---" of the frontmatter was ' +
            'consumed. Re-read the file and pick an old_str that does not span it.'
        );
    }

    // Whatever ends up between the fences must still be a YAML mapping.
    let parsed: unknown;
    try {
        parsed = parseYaml(afterBlock.raw);
    } catch (e) {
        return (
            'this edit would leave the YAML frontmatter unparseable ' +
            `(${e instanceof Error ? e.message.split('\n')[0] : String(e)}). ` +
            'That usually means the closing "---" of the frontmatter was consumed and the ' +
            'body leaked into it. Re-read the file and retry with an old_str that does not ' +
            'span the fence.'
        );
    }

    // An empty frontmatter (`---\n---`) parses to null and is legal.
    if (parsed !== null && parsed !== undefined && (typeof parsed !== 'object' || Array.isArray(parsed))) {
        return (
            'this edit would turn the YAML frontmatter into something that is not a ' +
            'key/value block. The closing "---" was most likely consumed. Re-read the file ' +
            'and retry.'
        );
    }

    return null;
}

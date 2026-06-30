import { describe, it, expect } from 'vitest';
import { stripPrunedForCondense } from '../stripPrunedForCondense';
import { PRUNED_MARKER } from '../MicroCompactor';
import type { MessageParam } from '../../../api/types';

/**
 * FIX-COMPACT-05: skeletons must not be re-summarised.
 *
 * Microcompaction replaces oversized tool_result contents with a self-
 * describing skeleton (e.g. "[context-pruned] read_file result (4321
 * chars) was used in an earlier turn..."). When the full-condense pass
 * runs later, these skeletons land in toSummarize and the helper LLM
 * paraphrases them into the summary. Two failure modes:
 *   - token waste (the skeleton is bigger than a placeholder)
 *   - hallucinated findings (summarizer says "the tool dropped data")
 *
 * Fix: BEFORE sending to the helper API, replace the skeleton CONTENT
 * with a one-line placeholder. Tool_use_id and is_error stay intact so
 * the Anthropic pairing contract holds.
 */
describe('stripPrunedForCondense (FIX-COMPACT-05)', () => {
    it('replaces pruned tool_result content with a short placeholder', () => {
        const history: MessageParam[] = [
            { role: 'user', content: 'do thing' },
            {
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: 'tu_1',
                        content: `${PRUNED_MARKER} read_file result (5000 chars) was used in an earlier turn and dropped from context to save space. Starts: "..." Re-read with read_file path=foo.md`,
                    },
                ],
            },
        ];
        const out = stripPrunedForCondense(history);
        const second = out[1];
        expect(Array.isArray(second.content)).toBe(true);
        const block = (second.content as Array<{ type: string; content?: unknown; tool_use_id?: string }>)[0];
        expect(block.type).toBe('tool_result');
        expect(block.tool_use_id).toBe('tu_1');
        // Placeholder is short and does not contain the original skeleton text
        const placeholder = block.content as string;
        expect(placeholder.length).toBeLessThan(80);
        expect(placeholder).not.toContain('5000 chars');
        expect(placeholder).not.toContain('Re-read');
    });

    it('leaves non-pruned tool_result blocks untouched', () => {
        const original = 'L1-L120 of foo.md\nimport bar from "bar";\n';
        const history: MessageParam[] = [
            {
                role: 'user',
                content: [
                    { type: 'tool_result', tool_use_id: 'tu_1', content: original },
                ],
            },
        ];
        const out = stripPrunedForCondense(history);
        const block = (out[0].content as Array<{ content: string }>)[0];
        expect(block.content).toBe(original);
    });

    it('leaves error tool_results untouched (errors stay readable)', () => {
        const errorText = `${PRUNED_MARKER} something`;
        const history: MessageParam[] = [
            {
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: 'tu_1',
                        content: errorText,
                        is_error: true,
                    },
                ],
            },
        ];
        const out = stripPrunedForCondense(history);
        const block = (out[0].content as Array<{ content: string }>)[0];
        // is_error tool_results are kept verbatim by MicroCompactor; we
        // shouldn't second-guess them here either.
        expect(block.content).toBe(errorText);
    });

    it('returns a shallow-copied array (does not mutate input)', () => {
        const history: MessageParam[] = [
            { role: 'user', content: 'a' },
            { role: 'assistant', content: 'b' },
        ];
        const out = stripPrunedForCondense(history);
        expect(out).not.toBe(history);
        // Same references when nothing changed (cheap path)
        expect(out[0]).toBe(history[0]);
    });

    it('keeps tool_use blocks intact (pairing contract)', () => {
        const history: MessageParam[] = [
            {
                role: 'assistant',
                content: [
                    { type: 'tool_use', id: 'tu_1', name: 'read_file', input: { path: 'a.md' } },
                ],
            },
            {
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: 'tu_1',
                        content: `${PRUNED_MARKER} read_file result was dropped`,
                    },
                ],
            },
        ];
        const out = stripPrunedForCondense(history);
        // tool_use must survive byte-identical
        const toolUseBlock = (out[0].content as Array<{ type: string; id?: string }>)[0];
        expect(toolUseBlock.type).toBe('tool_use');
        expect(toolUseBlock.id).toBe('tu_1');
        // tool_result still has the matching tool_use_id
        const toolResultBlock = (out[1].content as Array<{ tool_use_id: string }>)[0];
        expect(toolResultBlock.tool_use_id).toBe('tu_1');
    });
});

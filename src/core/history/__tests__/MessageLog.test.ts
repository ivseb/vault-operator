import { describe, it, expect } from 'vitest';
import { MessageLog } from '../MessageLog';
import type { MessageParam } from '../../../api/types';

/**
 * IMP-41-03-04 / ADR-149: append-only message log with commit points.
 *
 * Replaces the shared-mutable MessageParam[] (in-place push/splice aliased
 * by loop AND sidebar — the root of the boot-race bug class and of
 * unreconstructable condense failures). Rewrites keep the previous
 * generation reachable (bounded to 3) for diagnosis; consumers get
 * materialized copies, never live references.
 */

function msg(role: 'user' | 'assistant', text: string): MessageParam {
    return { role, content: text };
}

describe('MessageLog', () => {
    it('appends and materializes messages in order', () => {
        const log = new MessageLog();
        log.append(msg('user', 'one'));
        log.append(msg('assistant', 'two'));
        expect(log.toMessages().map((m) => m.content)).toEqual(['one', 'two']);
        expect(log.length).toBe(2);
    });

    it('returns copies, not live references (no aliasing)', () => {
        const log = new MessageLog();
        log.append(msg('user', 'original'));
        const view = log.toMessages();
        view.push(msg('user', 'sneaky'));
        (view[0] as { content: string }).content = 'mutated';
        expect(log.toMessages().map((m) => m.content)).toEqual(['original']);
    });

    it('seeds from an existing array without aliasing it', () => {
        const seed = [msg('user', 'a')];
        const log = MessageLog.from(seed);
        seed.push(msg('user', 'b'));
        expect(log.length).toBe(1);
    });

    it('rewriteFromCommit replaces content but keeps the previous generation reachable', () => {
        const log = new MessageLog();
        log.append(msg('user', 'task'));
        log.append(msg('assistant', 'long detail 1'));
        log.append(msg('assistant', 'long detail 2'));
        const commitId = log.commit('pre-condense');

        log.rewriteFromCommit(commitId, [msg('user', 'task'), msg('assistant', '[summary]')], 'condensed');

        expect(log.toMessages().map((m) => m.content)).toEqual(['task', '[summary]']);
        const timeline = log.dumpTimeline();
        expect(timeline.generations).toHaveLength(2);
        expect(timeline.generations[0].label).toBe('pre-condense');
        expect(timeline.generations[0].messages.map((m) => m.content))
            .toEqual(['task', 'long detail 1', 'long detail 2']);
        expect(timeline.generations[1].label).toBe('condensed');
    });

    it('bounds retained generations to 3 (oldest evicted)', () => {
        const log = new MessageLog();
        log.append(msg('user', 'g0'));
        for (let i = 1; i <= 4; i++) {
            const c = log.commit(`gen-${i - 1}`);
            log.rewriteFromCommit(c, [msg('user', `g${i}`)], `rewrite-${i}`);
        }
        const timeline = log.dumpTimeline();
        expect(timeline.generations.length).toBeLessThanOrEqual(3);
        expect(log.toMessages()[0].content).toBe('g4');
    });

    it('supports splice-equivalent removal of trailing orphans', () => {
        const log = new MessageLog();
        log.append(msg('user', 'task'));
        log.append({ role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'read_file', input: {} }] });
        log.removeTrailing((m) =>
            m.role === 'assistant'
            && Array.isArray(m.content)
            && m.content.some((b) => b.type === 'tool_use'));
        expect(log.length).toBe(1);
    });
});

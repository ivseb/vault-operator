/**
 * FIX-03-20-01 regression test
 *
 * A message sent during plugin boot predates ConversationStore init:
 * handleSend created no conversation id, and every later save
 * (onComplete, auto-save, onClose) silently skipped on the missing id.
 * The conversation never reached history despite a complete response.
 *
 * LazyConversationId closes the gap: it creates the id as soon as a
 * store is available, memoizes the in-flight create so concurrent save
 * paths share one id, and resolves immediately when an id already
 * exists.
 */

import { describe, it, expect, vi } from 'vitest';
import { LazyConversationId } from '../LazyConversationId';

function makeStore(): { create: (mode: string, model: string) => Promise<string> } & { create: ReturnType<typeof vi.fn<(mode: string, model: string) => Promise<string>>> } {
    let n = 0;
    return { create: vi.fn<(mode: string, model: string) => Promise<string>>(async () => `conv-${++n}`) };
}

describe('LazyConversationId (FIX-03-20-01)', () => {
    it('returns null while no store is available (nothing to save against)', () => {
        const lazy = new LazyConversationId();
        expect(lazy.ensure(null, null, () => ({ mode: 'agent', model: 'm' }), () => {})).toBeNull();
        expect(lazy.ensure(null, undefined, () => ({ mode: 'agent', model: 'm' }), () => {})).toBeNull();
    });

    it('resolves the existing id without creating a new one', async () => {
        const lazy = new LazyConversationId();
        const store = makeStore();
        const id = await lazy.ensure('conv-existing', store, () => ({ mode: 'agent', model: 'm' }), () => {});
        expect(id).toBe('conv-existing');
        expect(store.create).not.toHaveBeenCalled();
    });

    it('creates the id lazily once the store becomes available and assigns it', async () => {
        const lazy = new LazyConversationId();
        const store = makeStore();
        let assigned: string | null = null;
        const id = await lazy.ensure(null, store, () => ({ mode: 'agent', model: 'sonnet' }), (v) => { assigned = v; });
        expect(id).toBe('conv-1');
        expect(assigned).toBe('conv-1');
        expect(store.create).toHaveBeenCalledWith('agent', 'sonnet');
    });

    it('memoizes the in-flight create: concurrent save paths share ONE id', async () => {
        const lazy = new LazyConversationId();
        const store = makeStore();
        const [a, b, c] = await Promise.all([
            lazy.ensure(null, store, () => ({ mode: 'agent', model: 'm' }), () => {}),
            lazy.ensure(null, store, () => ({ mode: 'agent', model: 'm' }), () => {}),
            lazy.ensure(null, store, () => ({ mode: 'agent', model: 'm' }), () => {}),
        ]);
        expect(a).toBe('conv-1');
        expect(b).toBe('conv-1');
        expect(c).toBe('conv-1');
        expect(store.create).toHaveBeenCalledTimes(1);
    });

    it('reset() clears the memo for a fresh chat', async () => {
        const lazy = new LazyConversationId();
        const store = makeStore();
        await lazy.ensure(null, store, () => ({ mode: 'agent', model: 'm' }), () => {});
        lazy.reset();
        const id = await lazy.ensure(null, store, () => ({ mode: 'agent', model: 'm' }), () => {});
        expect(id).toBe('conv-2');
        expect(store.create).toHaveBeenCalledTimes(2);
    });
});

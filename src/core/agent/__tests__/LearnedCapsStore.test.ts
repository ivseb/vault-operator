import { describe, it, expect, beforeEach } from 'vitest';
import { LearnedCapsStore, LEARNED_CAPS_FILE } from '../LearnedCapsStore';
import { resolveOutputBudget, setLearnedOutputCaps } from '../../../types/model-registry';

function memFs() {
    const files = new Map<string, string>();
    return {
        files,
        exists: (p: string) => Promise.resolve(files.has(p)),
        read: (p: string) => {
            const c = files.get(p);
            return c === undefined ? Promise.reject(new Error('missing')) : Promise.resolve(c);
        },
        write: (p: string, c: string) => { files.set(p, c); return Promise.resolve(); },
    };
}

describe('LearnedCapsStore (ADR-148)', () => {
    beforeEach(() => setLearnedOutputCaps({}));

    it('learns a cap, persists it, and clamps resolveOutputBudget across decorated ids', async () => {
        const fs = memFs();
        const store = new LearnedCapsStore(fs);
        await store.load();
        await store.learnCap('global.anthropic.claude-sonnet-9', 12_000);

        expect(store.getCap('claude-sonnet-9')).toBe(12_000);
        expect(fs.files.has(LEARNED_CAPS_FILE)).toBe(true);
        expect(resolveOutputBudget('eu.anthropic.claude-sonnet-9-v1:0', undefined).maxTokens).toBe(12_000);
    });

    it('only ever lowers a cap and floors at 4096', async () => {
        const store = new LearnedCapsStore(memFs());
        await store.load();
        await store.learnCap('m1', 10_000);
        await store.learnCap('m1', 20_000); // attempt to raise -> ignored
        expect(store.getCap('m1')).toBe(10_000);
        await store.learnCap('m1', 100);    // below floor -> floored
        expect(store.getCap('m1')).toBe(4_096);
    });

    it('reloads persisted caps on boot and re-injects them', async () => {
        const fs = memFs();
        const first = new LearnedCapsStore(fs);
        await first.load();
        await first.learnCap('claude-sonnet-9', 8_192);
        setLearnedOutputCaps({}); // simulate fresh process

        const second = new LearnedCapsStore(fs);
        await second.load();
        expect(second.getCap('claude-sonnet-9')).toBe(8_192);
        expect(resolveOutputBudget('claude-sonnet-9', undefined).maxTokens).toBe(8_192);
    });

    it('survives a corrupt file', async () => {
        const fs = memFs();
        fs.files.set(LEARNED_CAPS_FILE, '{not json');
        const store = new LearnedCapsStore(fs);
        await store.load();
        expect(store.getCap('anything')).toBeUndefined();
    });
});

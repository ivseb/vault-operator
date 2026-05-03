/**
 * AUDIT-015 Eval-Coverage: recallMemory MCP-Handler.
 */

import { describe, it, expect } from 'vitest';
import { handleRecallMemory } from '../recallMemory';
import type ObsidianAgentPlugin from '../../../main';

function plugin(open: boolean) {
    return {
        memoryDB: { isOpen: () => open },
    } as unknown as ObsidianAgentPlugin;
}

describe('handleRecallMemory (AUDIT-015 Eval-Coverage)', () => {
    it('rejects empty query', async () => {
        const r = await handleRecallMemory(plugin(true), { query: '   ' });
        expect(r.isError).toBe(true);
    });

    it('reports memory DB not available when closed', async () => {
        const r = await handleRecallMemory(plugin(false), { query: 'x' });
        expect(r.isError).toBe(true);
        expect(r.content[0].text).toMatch(/not available/i);
    });
});

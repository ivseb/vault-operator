import { describe, it, expect, vi } from 'vitest';
import {
    createChatBlock,
    appendTurn,
    serializeChatBlock,
    parseChatBlockBody,
    extractChatBlocks,
    MAX_TURNS_PER_BLOCK,
    FENCE_LANG,
    FENCE_OPEN,
} from '../InlineChatBlock';
import { InlineChatAction, type NoteWriter } from '../InlineChatAction';
import type { InlineTriggerContext } from '../../InlineTriggerContext';
import type { InlineLLMCaller, InlineLLMStreamCallbacks } from '../../InlineLLMCaller';

describe('InlineChatBlock', () => {
    it('createChatBlock starts with empty turns', () => {
        const b = createChatBlock({ id: 'ic-1', selection_anchor: 'foo', model: 'm', created: 't' });
        expect(b.turns).toEqual([]);
        expect(b.selection_anchor).toBe('foo');
    });

    it('appendTurn returns a new block, original untouched', () => {
        const a = createChatBlock({ id: 'ic-1', selection_anchor: 'x', model: 'm', created: 't' });
        const b = appendTurn(a, { role: 'user', content: 'hi', at: 't' });
        expect(a.turns).toHaveLength(0);
        expect(b.turns).toHaveLength(1);
    });

    it('appendTurn enforces MAX_TURNS_PER_BLOCK cap (keeps newest)', () => {
        let block = createChatBlock({ id: 'ic-1', selection_anchor: 'x', model: 'm', created: 't' });
        for (let i = 0; i < MAX_TURNS_PER_BLOCK + 5; i += 1) {
            block = appendTurn(block, { role: 'user', content: `msg-${i}`, at: 't' });
        }
        expect(block.turns).toHaveLength(MAX_TURNS_PER_BLOCK);
        expect(block.turns[MAX_TURNS_PER_BLOCK - 1].content).toBe(`msg-${MAX_TURNS_PER_BLOCK + 4}`);
    });

    it('serializes to a vault-operator-chat-v1 fence', () => {
        const b = createChatBlock({ id: 'ic-1', selection_anchor: 'x', model: 'm', created: 't' });
        const out = serializeChatBlock(b);
        expect(out.startsWith(FENCE_OPEN)).toBe(true);
        expect(out).toContain(FENCE_LANG);
        expect(out).toContain('"id": "ic-1"');
    });

    it('serialize roundtrip via parseChatBlockBody', () => {
        const original = createChatBlock({ id: 'ic-9', selection_anchor: 'abc', model: 'opus', created: '2026-06-22T10:00:00Z' });
        const withTurn = appendTurn(original, { role: 'user', content: 'hello', at: '2026-06-22T10:00:01Z' });
        const serialized = serializeChatBlock(withTurn);
        // Strip fences for parseChatBlockBody.
        const body = serialized.slice(FENCE_OPEN.length + 1).replace(/\n```\n?$/, '');
        const parsed = parseChatBlockBody(body);
        expect(parsed).not.toBeNull();
        expect(parsed?.id).toBe('ic-9');
        expect(parsed?.turns).toHaveLength(1);
    });

    it('parseChatBlockBody rejects malformed JSON', () => {
        expect(parseChatBlockBody('{not json')).toBeNull();
    });

    it('parseChatBlockBody rejects wrong shape', () => {
        expect(parseChatBlockBody(JSON.stringify({ id: 1 }))).toBeNull();
        expect(parseChatBlockBody(JSON.stringify({ id: 'x', selection_anchor: 'y', model: 'm', created: 't', turns: [{ role: 'invalid', content: 'x', at: 't' }] }))).toBeNull();
    });

    it('extractChatBlocks finds multiple fences in a note', () => {
        const note = [
            '# Some note',
            'Plain text.',
            serializeChatBlock(createChatBlock({ id: 'ic-1', selection_anchor: 'a', model: 'm', created: 't' })),
            'More text.',
            serializeChatBlock(createChatBlock({ id: 'ic-2', selection_anchor: 'b', model: 'm', created: 't' })),
            'End.',
        ].join('\n');
        const blocks = extractChatBlocks(note);
        expect(blocks).toHaveLength(2);
        expect(blocks.map(b => b.id)).toEqual(['ic-1', 'ic-2']);
    });

    it('extractChatBlocks ignores fenced blocks with wrong language tag', () => {
        const note = '```javascript\nnot a chat block\n```';
        expect(extractChatBlocks(note)).toEqual([]);
    });
});

describe('InlineChatAction', () => {
    function makeCtx(text = 'selected', overrides: Partial<InlineTriggerContext> = {}): InlineTriggerContext {
        return {
            selectionText: text,
            editorMode: 'source',
            cursorPos: 100,
            notePath: 'Notes/foo.md',
            settingsSnapshot: { modelId: 'opus', provider: 'anthropic', skillIds: [], customPromptIds: [] },
            ...overrides,
        };
    }
    function makeCb() { return { onText: vi.fn(), onToolStart: vi.fn(), onToolResult: vi.fn(), onComplete: vi.fn(), onError: vi.fn() } as any; }
    function makeWriter(): NoteWriter & { insertAtCursor: ReturnType<typeof vi.fn> } {
        return { insertAtCursor: vi.fn(async () => {}) } as any;
    }
    function makeCaller(answer: string): InlineLLMCaller {
        return {
            stream: vi.fn(async (_args, cbs: InlineLLMStreamCallbacks) => {
                cbs.onText(answer);
                cbs.onComplete();
            }),
        } as any;
    }

    it('eligible in source/live-preview, not in reading', () => {
        const a = new InlineChatAction({ caller: makeCaller('x'), writer: makeWriter() });
        expect(a.isEligible(makeCtx())).toBe(true);
        expect(a.isEligible(makeCtx('x', { editorMode: 'reading' }))).toBe(false);
    });

    it('writes the chat fence after the initial response', async () => {
        const writer = makeWriter();
        const caller = makeCaller('Sure, here is what I think.');
        const action = new InlineChatAction({
            caller,
            writer,
            now: () => '2026-06-22T10:00:00Z',
            nextId: () => 'ic-test',
        });
        const cb = makeCb();
        await action.execute(makeCtx('lambda calculus'), cb);
        expect(writer.insertAtCursor).toHaveBeenCalledTimes(1);
        const args = writer.insertAtCursor.mock.calls[0][0];
        expect(args.notePath).toBe('Notes/foo.md');
        expect(args.cursorPos).toBe(100);
        expect(args.text).toContain(FENCE_OPEN);
        expect(args.text).toContain('"id": "ic-test"');
        expect(args.text).toContain('"selection_anchor": "lambda calculus"');
        expect(args.text).toContain('"role": "user"');
        expect(args.text).toContain('"role": "assistant"');
        expect(args.text).toContain('Sure, here is what I think.');
        expect(cb.onComplete).toHaveBeenCalledTimes(1);
    });

    it('routes writer errors to onError', async () => {
        const writer: NoteWriter = { insertAtCursor: async () => { throw new Error('write-fail'); } };
        const caller = makeCaller('hello');
        const action = new InlineChatAction({ caller, writer, now: () => 't', nextId: () => 'ic-x' });
        const cb = makeCb();
        await action.execute(makeCtx(), cb);
        expect(cb.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'write-fail' }));
    });
});

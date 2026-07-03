import { describe, it, expect, vi } from 'vitest';
import { AnthropicProvider } from '../providers/anthropic';
import { OpenAiProvider } from '../providers/openai';
import type { LLMProvider } from '../../types/settings';
import type { MessageParam } from '../types';
import type { ToolDefinition } from '../../core/tools/types';

/**
 * IMP-41-03-03 / ADR-150: wire-format golden files.
 *
 * BINDING precondition for the adapter extraction: these snapshots pin the
 * EXACT request payload each provider sends today, across the fixture axes
 * text / tools+cache / vision / thinking-passback. The extraction must
 * reproduce every payload byte-identically (vitest snapshot mismatch =
 * regression). Update a snapshot only with a commit that explains the
 * intentional wire change (Pflege-Regel in ADR-150).
 */

const FIXTURE_TOOLS: ToolDefinition[] = [
    {
        name: 'read_file',
        description: 'Read a file from the vault',
        input_schema: {
            type: 'object' as const,
            properties: { path: { type: 'string', description: 'Vault-relative path' } },
            required: ['path'],
        },
    } as ToolDefinition,
    {
        name: 'attempt_completion',
        description: 'Present the final result',
        input_schema: {
            type: 'object' as const,
            properties: { result: { type: 'string' } },
            required: ['result'],
        },
    } as ToolDefinition,
];

const TEXT_HISTORY: MessageParam[] = [
    { role: 'user', content: 'Summarize the vault structure.' },
    { role: 'assistant', content: 'It has three top folders.' },
    { role: 'user', content: 'Go deeper on the second one.' },
];

const TOOL_HISTORY: MessageParam[] = [
    { role: 'user', content: 'Read the readme.' },
    {
        role: 'assistant',
        content: [
            { type: 'text', text: 'Reading it now.' },
            { type: 'tool_use', id: 'tu-1', name: 'read_file', input: { path: 'README.md' } },
        ],
    },
    {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: '# Readme\nHello world' }],
    },
];

const VISION_HISTORY: MessageParam[] = [
    {
        role: 'user',
        content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aWNvbg==' } },
        ],
    },
];

const THINKING_HISTORY: MessageParam[] = [
    { role: 'user', content: 'Solve the puzzle.' },
    {
        role: 'assistant',
        content: [
            { type: 'thinking', text: 'signed reasoning', signature: 'sig-abc' },
            { type: 'tool_use', id: 'tu-2', name: 'read_file', input: { path: 'puzzle.md' } },
        ],
    },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-2', content: 'clue text' }] },
];

describe('wire format golden: anthropic', () => {
    function capture(config: Partial<LLMProvider>): { provider: AnthropicProvider; requests: unknown[] } {
        const provider = new AnthropicProvider({
            id: 'g', name: 'G', type: 'anthropic', apiKey: 'sk-test',
            model: 'claude-sonnet-4-5', maxTokens: 4096, temperature: 0.2,
            ...config,
        } as LLMProvider);
        const requests: unknown[] = [];
        (provider as unknown as { client: { messages: { stream: unknown } } }).client.messages.stream =
            vi.fn((req: unknown) => { requests.push(req); return (async function* () { /* empty */ })(); });
        return { provider, requests };
    }

    async function drain(p: AnthropicProvider, history: MessageParam[], tools: ToolDefinition[]): Promise<void> {
        for await (const _ of p.createMessage('SYSTEM PROMPT', history, tools)) { /* drain */ }
    }

    it('text-only request', async () => {
        const { provider, requests } = capture({});
        await drain(provider, TEXT_HISTORY, []);
        expect(requests[0]).toMatchSnapshot();
    });

    it('tools with prompt caching markers', async () => {
        const { provider, requests } = capture({ promptCachingEnabled: true });
        await drain(provider, TOOL_HISTORY, FIXTURE_TOOLS);
        expect(requests[0]).toMatchSnapshot();
    });

    it('vision blocks', async () => {
        const { provider, requests } = capture({});
        await drain(provider, VISION_HISTORY, []);
        expect(requests[0]).toMatchSnapshot();
    });

    it('signed thinking passback with thinking enabled', async () => {
        const { provider, requests } = capture({ thinkingEnabled: true, thinkingBudgetTokens: 2048 });
        await drain(provider, THINKING_HISTORY, FIXTURE_TOOLS);
        expect(requests[0]).toMatchSnapshot();
    });
});

describe('wire format golden: openai-shape', () => {
    function capture(config: Partial<LLMProvider>): { provider: OpenAiProvider; requests: unknown[] } {
        const provider = new OpenAiProvider({
            id: 'g', name: 'G', type: 'openai', apiKey: 'sk-test',
            model: 'gpt-4o', maxTokens: 4096, temperature: 0.2,
            ...config,
        } as LLMProvider);
        const requests: unknown[] = [];
        (provider as unknown as { client: { chat: { completions: { create: unknown } } } })
            .client.chat.completions.create =
            vi.fn((req: unknown) => { requests.push(req); return (async function* () { /* empty */ })(); });
        return { provider, requests };
    }

    async function drain(p: OpenAiProvider, history: MessageParam[], tools: ToolDefinition[]): Promise<void> {
        for await (const _ of p.createMessage('SYSTEM PROMPT', history, tools)) { /* drain */ }
    }

    it('text-only request', async () => {
        const { provider, requests } = capture({});
        await drain(provider, TEXT_HISTORY, []);
        expect(requests[0]).toMatchSnapshot();
    });

    it('tool history round trip', async () => {
        const { provider, requests } = capture({});
        await drain(provider, TOOL_HISTORY, FIXTURE_TOOLS);
        expect(requests[0]).toMatchSnapshot();
    });

    it('vision blocks as image_url parts', async () => {
        const { provider, requests } = capture({});
        await drain(provider, VISION_HISTORY, []);
        expect(requests[0]).toMatchSnapshot();
    });

    it('gpt-5 drops temperature and uses max_completion_tokens', async () => {
        const { provider, requests } = capture({ model: 'gpt-5' });
        await drain(provider, TEXT_HISTORY, []);
        expect(requests[0]).toMatchSnapshot();
    });
});

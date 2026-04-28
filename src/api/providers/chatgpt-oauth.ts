/**
 * ChatGptOAuthProvider -- LLM provider for ChatGPT OAuth (Subscription) backend.
 *
 * Talks to chatgpt.com/backend-api/codex via the OpenAI SDK with a custom
 * fetch wrapper that injects Bearer token + chatgpt-account-id header. The
 * underlying API is the Responses API used by Codex CLI; we send chat-style
 * requests via the SDK. If the backend rejects the chat shape, the
 * post-login smoke test surfaces the error and we adjust.
 *
 * Schema as observed 2026-04-28 in codex-cli 0.21.x and opencode.
 *
 * @see ADR-088 (Provider Architecture)
 * @see FEATURE-021-002 (Codex Responses-API Handler)
 */

import OpenAI from 'openai';
import type { LLMProvider } from '../../types/settings';
import type { ApiHandler, ApiStream, ApiStreamChunk, MessageParam, ModelInfo } from '../types';
import type { ToolDefinition } from '../../core/tools/types';
import { ChatGptOAuthService } from '../../core/auth/ChatGptOAuthService';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** ChatGPT Codex backend base URL. */
const CHATGPT_CODEX_BASE = 'https://chatgpt.com/backend-api/codex';

/** Required headers for every Codex backend call. Schema as observed 2026-04-28. */
const CODEX_HEADERS: Record<string, string> = {
    'OpenAI-Beta': 'responses=experimental',
    'User-Agent': 'Obsilo/Agent',
};

/** Known Codex models with context windows. Hardcoded per ADR-088. */
const KNOWN_MODELS: Record<string, ModelInfo> = {
    'gpt-5-codex': { contextWindow: 200_000, supportsTools: true, supportsStreaming: true },
    'gpt-5-codex-mini': { contextWindow: 200_000, supportsTools: true, supportsStreaming: true },
};

const DEFAULT_MODEL_INFO: ModelInfo = {
    contextWindow: 200_000,
    supportsTools: true,
    supportsStreaming: true,
};

// ---------------------------------------------------------------------------
// REST API types (subset, mirrors github-copilot.ts)
// ---------------------------------------------------------------------------

interface OpenAIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: OpenAIToolCall[];
    tool_call_id?: string;
    name?: string;
}

interface OpenAIToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

interface OpenAITool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

interface ToolCallAccumulator {
    id: string;
    name: string;
    argumentsJson: string;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class ChatGptOAuthProvider implements ApiHandler {
    private config: LLMProvider;
    private client: OpenAI;
    private auth: ChatGptOAuthService;

    constructor(config: LLMProvider) {
        this.config = config;
        this.auth = ChatGptOAuthService.getInstance();

        this.client = new OpenAI({
            apiKey: 'chatgpt-oauth', // Placeholder, real auth via custom fetch
            baseURL: CHATGPT_CODEX_BASE,
            dangerouslyAllowBrowser: true,
            fetch: this.buildAuthFetch(),
        });
    }

    getModel(): { id: string; info: ModelInfo } {
        const info = KNOWN_MODELS[this.config.model] ?? DEFAULT_MODEL_INFO;
        return { id: this.config.model, info };
    }

    async *createMessage(
        systemPrompt: string,
        messages: MessageParam[],
        tools: ToolDefinition[],
        abortSignal?: AbortSignal,
    ): ApiStream {
        const openAiMessages = this.convertMessages(systemPrompt, messages);
        const openAiTools = tools.length > 0 ? this.convertTools(tools) : undefined;

        const requestBody: Record<string, unknown> = {
            model: this.config.model,
            messages: openAiMessages,
            tools: openAiTools,
            stream: true,
            stream_options: { include_usage: true },
            max_completion_tokens: this.config.maxTokens ?? 8192,
        };
        if (openAiTools && openAiTools.length > 0) {
            requestBody.tool_choice = 'auto';
        }
        if (this.config.temperature !== undefined) {
            requestBody.temperature = Math.min(this.config.temperature, 2.0);
        }

        const createParams = requestBody as unknown as OpenAI.ChatCompletionCreateParamsStreaming;

        let stream: AsyncIterable<OpenAI.ChatCompletionChunk>;
        try {
            stream = await this.client.chat.completions.create(createParams, {
                signal: abortSignal ?? null,
            });
        } catch (e) {
            if (this.is401Error(e)) {
                this.auth.invalidateAccessToken();
                stream = await this.client.chat.completions.create(createParams, {
                    signal: abortSignal ?? null,
                });
            } else {
                throw this.enhanceError(e);
            }
        }

        const accumulators = new Map<number, ToolCallAccumulator>();

        for await (const chunk of stream) {
            if (chunk.usage) {
                yield {
                    type: 'usage',
                    inputTokens: chunk.usage.prompt_tokens,
                    outputTokens: chunk.usage.completion_tokens,
                } satisfies ApiStreamChunk;
            }

            const choice = chunk.choices?.[0];
            if (!choice) continue;
            const delta = choice.delta;

            const text = normalizeContent((delta as Record<string, unknown>)?.content);
            if (text) {
                yield { type: 'text', text } satisfies ApiStreamChunk;
            }

            if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                    const idx = tc.index;
                    if (!accumulators.has(idx)) {
                        accumulators.set(idx, { id: '', name: '', argumentsJson: '' });
                    }
                    const acc = accumulators.get(idx)!;
                    if (tc.id) acc.id = tc.id;
                    if (tc.function?.name) acc.name += tc.function.name;
                    if (tc.function?.arguments) acc.argumentsJson += tc.function.arguments;
                }
            }

            if (choice.finish_reason === 'tool_calls') {
                yield* this.flushToolCallAccumulators(accumulators);
            }
        }

        if (accumulators.size > 0) {
            yield* this.flushToolCallAccumulators(accumulators);
        }
    }

    private *flushToolCallAccumulators(
        accumulators: Map<number, ToolCallAccumulator>,
    ): Generator<ApiStreamChunk> {
        for (const [, acc] of accumulators) {
            if (!acc.id || !acc.name) {
                console.warn(
                    `[ChatGptOAuth] Skipping incomplete tool_call: id="${acc.id}", name="${acc.name}"`,
                );
                continue;
            }
            let input: Record<string, unknown> = {};
            try {
                input = acc.argumentsJson.trim() ? JSON.parse(acc.argumentsJson) : {};
            } catch (e) {
                yield {
                    type: 'text',
                    text: `[Tool input parse error for "${acc.name}": ${(e as Error).message}]`,
                } satisfies ApiStreamChunk;
                continue;
            }
            yield { type: 'tool_use', id: acc.id, name: acc.name, input } satisfies ApiStreamChunk;
        }
        accumulators.clear();
    }

    async classifyText(prompt: string, abortSignal?: AbortSignal): Promise<string> {
        const response = await this.client.chat.completions.create({
            model: this.config.model,
            max_completion_tokens: 50,
            messages: [{ role: 'user', content: prompt }],
        }, { signal: abortSignal ?? undefined });

        return response.choices?.[0]?.message?.content?.trim() ?? '';
    }

    // ---------------------------------------------------------------------------
    // Auth-aware fetch wrapper
    // ---------------------------------------------------------------------------

    private buildAuthFetch(): typeof globalThis.fetch {
        return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const token = await this.auth.getValidAccessToken();
            const accountId = this.auth.getAccountId();

            const headers = new Headers(init?.headers);
            headers.set('Authorization', `Bearer ${token}`);
            if (accountId) headers.set('chatgpt-account-id', accountId);
            for (const [k, v] of Object.entries(CODEX_HEADERS)) {
                if (!headers.has(k)) headers.set(k, v);
            }

            return globalThis.fetch(input, { ...init, headers });
        };
    }

    // ---------------------------------------------------------------------------
    // Format conversion (mirrors github-copilot.ts)
    // ---------------------------------------------------------------------------

    private convertMessages(systemPrompt: string, messages: MessageParam[]): OpenAIMessage[] {
        const result: OpenAIMessage[] = [{ role: 'system', content: systemPrompt }];

        for (const msg of messages) {
            if (typeof msg.content === 'string') {
                result.push({ role: msg.role, content: msg.content });
                continue;
            }

            const blocks = msg.content;

            if (msg.role === 'assistant') {
                const textParts = blocks
                    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
                    .map((b) => b.text)
                    .join('');

                const toolUseParts = blocks.filter(
                    (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
                        b.type === 'tool_use',
                );

                if (toolUseParts.length > 0) {
                    result.push({
                        role: 'assistant',
                        content: textParts || null,
                        tool_calls: toolUseParts.map((b) => ({
                            id: b.id,
                            type: 'function',
                            function: { name: b.name, arguments: JSON.stringify(b.input) },
                        })),
                    });
                } else {
                    result.push({ role: 'assistant', content: textParts });
                }
            } else {
                for (const block of blocks) {
                    if (block.type === 'text') {
                        result.push({ role: 'user', content: block.text });
                    } else if (block.type === 'tool_result') {
                        const textContent = typeof block.content === 'string'
                            ? block.content
                            : block.content
                                .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
                                .map((b) => b.text)
                                .join('\n');
                        result.push({
                            role: 'tool',
                            tool_call_id: block.tool_use_id,
                            content: textContent,
                        });
                    }
                }
            }
        }

        return result;
    }

    private convertTools(tools: ToolDefinition[]): OpenAITool[] {
        return tools.map((tool) => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.input_schema,
            },
        }));
    }

    // ---------------------------------------------------------------------------
    // Error handling
    // ---------------------------------------------------------------------------

    private is401Error(e: unknown): boolean {
        return e instanceof OpenAI.APIError && e.status === 401;
    }

    private enhanceError(e: unknown): Error {
        if (!(e instanceof OpenAI.APIError)) {
            return e instanceof Error ? e : new Error(String(e));
        }
        switch (e.status) {
            case 401:
                return new Error('ChatGPT authentication failed. Please sign in again in Provider settings.');
            case 403:
                return new Error('No active ChatGPT Plus or Pro subscription, or this model is not enabled for your plan.');
            case 429:
                return new Error('ChatGPT rate limit reached. Please wait a moment and retry.');
            case 400:
                return new Error(`ChatGPT request error: ${e.message}. The Codex backend schema may have changed; check for a plugin update.`);
            default:
                return new Error(`ChatGPT API error (${e.status}): ${e.message}`);
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize delta.content for streams that send arrays instead of strings. */
function normalizeContent(content: unknown): string | null {
    if (content == null) return null;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        const text = content
            .filter((c): c is { type: string; text: string } =>
                c != null && typeof c === 'object' && 'text' in c && typeof c.text === 'string')
            .map((c) => c.text)
            .join('');
        return text || null;
    }
    return null;
}

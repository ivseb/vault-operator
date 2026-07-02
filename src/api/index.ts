/**
 * API Handler Factory
 *
 * Adapted from Kilo Code's src/api/index.ts (buildApiHandler)
 */

import type { LLMProvider, CustomModel } from '../types/settings';
import { modelToLLMProvider } from '../types/settings';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAiProvider } from './providers/openai';
import { GitHubCopilotProvider } from './providers/github-copilot';
import { KiloGatewayProvider } from './providers/kilo-gateway';
import { BedrockProvider } from './providers/bedrock';
import { ChatGptOAuthProvider } from './providers/chatgpt-oauth';
import type { ApiHandler, ApiStream, MessageParam } from './types';
import type { ToolDefinition } from '../core/tools/types';
import { RequestRateLimiter, requestRateLimiter } from './RequestRateLimiter';

export type { ApiHandler, ApiStream, ApiStreamChunk, MessageParam, ContentBlock, ModelInfo } from './types';

/** Local inference has no provider-side rate limits — never wrapped. */
const UNLIMITED_PROVIDER_TYPES = new Set(['ollama', 'lmstudio']);

/**
 * IMP-41-02-03 / ADR-146: decorate createMessage with the token bucket so
 * EVERY call site (main loop, condensing helper, subtasks, FastPath
 * planners) passes through. The provider classes themselves stay
 * resilience-free.
 */
export function withRateLimit(
    handler: ApiHandler,
    providerType: string,
    limiter: RequestRateLimiter = requestRateLimiter,
): ApiHandler {
    const wrapped: ApiHandler = Object.create(handler) as ApiHandler;
    wrapped.createMessage = function (
        systemPrompt: string,
        messages: MessageParam[],
        tools: ToolDefinition[],
        abortSignal?: AbortSignal,
    ): ApiStream {
        return (async function* () {
            await limiter.acquire(providerType, handler.getModel().id, abortSignal);
            yield* handler.createMessage(systemPrompt, messages, tools, abortSignal);
        })();
    };
    return wrapped;
}

/**
 * Build an ApiHandler from a CustomModel (new path)
 */
export function buildApiHandlerForModel(model: CustomModel) {
    return buildApiHandler(modelToLLMProvider(model));
}

/**
 * Build an ApiHandler from a LLMProvider config (legacy / internal path)
 */
export function buildApiHandler(config: LLMProvider) {
    const providerType = config.type;
    const handler = ((): ApiHandler => {
        switch (providerType) {
            case 'anthropic':
                return new AnthropicProvider(config);
            case 'github-copilot':
                return new GitHubCopilotProvider(config);
            case 'kilo-gateway':
                return new KiloGatewayProvider(config);
            case 'bedrock':
                return new BedrockProvider(config);
            case 'chatgpt-oauth':
                return new ChatGptOAuthProvider(config);
            case 'openai':
            case 'gemini':
            case 'ollama':
            case 'lmstudio':
            case 'openrouter':
            case 'azure':
            case 'custom':
                return new OpenAiProvider(config);
            default: {
                const _exhaustive: never = providerType;
                throw new Error(`Unknown provider type: ${String(_exhaustive)}`);
            }
        }
    })();
    // IMP-41-02-03: every non-local handler passes the shared token bucket.
    // Unconfigured keys resolve instantly, so this is a no-op until a rate
    // is set (rateLimitMs mapping or future per-provider settings).
    handler.providerType = providerType;
    if (UNLIMITED_PROVIDER_TYPES.has(providerType)) return handler;
    const wrapped = withRateLimit(handler, providerType);
    wrapped.providerType = providerType;
    return wrapped;
}

/**
 * OpenAI-Responses wire adapter (IMP-41-03-03, ADR-150).
 *
 * Owns the Responses-API wire format used by the chatgpt-oauth (Codex)
 * provider: message/tool conversion (incl. the FIX-04-03-11 input_image
 * mapping) and the complete request-body construction with the GPT-5
 * reasoning-floor quirks. The provider keeps auth (OAuth token/account),
 * the Node-https transport and SSE parsing of its bespoke backend.
 */

import type { LLMProvider } from '../../types/settings';
import type { MessageParam } from '../types';
import type { ToolDefinition } from '../../core/tools/types';
import { modelSupportsTemperature } from '../../types/model-registry';

// ---------------------------------------------------------------------------
// Responses API types (observed 2026-04-28)
// ---------------------------------------------------------------------------

export interface ResponsesInputMessage {
    type: 'message';
    role: 'user' | 'assistant' | 'system';
    content: ResponsesContentBlock[];
}

export interface ResponsesFunctionCallOutput {
    type: 'function_call_output';
    call_id: string;
    output: string;
}

export interface ResponsesFunctionCall {
    type: 'function_call';
    call_id: string;
    name: string;
    arguments: string;
}

export type ResponsesInputItem = ResponsesInputMessage | ResponsesFunctionCallOutput | ResponsesFunctionCall;

export type ResponsesContentBlock =
    | { type: 'input_text'; text: string }
    | { type: 'output_text'; text: string }
    // FIX-04-03-11: Responses API image input. detail defaults to 'auto' so
    // the upload tokens stay bounded for OCR-style screenshots.
    | { type: 'input_image'; image_url: string; detail?: 'auto' | 'low' | 'high' };

export interface ResponsesTool {
    type: 'function';
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

/** The GPT-5 / o-series effort levels accepted on the Codex Responses surface. */
const GPT_EFFORT_LEVELS: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high'];

/**
 * Resolve the reasoning effort to send. The configured level may be a wider
 * EffortLevel (Claude has xhigh/max) so only a GPT-valid level is forwarded;
 * anything else (unset, or a Claude-only level) falls back to the documented
 * 'low' 400-avoidance floor. An explicit GPT-valid value overrides the floor.
 */
export function resolveGptEffort(level: string | undefined): ReasoningEffort {
    return GPT_EFFORT_LEVELS.find((valid) => valid === level) ?? 'low';
}

export interface ResponsesRequestBody {
    model: string;
    instructions?: string;
    input: ResponsesInputItem[];
    tools?: ResponsesTool[];
    stream: true;
    parallel_tool_calls?: boolean;
    store?: boolean;
    /** Required for GPT-5* models on the Codex backend; omitting it yields HTTP 400. */
    reasoning?: { effort: ReasoningEffort; summary?: 'auto' };
    include?: string[];
    [extra: string]: unknown;
}

/**
 * GPT-5* are reasoning models; the chatgpt.com Codex backend rejects requests
 * for them with HTTP 400 when the `reasoning` field is missing. "low" is the
 * narrowest effort accepted by both `gpt-5` (minimal/low/medium/high) and the
 * stricter codex variants (low/medium/high), so it is the safe default for
 * connection tests and short calls. Verified against
 * forked-kilocode/packages/types/src/providers/openai-codex.ts (supportsReasoningEffort matrix).
 */
export function isGpt5Family(modelId: string): boolean {
    return /^gpt-5(\b|[.-])/i.test(modelId);
}

/** Convert internal MessageParam[] to Responses input items. */
export function convertToResponsesInput(messages: MessageParam[]): ResponsesInputItem[] {
    const result: ResponsesInputItem[] = [];

    for (const msg of messages) {
        if (typeof msg.content === 'string') {
            result.push({
                type: 'message',
                role: msg.role,
                content: [
                    msg.role === 'assistant'
                        ? { type: 'output_text', text: msg.content }
                        : { type: 'input_text', text: msg.content },
                ],
            });
            continue;
        }

        const blocks = msg.content;

        if (msg.role === 'assistant') {
            // FIX-04-03-07: thinking blocks (DeepSeek-style reasoning) are
            // dropped here -- ChatGPT-OAuth uses the Responses API with
            // encrypted reasoning summaries, not a plaintext echo field.
            const textParts = blocks
                .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
                .map((b) => b.text)
                .join('');
            if (textParts) {
                result.push({
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: textParts }],
                });
            }
            for (const block of blocks) {
                if (block.type === 'tool_use') {
                    result.push({
                        type: 'function_call',
                        call_id: block.id,
                        name: block.name,
                        arguments: JSON.stringify(block.input),
                    });
                }
            }
        } else {
            // FIX-04-03-11: pre-fix this branch handled only text and
            // tool_result blocks; image blocks were silently dropped, so
            // GPT-5 / o-series vision through the Codex Responses path
            // saw text only and answered "I don't see an image". Same
            // class as FIX-04-03-09 (which fixed the openai / copilot /
            // kilo OpenAI-Chat-Completions shape). The Responses API
            // expects { type: 'input_image', image_url: data:... } on a
            // user message content array.
            const textParts: string[] = [];
            const userContent: ResponsesContentBlock[] = [];
            for (const block of blocks) {
                if (block.type === 'text') {
                    textParts.push(block.text);
                } else if (block.type === 'image') {
                    userContent.push({
                        type: 'input_image',
                        image_url: `data:${block.source.media_type};base64,${block.source.data}`,
                    });
                } else if (block.type === 'tool_result') {
                    const text = typeof block.content === 'string'
                        ? block.content
                        : block.content
                            .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
                            .map((b) => b.text)
                            .join('\n');
                    result.push({
                        type: 'function_call_output',
                        call_id: block.tool_use_id,
                        output: text,
                    });
                }
            }
            if (textParts.length > 0) {
                userContent.unshift({ type: 'input_text', text: textParts.join('\n') });
            }
            if (userContent.length > 0) {
                result.push({
                    type: 'message',
                    role: 'user',
                    content: userContent,
                });
            }
        }
    }

    return result;
}

/** Convert ToolDefinition[] to Responses function tools. */
export function convertToResponsesTools(tools: ToolDefinition[]): ResponsesTool[] {
    return tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
    }));
}

/**
 * Build the COMPLETE streaming request body for one turn, including the
 * GPT-5 reasoning floor and temperature quirks. Byte-identical to the
 * legacy inline construction (golden-pinned).
 */
export function prepareResponsesRequest(
    config: LLMProvider,
    systemPrompt: string,
    messages: MessageParam[],
    tools: ToolDefinition[],
): ResponsesRequestBody {
    const body: ResponsesRequestBody = {
        model: config.model,
        instructions: systemPrompt,
        input: convertToResponsesInput(messages),
        stream: true,
        store: false,
    };
    if (tools.length > 0) {
        body.tools = convertToResponsesTools(tools);
        body.parallel_tool_calls = false;
    }
    if (isGpt5Family(config.model)) {
        // The Codex backend rejects GPT-5* requests without a reasoning field.
        // Default to 'low' (the documented 400-avoidance value); an explicit
        // user-chosen effort overrides it. Never derive medium/high without
        // an explicit user value -- the hardcoded low stays the floor.
        body.reasoning = { effort: resolveGptEffort(config.reasoningEffort), summary: 'auto' };
        body.include = ['reasoning.encrypted_content'];
    }
    // FIX-04-03-02: omit temperature for default-only models (e.g. GPT-5.x)
    if (config.temperature !== undefined && modelSupportsTemperature(config.model)) {
        body.temperature = Math.min(config.temperature, 2.0);
    }
    return body;
}

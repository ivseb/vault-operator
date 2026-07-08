import { describe, it, expect } from 'vitest';
import { BedrockProvider } from '../bedrock';
import { KiloGatewayProvider } from '../kilo-gateway';
import { GitHubCopilotProvider } from '../github-copilot';
import { ChatGptOAuthProvider } from '../chatgpt-oauth';
import type { LLMProvider } from '../../../types/settings';

/**
 * FIX: premature context condensing on large-context models.
 *
 * The condense trigger and the UI context meter both derive their window
 * from api.getModel().info.contextWindow. Four providers used to hardcode
 * a small default (Bedrock 200k, kilo-gateway 128k, Copilot/ChatGPT-OAuth
 * via KNOWN_MODELS ?? DEFAULT), so a 1M-context model (Opus 4.7/4.8,
 * Sonnet 5, Fable) condensed at ~100-160k instead of ~800k. getModel()
 * must resolve the window through the central registry (which infers the
 * 1M family floor and normalizes Bedrock/OpenRouter-decorated ids),
 * keeping the per-provider tables only as an override for ids the registry
 * does not know (e.g. GPT-5.x on the OAuth backends).
 */

function bedrock(model: string): LLMProvider {
    return {
        type: 'bedrock',
        model,
        awsRegion: 'eu-central-1',
        awsAuthMode: 'api-key',
        awsApiKey: 'test-key',
    };
}

function kilo(model: string): LLMProvider {
    return { type: 'kilo-gateway', apiKey: 'sk', model };
}

function copilot(model: string): LLMProvider {
    return { type: 'github-copilot', apiKey: 'sk', model };
}

function chatgpt(model: string): LLMProvider {
    return { type: 'chatgpt-oauth', model };
}

describe('getModel().info.contextWindow resolves the real model window', () => {
    describe('Bedrock (region/vendor-decorated ids must normalize)', () => {
        it('reports 1M for a Bedrock EU Opus 4.8 inference-profile id', () => {
            const w = new BedrockProvider(bedrock('eu.anthropic.claude-opus-4-8-v1:0')).getModel().info.contextWindow;
            expect(w).toBe(1_000_000);
        });

        it('reports 1M for a Bedrock EU Opus 4.7 id', () => {
            const w = new BedrockProvider(bedrock('eu.anthropic.claude-opus-4-7')).getModel().info.contextWindow;
            expect(w).toBe(1_000_000);
        });

        it('keeps a 200k floor for an unknown Bedrock model (Nova)', () => {
            const w = new BedrockProvider(bedrock('eu.amazon.nova-pro-v1:0')).getModel().info.contextWindow;
            expect(w).toBe(200_000);
        });
    });

    describe('kilo-gateway', () => {
        it('reports 1M for Opus 4.8 instead of the old hardcoded 128k', () => {
            const w = new KiloGatewayProvider(kilo('claude-opus-4-8')).getModel().info.contextWindow;
            expect(w).toBe(1_000_000);
        });

        it('reports 128k for gpt-4o (registry-known)', () => {
            const w = new KiloGatewayProvider(kilo('gpt-4o')).getModel().info.contextWindow;
            expect(w).toBe(128_000);
        });
    });

    describe('github-copilot (registry-first, KNOWN_MODELS as override)', () => {
        it('reports 1M for Opus 4.8 via the registry family floor', () => {
            const w = new GitHubCopilotProvider(copilot('claude-opus-4-8')).getModel().info.contextWindow;
            expect(w).toBe(1_000_000);
        });

        it('keeps 128k for gpt-4o', () => {
            const w = new GitHubCopilotProvider(copilot('gpt-4o')).getModel().info.contextWindow;
            expect(w).toBe(128_000);
        });

        it('keeps the KNOWN_MODELS override for a registry-unknown id (gpt-5.4)', () => {
            const w = new GitHubCopilotProvider(copilot('gpt-5.4')).getModel().info.contextWindow;
            expect(w).toBe(200_000);
        });
    });

    describe('chatgpt-oauth (GPT-only backend, table stays authoritative)', () => {
        it('keeps 272k for gpt-5.5 from KNOWN_MODELS', () => {
            const w = new ChatGptOAuthProvider(chatgpt('gpt-5.5')).getModel().info.contextWindow;
            expect(w).toBe(272_000);
        });

        it('keeps the 400k default for a fully unknown id', () => {
            const w = new ChatGptOAuthProvider(chatgpt('gpt-6-ultra-unknown')).getModel().info.contextWindow;
            expect(w).toBe(400_000);
        });
    });
});

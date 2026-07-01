/**
 * AUDIT-038 ISSUE-002 -- Anthropic baseUrl must go through validateProviderUrl.
 *
 * Before the fix, AnthropicProvider passed `config.baseUrl` to the SDK
 * verbatim, so a manipulated settings file or a tainted ProviderConfig
 * payload could pivot the next anthropic API call (including the gateway
 * `Ocp-Apim-Subscription-Key` header) into the local network or AWS
 * Instance Metadata Service. OpenAI and Bedrock already hardened the
 * same vector via providerUrlGuard.
 */

import { describe, it, expect } from 'vitest';
import { AnthropicProvider } from '../anthropic';
import type { LLMProvider } from '../../../types/settings';

function makeAnthropicConfig(overrides: Partial<LLMProvider> = {}): LLMProvider {
    return {
        type: 'anthropic',
        model: 'claude-opus-4-7',
        apiKey: 'sk-ant-test',
        ...overrides,
    };
}

describe('AnthropicProvider constructor URL guard (AUDIT-038 ISSUE-002)', () => {
    it('accepts the default Anthropic host', () => {
        expect(
            () => new AnthropicProvider(makeAnthropicConfig({ baseUrl: 'https://api.anthropic.com' })),
        ).not.toThrow();
    });

    it('accepts an undefined baseUrl (SDK falls back to its own default)', () => {
        expect(() => new AnthropicProvider(makeAnthropicConfig({ baseUrl: undefined }))).not.toThrow();
    });

    it('rejects loopback hosts', () => {
        expect(
            () => new AnthropicProvider(makeAnthropicConfig({ baseUrl: 'http://127.0.0.1:8080' })),
        ).toThrow(/local|private/i);
        expect(
            () => new AnthropicProvider(makeAnthropicConfig({ baseUrl: 'http://localhost:8080' })),
        ).toThrow(/local|private/i);
    });

    it('rejects AWS Instance Metadata Service', () => {
        expect(
            () => new AnthropicProvider(makeAnthropicConfig({ baseUrl: 'http://169.254.169.254/latest/meta-data/' })),
        ).toThrow(/blocked|metadata|local|private/i);
    });

    it('rejects RFC 1918 private hosts', () => {
        expect(
            () => new AnthropicProvider(makeAnthropicConfig({ baseUrl: 'https://10.0.0.5' })),
        ).toThrow(/local|private/i);
        expect(
            () => new AnthropicProvider(makeAnthropicConfig({ baseUrl: 'https://192.168.1.1' })),
        ).toThrow(/local|private/i);
    });

    it('rejects plain HTTP for the public anthropic host', () => {
        expect(
            () => new AnthropicProvider(makeAnthropicConfig({ baseUrl: 'http://api.anthropic.com' })),
        ).toThrow(/HTTPS/i);
    });

    it('also guards gateway-mode (custom header would otherwise reach a hostile endpoint)', () => {
        expect(
            () => new AnthropicProvider(makeAnthropicConfig({
                baseUrl: 'http://127.0.0.1:9000',
                useGateway: true,
                gatewayHeaderName: 'Ocp-Apim-Subscription-Key',
                gatewayHeaderValue: 'subscription-secret',
            })),
        ).toThrow(/local|private|HTTPS/i);
    });
});

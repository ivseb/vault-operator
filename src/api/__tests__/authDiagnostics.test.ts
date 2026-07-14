/**
 * FIX-54-11 follow-up: when the provider returns an auth-class error
 * (401/403) we log a structured diagnostic line so the next incident is
 * traceable without a repro. Field report 2026-07-14: gpt-5.6-sol
 * succeeded on turn 1 and then 401ed on the follow-up tool_result call
 * with "insufficient permissions", and the log carried nothing beyond
 * the message. The helper extracts the OpenAI x-request-id, rate-limit
 * headers, and body so we can tell scope-restriction, quota-as-401 and
 * tool_result-continuation-restriction apart.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logAuthErrorDiagnostics } from '../authDiagnostics';

function apiError(overrides: Record<string, unknown>): Error {
    const err = new Error((overrides.message as string) ?? 'API error');
    Object.assign(err, overrides);
    return err;
}

describe('logAuthErrorDiagnostics', () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        warn.mockRestore();
    });

    it('logs status, message, provider, model on a bare 401', () => {
        const err = apiError({
            status: 401,
            message: '401 You have insufficient permissions for this operation.',
        });

        logAuthErrorDiagnostics(err, { providerType: 'openai', model: 'gpt-5.6-sol' });

        expect(warn).toHaveBeenCalledTimes(1);
        const [inline, payload] = warn.mock.calls[0];
        // Inline string form for copy-paste from DevTools.
        expect(inline).toContain('[AuthDiag]');
        expect(inline).toContain('providerType="openai"');
        expect(inline).toContain('model="gpt-5.6-sol"');
        expect(inline).toContain('status=401');
        // Object payload still passed for click-to-expand in DevTools.
        expect(payload).toMatchObject({
            providerType: 'openai',
            model: 'gpt-5.6-sol',
            status: 401,
            body: '401 You have insufficient permissions for this operation.',
        });
    });

    it('extracts x-request-id and rate-limit headers from fetch-style Headers.get', () => {
        const headerMap = new Map<string, string>([
            ['x-request-id', 'req_abc123'],
            ['x-ratelimit-remaining-requests', '17'],
            ['x-ratelimit-remaining-tokens', '295000'],
            ['x-ratelimit-reset-requests', '1s'],
            ['retry-after', '30'],
        ]);
        const err = apiError({
            status: 401,
            message: '401 You have insufficient permissions for this operation.',
            headers: { get: (k: string) => headerMap.get(k.toLowerCase()) ?? null },
        });

        logAuthErrorDiagnostics(err, { providerType: 'openai', model: 'gpt-5.6-sol' });

        const [inline, payload] = warn.mock.calls[0];
        expect(inline).toContain('requestId="req_abc123"');
        expect(inline).toContain('rateLimitRemainingRequests="17"');
        expect(inline).toContain('rateLimitRemainingTokens="295000"');
        expect(inline).toContain('retryAfter="30"');
        expect(payload).toMatchObject({
            requestId: 'req_abc123',
            rateLimitRemainingRequests: '17',
            rateLimitRemainingTokens: '295000',
            rateLimitResetRequests: '1s',
            retryAfter: '30',
        });
    });

    it('extracts headers from a plain-object headers map (case-insensitive)', () => {
        const err = apiError({
            status: 403,
            message: 'Missing scopes: model.request',
            headers: {
                'X-Request-Id': 'req_xyz',
                'X-RateLimit-Remaining-Requests': '0',
            },
        });

        logAuthErrorDiagnostics(err, { providerType: 'openai', model: 'gpt-5.6-sol' });

        const [, payload] = warn.mock.calls[0];
        expect(payload).toMatchObject({
            status: 403,
            requestId: 'req_xyz',
            rateLimitRemainingRequests: '0',
        });
    });

    it('inline form omits keys whose values are undefined (no "field=undefined" noise)', () => {
        const err = apiError({ status: 401, message: 'unauthorized' });

        logAuthErrorDiagnostics(err, { providerType: 'openai', model: 'gpt-5.6-sol' });

        const [inline] = warn.mock.calls[0];
        expect(inline).not.toContain('undefined');
        expect(inline).not.toContain('requestId=');
    });

    it('omits header fields cleanly when headers are absent', () => {
        const err = apiError({ status: 401, message: 'unauthorized' });

        logAuthErrorDiagnostics(err, { providerType: 'anthropic', model: 'claude-sonnet-5' });

        const [, payload] = warn.mock.calls[0];
        expect(payload).toMatchObject({ providerType: 'anthropic', model: 'claude-sonnet-5', status: 401 });
        expect(payload).not.toHaveProperty('requestId');
        expect(payload).not.toHaveProperty('rateLimitRemainingRequests');
    });

    it('truncates very long bodies so the log line stays readable', () => {
        const long = 'x'.repeat(4000);
        const err = apiError({ status: 401, message: long });

        logAuthErrorDiagnostics(err, { providerType: 'openai', model: 'gpt-5.6-sol' });

        const [, payload] = warn.mock.calls[0];
        expect(typeof payload.body).toBe('string');
        expect((payload.body as string).length).toBeLessThanOrEqual(1024);
    });

    it('never throws on a non-error value', () => {
        expect(() => logAuthErrorDiagnostics('boom', { providerType: 'openai', model: 'gpt-5.6-sol' }))
            .not.toThrow();
        expect(() => logAuthErrorDiagnostics(null, { providerType: 'openai', model: 'gpt-5.6-sol' }))
            .not.toThrow();
    });
});

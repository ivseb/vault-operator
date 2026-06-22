/**
 * AUDIT-034 L-2 regression: the OAuth error extractor must whitelist only the
 * documented RFC 6749 OAuth error fields and MUST drop everything else, so an
 * upstream schema change cannot embed a submitted code_verifier, refresh_token,
 * PKCE nonce, or other credential material in a thrown Error message.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../security/SafeStorageService', () => ({
    SafeStorageService: class {
        isAvailable(): boolean { return true; }
    },
}));

import { extractOAuthError } from '../ChatGptOAuthService';

describe('extractOAuthError', () => {
    it('returns the documented OAuth error fields verbatim', () => {
        const body = JSON.stringify({
            error: 'invalid_grant',
            error_description: 'The refresh token is invalid.',
        });
        const out = extractOAuthError(body);
        expect(out).toContain('error=invalid_grant');
        expect(out).toContain('error_description=The refresh token is invalid.');
    });

    it('drops echoed credential fields even if upstream starts to include them', () => {
        const body = JSON.stringify({
            error: 'invalid_grant',
            error_description: 'bad code',
            code_verifier: 'super-secret-pkce-verifier',
            refresh_token: 'rt-very-secret',
            access_token: 'at-very-secret',
            client_secret: 'cs-very-secret',
        });
        const out = extractOAuthError(body);
        expect(out).toContain('error=invalid_grant');
        expect(out).not.toContain('super-secret-pkce-verifier');
        expect(out).not.toContain('rt-very-secret');
        expect(out).not.toContain('at-very-secret');
        expect(out).not.toContain('cs-very-secret');
        expect(out).not.toContain('code_verifier');
        expect(out).not.toContain('refresh_token');
    });

    it('returns a sentinel for non-JSON bodies rather than echoing raw text', () => {
        const out = extractOAuthError('refresh_token=rt-very-secret&client_id=abc');
        expect(out).toBe('<non-json error body>');
        expect(out).not.toContain('rt-very-secret');
    });

    it('returns <empty> for empty bodies', () => {
        expect(extractOAuthError(undefined)).toBe('<empty>');
        expect(extractOAuthError('')).toBe('<empty>');
    });

    it('returns <unrecognized error body> when the JSON has none of the documented fields', () => {
        const out = extractOAuthError(JSON.stringify({ something: 'else', token: 'leaky' }));
        expect(out).toBe('<unrecognized error body>');
        expect(out).not.toContain('leaky');
    });

    it('clamps long error_description so a verbose upstream cannot smuggle bulk text', () => {
        const long = 'x'.repeat(2000);
        const out = extractOAuthError(JSON.stringify({ error: 'server_error', error_description: long }));
        expect(out).toContain('error=server_error');
        // 300 char cap on error_description
        const match = out.match(/error_description=(x+)/);
        expect(match).not.toBeNull();
        expect(match![1].length).toBeLessThanOrEqual(300);
    });
});

/**
 * Regression tests for the AUDIT-034 M-14 (SSRF guard) and L-4 (error redaction)
 * fixes inside the MCP client surface.
 *
 * The fetch-level SSRF guard inside obsidianFetch is also exercised here so a
 * future refactor cannot drop the protection silently.
 */

import { describe, expect, it } from 'vitest';
import { McpClient, redactMcpError } from '../McpClient';
import { obsidianFetch } from '../obsidianFetch';

describe('redactMcpError', () => {
    it('strips Authorization Bearer tokens supplied via headers', () => {
        const cfg = {
            url: 'https://mcp.example.com',
            headers: { Authorization: 'Bearer abc123secrettoken' },
        };
        const msg = 'request failed: Authorization: Bearer abc123secrettoken returned 401';
        const out = redactMcpError(msg, cfg);
        expect(out).not.toContain('abc123secrettoken');
        expect(out).toContain('<redacted>');
    });

    it('strips raw token values from non-Authorization headers', () => {
        const cfg = {
            url: 'https://mcp.example.com',
            headers: { 'X-Api-Key': 'kx_supersecret_123456' },
        };
        const out = redactMcpError(
            'remote returned kx_supersecret_123456 in body',
            cfg,
        );
        expect(out).not.toContain('kx_supersecret_123456');
    });

    it('redacts userinfo embedded in the configured URL', () => {
        const cfg = { url: 'https://user:hunter2@mcp.example.com/sse' };
        const out = redactMcpError(
            'connect ECONNREFUSED for https://user:hunter2@mcp.example.com/sse',
            cfg,
        );
        expect(out).not.toContain('hunter2');
        expect(out).toContain('<redacted>');
    });

    it('redacts token-shaped query parameters', () => {
        const cfg = { url: 'https://mcp.example.com/sse?token=abcdef123456' };
        const out = redactMcpError(
            'GET https://mcp.example.com/sse?token=abcdef123456 returned 500',
            cfg,
        );
        expect(out).not.toContain('abcdef123456');
        expect(out).toMatch(/token=<redacted>/);
    });

    it('falls back to generic Bearer pattern when no config is provided', () => {
        const out = redactMcpError(
            'upstream said Authorization: Bearer fallback-token-value',
            undefined,
        );
        expect(out).not.toContain('fallback-token-value');
        expect(out).toContain('Bearer <redacted>');
    });

    it('leaves benign messages untouched', () => {
        const out = redactMcpError('Connection to "icons8" timed out', {
            url: 'https://mcp.icons8.com/mcp/',
        });
        expect(out).toBe('Connection to "icons8" timed out');
    });
});

describe('McpClient SSRF guard (AUDIT-034 M-14)', () => {
    it('rejects metadata host and stores a non-leaky error', async () => {
        const client = new McpClient();
        await client.connect('imds', {
            type: 'streamable-http',
            url: 'http://169.254.169.254/latest/meta-data/',
        });
        const conn = client.getConnection('imds');
        expect(conn?.status).toBe('error');
        expect(conn?.error ?? '').toMatch(/metadata|blocked|local or private/i);
    });

    it('rejects loopback host by default', async () => {
        const client = new McpClient();
        await client.connect('local', {
            type: 'streamable-http',
            url: 'http://127.0.0.1:8080/mcp',
        });
        const conn = client.getConnection('local');
        expect(conn?.status).toBe('error');
        expect(conn?.error ?? '').toMatch(/local or private|HTTPS/i);
    });

    it('rejects RFC 1918 host by default', async () => {
        const client = new McpClient();
        await client.connect('rfc1918', {
            type: 'streamable-http',
            url: 'http://10.0.0.5:7000/mcp',
        });
        const conn = client.getConnection('rfc1918');
        expect(conn?.status).toBe('error');
        expect(conn?.error ?? '').toMatch(/local or private/i);
    });

    it('allows loopback when allowLocalUrls is enabled (network attempt is fine to fail)', async () => {
        const client = new McpClient({ allowLocalUrls: true });
        await client.connect('local-opt-in', {
            type: 'streamable-http',
            url: 'http://127.0.0.1:1/mcp',
        });
        const conn = client.getConnection('local-opt-in');
        // The URL guard passes; status ends up "error" because nothing listens
        // on port 1, but the error message must NOT be the SSRF rejection.
        expect(conn?.error ?? '').not.toMatch(/local or private/i);
    });
});

describe('obsidianFetch SSRF guard', () => {
    it('rejects the AWS metadata host', async () => {
        await expect(
            obsidianFetch('http://169.254.169.254/latest/meta-data/'),
        ).rejects.toThrow(/blocked host|local or private/i);
    });

    it('rejects loopback without the opt-in header', async () => {
        await expect(
            obsidianFetch('http://127.0.0.1:9999/anything'),
        ).rejects.toThrow(/local or private/i);
    });

    it('rejects non-http(s) protocols', async () => {
        await expect(
            obsidianFetch('file:///etc/passwd'),
        ).rejects.toThrow(/protocol/i);
    });
});

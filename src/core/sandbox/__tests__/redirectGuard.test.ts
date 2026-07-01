/**
 * AUDIT-038 ISSUE-004 -- redirect chain validation pin.
 */

import { describe, it, expect } from 'vitest';
import {
    followAllowlistedRedirects,
    type HopFetcher,
    type HopGuard,
    type HopResponse,
} from '../redirectGuard';

function makeFetcher(map: Record<string, HopResponse>): HopFetcher {
    return async (url: string) => {
        const r = map[url];
        if (!r) throw new Error(`unexpected fetch: ${url}`);
        return r;
    };
}

const allowExact =
    (...hosts: string[]): HopGuard =>
    (url) => {
        try {
            return hosts.includes(new URL(url).hostname);
        } catch {
            return false;
        }
    };

describe('followAllowlistedRedirects (AUDIT-038 ISSUE-004)', () => {
    it('returns the response directly on a 2xx with no redirect', async () => {
        const fetcher = makeFetcher({
            'https://cdn.jsdelivr.net/npm/foo': { status: 200, headers: {}, text: 'ok' },
        });
        const res = await followAllowlistedRedirects(
            'https://cdn.jsdelivr.net/npm/foo',
            fetcher,
            allowExact('cdn.jsdelivr.net'),
        );
        expect(res.status).toBe(200);
        expect(res.text).toBe('ok');
    });

    it('blocks the very first call when the start URL is not on the allowlist', async () => {
        await expect(
            followAllowlistedRedirects(
                'https://evil.example.com',
                makeFetcher({}),
                allowExact('cdn.jsdelivr.net'),
            ),
        ).rejects.toThrow(/not on allowlist/i);
    });

    it('follows an allowlisted redirect to another allowlisted host', async () => {
        const fetcher = makeFetcher({
            'https://cdn.jsdelivr.net/npm/foo': {
                status: 302,
                headers: { location: 'https://unpkg.com/foo' },
                text: '',
            },
            'https://unpkg.com/foo': { status: 200, headers: {}, text: 'final' },
        });
        const res = await followAllowlistedRedirects(
            'https://cdn.jsdelivr.net/npm/foo',
            fetcher,
            allowExact('cdn.jsdelivr.net', 'unpkg.com'),
        );
        expect(res.status).toBe(200);
        expect(res.text).toBe('final');
    });

    it('BLOCKS a redirect to a non-allowlisted host (the audit bug)', async () => {
        const fetcher = makeFetcher({
            'https://cdn.jsdelivr.net/npm/foo': {
                status: 302,
                headers: { location: 'https://attacker.example.com/' },
                text: '',
            },
        });
        await expect(
            followAllowlistedRedirects(
                'https://cdn.jsdelivr.net/npm/foo',
                fetcher,
                allowExact('cdn.jsdelivr.net'),
            ),
        ).rejects.toThrow(/blocked by allowlist/i);
    });

    it('BLOCKS a redirect to an IP literal (e.g. 169.254.169.254 AWS IMDS)', async () => {
        const fetcher = makeFetcher({
            'https://cdn.jsdelivr.net/npm/foo': {
                status: 301,
                headers: { location: 'https://169.254.169.254/latest/meta-data/' },
                text: '',
            },
        });
        // allowExact lets only hostnames through; an IP literal hostname
        // is not in the list so the guard rejects.
        await expect(
            followAllowlistedRedirects(
                'https://cdn.jsdelivr.net/npm/foo',
                fetcher,
                allowExact('cdn.jsdelivr.net'),
            ),
        ).rejects.toThrow(/blocked by allowlist/i);
    });

    it('respects maxRedirects and aborts a redirect loop', async () => {
        const fetcher = makeFetcher({
            'https://cdn.jsdelivr.net/a': {
                status: 302,
                headers: { location: 'https://cdn.jsdelivr.net/b' },
                text: '',
            },
            'https://cdn.jsdelivr.net/b': {
                status: 302,
                headers: { location: 'https://cdn.jsdelivr.net/c' },
                text: '',
            },
            'https://cdn.jsdelivr.net/c': {
                status: 302,
                headers: { location: 'https://cdn.jsdelivr.net/d' },
                text: '',
            },
            'https://cdn.jsdelivr.net/d': {
                status: 302,
                headers: { location: 'https://cdn.jsdelivr.net/e' },
                text: '',
            },
        });
        await expect(
            followAllowlistedRedirects(
                'https://cdn.jsdelivr.net/a',
                fetcher,
                allowExact('cdn.jsdelivr.net'),
                { maxRedirects: 3 },
            ),
        ).rejects.toThrow(/Redirect limit/i);
    });

    it('resolves a relative Location header against the current URL', async () => {
        const fetcher = makeFetcher({
            'https://cdn.jsdelivr.net/npm/foo/index.js': {
                status: 301,
                headers: { location: '/npm/foo@latest/index.js' },
                text: '',
            },
            'https://cdn.jsdelivr.net/npm/foo@latest/index.js': {
                status: 200,
                headers: {},
                text: 'final',
            },
        });
        const res = await followAllowlistedRedirects(
            'https://cdn.jsdelivr.net/npm/foo/index.js',
            fetcher,
            allowExact('cdn.jsdelivr.net'),
        );
        expect(res.text).toBe('final');
    });

    it('rejects when the Location header is unparsable', async () => {
        const fetcher = makeFetcher({
            'https://cdn.jsdelivr.net/x': {
                status: 302,
                headers: { location: 'http://[invalid' },
                text: '',
            },
        });
        await expect(
            followAllowlistedRedirects(
                'https://cdn.jsdelivr.net/x',
                fetcher,
                allowExact('cdn.jsdelivr.net'),
            ),
        ).rejects.toThrow(/Invalid redirect target/i);
    });
});

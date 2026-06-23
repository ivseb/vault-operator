/**
 * REF-11: regression tests for OperationLogger.sanitizeParams.
 *
 * The logger persists tool-call audit entries to a JSONL file. The
 * sanitiseParams step is the security-relevant boundary -- credentials,
 * file content and overlong values must be stripped before they hit
 * the persistent log. These tests pin every documented redaction rule.
 *
 * sanitizeParams is private; we reach it through the public `log()`
 * API so the test exercises the real wire path. A minimal fake
 * FileAdapter captures the JSONL line for inspection.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OperationLogger } from '../OperationLogger';

class FakeAdapter {
    files = new Map<string, string>();
    async exists(p: string): Promise<boolean> { return this.files.has(p); }
    async mkdir(_p: string): Promise<void> { /* no-op */ }
    async write(p: string, content: string): Promise<void> { this.files.set(p, content); }
    async append(p: string, content: string): Promise<void> {
        const prev = this.files.get(p) ?? '';
        this.files.set(p, prev + content);
    }
    async read(p: string): Promise<string> {
        const v = this.files.get(p);
        if (v === undefined) throw new Error('ENOENT');
        return v;
    }
    async readBinary(_p: string): Promise<ArrayBuffer> { throw new Error('binary not used'); }
    async writeBinary(_p: string, _data: ArrayBuffer): Promise<void> { /* not used */ }
    async remove(_p: string): Promise<void> { /* not used */ }
    async list(_p: string): Promise<{ files: string[]; folders: string[] }> { return { files: [], folders: [] }; }
    async rmdir(_p: string, _recursive: boolean): Promise<void> { /* not used */ }
}

async function lastEntry(fa: FakeAdapter): Promise<Record<string, unknown>> {
    const entries = Array.from(fa.files.values()).flatMap((c) => c.split('\n').filter(Boolean));
    return JSON.parse(entries[entries.length - 1]) as Record<string, unknown>;
}

describe('OperationLogger.sanitizeParams (REF-11)', () => {
    let fa: FakeAdapter;
    let logger: OperationLogger;

    beforeEach(async () => {
        fa = new FakeAdapter();
        // The OperationLogger type expects a FileAdapter but the runtime
        // contract is duck-typed: exists/mkdir/write/append/read.
        logger = new OperationLogger(fa as unknown as ConstructorParameters<typeof OperationLogger>[0]);
        await logger.initialize();
    });

    function makeBaseEntry(params: Record<string, unknown>): Parameters<typeof logger.log>[0] {
        return {
            timestamp: new Date().toISOString(),
            taskId: 'task-1',
            mode: 'agent',
            tool: 'test_tool',
            params,
            success: true,
            durationMs: 1,
        };
    }

    it('redacts sensitive keys (password, api_key, secret, auth, authorization)', async () => {
        await logger.log(makeBaseEntry({
            password: 'hunter2',
            api_key: 'sk-abcdef0123456789',
            secret: 'shh',
            auth: 'Bearer xyz',
            authorization: 'Basic ...',
            other: 'kept',
        }));
        const entry = await lastEntry(fa);
        const p = entry.params as Record<string, unknown>;
        expect(p.password).toBe('[REDACTED]');
        expect(p.api_key).toBe('[REDACTED]');
        expect(p.secret).toBe('[REDACTED]');
        expect(p.auth).toBe('[REDACTED]');
        expect(p.authorization).toBe('[REDACTED]');
        expect(p.other).toBe('kept');
    });

    // M-12: camelCase credential keys must be caught.
    it('redacts camelCase credential keys (apiKey, accessToken, clientSecret, awsSessionToken)', async () => {
        await logger.log(makeBaseEntry({
            apiKey: 'sk-abcdef0123456789',
            accessToken: 'tok-1',
            refreshToken: 'tok-2',
            sessionToken: 'tok-3',
            clientSecret: 'cs-1',
            awsAccessKey: 'AKIA000000000000XXXX',
            awsSecretKey: 'sk',
            awsSessionToken: 'st',
            gatewayHeaderValue: 'gh',
            subscriptionKey: 'sub',
            chatgptOAuthRefresh: 'ref',
            keepMe: 'visible',
        }));
        const p = (await lastEntry(fa)).params as Record<string, unknown>;
        expect(p.apiKey).toBe('[REDACTED]');
        expect(p.accessToken).toBe('[REDACTED]');
        expect(p.refreshToken).toBe('[REDACTED]');
        expect(p.sessionToken).toBe('[REDACTED]');
        expect(p.clientSecret).toBe('[REDACTED]');
        expect(p.awsAccessKey).toBe('[REDACTED]');
        expect(p.awsSecretKey).toBe('[REDACTED]');
        expect(p.awsSessionToken).toBe('[REDACTED]');
        expect(p.gatewayHeaderValue).toBe('[REDACTED]');
        expect(p.subscriptionKey).toBe('[REDACTED]');
        expect(p.chatgptOAuthRefresh).toBe('[REDACTED]');
        expect(p.keepMe).toBe('visible');
    });

    // M-12: bare "key" plus "keyword" / "cache_key" / "sort_key" must NOT be redacted.
    it('does not redact non-credential keys named key/cache_key/sort_key/keyword', async () => {
        await logger.log(makeBaseEntry({
            cache_key: 'abc',
            sort_key: 'def',
            keyword: 'search-term',
            key: 'plain-identifier',
        }));
        const p = (await lastEntry(fa)).params as Record<string, unknown>;
        expect(p.cache_key).toBe('abc');
        expect(p.sort_key).toBe('def');
        expect(p.keyword).toBe('search-term');
        expect(p.key).toBe('plain-identifier');
    });

    // M-12: whole-block redaction for headers / cookies / providerConfigs.
    it('redacts headers, cookies, and providerConfigs blocks wholesale', async () => {
        await logger.log(makeBaseEntry({
            headers: { Authorization: 'Bearer eyJhbGciOi...' },
            cookies: { session: 'abc=def' },
            providerConfigs: [{ apiKey: 'sk-xxx', name: 'visible-name' }],
            payload: { ok: true },
        }));
        const p = (await lastEntry(fa)).params as Record<string, unknown>;
        expect(p.headers).toBe('[REDACTED]');
        expect(p.cookies).toBe('[REDACTED]');
        expect(p.providerConfigs).toBe('[REDACTED]');
        expect(p.payload).toEqual({ ok: true });
    });

    // M-12: nested credential keys are redacted when walking deep into objects.
    it('redacts credentials nested inside objects and arrays', async () => {
        await logger.log(makeBaseEntry({
            config: {
                provider: {
                    name: 'anthropic',
                    apiKey: 'sk-deepvalue',
                    nested: { clientSecret: 'inner' },
                },
            },
            list: [{ accessToken: 'tok' }, { name: 'ok' }],
        }));
        const p = (await lastEntry(fa)).params as Record<string, unknown>;
        const config = p.config as Record<string, unknown>;
        const provider = config.provider as Record<string, unknown>;
        expect(provider.name).toBe('anthropic');
        expect(provider.apiKey).toBe('[REDACTED]');
        const nested = provider.nested as Record<string, unknown>;
        expect(nested.clientSecret).toBe('[REDACTED]');
        const list = p.list as Array<Record<string, unknown>>;
        expect(list[0].accessToken).toBe('[REDACTED]');
        expect(list[1].name).toBe('ok');
    });

    // M-12: well-known token value patterns are scrubbed even when the key name is innocuous.
    it('scrubs well-known token shapes (Bearer / sk- / ghp_ / AKIA) from string values', async () => {
        await logger.log(makeBaseEntry({
            note: 'Sent Bearer eyJabc.def-ghi to the server',
            mixed: 'see sk-abcdefghijklmnop1234 for context',
            paste: 'token=ghp_abcdefghijklmnopqrstuvwx0123456789',
            aws: 'used AKIAIOSFODNN7EXAMPLE today',
        }));
        const p = (await lastEntry(fa)).params as Record<string, unknown>;
        expect(p.note).not.toMatch(/Bearer\s+eyJ/);
        expect(p.note).toMatch(/\[REDACTED\]/);
        expect(p.mixed).not.toMatch(/sk-abcdef/);
        expect(p.mixed).toMatch(/\[REDACTED\]/);
        expect(p.paste).not.toMatch(/ghp_/);
        expect(p.paste).toMatch(/\[REDACTED\]/);
        expect(p.aws).not.toMatch(/AKIA[A-Z0-9]{16}/);
        expect(p.aws).toMatch(/\[REDACTED\]/);
    });

    it('replaces file-content keys with their length', async () => {
        const longText = 'A'.repeat(1234);
        await logger.log(makeBaseEntry({
            content: longText,
            new_str: 'short',
            old_str: 'abc',
        }));
        const p = (await lastEntry(fa)).params as Record<string, unknown>;
        expect(p.content).toBe('[1234 chars]');
        expect(p.new_str).toBe('[5 chars]');
        expect(p.old_str).toBe('[3 chars]');
    });

    it('strips userinfo from url values', async () => {
        await logger.log(makeBaseEntry({
            url: 'https://alice:secret@example.com/path?q=1',
        }));
        const p = (await lastEntry(fa)).params as Record<string, unknown>;
        expect(p.url).toBe('https://example.com/path?q=1');
    });

    it('replaces invalid urls with [INVALID_URL]', async () => {
        await logger.log(makeBaseEntry({ url: 'not a url' }));
        const p = (await lastEntry(fa)).params as Record<string, unknown>;
        expect(p.url).toBe('[INVALID_URL]');
    });

    it('truncates overlong string values', async () => {
        const long = 'B'.repeat(800);
        await logger.log(makeBaseEntry({ note: long }));
        const p = (await lastEntry(fa)).params as Record<string, unknown>;
        expect(typeof p.note).toBe('string');
        expect((p.note as string).length).toBeLessThanOrEqual(501);
        expect((p.note as string).endsWith('…')).toBe(true);
    });

    it('passes short strings through untouched', async () => {
        await logger.log(makeBaseEntry({ note: 'short value' }));
        const p = (await lastEntry(fa)).params as Record<string, unknown>;
        expect(p.note).toBe('short value');
    });

    it('truncates a long result field', async () => {
        const long = 'C'.repeat(3000);
        await logger.log({
            ...makeBaseEntry({}),
            result: long,
        });
        const entry = await lastEntry(fa);
        expect(typeof entry.result).toBe('string');
        expect((entry.result as string)).toMatch(/\[truncated\]$/);
    });

    // L-12: when the underlying adapter fails, the counter increments and the failure message
    // is exposed via the public accessors so the Log tab can render a banner.
    it('records write failures via getFailedWriteCount / getLastFailureMessage', async () => {
        const breakingAdapter = {
            async exists(_p: string): Promise<boolean> { return false; },
            async mkdir(_p: string): Promise<void> { /* no-op */ },
            async write(_p: string, _c: string): Promise<void> { throw new Error('ENOSPC: disk full'); },
            async append(_p: string, _c: string): Promise<void> { throw new Error('ENOSPC: disk full'); },
            async read(_p: string): Promise<string> { throw new Error('ENOENT'); },
            async readBinary(_p: string): Promise<ArrayBuffer> { throw new Error('binary not used'); },
            async writeBinary(_p: string, _d: ArrayBuffer): Promise<void> { /* not used */ },
            async remove(_p: string): Promise<void> { /* not used */ },
            async list(_p: string): Promise<{ files: string[]; folders: string[] }> { return { files: [], folders: [] }; },
            async rmdir(_p: string, _recursive: boolean): Promise<void> { /* not used */ },
        };
        const failingLogger = new OperationLogger(
            breakingAdapter as unknown as ConstructorParameters<typeof OperationLogger>[0]
        );
        await failingLogger.initialize();
        expect(failingLogger.getFailedWriteCount()).toBe(0);

        await failingLogger.log(makeBaseEntry({ tool: 'x' }));
        expect(failingLogger.getFailedWriteCount()).toBe(1);
        expect(failingLogger.getLastFailureMessage()).toMatch(/ENOSPC/);

        await failingLogger.log(makeBaseEntry({ tool: 'y' }));
        expect(failingLogger.getFailedWriteCount()).toBe(2);

        failingLogger.clearFailureState();
        expect(failingLogger.getFailedWriteCount()).toBe(0);
        expect(failingLogger.getLastFailureMessage()).toBeUndefined();
    });
});

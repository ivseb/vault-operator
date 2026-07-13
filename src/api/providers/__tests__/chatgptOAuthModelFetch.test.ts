/**
 * FIX-55-03 (issue #55): gpt-5.6 lineup + visible discovery fallback for the
 * ChatGPT OAuth (Codex) provider.
 *
 * The Codex backend keys the served model lineup on the client_version in the
 * User-Agent, so a stale CODEX_CLIENT_VERSION pin silently serves an outdated
 * set. On top, fetchChatGptOAuthModels swallowed every error in a bare catch
 * and silently returned the static 3-model KNOWN_MODELS fallback -- combined
 * with the 24h discovery cache the user saw a stale list with no signal.
 * These tests pin the new lineup and the fallback-visibility hook.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authState: { token: string | null; accountId: string | null } = {
    token: null,
    accountId: null,
};

vi.mock('../../../core/auth/ChatGptOAuthService', () => ({
    ChatGptOAuthService: {
        getInstance: () => ({
            getValidAccessToken: () => Promise.resolve(authState.token),
            getAccountId: () => authState.accountId,
        }),
    },
}));

const requestUrlMock = vi.fn();
vi.mock('obsidian', () => ({
    requestUrl: (opts: unknown) => requestUrlMock(opts) as unknown,
}));

import {
    CODEX_CLIENT_VERSION,
    fetchChatGptOAuthModels,
    getLastChatGptOAuthModelFetch,
    listKnownChatGptOAuthModels,
} from '../chatgpt-oauth';

beforeEach(() => {
    authState.token = null;
    authState.accountId = null;
    requestUrlMock.mockReset();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('KNOWN_MODELS lineup (FIX-55-03)', () => {
    const ids = listKnownChatGptOAuthModels().map((m) => m.id);

    it('contains the reporter-confirmed gpt-5.6', () => {
        expect(ids).toContain('gpt-5.6');
    });

    it('keeps the previous 2026-06 lineup', () => {
        expect(ids).toContain('gpt-5.5');
        expect(ids).toContain('gpt-5.4');
        expect(ids).toContain('gpt-5.4-mini');
    });

    it('does not carry unverified platform-API variant ids', () => {
        // developers.openai.com lists gpt-5.6-sol/-terra/-luna as PLATFORM API
        // ids; they are not verified against the Codex backend and must not be
        // offered here (a wrong id 400s with a confusing backend message).
        expect(ids).not.toContain('gpt-5.6-sol');
        expect(ids).not.toContain('gpt-5.6-terra');
        expect(ids).not.toContain('gpt-5.6-luna');
    });
});

describe('CODEX_CLIENT_VERSION pin (FIX-55-03)', () => {
    it('is pinned to the codex-cli release verified on 2026-07-13', () => {
        // Verified via https://registry.npmjs.org/@openai/codex/latest
        // ("version" field). The Codex backend keys the served lineup on this
        // value, so bumping it is part of every model-lineup refresh.
        expect(CODEX_CLIENT_VERSION).toBe('0.144.3');
    });
});

describe('fetchChatGptOAuthModels fallback visibility (FIX-55-03)', () => {
    it('reports source live after a successful fetch', async () => {
        authState.token = 'tok';
        authState.accountId = 'acc';
        requestUrlMock.mockResolvedValue({
            status: 200,
            json: { models: [{ slug: 'gpt-5.6', display_name: 'GPT-5.6' }] },
        });
        const list = await fetchChatGptOAuthModels();
        expect(list).toEqual([{ id: 'gpt-5.6', label: 'GPT-5.6' }]);
        expect(getLastChatGptOAuthModelFetch().source).toBe('live');
    });

    it('reports a fallback with reason no-token when not signed in', async () => {
        const list = await fetchChatGptOAuthModels();
        expect(list).toEqual(listKnownChatGptOAuthModels());
        const status = getLastChatGptOAuthModelFetch();
        expect(status.source).toBe('fallback');
        expect(status.reason).toBe('no-token');
    });

    it('reports a fallback with reason http-error on a non-200 response', async () => {
        authState.token = 'tok';
        requestUrlMock.mockResolvedValue({ status: 500, json: {} });
        const list = await fetchChatGptOAuthModels();
        expect(list).toEqual(listKnownChatGptOAuthModels());
        const status = getLastChatGptOAuthModelFetch();
        expect(status.source).toBe('fallback');
        expect(status.reason).toBe('http-error');
    });

    it('logs via console.debug instead of swallowing exceptions silently', async () => {
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
        authState.token = 'tok';
        requestUrlMock.mockRejectedValue(new Error('network down'));
        const list = await fetchChatGptOAuthModels();
        expect(list).toEqual(listKnownChatGptOAuthModels());
        const status = getLastChatGptOAuthModelFetch();
        expect(status.source).toBe('fallback');
        expect(status.reason).toBe('exception');
        expect(debugSpy).toHaveBeenCalled();
    });
});

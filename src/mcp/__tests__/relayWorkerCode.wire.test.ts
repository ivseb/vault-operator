/**
 * Wire-spec tests for the embedded Cloudflare relay worker (AUDIT-015 gap).
 *
 * The worker ships as a template string (RELAY_WORKER_CODE) that the plugin
 * uploads to Cloudflare. To test the actual wire behaviour we evaluate the
 * string as a module (export rewrite + new Function) and drive the worker
 * fetch handler and the RelayDO with real Request/Response objects, which
 * Node provides as globals.
 *
 * NOT covered here: real Cloudflare runtime behaviour (DO eviction,
 * free-plan limits, the 1101 HTML error renderer) and Obsidian's
 * requestUrl timeout semantics.
 *
 * FIX-23-04-11: long-poll /poll + plugin liveness (issue #53)
 * FIX-23-04-12: JSON-RPC error envelopes instead of Cloudflare 1101 HTML,
 *               HEAD 200, clean JSON 404 for /.well-known/ OAuth probes.
 * FIX-23-04-14: review follow-ups -- CORS stays off plugin endpoints even
 *               on error envelopes and HEAD (H-6), /health probes the DO
 *               only for token-authenticated callers, supersede coverage.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { RELAY_WORKER_CODE } from '../relayWorkerCode';

const TOKEN = 'test-relay-token';

interface WorkerHandler {
    fetch(request: Request, env: RelayEnv): Promise<Response>;
}

interface RelayDOInstance {
    fetch(request: Request): Promise<Response>;
}

type RelayDOConstructor = new (state: unknown, env: unknown) => RelayDOInstance;

interface RelayEnv {
    RELAY_TOKEN: string;
    RELAY_DO: {
        idFromName(name: string): string;
        get(id: string): { fetch(request: Request): Promise<Response> };
    };
}

function loadWorkerModule(): { worker: WorkerHandler; RelayDO: RelayDOConstructor } {
    const src = RELAY_WORKER_CODE
        .replace('export default', 'const __workerDefault =')
        .replace('export class RelayDO', 'class RelayDO')
        + '\nreturn { workerDefault: __workerDefault, RelayDO };';
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the relay worker ships as a template string deployed to Cloudflare; evaluating it is the only way to wire-test the deployed code
    const factory = new Function(src) as () => { workerDefault: WorkerHandler; RelayDO: RelayDOConstructor };
    const mod = factory();
    return { worker: mod.workerDefault, RelayDO: mod.RelayDO };
}

function makeEnv(relay: RelayDOInstance): RelayEnv {
    return {
        RELAY_TOKEN: TOKEN,
        RELAY_DO: {
            idFromName: (name: string) => name,
            get: () => ({ fetch: (req: Request) => relay.fetch(req) }),
        },
    };
}

function pollRequest(): Request {
    return new Request('https://relay.test/poll', {
        method: 'GET',
        headers: { Authorization: `Bearer ${TOKEN}` },
    });
}

function mcpPost(body: Record<string, unknown>, headers: Record<string, string> = {}): Request {
    return new Request(`https://relay.test/${TOKEN}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
        body: JSON.stringify(body),
    });
}

/**
 * FIX-23-04-14: /health only probes the DO for authenticated callers.
 * Browser diagnosis cannot set headers, so the query token is supported too.
 */
function healthRequest(mode?: 'bearer' | 'query'): Request {
    if (mode === 'bearer') {
        return new Request('https://relay.test/health', {
            headers: { Authorization: `Bearer ${TOKEN}` },
        });
    }
    if (mode === 'query') {
        return new Request(`https://relay.test/health?token=${TOKEN}`);
    }
    return new Request('https://relay.test/health');
}

function respondRequest(body: Record<string, unknown>): Request {
    return new Request('https://relay.test/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify(body),
    });
}

afterEach(() => {
    vi.useRealTimers();
});

describe('FIX-23-04-11: DO /poll long-poll', () => {
    it('parks the poll and delivers a request the moment it is enqueued', async () => {
        const { RelayDO } = loadWorkerModule();
        const relay = new RelayDO({}, {});

        // Plugin poll arrives first and must park (queue is empty).
        const pollPromise = relay.fetch(pollRequest());

        // A client POST arrives while the poll is parked.
        const postPromise = relay.fetch(mcpPost({ jsonrpc: '2.0', id: 1, method: 'initialize' }));

        // The parked poll must resolve with the freshly enqueued request,
        // without waiting for any poll interval.
        const pollResp = await pollPromise;
        const pollData = await pollResp.json() as { requests: string[] };
        expect(pollData.requests).toHaveLength(1);

        const delivered = JSON.parse(pollData.requests[0]) as { __correlationId: string; method: string };
        expect(delivered.method).toBe('initialize');

        // Complete the round-trip so the pending 30s timer is cleared.
        await relay.fetch(respondRequest({
            jsonrpc: '2.0',
            id: delivered.__correlationId,
            result: { ok: true },
        }));
        const postResp = await postPromise;
        expect(postResp.status).toBe(200);
        const postData = await postResp.json() as { id: number; result: { ok: boolean } };
        expect(postData.id).toBe(1);
        expect(postData.result.ok).toBe(true);
    });

    it('parks an empty poll for the park window, then answers with empty requests', async () => {
        vi.useFakeTimers();
        const { RelayDO } = loadWorkerModule();
        const relay = new RelayDO({}, {});

        let settled = false;
        const pollPromise = relay.fetch(pollRequest()).then((resp) => {
            settled = true;
            return resp;
        });

        // Must still be parked after 1s (a short-polling DO answers immediately).
        await vi.advanceTimersByTimeAsync(1_000);
        expect(settled).toBe(false);

        // Must be released by the park-window timeout (<= 25s) with an empty batch.
        await vi.advanceTimersByTimeAsync(25_000);
        expect(settled).toBe(true);
        const resp = await pollPromise;
        expect(resp.status).toBe(200);
        const data = await resp.json() as { requests: string[] };
        expect(data.requests).toEqual([]);
    });

    it('supersedes a parked poll with an empty batch and delivers to the new poll', async () => {
        const { RelayDO } = loadWorkerModule();
        const relay = new RelayDO({}, {});

        // Poll A parks (empty queue), poll B supersedes it: the DO holds a
        // single waiter slot, so A must be released with an empty batch and
        // B takes over the parking slot.
        const pollA = relay.fetch(pollRequest());
        const pollB = relay.fetch(pollRequest());

        const respA = await pollA;
        const dataA = await respA.json() as { requests: string[] };
        expect(dataA.requests).toEqual([]);

        // A request arriving now must reach poll B; nothing may be lost
        // or double-delivered through the supersede.
        const postPromise = relay.fetch(mcpPost({ jsonrpc: '2.0', id: 5, method: 'tools/list' }));

        const respB = await pollB;
        const dataB = await respB.json() as { requests: string[] };
        expect(dataB.requests).toHaveLength(1);
        const delivered = JSON.parse(dataB.requests[0]) as { __correlationId: string; method: string };
        expect(delivered.method).toBe('tools/list');

        await relay.fetch(respondRequest({
            jsonrpc: '2.0',
            id: delivered.__correlationId,
            result: { ok: true },
        }));
        const postResp = await postPromise;
        expect(postResp.status).toBe(200);
        const postData = await postResp.json() as { id: number; result: { ok: boolean } };
        expect(postData.id).toBe(5);
        expect(postData.result.ok).toBe(true);
    });
});

describe('FIX-23-04-11: plugin liveness', () => {
    it('fails a POST fast with 502 when the plugin never polled (fresh DO)', async () => {
        const { RelayDO } = loadWorkerModule();
        const relay = new RelayDO({}, {});

        const resp = await relay.fetch(mcpPost({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
        expect(resp.status).toBe(502);
        const data = await resp.json() as { error: { code: number } };
        expect(data.error.code).toBe(-32603);
    });

    it('fails a POST fast with 502 when the last poll is stale, instead of parking 30s', async () => {
        vi.useFakeTimers();
        const { RelayDO } = loadWorkerModule();
        const relay = new RelayDO({}, {});

        // One poll happens, released by the park-window timeout.
        const pollPromise = relay.fetch(pollRequest());
        await vi.advanceTimersByTimeAsync(30_000);
        await pollPromise;

        // Plugin disappears: no polls for well over 2.5x the park window.
        await vi.advanceTimersByTimeAsync(120_000);

        let status = 0;
        const postPromise = relay.fetch(mcpPost({ jsonrpc: '2.0', id: 7, method: 'tools/list' }))
            .then((resp) => { status = resp.status; return resp; });

        // Fast-fail: the 502 must arrive without any timer advancing.
        await vi.advanceTimersByTimeAsync(0);
        expect(status).toBe(502);

        // Drain any stray timers defensively.
        await vi.advanceTimersByTimeAsync(60_000);
        await postPromise;
    });

    it('exposes plugin liveness in /health for token-authenticated callers', async () => {
        vi.useFakeTimers();
        const { worker, RelayDO } = loadWorkerModule();
        const relay = new RelayDO({}, {});
        const env = makeEnv(relay);

        // Fresh relay: no plugin has ever polled.
        const fresh = await worker.fetch(healthRequest('bearer'), env);
        expect(fresh.status).toBe(200);
        const freshData = await fresh.json() as {
            status: string;
            plugin: { connected: boolean; lastPollAgeMs: number | null };
        };
        expect(freshData.status).toBe('ok');
        expect(freshData.plugin.connected).toBe(false);
        expect(freshData.plugin.lastPollAgeMs).toBeNull();

        // A parked poll marks the plugin as alive.
        const pollPromise = relay.fetch(pollRequest());
        await vi.advanceTimersByTimeAsync(2_000);

        const alive = await worker.fetch(healthRequest('bearer'), env);
        const aliveData = await alive.json() as {
            plugin: { connected: boolean; lastPollAgeMs: number | null };
        };
        expect(aliveData.plugin.connected).toBe(true);
        expect(typeof aliveData.plugin.lastPollAgeMs).toBe('number');

        await vi.advanceTimersByTimeAsync(30_000);
        await pollPromise;
    });
});

describe('FIX-23-04-14: /health auth gate for the DO probe', () => {
    it('answers anonymous /health statically without a DO subrequest', async () => {
        const { worker, RelayDO } = loadWorkerModule();
        const relay = new RelayDO({}, {});
        const env = makeEnv(relay);
        const getSpy = vi.spyOn(env.RELAY_DO, 'get');

        const resp = await worker.fetch(healthRequest(), env);
        expect(resp.status).toBe(200);
        const data = await resp.json() as { status: string; relay: string; plugin?: unknown };
        expect(data.status).toBe('ok');
        expect(data.relay).toBe('obsilo');
        // No plugin liveness and, crucially, no DO request burned: an
        // unauthenticated caller must not be able to consume the free-plan
        // DO request quota or keep the DO resident via /health.
        expect(data.plugin).toBeUndefined();
        expect(getSpy).not.toHaveBeenCalled();
    });

    it('probes the DO for a ?token= authenticated /health (browser diagnosis)', async () => {
        const { worker, RelayDO } = loadWorkerModule();
        const relay = new RelayDO({}, {});
        const env = makeEnv(relay);

        const resp = await worker.fetch(healthRequest('query'), env);
        expect(resp.status).toBe(200);
        const data = await resp.json() as { plugin: { connected: boolean } };
        expect(data.plugin).toBeDefined();
        expect(data.plugin.connected).toBe(false);
    });

    it('treats a wrong token as anonymous (static status only)', async () => {
        const { worker, RelayDO } = loadWorkerModule();
        const relay = new RelayDO({}, {});
        const env = makeEnv(relay);
        const getSpy = vi.spyOn(env.RELAY_DO, 'get');

        const resp = await worker.fetch(new Request('https://relay.test/health?token=wrong'), env);
        expect(resp.status).toBe(200);
        const data = await resp.json() as { plugin?: unknown };
        expect(data.plugin).toBeUndefined();
        expect(getSpy).not.toHaveBeenCalled();
    });
});

describe('FIX-23-04-14: CORS scope on plugin endpoints (H-6)', () => {
    it('omits CORS headers on the error envelope for plugin endpoints', async () => {
        const { worker } = loadWorkerModule();
        const env: RelayEnv = {
            RELAY_TOKEN: TOKEN,
            RELAY_DO: {
                idFromName: (name: string) => name,
                get: () => ({ fetch: () => { throw new Error('DO exploded'); } }),
            },
        };

        const resp = await worker.fetch(pollRequest(), env);
        expect(resp.status).toBe(500);
        expect(resp.headers.get('Access-Control-Allow-Origin')).toBeNull();
        const data = await resp.json() as { error: { code: number } };
        expect(data.error.code).toBe(-32603);
    });

    it('answers HEAD on plugin endpoints without CORS headers', async () => {
        const { worker, RelayDO } = loadWorkerModule();
        const relay = new RelayDO({}, {});
        const env = makeEnv(relay);

        for (const path of ['/poll', '/respond']) {
            const resp = await worker.fetch(new Request(`https://relay.test${path}`, { method: 'HEAD' }), env);
            expect(resp.status).toBe(200);
            expect(resp.headers.get('Access-Control-Allow-Origin')).toBeNull();
        }
    });

    it('keeps CORS headers on HEAD for the MCP endpoint', async () => {
        const { worker, RelayDO } = loadWorkerModule();
        const relay = new RelayDO({}, {});
        const env = makeEnv(relay);

        const resp = await worker.fetch(new Request(`https://relay.test/${TOKEN}/mcp`, { method: 'HEAD' }), env);
        expect(resp.status).toBe(200);
        expect(resp.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
});

describe('FIX-23-04-11: worker round-trip (regression, AUDIT-015)', () => {
    it('answers a POSTed initialize through the parked poll with JSON content type and a session id', async () => {
        const { worker, RelayDO } = loadWorkerModule();
        const relay = new RelayDO({}, {});
        const env = makeEnv(relay);

        const pollPromise = worker.fetch(pollRequest(), env);

        // The worker path awaits async token digests before reaching the DO,
        // so poll/POST ordering is not guaranteed by call order alone. Wait
        // until /health reports the parked poll before POSTing, otherwise
        // the POST can hit a fresh DO and fast-fail with 502.
        let gateOpen = false;
        for (let i = 0; i < 50; i++) {
            // Yield a macrotask so the /poll path's async token digest
            // (crypto.subtle) can settle; microtask-only spinning never
            // lets the poll park.
            await new Promise((resolve) => setTimeout(resolve, 0));
            const health = await worker.fetch(healthRequest('bearer'), env);
            const h = await health.json() as { plugin: { connected: boolean } };
            if (h.plugin.connected) { gateOpen = true; break; }
        }
        // FIX-23-04-14 (review): fail loudly here instead of letting the
        // round-trip assertions below produce a confusing 502/timeout when
        // the ordering guard never saw the parked poll.
        expect(gateOpen, 'health gate never reported the parked poll').toBe(true);

        const postPromise = worker.fetch(mcpPost({
            jsonrpc: '2.0',
            id: 42,
            method: 'initialize',
            params: { protocolVersion: '2025-03-26' },
        }), env);

        const pollResp = await pollPromise;
        const pollData = await pollResp.json() as { requests: string[] };
        expect(pollData.requests).toHaveLength(1);
        const delivered = JSON.parse(pollData.requests[0]) as { __correlationId: string };

        await worker.fetch(respondRequest({
            jsonrpc: '2.0',
            id: delivered.__correlationId,
            result: { protocolVersion: '2025-03-26' },
        }), env);

        const postResp = await postPromise;
        expect(postResp.status).toBe(200);
        expect(postResp.headers.get('Content-Type')).toContain('application/json');
        expect(postResp.headers.get('Mcp-Session-Id')).toBeTruthy();
        const postData = await postResp.json() as { id: number };
        expect(postData.id).toBe(42);
    });
});

describe('FIX-23-04-12: error envelopes and probe paths', () => {
    it('answers with a JSON-RPC -32603 envelope instead of an unhandled exception when the DO fetch throws', async () => {
        const { worker } = loadWorkerModule();
        const env: RelayEnv = {
            RELAY_TOKEN: TOKEN,
            RELAY_DO: {
                idFromName: (name: string) => name,
                get: () => ({ fetch: () => { throw new Error('DO exploded'); } }),
            },
        };

        const resp = await worker.fetch(mcpPost({ jsonrpc: '2.0', id: 1, method: 'initialize' }), env);
        expect(resp.status).toBe(500);
        expect(resp.headers.get('Content-Type')).toContain('application/json');
        expect(resp.headers.get('Access-Control-Allow-Origin')).toBe('*');
        const data = await resp.json() as { error: { code: number } };
        expect(data.error.code).toBe(-32603);
    });

    it('answers /respond with an invalid JSON body with a JSON -32603 envelope instead of throwing', async () => {
        const { RelayDO } = loadWorkerModule();
        const relay = new RelayDO({}, {});

        const resp = await relay.fetch(new Request('https://relay.test/respond', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
            body: 'this is not json',
        }));
        expect(resp.status).toBe(500);
        expect(resp.headers.get('Content-Type')).toContain('application/json');
        const data = await resp.json() as { error: { code: number } };
        expect(data.error.code).toBe(-32603);
    });

    it('answers HEAD with 200 and no body', async () => {
        const { worker, RelayDO } = loadWorkerModule();
        const relay = new RelayDO({}, {});
        const env = makeEnv(relay);

        const resp = await worker.fetch(new Request(`https://relay.test/${TOKEN}/mcp`, { method: 'HEAD' }), env);
        expect(resp.status).toBe(200);
        expect(await resp.text()).toBe('');
    });

    it('answers /.well-known/ OAuth probes with a clean JSON 404 without requiring auth', async () => {
        const { worker, RelayDO } = loadWorkerModule();
        const relay = new RelayDO({}, {});
        const env = makeEnv(relay);

        for (const path of [
            '/.well-known/oauth-authorization-server',
            '/.well-known/oauth-protected-resource',
        ]) {
            const resp = await worker.fetch(new Request(`https://relay.test${path}`, { method: 'GET' }), env);
            expect(resp.status).toBe(404);
            expect(resp.headers.get('Content-Type')).toContain('application/json');
            const data = await resp.json() as { error: string };
            expect(data.error).toBe('not_found');
        }
    });
});

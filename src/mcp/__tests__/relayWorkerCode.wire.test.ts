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

    it('exposes plugin liveness in /health', async () => {
        vi.useFakeTimers();
        const { worker, RelayDO } = loadWorkerModule();
        const relay = new RelayDO({}, {});
        const env = makeEnv(relay);

        // Fresh relay: no plugin has ever polled.
        const fresh = await worker.fetch(new Request('https://relay.test/health'), env);
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

        const alive = await worker.fetch(new Request('https://relay.test/health'), env);
        const aliveData = await alive.json() as {
            plugin: { connected: boolean; lastPollAgeMs: number | null };
        };
        expect(aliveData.plugin.connected).toBe(true);
        expect(typeof aliveData.plugin.lastPollAgeMs).toBe('number');

        await vi.advanceTimersByTimeAsync(30_000);
        await pollPromise;
    });
});

describe('FIX-23-04-11: worker round-trip (regression, AUDIT-015)', () => {
    it('answers a POSTed initialize through the parked poll with JSON content type and a session id', async () => {
        const { worker, RelayDO } = loadWorkerModule();
        const relay = new RelayDO({}, {});
        const env = makeEnv(relay);

        const pollPromise = worker.fetch(pollRequest(), env);
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

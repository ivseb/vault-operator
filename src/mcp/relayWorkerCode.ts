/**
 * Embedded Cloudflare Worker code for the Obsilo Relay.
 * This is uploaded to Cloudflare via REST API when the user clicks "Deploy".
 *
 * Architecture: HTTP long-polling (NOT WebSocket) for Obsidian compatibility.
 * Obsidian's renderer CSP blocks WebSocket to external servers,
 * so we use requestUrl-based polling instead.
 *
 * Flow:
 *   1. AI assistant (claude.ai) sends POST /{token}/mcp with JSON-RPC
 *   2. Relay stores the request in the DO
 *   3. Plugin polls GET /poll?token=xxx and receives pending requests
 *   4. Plugin processes request, sends result via POST /respond?token=xxx
 *   5. DO resolves the original HTTP response to the AI assistant
 *
 * URL structure:
 *   /health                  -- health check (no auth)
 *   /poll?token=xxx          -- plugin polls for pending requests (long-poll, 25s)
 *   /respond?token=xxx       -- plugin sends tool results back
 *   /{token}/mcp             -- MCP endpoint for AI assistants (token in URL)
 *   POST with Bearer header  -- MCP endpoint (Bearer auth)
 *
 * FEATURE-1403: Remote Transport
 */

export const RELAY_WORKER_CODE = `
// Obsilo Relay Worker -- deployed via Obsilo Plugin
export default {
    async fetch(request, env) {
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders });
        }

        const url = new URL(request.url);

        if (url.pathname === '/health') {
            return new Response(JSON.stringify({ status: 'ok', relay: 'obsilo' }), {
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
        }

        // Diagnostic endpoint (no auth) -- shows if token arrives correctly
        if (url.pathname === '/diag') {
            const qToken = url.searchParams.get('token') || '';
            const envLen = env.RELAY_TOKEN ? env.RELAY_TOKEN.length : 0;
            return new Response(JSON.stringify({
                receivedTokenLength: qToken.length,
                expectedTokenLength: envLen,
                match: qToken === env.RELAY_TOKEN,
                receivedPrefix: qToken.slice(0, 6),
                expectedPrefix: env.RELAY_TOKEN ? env.RELAY_TOKEN.slice(0, 6) : '',
                fullUrl: url.toString().replace(/token=[^&]+/, 'token=***'),
            }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        // Debug endpoint (no auth) -- shows DO state
        if (url.pathname === '/debug') {
            const id = env.RELAY_DO.idFromName('default');
            const relay = env.RELAY_DO.get(id);
            const resp = await relay.fetch(request);
            const newResp = new Response(resp.body, resp);
            for (const [k, v] of Object.entries(corsHeaders)) newResp.headers.set(k, v);
            return newResp;
        }

        // Plugin polling and respond endpoints (auth via query param)
        if (url.pathname === '/poll' || url.pathname === '/respond') {
            const token = url.searchParams.get('token') || '';
            if (!token || token !== env.RELAY_TOKEN) {
                return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                    status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders },
                });
            }
            const id = env.RELAY_DO.idFromName('default');
            const relay = env.RELAY_DO.get(id);
            const resp = await relay.fetch(request);
            const newResp = new Response(resp.body, resp);
            for (const [k, v] of Object.entries(corsHeaders)) newResp.headers.set(k, v);
            return newResp;
        }

        // MCP endpoint: auth via URL path (/{token}/mcp) or Bearer header
        let authenticated = false;
        const parts = url.pathname.split('/').filter(Boolean);
        const pathMatch = parts.length === 2 && parts[1] === 'mcp' ? parts : null;
        if (pathMatch && pathMatch[0] === env.RELAY_TOKEN) {
            authenticated = true;
        }
        if (!authenticated) {
            const bearer = (request.headers.get('Authorization') || '').replace('Bearer ', '');
            if (bearer && bearer === env.RELAY_TOKEN) {
                authenticated = true;
            }
        }
        if (!authenticated) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
        }

        // Forward authenticated MCP request to DO
        const id = env.RELAY_DO.idFromName('default');
        const relay = env.RELAY_DO.get(id);
        const resp = await relay.fetch(request);
        const newResp = new Response(resp.body, resp);
        for (const [k, v] of Object.entries(corsHeaders)) newResp.headers.set(k, v);
        return newResp;
    },
};

export class RelayDO {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        // Pending MCP requests waiting for plugin response
        // Map<correlationId, { resolve, reject, timeout }>
        this.pending = new Map();
        // Queue of MCP requests waiting to be picked up by plugin
        this.requestQueue = [];
        this.pluginConnected = false;
        this.logs = [];
    }

    addLog(msg) {
        this.logs.push({ t: Date.now(), msg });
        if (this.logs.length > 50) this.logs.shift();
    }

    async fetch(request) {
        const url = new URL(request.url);

        // Debug endpoint
        if (url.pathname === '/debug') {
            return new Response(JSON.stringify({
                pluginConnected: this.pluginConnected,
                pendingCount: this.pending.size,
                queueLength: this.requestQueue.length,
                logs: this.logs.slice(-20),
            }, null, 2), { headers: { 'Content-Type': 'application/json' } });
        }

        // Plugin polls for pending MCP requests
        if (url.pathname === '/poll') {
            this.pluginConnected = true;
            const requests = this.requestQueue.splice(0);
            if (requests.length > 0) {
                this.addLog('poll: returning ' + requests.length + ' requests');
            }
            return new Response(JSON.stringify({ requests }), {
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Plugin sends response to an MCP request
        if (url.pathname === '/respond' && request.method === 'POST') {
            const body = await request.json();
            const id = String(body.id ?? '');
            const pending = this.pending.get(id);
            if (pending) {
                clearTimeout(pending.timeout);
                this.pending.delete(id);
                pending.resolve(JSON.stringify(body));
            }
            return new Response(JSON.stringify({ ok: true }), {
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // MCP request from AI assistant (POST)
        if (request.method === 'POST') {
            this.addLog('mcp: POST ' + url.pathname + ' pluginConnected=' + this.pluginConnected);
            if (!this.pluginConnected) {
                return new Response(JSON.stringify({
                    jsonrpc: '2.0', id: null,
                    error: { code: -32603, message: 'Obsilo not connected. Make sure Obsidian is running with remote access enabled.' },
                }), { status: 502, headers: { 'Content-Type': 'application/json' } });
            }

            const body = await request.text();
            let parsed;
            try { parsed = JSON.parse(body); } catch { return new Response('Invalid JSON', { status: 400 }); }

            // Notification (no id) -- fire and forget
            if (parsed.id === undefined || parsed.id === null) {
                this.addLog('mcp: notification method=' + (parsed.method || 'unknown'));
                this.enqueueForPlugin(body);
                return new Response(null, { status: 204 });
            }

            this.addLog('mcp: request id=' + parsed.id + ' method=' + (parsed.method || 'unknown'));
            // Request with id -- wait for response from plugin (30s timeout)
            const correlationId = String(parsed.id);
            const responsePromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    this.pending.delete(correlationId);
                    reject(new Error('Plugin response timeout (30s)'));
                }, 30000);
                this.pending.set(correlationId, { resolve, reject, timeout });
            });

            this.enqueueForPlugin(body);

            try {
                const response = await responsePromise;
                this.addLog('mcp: response for id=' + correlationId + ' len=' + response.length);
                return new Response(response, { headers: { 'Content-Type': 'application/json' } });
            } catch (e) {
                return new Response(JSON.stringify({
                    jsonrpc: '2.0', id: parsed.id,
                    error: { code: -32603, message: e.message || 'Timeout' },
                }), { status: 504, headers: { 'Content-Type': 'application/json' } });
            }
        }

        return new Response('Method not allowed', { status: 405 });
    }

    enqueueForPlugin(body) {
        this.requestQueue.push(body);
    }
}
`;

/** Metadata for the Cloudflare Worker upload (Durable Object bindings + migrations). */
export const RELAY_WORKER_METADATA = {
    main_module: 'worker.js',
    bindings: [
        { type: 'durable_object_namespace', name: 'RELAY_DO', class_name: 'RelayDO' },
    ],
    compatibility_date: '2024-09-01',
    migrations: {
        tag: 'v1',
        new_sqlite_classes: ['RelayDO'],
    },
};

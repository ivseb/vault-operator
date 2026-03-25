/**
 * obsidianFetch -- CORS-free fetch adapter for MCP transports in Obsidian/Electron.
 *
 * Obsidian runs in Electron's renderer process. The browser-native `fetch()` enforces
 * CORS, which blocks SSE connections to MCP servers that don't set Access-Control-Allow-Origin.
 * Obsidian's `requestUrl` bypasses CORS but doesn't support streaming (needed for SSE).
 *
 * This adapter uses Node.js http/https modules (available in Electron with nodeIntegration)
 * which have no CORS restrictions and support streaming responses.
 *
 * Signature matches MCP SDK's FetchLike: (url, init?) => Promise<Response>
 */

import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';

/**
 * CORS-free fetch using Node.js http/https. Returns a standard Web Response
 * with a streaming body (ReadableStream), compatible with the MCP SDK's
 * SSEClientTransport and StreamableHTTPClientTransport.
 */
export function obsidianFetch(url: string | URL, init?: RequestInit): Promise<Response> {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url.toString());
        const isHttps = parsedUrl.protocol === 'https:';
        const reqFn = isHttps ? httpsRequest : httpRequest;

        // Convert RequestInit headers to plain object
        const headers: Record<string, string> = {};
        if (init?.headers) {
            if (init.headers instanceof Headers) {
                init.headers.forEach((value, key) => { headers[key] = value; });
            } else if (Array.isArray(init.headers)) {
                for (const [key, value] of init.headers) {
                    headers[key] = value;
                }
            } else {
                Object.assign(headers, init.headers);
            }
        }

        const req = reqFn(
            {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (isHttps ? 443 : 80),
                path: parsedUrl.pathname + parsedUrl.search,
                method: init?.method ?? 'GET',
                headers,
            },
            (res) => {
                // Convert Node.js IncomingMessage stream to Web ReadableStream
                const body = new ReadableStream<Uint8Array>({
                    start(controller) {
                        res.on('data', (chunk: Buffer) => {
                            controller.enqueue(new Uint8Array(chunk));
                        });
                        res.on('end', () => {
                            try { controller.close(); } catch { /* already closed */ }
                        });
                        res.on('error', (err) => {
                            try { controller.error(err); } catch { /* already errored */ }
                        });
                    },
                    cancel() {
                        res.destroy();
                    },
                });

                // Convert Node.js headers to Web Headers
                const responseHeaders = new Headers();
                for (const [key, value] of Object.entries(res.headers)) {
                    if (value != null) {
                        if (Array.isArray(value)) {
                            for (const v of value) responseHeaders.append(key, v);
                        } else {
                            responseHeaders.set(key, value);
                        }
                    }
                }

                const response = new Response(body, {
                    status: res.statusCode ?? 200,
                    statusText: res.statusMessage ?? '',
                    headers: responseHeaders,
                });

                resolve(response);
            },
        );

        req.on('error', reject);

        // AbortSignal support
        if (init?.signal) {
            if (init.signal.aborted) {
                req.destroy();
                reject(new DOMException('The operation was aborted.', 'AbortError'));
                return;
            }
            init.signal.addEventListener('abort', () => {
                req.destroy();
            }, { once: true });
        }

        // Write request body
        if (init?.body != null) {
            if (typeof init.body === 'string') {
                req.write(init.body);
            } else if (init.body instanceof ArrayBuffer) {
                req.write(Buffer.from(init.body));
            } else if (init.body instanceof Uint8Array) {
                req.write(Buffer.from(init.body.buffer, init.body.byteOffset, init.body.byteLength));
            } else if (init.body instanceof URLSearchParams) {
                req.write(init.body.toString());
            }
        }

        req.end();
    });
}

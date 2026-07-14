/**
 * AUDIT 2026-07-14 (Codex) M-7: web_fetch buffered the whole response before
 * enforcing any size limit (Buffer.concat then a 2 MB parse cap), so a large or
 * slow response could exhaust the renderer heap. These tests pin the hard byte
 * cap enforced while streaming plus the early Content-Length rejection.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import {
    parseContentLength,
    readCappedResponseBody,
    MAX_RESPONSE_BYTES,
} from '../WebFetchTool';

function fakeRes(headers: Record<string, string> = {}): EventEmitter & { headers: Record<string, string> } {
    const e = new EventEmitter() as EventEmitter & { headers: Record<string, string> };
    e.headers = headers;
    return e;
}

describe('parseContentLength', () => {
    it('parses a numeric header', () => {
        expect(parseContentLength('1234')).toBe(1234);
        expect(parseContentLength(['1234'])).toBe(1234);
    });
    it('returns null for absent or invalid values', () => {
        expect(parseContentLength(undefined)).toBeNull();
        expect(parseContentLength('not-a-number')).toBeNull();
        expect(parseContentLength('-5')).toBeNull();
    });
});

describe('readCappedResponseBody (M-7)', () => {
    it('resolves a small body and never aborts', async () => {
        const res = fakeRes();
        const onAbort = vi.fn();
        const p = readCappedResponseBody(res, onAbort, MAX_RESPONSE_BYTES);
        res.emit('data', Buffer.from('hello '));
        res.emit('data', Buffer.from('world'));
        res.emit('end');
        await expect(p).resolves.toBe('hello world');
        expect(onAbort).not.toHaveBeenCalled();
    });

    it('rejects immediately when Content-Length exceeds the cap', async () => {
        const res = fakeRes({ 'content-length': String(MAX_RESPONSE_BYTES + 1) });
        const onAbort = vi.fn();
        await expect(readCappedResponseBody(res, onAbort, MAX_RESPONSE_BYTES)).rejects.toThrow(/cap/i);
        expect(onAbort).toHaveBeenCalledTimes(1);
    });

    it('aborts and rejects once streamed bytes exceed the cap', async () => {
        const res = fakeRes();
        const onAbort = vi.fn();
        const cap = 10;
        const p = readCappedResponseBody(res, onAbort, cap);
        res.emit('data', Buffer.from('12345'));
        res.emit('data', Buffer.from('67890XYZ')); // pushes total to 13 > 10
        await expect(p).rejects.toThrow(/cap/i);
        expect(onAbort).toHaveBeenCalledTimes(1);
    });
});

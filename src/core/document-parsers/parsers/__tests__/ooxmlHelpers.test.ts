/**
 * Regression tests for AUDIT-034 M-7 (OOXML pre-decompression size cap).
 *
 * Pins three invariants on openZipSafe:
 *   1. A legitimate, small ZIP opens cleanly.
 *   2. A single entry whose advertised uncompressed size exceeds the
 *      50 MB per-entry cap is rejected BEFORE decompression runs.
 *   3. Many small entries whose advertised cumulative size exceeds the
 *      500 MB cumulative cap are rejected BEFORE decompression runs.
 *
 * The pre-decompression check matters because file.async('text')
 * materialises the full decompressed buffer in V8 memory before any
 * post-hoc size tracker can fire. JSZip exposes the advertised
 * uncompressed size via the internal _data record; openZipSafe reads
 * that without ever calling .async() on the entry.
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { openZipSafe, MAX_SINGLE_ENTRY_DECOMPRESSED_SIZE } from '../ooxmlHelpers';
import { MAX_DECOMPRESSED_SIZE } from '../../types';

/**
 * Build a real JSZip-encoded ArrayBuffer with one tiny entry. The test
 * mutates the in-memory zip.files map after loadAsync to spoof the
 * advertised uncompressed size, which is exactly the threat model
 * (attacker-controlled metadata, no actual giant payload).
 */
async function buildTinyZipBytes(entries: Record<string, string>): Promise<ArrayBuffer> {
    const zip = new JSZip();
    for (const [name, content] of Object.entries(entries)) {
        zip.file(name, content);
    }
    const u8 = await zip.generateAsync({ type: 'uint8array' });
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/**
 * Spoof the advertised uncompressedSize on every JSZip entry by
 * monkey-patching loadAsync via a wrapper. We round-trip through
 * JSZip ourselves, then override the _data record before openZipSafe
 * inspects it.
 */
async function loadAndSpoofSizes(
    bytes: ArrayBuffer,
    sizes: Record<string, number>,
): Promise<JSZip> {
    const zip = await JSZip.loadAsync(bytes);
    for (const [name, file] of Object.entries(zip.files)) {
        const desired = sizes[name];
        if (desired === undefined) continue;
        const raw = (file as unknown as { _data?: Record<string, unknown> })._data;
        if (raw) raw.uncompressedSize = desired;
    }
    return zip;
}

describe('openZipSafe (AUDIT-034 M-7 pre-decompression cap)', () => {
    it('opens a legitimate small OOXML-shaped ZIP', async () => {
        const bytes = await buildTinyZipBytes({
            '[Content_Types].xml': '<Types/>',
            'word/document.xml': '<document><body/></document>',
        });
        const zip = await openZipSafe(bytes);
        expect(Object.keys(zip.files).length).toBeGreaterThan(0);
    });

    it('rejects a single entry whose advertised uncompressed size exceeds the per-entry cap', async () => {
        // We need to bypass JSZip's actual loadAsync so we can inject
        // a spoofed _data.uncompressedSize. openZipSafe itself calls
        // JSZip.loadAsync, so we temporarily monkey-patch it.
        const bytes = await buildTinyZipBytes({
            'word/document.xml': '<small/>',
        });
        const spoofed = await loadAndSpoofSizes(bytes, {
            'word/document.xml': MAX_SINGLE_ENTRY_DECOMPRESSED_SIZE + 1,
        });

        const originalLoad = JSZip.loadAsync;
        JSZip.loadAsync = (async () => spoofed) as typeof JSZip.loadAsync;
        try {
            await expect(openZipSafe(bytes)).rejects.toThrow(/per-entry safety limit/);
        } finally {
            JSZip.loadAsync = originalLoad;
        }
    });

    it('rejects when cumulative advertised uncompressed size exceeds the global cap', async () => {
        // Five entries, each just under the per-entry cap, summing to
        // more than MAX_DECOMPRESSED_SIZE (500 MB).
        const oneEntry = MAX_SINGLE_ENTRY_DECOMPRESSED_SIZE - 1;
        const needed = Math.ceil(MAX_DECOMPRESSED_SIZE / oneEntry) + 1;
        const fileNames: string[] = [];
        const inputs: Record<string, string> = {};
        const spoofedSizes: Record<string, number> = {};
        for (let i = 0; i < needed; i++) {
            const name = `entry-${i}.xml`;
            fileNames.push(name);
            inputs[name] = '<x/>';
            spoofedSizes[name] = oneEntry;
        }
        const bytes = await buildTinyZipBytes(inputs);
        const spoofed = await loadAndSpoofSizes(bytes, spoofedSizes);

        const originalLoad = JSZip.loadAsync;
        JSZip.loadAsync = (async () => spoofed) as typeof JSZip.loadAsync;
        try {
            await expect(openZipSafe(bytes)).rejects.toThrow(
                /cumulative uncompressed size exceeds safety limit/,
            );
        } finally {
            JSZip.loadAsync = originalLoad;
        }
    });

    it('still rejects path traversal entries (regression)', async () => {
        const bytes = await buildTinyZipBytes({
            '../escape.xml': '<x/>',
        });
        await expect(openZipSafe(bytes)).rejects.toThrow(/Suspicious path/);
    });
});

/**
 * AUDIT-034 SSRF regression tests for WebFetchTool.
 *
 * Covers the M-3 + L-5 fix surface: bracket-stripped IPv6, IPv4-mapped IPv6,
 * CGNAT, multicast, broadcast, unspecified, tighter link-local pattern, and
 * the internal-hostname suffix denylist that backs the L-13 split-horizon fix.
 */

import { describe, it, expect } from 'vitest';
import { isPrivateIP, hasInternalSuffix } from '../WebFetchTool';

describe('isPrivateIP (AUDIT-034 M-3 + L-5)', () => {
    describe('IPv4 private ranges', () => {
        it.each([
            ['127.0.0.1', true, 'loopback'],
            ['127.255.255.254', true, 'loopback edge'],
            ['10.0.0.1', true, 'RFC 1918 /8'],
            ['172.16.0.1', true, 'RFC 1918 /12 low edge'],
            ['172.31.255.255', true, 'RFC 1918 /12 high edge'],
            ['172.32.0.1', false, 'just outside RFC 1918 /12'],
            ['192.168.1.1', true, 'RFC 1918 /16'],
            ['169.254.169.254', true, 'AWS metadata link-local'],
            ['0.0.0.0', true, 'unspecified / this network'],
            ['100.64.0.1', true, 'CGNAT low edge (RFC 6598)'],
            ['100.127.255.255', true, 'CGNAT high edge'],
            ['100.63.255.255', false, 'just below CGNAT'],
            ['100.128.0.0', false, 'just above CGNAT'],
            ['224.0.0.1', true, 'multicast low edge'],
            ['239.255.255.255', true, 'multicast high edge'],
            ['255.255.255.255', true, 'limited broadcast'],
            ['240.0.0.1', true, 'reserved /4'],
            ['8.8.8.8', false, 'public DNS'],
            ['1.1.1.1', false, 'public DNS'],
        ])('classifies %s as private=%s (%s)', (ip, expected) => {
            expect(isPrivateIP(ip)).toBe(expected);
        });

        it('rejects malformed IPv4 with non-numeric octets', () => {
            expect(isPrivateIP('127.0.0.1.evil.com')).toBe(false);
            expect(isPrivateIP('a.b.c.d')).toBe(false);
            expect(isPrivateIP('127.0.0')).toBe(false);
            expect(isPrivateIP('127.0.0.256')).toBe(false);
        });
    });

    describe('IPv6 private ranges', () => {
        it.each([
            ['::1', true, 'loopback'],
            ['::', true, 'unspecified'],
            ['fe80::1', true, 'link-local'],
            ['fe80::1%eth0', true, 'link-local with zone id'],
            ['febf::1', true, 'link-local upper edge'],
            ['fec0::1', false, 'just outside link-local (deprecated site-local)'],
            ['fc00::1', true, 'unique-local'],
            ['fd00::1', true, 'unique-local'],
            ['ff02::1', true, 'multicast all-nodes'],
            ['2606:4700:4700::1111', false, 'public Cloudflare DNS IPv6'],
        ])('classifies %s as private=%s (%s)', (ip, expected) => {
            expect(isPrivateIP(ip)).toBe(expected);
        });

        it('strips brackets before classifying IPv6 literals', () => {
            expect(isPrivateIP('[::1]')).toBe(true);
            expect(isPrivateIP('[fe80::1]')).toBe(true);
            expect(isPrivateIP('[2606:4700:4700::1111]')).toBe(false);
        });

        it('recurses into IPv4-mapped IPv6 (dotted form)', () => {
            expect(isPrivateIP('::ffff:127.0.0.1')).toBe(true);
            expect(isPrivateIP('[::ffff:127.0.0.1]')).toBe(true);
            expect(isPrivateIP('::ffff:169.254.169.254')).toBe(true);
            expect(isPrivateIP('::ffff:8.8.8.8')).toBe(false);
        });

        it('recurses into IPv4-mapped IPv6 (hex form)', () => {
            // 7f00:0001 = 127.0.0.1
            expect(isPrivateIP('::ffff:7f00:1')).toBe(true);
            expect(isPrivateIP('[::ffff:7f00:1]')).toBe(true);
            // a9fe:a9fe = 169.254.169.254 (AWS metadata)
            expect(isPrivateIP('::ffff:a9fe:a9fe')).toBe(true);
            // 0808:0808 = 8.8.8.8 (public)
            expect(isPrivateIP('::ffff:808:808')).toBe(false);
        });
    });
});

describe('hasInternalSuffix (AUDIT-034 L-13 split-horizon denylist)', () => {
    it.each([
        ['localhost', true],
        ['wiki.internal', true],
        ['wiki.internal.example.com', false],
        ['service.local', true],
        ['printer.lan', true],
        ['build.corp', true],
        ['dev.home', true],
        ['router.home.arpa', true],
        ['intra.company.intra', true],
        ['example.com', false],
        ['internal.com', false],
    ])('classifies %s as internal=%s', (host, expected) => {
        expect(hasInternalSuffix(host)).toBe(expected);
    });

    it('is case-insensitive', () => {
        expect(hasInternalSuffix('Wiki.Internal')).toBe(true);
        expect(hasInternalSuffix('SERVICE.LOCAL')).toBe(true);
    });
});

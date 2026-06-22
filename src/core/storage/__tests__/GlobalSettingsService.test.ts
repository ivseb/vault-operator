/**
 * AUDIT-034 H-2 / H-3 / H-4 regression -- GlobalSettingsService must encrypt
 * the ChatGPT OAuth tokens and the providerConfigs[] / legacy_active_models_backup
 * credential fields before writing the global settings file. The dual-write
 * path used to mirror only 8 leaf token fields and skip the EPIC-26 walker,
 * so AWS secret access keys, provider api keys, and OAuth refresh tokens
 * landed plaintext in vault-operator-shared/settings.json (CWE-256 / CWE-312).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GlobalSettingsService } from '../GlobalSettingsService';
import type { GlobalFileService } from '../GlobalFileService';
import type { SafeStorageService } from '../../security/SafeStorageService';
import type { ObsidianAgentSettings, ProviderConfig } from '../../../types/settings';

const ENC_PREFIX = 'enc:test:';

class FakeGlobalFs {
    public lastWritten: string | undefined;
    public files = new Map<string, string>();

    async exists(p: string): Promise<boolean> {
        return this.files.has(p);
    }
    async read(p: string): Promise<string> {
        const raw = this.files.get(p);
        if (raw === undefined) throw new Error(`missing: ${p}`);
        return raw;
    }
    async write(p: string, data: string): Promise<void> {
        this.lastWritten = data;
        this.files.set(p, data);
    }
}

function makeSafeStorage(): SafeStorageService {
    // Encode the plaintext as base64 so the encrypted form does NOT contain
    // the plaintext marker as a substring. This mirrors the real SafeStorage
    // wire format (Electron safeStorage emits opaque bytes) and lets the
    // "raw file does not contain the plaintext" assertion be meaningful.
    const fake = {
        isAvailable: () => true,
        isEncrypted: (v: string | undefined) => typeof v === 'string' && v.startsWith(ENC_PREFIX),
        encrypt: (v: string) => ENC_PREFIX + Buffer.from(v, 'utf8').toString('base64'),
        decrypt: (v: string) => {
            if (typeof v !== 'string' || !v.startsWith(ENC_PREFIX)) return v;
            return Buffer.from(v.slice(ENC_PREFIX.length), 'base64').toString('utf8');
        },
    };
    return fake as unknown as SafeStorageService;
}

function enc(plain: string): string {
    return ENC_PREFIX + Buffer.from(plain, 'utf8').toString('base64');
}

function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
    return {
        id: 'anthropic-main',
        type: 'anthropic',
        enabled: true,
        apiKey: 'sk-cleartext-anthropic',
        discoveredModels: [],
        lastRefreshAt: 0,
        tierMapping: {},
        tierOverrides: {},
        ...overrides,
    } as ProviderConfig;
}

function makeSettings(overrides: Partial<ObsidianAgentSettings> = {}): ObsidianAgentSettings {
    return {
        activeModels: [],
        embeddingModels: [],
        providerConfigs: [],
        legacy_active_models_backup: [],
        ...overrides,
    } as unknown as ObsidianAgentSettings;
}

describe('GlobalSettingsService AUDIT-034 H-2/H-3/H-4', () => {
    let fs: FakeGlobalFs;
    let safe: SafeStorageService;
    let svc: GlobalSettingsService;

    beforeEach(() => {
        fs = new FakeGlobalFs();
        safe = makeSafeStorage();
        svc = new GlobalSettingsService(
            fs as unknown as GlobalFileService,
            safe,
        );
    });

    it('encrypts ChatGPT OAuth tokens (H-2) before writing the global file', async () => {
        const settings = makeSettings({
            chatgptOAuthAccessToken: 'cgpt-access-PLAINTEXT-MARKER',
            chatgptOAuthRefreshToken: 'cgpt-refresh-PLAINTEXT-MARKER',
            chatgptOAuthIdToken: 'cgpt-id-PLAINTEXT-MARKER',
        } as Partial<ObsidianAgentSettings>);

        await svc.saveGlobal(settings);

        expect(fs.lastWritten).toBeDefined();
        expect(fs.lastWritten).not.toContain('cgpt-access-PLAINTEXT-MARKER');
        expect(fs.lastWritten).not.toContain('cgpt-refresh-PLAINTEXT-MARKER');
        expect(fs.lastWritten).not.toContain('cgpt-id-PLAINTEXT-MARKER');

        const parsed = JSON.parse(fs.lastWritten!);
        expect(parsed._encrypted).toBe(true);
        expect(parsed.chatgptOAuthAccessToken).toBe(enc('cgpt-access-PLAINTEXT-MARKER'));
        expect(parsed.chatgptOAuthRefreshToken).toBe(enc('cgpt-refresh-PLAINTEXT-MARKER'));
        expect(parsed.chatgptOAuthIdToken).toBe(enc('cgpt-id-PLAINTEXT-MARKER'));
    });

    it('encrypts providerConfigs[] credentials (H-3) before writing the global file', async () => {
        const settings = makeSettings({
            providerConfigs: [
                makeProvider({ apiKey: 'PROVIDER-API-KEY-PLAINTEXT' }),
                makeProvider({
                    id: 'bedrock-main',
                    type: 'bedrock',
                    apiKey: undefined,
                    awsAccessKey: 'AKIA-PLAINTEXT-MARKER',
                    awsSecretKey: 'AWS-SECRET-PLAINTEXT-MARKER',
                    awsSessionToken: 'AWS-SESSION-PLAINTEXT-MARKER',
                    gatewayHeaderValue: 'GATEWAY-HEADER-PLAINTEXT',
                }),
                makeProvider({
                    id: 'copilot-main',
                    type: 'github-copilot',
                    apiKey: undefined,
                    oauthToken: 'GHO-OAUTH-PLAINTEXT-MARKER',
                }),
            ],
        });

        await svc.saveGlobal(settings);

        expect(fs.lastWritten).toBeDefined();
        for (const marker of [
            'PROVIDER-API-KEY-PLAINTEXT',
            'AKIA-PLAINTEXT-MARKER',
            'AWS-SECRET-PLAINTEXT-MARKER',
            'AWS-SESSION-PLAINTEXT-MARKER',
            'GATEWAY-HEADER-PLAINTEXT',
            'GHO-OAUTH-PLAINTEXT-MARKER',
        ]) {
            expect(fs.lastWritten).not.toContain(marker);
        }

        const parsed = JSON.parse(fs.lastWritten!);
        expect(parsed.providerConfigs[0].apiKey).toBe(enc('PROVIDER-API-KEY-PLAINTEXT'));
        expect(parsed.providerConfigs[1].awsAccessKey).toBe(enc('AKIA-PLAINTEXT-MARKER'));
        expect(parsed.providerConfigs[1].awsSecretKey).toBe(enc('AWS-SECRET-PLAINTEXT-MARKER'));
        expect(parsed.providerConfigs[1].awsSessionToken).toBe(enc('AWS-SESSION-PLAINTEXT-MARKER'));
        expect(parsed.providerConfigs[1].gatewayHeaderValue).toBe(enc('GATEWAY-HEADER-PLAINTEXT'));
        expect(parsed.providerConfigs[2].oauthToken).toBe(enc('GHO-OAUTH-PLAINTEXT-MARKER'));
    });

    it('encrypts legacy_active_models_backup credentials (H-3/H-4)', async () => {
        const settings = makeSettings({
            legacy_active_models_backup: [
                {
                    apiKey: 'LEGACY-API-KEY-PLAINTEXT',
                    awsAccessKey: 'LEGACY-AKIA-PLAINTEXT',
                    awsSecretKey: 'LEGACY-SECRET-PLAINTEXT',
                } as unknown as NonNullable<ObsidianAgentSettings['legacy_active_models_backup']>[number],
            ],
        });

        await svc.saveGlobal(settings);

        expect(fs.lastWritten).toBeDefined();
        expect(fs.lastWritten).not.toContain('LEGACY-API-KEY-PLAINTEXT');
        expect(fs.lastWritten).not.toContain('LEGACY-AKIA-PLAINTEXT');
        expect(fs.lastWritten).not.toContain('LEGACY-SECRET-PLAINTEXT');

        const parsed = JSON.parse(fs.lastWritten!);
        expect(parsed.legacy_active_models_backup[0].apiKey).toBe(enc('LEGACY-API-KEY-PLAINTEXT'));
        expect(parsed.legacy_active_models_backup[0].awsAccessKey).toBe(enc('LEGACY-AKIA-PLAINTEXT'));
        expect(parsed.legacy_active_models_backup[0].awsSecretKey).toBe(enc('LEGACY-SECRET-PLAINTEXT'));
    });

    it('round-trips: loadGlobal decrypts the same fields encryptGlobal wrote', async () => {
        const settings = makeSettings({
            chatgptOAuthAccessToken: 'roundtrip-cgpt-access',
            chatgptOAuthRefreshToken: 'roundtrip-cgpt-refresh',
            chatgptOAuthIdToken: 'roundtrip-cgpt-id',
            providerConfigs: [
                makeProvider({ apiKey: 'roundtrip-provider-api-key' }),
                makeProvider({
                    id: 'bedrock-rt',
                    type: 'bedrock',
                    apiKey: undefined,
                    awsAccessKey: 'roundtrip-akia',
                    awsSecretKey: 'roundtrip-secret',
                }),
            ],
            legacy_active_models_backup: [
                {
                    apiKey: 'roundtrip-legacy-api',
                } as unknown as NonNullable<ObsidianAgentSettings['legacy_active_models_backup']>[number],
            ],
        } as Partial<ObsidianAgentSettings>);

        await svc.saveGlobal(settings);
        const reloaded = await svc.loadGlobal();

        expect((reloaded as Record<string, unknown>).chatgptOAuthAccessToken).toBe('roundtrip-cgpt-access');
        expect((reloaded as Record<string, unknown>).chatgptOAuthRefreshToken).toBe('roundtrip-cgpt-refresh');
        expect((reloaded as Record<string, unknown>).chatgptOAuthIdToken).toBe('roundtrip-cgpt-id');
        expect(reloaded.providerConfigs?.[0].apiKey).toBe('roundtrip-provider-api-key');
        expect(reloaded.providerConfigs?.[1].awsAccessKey).toBe('roundtrip-akia');
        expect(reloaded.providerConfigs?.[1].awsSecretKey).toBe('roundtrip-secret');
        expect((reloaded.legacy_active_models_backup?.[0] as { apiKey?: string } | undefined)?.apiKey)
            .toBe('roundtrip-legacy-api');
    });

    it('saveGlobal is idempotent: a second call does not double-encrypt', async () => {
        const settings = makeSettings({
            chatgptOAuthRefreshToken: 'idem-cgpt-refresh',
            providerConfigs: [makeProvider({ apiKey: 'idem-provider-key' })],
        } as Partial<ObsidianAgentSettings>);

        await svc.saveGlobal(settings);
        const firstRaw = fs.lastWritten!;
        const reloaded = await svc.loadGlobal();
        await svc.saveGlobal(reloaded as ObsidianAgentSettings);
        const secondRaw = fs.lastWritten!;

        // After re-encrypt the same plaintext input must produce the same enc prefix once, not twice.
        const parsed = JSON.parse(secondRaw);
        expect(parsed.chatgptOAuthRefreshToken).toBe(enc('idem-cgpt-refresh'));
        expect(parsed.providerConfigs[0].apiKey).toBe(enc('idem-provider-key'));
        // Sanity: a double-encrypt would have produced ENC_PREFIX + ENC_PREFIX + value.
        expect(parsed.chatgptOAuthRefreshToken).not.toContain(ENC_PREFIX + ENC_PREFIX);
        expect(firstRaw.length).toBeGreaterThan(0);
    });
});

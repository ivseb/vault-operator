import { describe, it, expect } from 'vitest';

describe('SafeStorageService', () => {
    // Use dynamic import because the module tries to require('electron')
    // which is not available in test environment. The constructor catches the error
    // and sets available = false.
    async function createService() {
        const { SafeStorageService } = await import('../SafeStorageService');
        return new SafeStorageService();
    }

    describe('isEncrypted', () => {
        it('should return true for values with enc:v1: prefix', async () => {
            const service = await createService();
            expect(service.isEncrypted('enc:v1:abc123==')).toBe(true);
        });

        it('should return false for plaintext values', async () => {
            const service = await createService();
            expect(service.isEncrypted('sk-ant-1234567890')).toBe(false);
        });

        it('should return false for undefined', async () => {
            const service = await createService();
            expect(service.isEncrypted(undefined)).toBe(false);
        });

        it('should return false for empty string', async () => {
            const service = await createService();
            expect(service.isEncrypted('')).toBe(false);
        });

        it('should return false for partial prefix', async () => {
            const service = await createService();
            expect(service.isEncrypted('enc:v1')).toBe(false);
            expect(service.isEncrypted('enc:')).toBe(false);
        });
    });

    describe('isAvailable', () => {
        it('should return false in test environment (no Electron)', async () => {
            const service = await createService();
            expect(service.isAvailable()).toBe(false);
        });
    });

    describe('encrypt', () => {
        it('should return plaintext unchanged when not available', async () => {
            const service = await createService();
            expect(service.encrypt('my-api-key')).toBe('my-api-key');
        });

        it('should return empty string unchanged', async () => {
            const service = await createService();
            expect(service.encrypt('')).toBe('');
        });
    });

    describe('decrypt', () => {
        it('should pass through plaintext values', async () => {
            const service = await createService();
            expect(service.decrypt('plaintext-key')).toBe('plaintext-key');
        });

        it('should return empty string for empty input', async () => {
            const service = await createService();
            expect(service.decrypt('')).toBe('');
        });

        it('should return empty string for encrypted values when unavailable', async () => {
            const service = await createService();
            expect(service.decrypt('enc:v1:abc123==')).toBe('');
        });
    });
});

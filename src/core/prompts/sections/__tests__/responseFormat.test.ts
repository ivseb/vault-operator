import { describe, it, expect } from 'vitest';
import { getResponseFormatSection } from '../responseFormat';

/**
 * Issue #54.2: the always-sent response-format section must not carry German
 * example tokens (they nudged a weak model into German on a bare "Hi"), and it
 * must explicitly instruct the model to answer in the user's language.
 */
describe('getResponseFormatSection', () => {
    const section = getResponseFormatSection();

    it('contains no hardcoded German example tokens', () => {
        for (const token of ['Neuronale Netze', 'Anwendungsbereiche', 'Antwort:', 'Kurz:', 'Zusammenfassung:']) {
            expect(section).not.toContain(token);
        }
    });

    it('carries an explicit response-language directive', () => {
        expect(section).toContain('same language the user writes in');
    });
});

/**
 * FIX-54-11: a 401 whose body is a scope/permission rejection (OpenAI
 * project keys with model restrictions: "You have insufficient permissions
 * for this operation.") must NOT be titled "Invalid API key". The key is
 * valid; it lacks access to the requested model or operation. Field report
 * 2026-07-14: gpt-5.6-sol succeeded on turn 1 and 401ed on turn 2 with this
 * exact body while the user hunted a nonexistent key problem.
 */
import { describe, it, expect } from 'vitest';
import { isInsufficientPermissionsAuthError } from '../errorTitleClassifier';

describe('isInsufficientPermissionsAuthError (FIX-54-11)', () => {
    it('matches the live OpenAI project-key scope rejection', () => {
        expect(isInsufficientPermissionsAuthError(
            '401 You have insufficient permissions for this operation.', 401,
        )).toBe(true);
    });

    it('matches missing-scopes wording on 403', () => {
        expect(isInsufficientPermissionsAuthError(
            'You have insufficient permissions for this operation. Missing scopes: model.request', 403,
        )).toBe(true);
    });

    it('does NOT match a plain invalid-key 401', () => {
        expect(isInsufficientPermissionsAuthError(
            'Incorrect API key provided: sk-proj-***. You can find your API key at platform.openai.com.', 401,
        )).toBe(false);
    });

    it('does NOT match permission wording on non-auth statuses', () => {
        expect(isInsufficientPermissionsAuthError(
            'insufficient permissions mentioned in a 500 body', 500,
        )).toBe(false);
    });

    it('does NOT match without a status when the wording is absent', () => {
        expect(isInsufficientPermissionsAuthError('some network error', undefined)).toBe(false);
    });

    it('matches on missing status when the wording is unambiguous', () => {
        expect(isInsufficientPermissionsAuthError(
            'You have insufficient permissions for this operation.', undefined,
        )).toBe(true);
    });
});

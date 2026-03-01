/**
 * AstValidator
 *
 * Supplementary validation layer that checks source code for obviously
 * dangerous patterns BEFORE compilation. This is NOT the primary security
 * boundary (that's the Chromium iframe sandbox), but it catches common
 * issues early and provides clear error messages.
 *
 * Part of Self-Development Phase 3: Sandbox + Dynamic Modules.
 */

// ---------------------------------------------------------------------------
// Blocked Patterns
// ---------------------------------------------------------------------------

const BLOCKED_PATTERNS: { pattern: RegExp; reason: string }[] = [
    { pattern: /\beval\s*\(/, reason: 'eval() is not allowed' },
    { pattern: /\bnew\s+Function\b/, reason: 'new Function() is not allowed' },
    { pattern: /\brequire\s*\(/, reason: 'require() is not allowed' },
    { pattern: /\bimport\s*\(/, reason: 'dynamic import() is not allowed' },
    { pattern: /\bprocess\b/, reason: 'process access is not allowed' },
    { pattern: /\b__proto__\b/, reason: '__proto__ access is not allowed' },
    { pattern: /\.constructor\.constructor/, reason: 'constructor chain traversal is not allowed' },
    { pattern: /\barguments\.callee\b/, reason: 'arguments.callee is not allowed' },
    { pattern: /\bglobalThis\b/, reason: 'globalThis access is not allowed' },
    { pattern: /\bchild_process\b/, reason: 'child_process access is not allowed' },
    { pattern: /\bexecSync\b/, reason: 'execSync is not allowed' },
    { pattern: /\bspawnSync\b/, reason: 'spawnSync is not allowed' },
];

// ---------------------------------------------------------------------------
// AstValidator
// ---------------------------------------------------------------------------

export class AstValidator {
    /**
     * Validate source code against blocked patterns.
     * Returns { valid: true } if no issues found, or { valid: false, errors: [...] }.
     */
    static validate(source: string): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        for (const { pattern, reason } of BLOCKED_PATTERNS) {
            if (pattern.test(source)) {
                errors.push(reason);
            }
        }

        return { valid: errors.length === 0, errors };
    }
}

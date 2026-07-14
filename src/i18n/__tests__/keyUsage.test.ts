import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { en } from '../locales/en';

/**
 * Every static t('...') call site must reference an existing en key,
 * otherwise the raw key leaks into the UI at runtime (t() falls back to
 * the key string). Dynamic keys (template literals) are exempt; their
 * prefixes are checked loosely instead.
 */

const SRC = path.resolve(__dirname, '..', '..');
const SKIP_DIRS = new Set(['__tests__', '_generated']);
const CALL_RE = /\bt\(\s*'((?:[^'\\]|\\.)+)'/g;

// The i18n module itself documents t('key', ...) in comments.
const SKIP_FILES = new Set([path.join(SRC, 'i18n', 'index.ts')]);

function* walk(dir: string): Generator<string> {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            yield* walk(full);
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
            if (SKIP_FILES.has(full)) continue;
            yield full;
        }
    }
}

describe('t() key usage', () => {
    it('every static t() key exists in en.ts', () => {
        const missing: string[] = [];
        for (const file of walk(SRC)) {
            const src = fs.readFileSync(file, 'utf-8');
            CALL_RE.lastIndex = 0;
            let m;
            while ((m = CALL_RE.exec(src)) !== null) {
                const key = m[1].replace(/\\'/g, "'");
                if (!(key in en)) {
                    missing.push(`${path.relative(process.cwd(), file)}: ${key}`);
                }
            }
        }
        expect(missing, 'keys used in code but missing in en.ts').toEqual([]);
    });

    // FIX-44-34: the reverse direction, scoped to the permissions surface. A
    // permission key defined in en.ts but never rendered is a dead setting the
    // audit had to hunt down by hand. Pin it so drift cannot reaccumulate. Kept
    // to settings.permissions.* on purpose -- the whole locale has legitimate
    // dynamically-built keys this static scan cannot see.
    it('every settings.permissions.* key in en.ts has a call site', () => {
        const referenced = new Set<string>();
        for (const file of walk(SRC)) {
            const src = fs.readFileSync(file, 'utf-8');
            CALL_RE.lastIndex = 0;
            let m;
            while ((m = CALL_RE.exec(src)) !== null) {
                referenced.add(m[1].replace(/\\'/g, "'"));
            }
        }
        const dead = Object.keys(en)
            .filter((k) => k.startsWith('settings.permissions.'))
            .filter((k) => !referenced.has(k));
        expect(dead, 'permission keys defined in en.ts but never rendered').toEqual([]);
    });
});

/**
 * FIX-22-07-02 regression test
 *
 * The FEATURE-2208 stale-leaf rebuild (BRAT hot-reload fix) cycled EVERY
 * sidebar leaf through setViewState('empty') at layout-ready, including
 * the view the user was actively chatting in. On a slow boot (~9s) a
 * message sent mid-boot streamed its response and then the whole chat
 * vanished when the rebuild destroyed the live view.
 *
 * Only genuinely stale leaves need the cycle: after a hot reload the
 * leaf's view instance stems from the OLD plugin's class (or is a
 * deferred placeholder), so `view instanceof <current class>` is false.
 * A view created by the current plugin instance is never stale.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { shouldRebuildSidebarLeaf } from '../staleLeafGuard';

class CurrentViewClass {}
class OldPluginViewClass {}

describe('shouldRebuildSidebarLeaf (FIX-22-07-02)', () => {
    it('rebuilds a leaf whose view stems from another (old) class', () => {
        expect(shouldRebuildSidebarLeaf(new OldPluginViewClass(), CurrentViewClass)).toBe(true);
    });

    it('rebuilds a leaf with a deferred/undefined view', () => {
        expect(shouldRebuildSidebarLeaf(undefined, CurrentViewClass)).toBe(true);
        expect(shouldRebuildSidebarLeaf(null, CurrentViewClass)).toBe(true);
    });

    it('does NOT rebuild a view created by the current plugin instance', () => {
        expect(shouldRebuildSidebarLeaf(new CurrentViewClass(), CurrentViewClass)).toBe(false);
    });

    // Source pin: main.ts must actually gate the FEATURE-2208 cycle on the
    // guard -- the audit found it cycling every leaf unconditionally.
    it('main.ts gates the stale-leaf cycle on shouldRebuildSidebarLeaf', () => {
        const source = fs.readFileSync(
            path.resolve(__dirname, '../../../main.ts'),
            'utf-8',
        );
        expect(source).toMatch(/shouldRebuildSidebarLeaf\(\s*leaf\.view,\s*AgentSidebarView\s*\)/);
    });
});

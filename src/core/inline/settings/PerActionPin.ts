/**
 * PerActionPin -- per-action model override (FEAT-33-10, EPIC-33).
 *
 * Reads `plugin.settings.inlineActions.actionPins` and supplies the
 * resolved model id for a given InlineAction. Returns null when no
 * pin is set so the caller falls back to the active main-chat model.
 *
 * The plugin entry-point injects this helper into action callbacks
 * via the snapshot.modelId field (the snapshot is built per-trigger
 * by InlineTriggerResolver) -- the pin is the override layer above
 * the snapshot's main-chat default.
 *
 * Related: ADR-140 (Settings-Snapshot-Lifecycle Section 'Per-Action-Pin').
 */

export interface PerActionPinReader {
    getModelOverride(actionId: string): string | null;
}

export interface PerActionPinOptions {
    /** Live-callback so changes via the Settings UI take effect immediately. */
    getPins: () => Record<string, string | null | undefined> | undefined;
}

export class PerActionPin implements PerActionPinReader {
    private readonly getPins: () => Record<string, string | null | undefined> | undefined;

    constructor(options: PerActionPinOptions) {
        this.getPins = options.getPins;
    }

    /**
     * Returns the pinned model id for the given action, or null when
     * no pin is set. Pinned-to-null (explicit clear via UI) and
     * not-present both return null.
     */
    getModelOverride(actionId: string): string | null {
        const pins = this.getPins() ?? {};
        const v = pins[actionId];
        if (v === undefined || v === null || v === '') return null;
        return v;
    }
}

/**
 * SkillProvenanceStore (FIX-44-05)
 *
 * The trust class of a skill -- `builtin`, `bundled`, `pro` -- decides whether
 * it may run without a per-skill approval prompt and whether its instructions
 * are treated as operator-level rather than untrusted content. Before this
 * store, that class was read straight from the SKILL.md frontmatter, so any
 * third-party skill could write `source: pro` and inherit the paid-skill trust.
 * That is the boundary the whole Pro-Skill monetization rests on.
 *
 * This store is the authority instead. Only the BuiltinSkillMaterializer (plugin
 * code) records an entry, and only into a manifest that lives in the agent's
 * protected config zone -- the sandbox cannot write there (FIX-44-22), so a
 * skill script cannot forge its own provenance. Each entry pins a content hash,
 * so overwriting a managed skill's SKILL.md with malicious content also breaks
 * the match and drops it back to `user`.
 *
 * ADR-152 grandfathering: on first run after this fix the manifest is absent, so
 * we seed it once from whatever trusted skills are already on disk. That keeps
 * premium skills a user already installed (and that may since have left the
 * bundle) trusted. From then on the manifest is authoritative and a newly
 * planted `source: pro` is not honoured.
 */

/** The tiers that grant elevated trust. Kept in sync with the pipeline / InvokeSkillTool. */
export const TRUSTED_SKILL_TIERS: ReadonlySet<string> = new Set(['builtin', 'bundled', 'pro']);

interface ProvenanceEntry {
    /** The managed source tier (builtin | bundled | pro). */
    source: string;
    /** Non-cryptographic content hash of the SKILL.md when it was recorded. */
    hash: string;
}

interface ManifestShape {
    version: number;
    skills: Record<string, ProvenanceEntry>;
}

interface AdapterLike {
    exists(p: string): Promise<boolean>;
    read(p: string): Promise<string>;
    write(p: string, content: string): Promise<void>;
    list(p: string): Promise<{ files: string[]; folders: string[] }>;
}

const MANIFEST_VERSION = 1;

/** djb2, same family as the materializer's bundle hash. Not cryptographic; it
 *  only needs to detect that a managed SKILL.md was replaced. */
export function hashSkillContent(content: string): string {
    let h = 5381;
    for (let i = 0; i < content.length; i++) {
        h = ((h * 33) ^ content.charCodeAt(i)) >>> 0;
    }
    return `${content.length.toString(36)}.${h.toString(36)}`;
}

function extractSource(content: string): string | null {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    const fmLine = match[1].split('\n').find((line) => /^\s*source\s*:/.test(line));
    if (!fmLine) return null;
    return fmLine.slice(fmLine.indexOf(':') + 1).trim().replace(/^['"]|['"]$/g, '');
}

export class SkillProvenanceStore {
    private entries: Record<string, ProvenanceEntry> = {};
    private existedOnDisk = false;
    /** FIX-44-05: manifest existed but was unreadable -> fail-closed, do not seed. */
    private corrupt = false;

    constructor(private adapter: AdapterLike, private manifestPath: string) {}

    /**
     * Load the manifest. Returns whether it already existed (false means a fresh
     * install or a pre-fix install that needs the ADR-152 seed).
     */
    async load(): Promise<boolean> {
        try {
            if (!(await this.adapter.exists(this.manifestPath))) {
                // Genuinely first run: reconcile() is allowed to seed from disk
                // (ADR-152 grandfathering of an existing install).
                this.existedOnDisk = false;
                this.corrupt = false;
                return false;
            }
            const raw = await this.adapter.read(this.manifestPath);
            const parsed = JSON.parse(raw) as ManifestShape;
            this.entries = (parsed && typeof parsed === 'object' && parsed.skills) ? parsed.skills : {};
            this.existedOnDisk = true;
            this.corrupt = false;
            return true;
        } catch {
            // FIX-44-05 fail-CLOSED: a manifest that EXISTS but is unreadable
            // (truncated write, sync conflict) must NOT be treated as a first run.
            // Seeding here would re-grandfather every on-disk `source: pro` skill,
            // re-opening the forgery window for anything imported since. Mark it
            // corrupt: reconcile() will NOT seed, so unverifiable trusted-tier
            // claims drop to `user`. Grandfathered skills lose auto-approval until
            // the plugin re-materializes them -- fail-safe, not fail-open.
            this.entries = {};
            this.existedOnDisk = false;
            this.corrupt = true;
            return false;
        }
    }

    /**
     * Return the verified managed source for a skill, or null when it cannot be
     * trusted. `content` is the current on-disk SKILL.md: the recorded hash must
     * match it, so a replaced file drops back to null.
     */
    getVerifiedSource(skillName: string, content: string): string | null {
        const entry = this.entries[skillName];
        if (!entry) return null;
        if (!TRUSTED_SKILL_TIERS.has(entry.source)) return null;
        if (entry.hash !== hashSkillContent(content)) return null;
        return entry.source;
    }

    /**
     * Rebuild the manifest for this boot.
     *
     * @param skillsRoot     the vault-relative skills directory
     * @param freshlyManaged skill folder names the materializer just wrote (these
     *                       are authoritative -- their entry is refreshed from the
     *                       current on-disk content)
     *
     * Grandfathered entries (present in a prior manifest but not re-materialized)
     * are preserved verbatim. On a first run without a manifest, existing trusted
     * skills on disk are seeded once (ADR-152).
     */
    async reconcile(skillsRoot: string, freshlyManaged: Iterable<string>): Promise<void> {
        // Seed ONLY on a genuine first run. A corrupt manifest is deliberately
        // NOT seeded (FIX-44-05 fail-closed) -- otherwise a lost/truncated file
        // would re-grandfather a planted `source: pro` skill.
        if (!this.existedOnDisk && !this.corrupt) {
            await this.seedFromDisk(skillsRoot);
        }
        for (const name of freshlyManaged) {
            const skillMd = `${skillsRoot}/${name}/SKILL.md`;
            try {
                if (!(await this.adapter.exists(skillMd))) continue;
                const content = await this.adapter.read(skillMd);
                const source = extractSource(content);
                if (source && TRUSTED_SKILL_TIERS.has(source)) {
                    this.entries[name] = { source, hash: hashSkillContent(content) };
                }
            } catch {
                // Skip a skill we cannot read; its absence just means "untrusted".
            }
        }
        await this.save();
    }

    /**
     * ADR-152 one-time seed: record every on-disk skill that currently claims a
     * trusted tier. This trusts the existing vault state exactly once, which is
     * the documented grandfathering stance -- what the user already installed
     * stays trusted; anything planted afterwards is not in the manifest.
     */
    private async seedFromDisk(skillsRoot: string): Promise<void> {
        try {
            if (!(await this.adapter.exists(skillsRoot))) return;
            const { folders } = await this.adapter.list(skillsRoot);
            for (const folder of folders) {
                const skillMd = `${folder}/SKILL.md`;
                try {
                    if (!(await this.adapter.exists(skillMd))) continue;
                    const content = await this.adapter.read(skillMd);
                    const source = extractSource(content);
                    if (source && TRUSTED_SKILL_TIERS.has(source)) {
                        const name = folder.slice(folder.lastIndexOf('/') + 1);
                        this.entries[name] = { source, hash: hashSkillContent(content) };
                    }
                } catch {
                    // Skip unreadable entries.
                }
            }
        } catch {
            // No skills dir yet (fresh install): nothing to seed.
        }
    }

    private async save(): Promise<void> {
        const manifest: ManifestShape = { version: MANIFEST_VERSION, skills: this.entries };
        try {
            await this.adapter.write(this.manifestPath, JSON.stringify(manifest, null, 2));
            this.existedOnDisk = true;
        } catch (e) {
            console.warn('[SkillProvenanceStore] Failed to persist manifest:', e);
        }
    }
}

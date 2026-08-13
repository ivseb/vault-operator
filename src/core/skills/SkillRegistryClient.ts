/**
 * SkillRegistryClient (FEAT-31-02)
 *
 * Fetches the public skill catalogue and installs a skill from it.
 *
 * The trust model in one line: a download tells us where a skill came from, not
 * that it is safe. An installed registry skill lands as `source: registry`,
 * which is a MANAGED tier (recorded and hash-pinned, so the badge is honest and
 * updates are detectable) but NOT a TRUSTED one. It runs through the same
 * approval chain as a skill the user wrote. See SkillProvenanceStore.
 *
 * What is verified before anything touches the vault:
 *   - the catalogue parses and every entry carries the fields we rely on
 *   - the download is under the size cap
 *   - the SHA-256 matches the catalogue entry
 * A failure at any of those steps writes nothing. Partial state is worse than
 * no state, because a half-written skill folder still loads.
 *
 * Network shape: exactly two GETs, both to the registry host, both triggered by
 * an explicit user click. Nothing is fetched on plugin load -- that would make
 * the plugin phone home on every boot, which the README promises it does not do.
 */

import { requestUrl } from 'obsidian';
import JSZip from 'jszip';

import type AgentPlugin from '../../main';
import { getSelfAuthoredSkillsDir } from '../utils/agentFolder';
import { importSkillPackage } from './SkillPackageImporter';

/** Where the catalogue lives. One host, named once. */
export const REGISTRY_BASE_URL =
    'https://raw.githubusercontent.com/pssah4/vault-operator-skill-registry/main';

/** Hard cap per package. The real ones are 1 to 90 KB; this is a sanity bound. */
export const MAX_PACKAGE_BYTES = 5 * 1024 * 1024;

/**
 * What a skill is licensed under when the catalogue does not say.
 *
 * Every skill in this registry is published under Apache-2.0, so the fallback
 * is the truth rather than a guess. It exists because a plugin release and a
 * registry release are not the same event: a plugin reading a catalogue built
 * before the field existed must still be able to name the licence it is asking
 * the user to accept.
 */
export const DEFAULT_SKILL_LICENSE = 'Apache-2.0';

/**
 * Where to read a licence.
 *
 * Apache-2.0 gets its canonical text at apache.org; anything else resolves
 * through SPDX, which carries the full text for every identifier it lists. The
 * point is that the name in the dialog is always clickable: a licence the user
 * is asked to accept but cannot read is not a licence, it is a checkbox.
 */
export function licenseUrl(spdxId: string): string {
    if (spdxId === DEFAULT_SKILL_LICENSE) return 'https://www.apache.org/licenses/LICENSE-2.0';
    return `https://spdx.org/licenses/${encodeURIComponent(spdxId)}.html`;
}

/** One skill as the catalogue describes it. */
export interface RegistrySkill {
    slug: string;
    name: string;
    description: string;
    /** Space- or pipe-separated keywords, used for search. May be empty. */
    trigger: string;
    /** What the skill is made of: prompt, scripts, references, assets. */
    components: string[];
    version: string;
    file: string;
    bytes: number;
    sha256: string;
    /** SPDX identifier. Falls back to DEFAULT_SKILL_LICENSE, never to empty. */
    license: string;
}

export interface RegistryCatalog {
    schema: number;
    generatedAt: string | null;
    count: number;
    skills: RegistrySkill[];
}

/** Thrown for every failure the user can act on. */
export class RegistryError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RegistryError';
    }
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Validate a parsed catalogue.
 *
 * Deliberately strict: a malformed entry is refused rather than skipped. A
 * catalogue we only half understand is one we cannot make promises about, and
 * the install path downstream trusts these fields.
 */
export function parseCatalog(raw: unknown): RegistryCatalog {
    if (typeof raw !== 'object' || raw === null) {
        throw new RegistryError('The registry catalogue is not readable.');
    }
    const obj = raw as Record<string, unknown>;
    if (obj.schema !== 1) {
        throw new RegistryError(
            `This plugin reads catalogue schema 1, the registry published schema ${String(obj.schema)}. `
            + 'Update Vault Operator to install skills.',
        );
    }
    if (!Array.isArray(obj.skills)) {
        throw new RegistryError('The registry catalogue has no skill list.');
    }

    const skills: RegistrySkill[] = obj.skills.map((entry, i) => {
        const e = entry as Record<string, unknown>;
        const str = (key: string, required: boolean): string => {
            const v = e[key];
            if (typeof v === 'string') return v;
            if (!required) return '';
            throw new RegistryError(`Catalogue entry ${i} is missing "${key}".`);
        };
        const sha = str('sha256', true);
        if (!/^[0-9a-f]{64}$/.test(sha)) {
            throw new RegistryError(`Catalogue entry ${i} has no usable checksum.`);
        }
        return {
            slug: str('slug', true),
            name: str('name', true),
            description: str('description', false),
            trigger: str('trigger', false),
            components: Array.isArray(e.components) ? e.components.map(String) : [],
            version: str('version', false) || '1.0.0',
            file: str('file', true),
            bytes: typeof e.bytes === 'number' ? e.bytes : 0,
            sha256: sha,
            // Never empty. An install asks the user to accept a licence, and a
            // blank field would put a nameless one in front of them.
            license: str('license', false) || DEFAULT_SKILL_LICENSE,
        };
    });

    return {
        schema: 1,
        generatedAt: typeof obj.generatedAt === 'string' ? obj.generatedAt : null,
        count: skills.length,
        skills,
    };
}

/**
 * Rank catalogue entries against a query.
 *
 * Searches name, description and keywords, because a user looks for a
 * capability ("summarise a meeting") and rarely knows the slug.
 *
 * An empty query returns the whole catalogue in slug order. Search and browse
 * are the two ends of one query rather than two modes: the registry window
 * opens on everything and each character narrows it. The list is the only thing
 * in that window, so there is nothing for a full list to crowd out.
 */
export function searchCatalog(skills: RegistrySkill[], query: string): RegistrySkill[] {
    const q = query.trim().toLowerCase();
    if (!q) return [...skills].sort((a, b) => a.slug.localeCompare(b.slug));
    const terms = q.split(/\s+/);

    const scored = skills
        .map((s) => {
            const name = `${s.slug} ${s.name}`.toLowerCase();
            const haystack = `${name} ${s.description} ${s.trigger}`.toLowerCase();
            // Every term has to appear somewhere, so a two-word query narrows
            // instead of widening the way an OR match would.
            if (!terms.every((t) => haystack.includes(t))) return null;
            const score = terms.reduce((acc, t) => acc + (name.includes(t) ? 2 : 1), 0);
            return { s, score };
        })
        .filter((x): x is { s: RegistrySkill; score: number } => x !== null);

    scored.sort((a, b) => (b.score - a.score) || a.s.slug.localeCompare(b.s.slug));
    return scored.map((x) => x.s);
}

export class SkillRegistryClient {
    private cached: RegistryCatalog | null = null;

    constructor(private readonly plugin: AgentPlugin, private readonly baseUrl = REGISTRY_BASE_URL) {}

    /** The catalogue from the last fetch, or null. Never fetches. */
    get catalog(): RegistryCatalog | null {
        return this.cached;
    }

    /**
     * Fetch the catalogue. Only ever called from an explicit user action --
     * opening the registry view or pressing refresh.
     */
    async fetchCatalog(): Promise<RegistryCatalog> {
        let response;
        try {
            response = await requestUrl({ url: `${this.baseUrl}/catalog.json` });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new RegistryError(`Could not reach the skill registry: ${msg}`);
        }
        if (response.status >= 400) {
            throw new RegistryError(`The skill registry returned HTTP ${response.status}.`);
        }

        let raw: unknown;
        try {
            raw = JSON.parse(response.text);
        } catch {
            throw new RegistryError('The registry catalogue is not valid JSON.');
        }
        this.cached = parseCatalog(raw);
        return this.cached;
    }

    /**
     * Download, verify and install one skill.
     *
     * Order matters: size, then hash, then write. The provenance entry is
     * written last and only after the files landed, so a crash mid-install
     * leaves a skill without a badge rather than a badge without a skill.
     */
    /**
     * Download a package and verify it against the catalogue: size, then
     * checksum. Shared by install() and previewSkillMd() so a preview is held
     * to the same integrity bar as an install -- a tampered package must not
     * even be shown, let alone written.
     */
    private async downloadVerified(entry: RegistrySkill): Promise<ArrayBuffer> {
        let response;
        try {
            response = await requestUrl({ url: `${this.baseUrl}/${entry.file}` });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new RegistryError(`Could not download ${entry.slug}: ${msg}`);
        }
        if (response.status >= 400) {
            throw new RegistryError(
                `Could not download ${entry.slug}: HTTP ${response.status}. `
                + 'The catalogue may be newer than the published files.',
            );
        }

        const buffer = response.arrayBuffer;
        if (buffer.byteLength > MAX_PACKAGE_BYTES) {
            throw new RegistryError(
                `${entry.slug} is ${Math.round(buffer.byteLength / 1024)} KB, over the `
                + `${MAX_PACKAGE_BYTES / 1024 / 1024} MB limit. Refusing to install.`,
            );
        }

        const sha = await sha256Hex(buffer);
        if (sha !== entry.sha256) {
            throw new RegistryError(
                `${entry.slug} does not match its checksum. Expected ${entry.sha256.slice(0, 12)}…, `
                + `got ${sha.slice(0, 12)}…. Nothing was installed.`,
            );
        }
        return buffer;
    }

    /**
     * Fetch and return the SKILL.md of a package WITHOUT installing it.
     *
     * This is the "read before you run" path: a user can see exactly what the
     * agent would be told before a single file lands in the vault. Same
     * verification as install, nothing written.
     */
    async previewSkillMd(entry: RegistrySkill): Promise<string> {
        const buffer = await this.downloadVerified(entry);
        const zip = await JSZip.loadAsync(buffer);
        // The package nests everything under a slug folder; find the SKILL.md
        // wherever it sits rather than assuming the exact path.
        const file = Object.values(zip.files).find(
            (f) => !f.dir && f.name.endsWith('SKILL.md'),
        );
        if (!file) {
            throw new RegistryError(`${entry.slug} has no SKILL.md to show.`);
        }
        return file.async('string');
    }

    async install(entry: RegistrySkill, opts: { overwrite?: boolean } = {}): Promise<string> {
        const buffer = await this.downloadVerified(entry);
        const targetSkillsDir = getSelfAuthoredSkillsDir(this.plugin);
        const result = await importSkillPackage({
            adapter: this.plugin.app.vault.adapter,
            targetSkillsDir,
            buffer,
            fallbackSlug: entry.slug,
            overwrite: opts.overwrite ?? false,
        });

        await this.stampProvenance(targetSkillsDir, result.slug);
        return result.slug;
    }

    /**
     * Record the skill as `registry` in the provenance manifest.
     *
     * This is what makes the badge honest and updates detectable. It grants no
     * privilege: `registry` is MANAGED, not TRUSTED. If the user later edits the
     * skill the content hash stops matching and it resolves to `user`, which is
     * the intended demotion rather than a failure.
     */
    private async stampProvenance(skillsDir: string, slug: string): Promise<void> {
        const store = this.plugin.skillProvenance;
        if (!store) return;
        const path = `${skillsDir}/${slug}/SKILL.md`;
        try {
            const content = await this.plugin.app.vault.adapter.read(path);
            await store.recordVerified(slug, 'registry', content);
        } catch (e) {
            // A missing badge is a cosmetic loss, not a broken install: the
            // skill still loads, as `user`. Swallowing here keeps a provenance
            // hiccup from rolling back a successful download.
            console.warn(`[SkillRegistryClient] could not record provenance for ${slug}:`, e);
        }
    }
}

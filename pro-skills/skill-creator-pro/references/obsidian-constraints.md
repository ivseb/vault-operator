# Obsidian constraints

The Obsidian side of the runtime. These are the constraints that make a script-correct skill still fail: the wrong folder, a nulled file, a truncated read, a mobile assumption. Check the ones a skill touches during the feasibility step.

## Contents

- Where files may live
- The dot-path nulling trap
- The read-window cap
- Desktop-only
- Language and English fallback
- The model frontmatter does nothing
- MCP servers are out of reach for scripts
- No silent asset downloads

## Where files may live

Three distinct places, do not mix them:

- **Skill definition:** `.vault-operator/data/skills/{name}/`. The SKILL.md and its `scripts/` `references/` `assets/`. Only this path is discovered.
- **Skill state and sidecar data:** `.vault-operator/data/skill-data/{name}/`. Dashboards, caches, generated data files the skill reads back. Keeping this outside `skills/` avoids snapshot churn on the skill folder.
- **User output:** the visible vault, in a normal folder. Notes the user reads and edits. These sync through Obsidian Sync and appear in the file explorer.

The `.vault-operator/` root is hidden (dot-prefix), so Obsidian Sync excludes it. Anything the user is meant to see and sync belongs in the visible vault, not under `.vault-operator/`. A daily-briefing skill, for example, hides its data under `skill-data/` but writes the `Daily Briefing.md` note into the visible vault.

## The dot-path nulling trap

Writing user data into a dot-prefixed folder is dangerous. Two things bite:

- `append_to_file` and `create_folder` fail on dot-paths (the TFile API does not index them).
- The post-task review path has nulled dot-path files: a lookup returns null, the "after" content becomes empty, and a raw adapter write zeroes the file.

For skill state under `.vault-operator/`, write through `ctx.vault.write` (sandbox) or `write_file` (body), which are hidden-aware and atomic. For user output, use a normal visible folder. Do not point `append_to_file` at a dot-path.

## The read-window cap

`read_file` truncates to a budget derived from the model context window: ten percent of the window times four characters per token, floored at 50000 characters, ceilinged at 400000. It uses the 50000 floor whenever model info is missing, even on a million-token model. A skill cannot bypass this by telling the agent to "read the whole file".

Design consequence: prefer many small notes over one large data file. A skill that expects a big file to be read whole drives the agent into repeated chunked reads and rewrite retries. Emit chunked layouts, and read back only what a step needs.

## Desktop-only

The plugin manifest is desktop-only, so skills run on desktop in practice. The sandbox iframe itself is mobile-safe, but a skill should not assume it runs on mobile. Host tools can assume the Electron runtime; the sandbox surface (only `vault` and `requestUrl`) still applies everywhere.

## Language and English fallback

Skills do not need to be multilingual. The plugin ships English bundled and always falls back to English; the eight other locales load on demand as JSON packs, keyed off Obsidian's own language setting. Write skill content in English. This keeps triggers consistent and the skill portable. The description in particular stays English even for a German vault, so triggering stays reliable.

## The model frontmatter does nothing

A `model:` field in the frontmatter is accepted by the validator but not consumed by routing. A skill cannot demand a cheaper or stronger model; whichever model the user has active runs the skill. So a cost-sensitive skill must bound its own cost structurally: fewer turns, smaller reads, fewer fetches, a script instead of a debug loop. Do not rely on `model:` to control spend.

## MCP servers are out of reach for scripts

MCP servers reach the agent, not the sandbox. A script cannot open an MCP connection inside `execute()`. Only the body can, via `invoke_mcp_server` or `use_mcp_tool`. STDIO MCP is not supported at all; HTTP MCP goes through the remote transport. A skill can instruct the agent to call an MCP tool, but the script must not try.

## No silent asset downloads

A skill must never pull an optional asset (WASM, a language pack, an Office library, a reranker bundle) on its own. This is an Obsidian community-plugin rule and a review-bot blocker. If a skill needs an asset, it asks the user first with a clear in-chat prompt explaining what and why, and the download goes through the plugin's asset callback, not through the sandbox. The sandbox `requestUrl` allowlist exists for small CDN module fetches, not for pulling large assets in the background.

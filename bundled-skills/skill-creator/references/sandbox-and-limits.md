# Sandbox and limits

What a `scripts/*.js` helper can and cannot do, and the rules any generated code must follow. When a skill runs a script through `run_skill_script`, or the agent runs ad-hoc code through `evaluate_expression`, this is the environment. The canonical, fuller API reference is the `sandbox-environment` skill; read it with `read_skill` when writing non-trivial scripts. This file is the decision-level summary for feasibility.

## Contents

- The script contract
- The ctx API surface
- Hard limits
- Blocked language patterns
- Not available
- Use a built-in tool, not the sandbox, for these
- Review-bot rules for generated code

## The script contract

A skill script is a module that exports one function:

```javascript
export async function execute(args, ctx) {
  // args: the JSON-serializable object passed via run_skill_script
  // ctx:  { vault, requestUrl } -- the ONLY injected objects
  const text = await ctx.vault.read(args.path);
  // ... compute ...
  return { ok: true, summary: "..." }; // JSON-serialized into the tool result
}
```

`ctx` is the second parameter. There is no bare global `ctx`; referencing it without declaring the parameter fails. The return value is JSON-serialized back to the agent. Scripts live at the skills folder the host injects as `skills_root`, at `{skills_root}/{skill}/scripts/{name}.js`. The iframe backend runs on both desktop and mobile.

**A script is ONE self-contained file. This rule has no error message, so it goes first.** No `import`, no `require`. `run_skill_script` compiles with `esbuild.transform`, which does NOT bundle: it rewrites a static `import x from './y.js'` to `require()`, and the iframe has no `require`. The AstValidator blocks `require(` and `import(` but not a static `import`, so such a script passes every check in the repo and then dies on the user's first call, with an error that names none of this. Everything the script needs is in that one file or in `ctx`.

If you need an npm package, that is not a script. It is an `evaluate_expression` call the agent makes (that tool bundles, via a `dependencies` param). A `scripts/*.js` cannot use one.

**The AstValidator scans string literals.** A script that searches its input for a forbidden token (`process`, `eval`, `require`, `globalThis`) contains that token and rejects itself before it runs. Build such patterns from fragments at runtime (`'pro' + 'cess'`); `new RegExp` is allowed. `quick_validate.js` and `skill-translator` both do this, and are worth reading as the pattern.

## The ctx API surface

Only these calls exist. Nothing else.

- `ctx.vault.read(path)` returns a UTF-8 string. Hidden paths (a segment starting with a dot, like the agent folder) use an adapter fallback.
- `ctx.vault.readBinary(path)` returns an ArrayBuffer.
- `ctx.vault.list(path)` returns child paths (files and folders combined). Empty string or `/` is the vault root. No depth flag; recursion is the script's job.
- `ctx.vault.mkdir(path)` creates folders recursively, idempotent.
- `ctx.vault.write(path, content)` writes text. Rate-limited, size-capped (see below).
- `ctx.vault.writeBinary(path, content)` writes an ArrayBuffer. Use for generated binary output, but prefer the built-in Office tools for Office formats.
- `ctx.requestUrl(url, options?)` returns `{ status, text }`. HTTPS only, and only to `unpkg.com`, `cdn.jsdelivr.net`, `registry.npmjs.org`, `esm.sh`. Not a general HTTP client.

## Hard limits

- Execution timeout: 30 seconds per script. Longer work must be chunked across calls or moved to the body.
- Heap: 128 MB soft cap. Breach tears down the iframe and rejects pending work.
- Write size: 10 MB per `write` or `writeBinary`.
- Write rate: 10 writes per minute.
- Request rate: 5 `requestUrl` calls per minute, 15 second timeout per hop.
- Network: the four CDN hosts above only. No arbitrary API, no arXiv, no OpenAI or Anthropic endpoints, no GitHub, no localhost, no IP literals, HTTPS on port 443 only. If a skill needs external data, the body fetches it with `web_fetch` or an MCP tool and passes it into the script via `args`.
- configDir (`.obsidian/`) is blocked for both read and write, because it holds encrypted credentials.
- `evaluate_expression` return value is capped at 16000 characters. Design scripts to return a compact summary, not a data dump.

## Blocked language patterns

The source is rejected before it runs if it contains any of: `eval`, `new Function`, `require()`, dynamic `import()`, `process`, `__proto__`, `.constructor.constructor`, `arguments.callee`, `globalThis`, `child_process`, `execSync`, `spawnSync`, `setTimeout`/`setInterval` with a string argument, `.prototype.constructor`, `[].constructor`, `WebAssembly`. Do not emit these.

## Not available

Genuinely absent, referencing them throws: `Buffer` (Node), `require`, `import()`, `process`, `fs`, `path`, `WebAssembly`. Use `new TextEncoder().encode(str)` for bytes and `ctx.requestUrl` for the four CDN hosts.

Present as globals but DEAD, and worse than absent because they look usable: `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `window`, `document`, `crypto.subtle`, `localStorage`. The iframe is a real browser window, so these bindings exist. But the CSP is `default-src 'none'` and `connect-src` falls back to it, so every network call rejects with `TypeError: Failed to fetch`, for every URL, with no exception. `localStorage` is worse: the opaque origin makes even `typeof localStorage` THROW a SecurityError. `quick_validate` flags a `fetch(` in a script as an error for exactly this reason. If a skill needs the web, the agent fetches with `web_fetch` and writes the result into a file the script reads.

Present and fully working: `Promise`, `JSON`, `Math`, `Date`, `Array`, `Object`, `Map`, `Set`, `RegExp`, `TextEncoder`, `TextDecoder`, `atob`, `btoa`, `structuredClone`, `crypto.getRandomValues`, `URL`, and the typed arrays.

Note on `console.log`: it is NOT a no-op. It works and appears in the Electron DevTools console. But nothing can read it programmatically, so it is a debugging aid, never a way to return a result. Only the value `execute` returns reaches the agent.

## Use a built-in tool, not the sandbox, for these

The sandbox has no Buffer, no streams, no JSZip, so it is the wrong place for these. Have the body call the tool instead:

- PPTX: `create_pptx`. XLSX: `create_xlsx`. DOCX: `create_docx`. These run in the plugin process with full library access and a quality gate.
- PDF from a document: `workspace:export-pdf` or the pandoc recipe via `execute_recipe`. Simple PDF from scratch can use `pdf-lib` in the sandbox, but conversion cannot.
- Unzipping a `.zip` or `.skill`: `extract_zip`. JSZip does not bundle in the sandbox.
- Fuzzy block anchoring against messy text: `set_block_anchors`, not a hand-written indexOf loop.

## Review-bot rules for generated code

Bundled skills and their scripts get scanned by the Obsidian community-plugin review bot. Any code a skill generates, and any note-rendering code it produces, must follow the same rules the plugin does:

| Do not | Use instead |
|--------|-------------|
| `console.log` / `console.info` | `console.debug` / `.warn` / `.error` |
| `fetch()` | `web_fetch` (agent); a script cannot reach the general web at all, only the four CDN hosts via `ctx.requestUrl` |
| `require()` | in the PLUGIN, ES `import`; in a SKILL SCRIPT, neither: one self-contained file (see above) |
| hardcoded `.obsidian` | `vault.configDir` |
| `element.style.x = y` | CSS classes or `style.setProperty()` |
| `innerHTML` | Obsidian DOM API (`createEl`, `createDiv`, `appendText`) |
| `any` types | `unknown` plus type guards |
| floating promises | `void` prefix or `.catch()` |
| `as TFile` / `as TFolder` | `instanceof` checks |
| `Vault.delete` / `Vault.trash` | `fileManager.trashFile` |
| `window.setInterval` | `scheduleRecurring` (a post-build rename breaks raw `setInterval`) |

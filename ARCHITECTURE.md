# Obsilo Agent — Architecture Reference

This document is embedded in the plugin at build time and used by the agent
for **core self-modification** (Phase 4). It describes the key modules,
interfaces, and patterns so the agent can understand and safely edit its own
source code.

## Entry Point

- `src/main.ts` — `ObsidianAgentPlugin extends Plugin`. All services are
  initialised in `onload()`. Exports the plugin class as `default`.

## Core Interfaces

### BaseTool (`src/core/tools/BaseTool.ts`)
```typescript
abstract class BaseTool<N extends ToolName = ToolName> {
  abstract readonly name: N;
  abstract readonly isWriteOperation: boolean;
  abstract getDefinition(): ToolDefinition;
  abstract execute(input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<void>;
  protected formatSuccess(text: string): string;
  protected formatError(err: unknown): string;
}
```

### ToolExecutionContext (`src/core/tools/types.ts`)
```typescript
interface ToolExecutionContext {
  taskId: string;
  mode: string;
  callbacks: ToolCallbacks;
  askQuestion?: (q: string, opts?: string[], multi?: boolean) => Promise<string>;
  signalCompletion?: (result: string) => void;
  updateTodos?: (items: TodoItem[]) => void;
  switchMode?: (slug: string) => void;
  spawnSubtask?: (mode: string, message: string) => Promise<string>;
  invalidateToolCache?: () => void;
}
```

### ApiHandler (`src/api/types.ts`)
```typescript
interface ApiHandler {
  createMessage(systemPrompt: string, messages: Message[], tools: ToolDefinition[]): AsyncGenerator<ApiEvent>;
}
```

## Key Directories

| Path | Description |
|------|-------------|
| `src/api/` | LLM provider adapters (Anthropic, OpenAI, Google, Ollama, etc.) |
| `src/api/providers/` | Individual provider implementations |
| `src/core/tools/` | Tool definitions and registry |
| `src/core/tools/vault/` | Vault read/write tools |
| `src/core/tools/agent/` | Agent control tools (completion, questions, settings) |
| `src/core/tools/web/` | Web fetch and search tools |
| `src/core/tools/dynamic/` | Dynamic tool loading (Phase 3) |
| `src/core/tools/mcp/` | MCP tool proxy |
| `src/core/tool-execution/` | ToolExecutionPipeline — governance, approval, logging |
| `src/core/governance/` | IgnoreService, OperationLogger |
| `src/core/checkpoints/` | Git-based shadow checkpoints |
| `src/core/context/` | Rules, Workflows, Skills loaders |
| `src/core/modes/` | Agent mode system |
| `src/core/prompts/` | Default prompt templates |
| `src/core/mastery/` | Recipe store, matching, episodic extraction, promotion |
| `src/core/memory/` | MemoryService, extractors, queue |
| `src/core/semantic/` | SemanticIndexService (vectra) |
| `src/core/mcp/` | McpClient |
| `src/core/skills/` | VaultDNA, SkillRegistry, SelfAuthoredSkillLoader |
| `src/core/sandbox/` | SandboxExecutor, AstValidator, EsbuildWasmManager |
| `src/core/self-development/` | EmbeddedSourceManager, PluginBuilder, PluginReloader |
| `src/core/observability/` | ConsoleRingBuffer |
| `src/core/security/` | SafeStorageService |
| `src/core/storage/` | GlobalFileService, GlobalSettingsService, SyncBridge |
| `src/ui/` | AgentSidebarView, settings modals |
| `src/types/` | Settings types, augmentation declarations |
| `src/i18n/` | Internationalization (i18next) |

## Tool Registration Flow

1. Tools are created in `ToolRegistry.registerInternalTools()`
2. Each tool extends `BaseTool` and implements `getDefinition()` + `execute()`
3. `ToolExecutionPipeline` routes all calls through governance checks
4. `TOOL_GROUPS` in `ToolExecutionPipeline.ts` maps tool names to approval groups

## Patterns and Conventions

### Review-Bot Compliance (MUST follow)
- **NO** `console.log()` or `console.info()` — use `console.debug()`, `.warn()`, `.error()`
- **NO** `fetch()` — use `requestUrl` from `obsidian` or SDK clients
- **NO** `require()` — use ES `import` (exception: `require('electron')`)
- **NO** hardcoded `.obsidian` — use `vault.configDir`
- **NO** `element.style.X = Y` — use CSS classes
- **NO** `innerHTML` — use Obsidian DOM API (`createEl`, `createDiv`)
- **NO** `any` types — use `unknown` + type guards
- **NO** floating promises — prefix with `void` or add `.catch()`
- **NO** `as TFile`/`as TFolder` — use `instanceof` checks
- Use `FileManager.trashFile()` instead of `Vault.delete()`

### Error Handling
- Non-fatal service init: `.catch((e) => console.warn(...))`
- Tool errors: `callbacks.pushToolResult(this.formatError(error))`
- Service fields are `T | null` — check before use

### Action-Based Tools
Multi-action tools (like ConfigureModelTool, ManageSkillTool, ManageSourceTool)
use an `action` parameter with `if/else` or `switch` routing to handler methods.

### Build System
- esbuild with CJS format, target es2022
- Externals: obsidian, electron, esbuild-wasm, @codemirror/*, @lezer/*, builtins
- Source is embedded in production builds via the `embed-source` esbuild plugin

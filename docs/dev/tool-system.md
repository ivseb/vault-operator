---
title: Tool System
description: Tool execution pipeline, registry, metadata, quality gates, and extensibility.
---

# Tool System

Obsilo's tool system is the interface between the AI model and the Obsidian vault. 43+ tools are organized into groups, registered in a central registry, and executed through a governance pipeline that enforces approval, path validation, and checkpointing. Every tool call -- internal or MCP -- flows through the same pipeline.

## BaseTool

All tools extend `BaseTool` (`src/core/tools/BaseTool.ts`):

```typescript
abstract class BaseTool<TName extends ToolName = ToolName> {
    abstract readonly name: TName;
    abstract readonly isWriteOperation: boolean;

    abstract getDefinition(): ToolDefinition;
    abstract execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void>;

    protected validate(input: Record<string, unknown>): void { /* optional override */ }
    protected formatError(error: unknown): string { /* <error>...</error> wrapper */ }
}
```

Key design decisions:
- **`isWriteOperation`** is declared per tool, not inferred. The pipeline uses it to decide whether approval and checkpoints are needed.
- **`getDefinition()`** returns the JSON Schema that the LLM sees (name, description, input_schema). This is separate from `toolMetadata.ts` which provides UI labels and prompt-level descriptions.
- **`execute()`** receives a `ToolExecutionContext` with callbacks for spawning subtasks, switching modes, signaling completion, asking questions, and requesting approval.

## ToolRegistry

`ToolRegistry` (`src/core/tools/ToolRegistry.ts`) is the central registry. Its constructor accepts the plugin instance plus optional service references (MCP client, sandbox executor, skill loader, etc.) and registers all internal tools via `registerInternalTools()`.

```typescript
class ToolRegistry {
    private tools: Map<ToolName, BaseTool>;
    readonly plugin: ObsidianAgentPlugin;

    getTool(name: ToolName): BaseTool | undefined;
    getToolDefinitions(mode: ModeConfig): ToolDefinition[];
    getAllToolNames(): ToolName[];
}
```

`getToolDefinitions()` filters tools by the active mode's `toolGroups` setting. A mode that only enables the `read` group will not expose write tools to the LLM.

## ToolExecutionPipeline

`ToolExecutionPipeline` (`src/core/tool-execution/ToolExecutionPipeline.ts`) is the governance layer. Its central method, `executeTool()`, enforces a strict sequence:

1. **Tool lookup** -- verify the tool exists in the registry.
2. **Path validation** -- check `IgnoreService` for protected/ignored paths.
3. **Result cache** -- return cached content for identical read-only calls (cache key: `toolName:sortedJSON(input)`).
4. **Approval check** -- write operations, MCP calls, sandbox evaluations, and subtask spawning go through `checkApproval()`. If the approval callback is missing, the operation is rejected (fail-closed).
5. **Cache invalidation** -- write tools invalidate cached reads for affected file paths.
6. **Checkpoint** -- before each write, a git-style checkpoint snapshots the file for granular undo.
7. **Execution** -- the tool's `execute()` method runs.
8. **Quality gate** -- if the tool has a quality gate, the self-check checklist is appended to the result.
9. **Operation logging** -- every execution is logged via `OperationLogger` for audit trails.

::: info Fail-Closed by Design
The pipeline's approval path is deliberately fail-closed: if `onApprovalRequired` is not provided (e.g., in a headless context), write operations are rejected with "Operation denied." This is the single most important safety invariant in the system -- it means no code path can accidentally bypass user consent.
:::

## Approval Groups

The pipeline classifies every tool into an `ApprovalGroup` that determines its governance path:

| Group | Tools | Approval Behavior |
|-------|-------|-------------------|
| `read` | `read_file`, `list_files`, `search_files`, `semantic_search`, ... | Always auto-approved |
| `note-edit` | `write_file`, `edit_file`, `append_to_file`, `update_frontmatter` | Requires approval (DiffReviewModal) |
| `vault-change` | `create_folder`, `delete_file`, `move_file`, `generate_canvas`, ... | Requires approval |
| `web` | `web_fetch`, `web_search` | Auto-approved when web tools enabled |
| `agent` | `ask_followup_question`, `attempt_completion`, `switch_mode`, ... | Always auto-approved |
| `subtask` | `new_task` | Respects `autoApproval.subtasks` setting |
| `mcp` | `use_mcp_tool` | Requires approval |
| `sandbox` | `evaluate_expression` | Always requires approval |
| `self-modify` | `manage_skill`, `manage_source` | Always requires human approval |

## Tool Metadata

`toolMetadata.ts` (`src/core/tools/toolMetadata.ts`) is the single source of truth for UI display and system prompt generation:

```typescript
interface ToolMeta {
    group: ToolGroup;        // Mode-level group (read, vault, edit, web, agent, mcp)
    label: string;           // UI display name
    description: string;     // Used in system prompt AND UI
    icon: string;            // Lucide icon name
    signature: string;       // e.g. "read_file(path)"
    example?: string;        // Concrete call example for the prompt
    whenToUse?: string;      // Guidance for tool selection
    commonMistakes?: string; // Known LLM failure patterns
    qualityGate?: boolean;   // Triggers self-check checklist
}
```

This separation keeps API-level tool schemas (in each tool's `getDefinition()`) focused on function calling, while metadata handles the human-readable and prompt-engineering concerns.

## Quality Gates

`qualityGates.ts` (`src/core/tools/qualityGates.ts`) defines self-check checklists for complex tools. After execution, the checklist is appended to the tool result. The agent sees it on its next iteration and self-corrects if any check fails.

A tool qualifies for a quality gate when at least 2 of 3 criteria apply:
1. **Artifact-producing** -- creates a user-facing file.
2. **Multi-element structure** -- slides, sections, sheets, nodes.
3. **Hard to manually correct** -- binary format or complex structure.

Currently gated: `create_pptx`, `create_docx`, `create_xlsx`, `generate_canvas`.

::: tip Zero-Cost Self-Correction
Quality gates add no extra API calls. The checklist is embedded in the tool result that the model already reads. When the output is correct, the agent simply proceeds. When a check fails, the agent calls the tool again with corrections -- typically costing one additional iteration instead of a user-initiated retry.
:::

## Tool Repetition Detection

`ToolRepetitionDetector` (`src/core/tool-execution/ToolRepetitionDetector.ts`) prevents the agent from looping on failed approaches:

- **Sliding window** of 15 recent calls.
- **Exact match**: blocks identical `tool:input` appearing 3+ times.
- **Fuzzy search dedup**: for search tools (`search_files`, `semantic_search`, `search_by_tag`, `web_search`), blocks queries with Jaccard similarity > 0.5 appearing 3+ times.
- **Tool ledger**: records all calls for episodic memory (ADR-018) -- a structured log that survives context condensing.

## Parallel Execution

Read-only tools from the `PARALLEL_SAFE` set execute concurrently via `Promise.all()` in `AgentTask.run()`. Write tools and control-flow tools always run sequentially. This means a single iteration can resolve multiple `read_file` or `search_files` calls in parallel, significantly reducing latency for research-heavy tasks.

## Dynamic Tools

The dynamic tool system (`src/core/tools/dynamic/`) allows runtime tool creation:

- **`DynamicToolFactory`** -- creates tool instances from a runtime definition (name, schema, execute function).
- **`DynamicToolLoader`** -- loads tool definitions from persistent storage, enabling user-created or agent-authored tools to survive across sessions.

Dynamic tools go through the same `ToolExecutionPipeline` as built-in tools -- no governance bypass.

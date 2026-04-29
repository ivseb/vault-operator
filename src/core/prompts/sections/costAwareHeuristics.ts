/**
 * Cost-Aware Agent Heuristics (ADR-080)
 *
 * Levers 1, 2, 3, 6, 9: prompt-side guidance to make the agent prefer the
 * simplest path first, escalate only when justified, and stop as soon as
 * the answer is in hand.
 *
 * Lever 4 + 7 (sub-agent gating, escalation justification) lives partly in
 * the new_task tool schema and partly in the OBJECTIVE section update.
 *
 * Order is intentional: PLAN-FIRST is read before TOOL-TIERS so the agent
 * is already thinking about its approach when it considers tools.
 */

export function getCostAwareHeuristicsSection(): string {
    return `====

COST-AWARE EXECUTION (read this BEFORE choosing tools)

These rules trump exploration. They turn a 25-minute, $2 task into a 60-second, 2-cent task. Do not skip.

## 1. PLAN FIRST (visible to the user, before tools)

For tasks with **2+ tool calls**: your VERY FIRST action MUST be \`update_todo_list\` with a 2-5 step plan. This renders as a checklist in the UI so the user sees what you intend to do. Update the same list as you progress (status: pending / in_progress / done).

Example for "summarise this meeting note":
\`\`\`
update_todo_list(todos: "- [ ] Read transcript\\n- [ ] Generate summary\\n- [ ] Write summary into note")
\`\`\`

For genuinely **single-tool tasks** (e.g. "open note X", "what's the active file?"): skip the plan, just do it.

DO NOT write a Plan when:
- the task takes 1 tool call
- you are mid-task and just continuing existing steps (update the todo, don't make a new one)

DO write a Plan when:
- 2+ tool calls expected
- Any write/edit operation
- Anything that takes more than 30 seconds of work

The plan commits you to a path and stops aimless exploration. It is also the user's safety check before you change files.

## 2. TOOL TIERS (start cheap, escalate only on need)

Tools are NOT cost-equal. Always start at TIER 1 and only escalate when a Tier-1 attempt actually failed for a concrete reason.

**TIER 1 -- always try first (cheap, fast):**
  read_file, write_file, append_to_file, update_frontmatter, list_files, open_note, ask_followup_question, attempt_completion

**TIER 2 -- when Tier 1 doesn't reach the data:**
  search_files, edit_file, get_frontmatter, search_by_tag, get_linked_notes, get_daily_note

**TIER 3 -- when Tier 2 doesn't suffice (involves embeddings or LLM-internal calls):**
  semantic_search, query_base, recall_memory, search_history, web_search, web_fetch

**TIER 4 -- expensive escalation (only with explicit justification, see #4):**
  new_task, evaluate_expression, plan_presentation, generate_canvas, ingest_document

When the user says "summarize this note", "rewrite X", "translate Y", "extract todos from this transcript" -- this is **Tier 1 only**. read, then write. No semantic_search, no sub-agents, no exploration.

## 3. ANTI-OVERTHINKING

If the task fits this pattern, do it directly with Tier 1 tools and STOP:
- "lies X, schreibe Y" / "read X, write Y"
- "fasse zusammen" / "summarize"
- "uebersetze" / "translate"
- "ergaenze" / "add to / extend"
- "verschiebe" / "move"
- "nenne mir" / "list"

DO NOT:
- run semantic_search to "find related notes" before reading the file the user pointed at
- spawn a sub-agent to "explore the topic" -- you already have the input
- read 5 tangential files to "build context" -- the user gave you the file
- write a multi-paragraph plan when the answer is "read, write, done"

ALWAYS REMEMBER: when in doubt, the simpler interpretation of the request is correct.

## 4. SUB-AGENT GATING (Tier 4 escalation rules)

Spawning a sub-agent (\`new_task\`) is allowed ONLY when the task fits one of these three categories. Name the category in the sub-task prompt's first line.

  PARALLEL: 3+ truly independent investigations that can run simultaneously
            (e.g. "compare findings across 5 different notes")
  SPECIALIST: a sub-task needs a different mode or tool group
              (e.g. ask -> agent for a write step in a research session)
  ESCALATION: the main loop has been stuck for 3+ iterations on the same
              concrete blocker

NOT ALLOWED: spawning a sub-agent because "I'm confused" or "fresh perspective".
That is exploration disguised as delegation, and it doubles the system prompt cost.

Before any new_task call, your text MUST include:
\`\`\`
[Sub-agent justification: <PARALLEL|SPECIALIST|ESCALATION>] <one-sentence reason>
\`\`\`
If you cannot fill this honestly, do not spawn.

## 5. ERROR RECOVERY -- simplify, don't expand

When a tool fails, your next step is a SIMPLER tool, not a more powerful one. Concrete recipes:

| Failed tool             | First retry                               | Don't do                       |
|-------------------------|-------------------------------------------|--------------------------------|
| edit_file mismatch      | re-read file, retry with shorter old_str OR switch to write_file | spawn sub-agent |
| edit_file new_str > 2KB | switch to write_file (full content) or append_to_file | retry edit_file |
| read_file not found     | list_files in parent folder, then retry  | semantic_search                |
| semantic_search empty   | search_files with literal keyword         | spawn sub-agent                |
| any tool hangs/errors   | abort that path, attempt_completion with what you have, ask user | recursive sub-agents |

NEVER: respond to a tool error by adding more tool calls of the same kind.

## 6. STOP CONDITION (after every tool result, ask yourself)

After each tool returns, before deciding the next action, internally answer:
1. Do I now have the information I need to answer? **YES** -> write the answer, call attempt_completion, stop.
2. **NO** -> what specific piece is still missing? Name it concretely. If you can't name it, the answer is YES and you're stalling.

If your next instinct is "let me also check X just in case" -- that is stalling. Stop and answer.

## 7. BUDGET AWARENESS

The UI shows live token + EUR cost to the user. Internalise these targets:
- A "lies, schreibe" task should cost <= 5 cents (≤30k input tokens)
- A search-and-summarise task should cost <= 10 cents (≤60k input tokens)
- A multi-step research task should cost <= 30 cents (≤200k input tokens)

If your token budget for the current task is already past these thresholds, your plan is wrong. Stop and reconsider before continuing.

====

`;
}

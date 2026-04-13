---
name: knowledge-batch-ingest
description: Integrate an entire folder of notes and documents at once. Groups files thematically, presents proposals per group, and processes after user confirmation. Uses entity cache across files for token efficiency.
trigger: batch.*ingest|alle.*integrier|ordner.*einpflege|inbox.*integrier|batch.*import|alle.*notes.*einordne
source: bundled
requiredTools: [list_files, read_file, read_document, semantic_search, update_frontmatter, write_file, ingest_document]
---

# Batch Ingest

Integrate multiple notes and documents from a folder in one workflow.
Token-efficient: shares entity lookups across files (search once, link many).

FEATURE-2005, EPIC-020.

## Step 1: ASK THE USER

Ask: "How would you like to handle this batch?"

- **Group review (recommended):** I analyze all files, group them by topic, and show you each group for confirmation before making changes.
- **Individual review:** I process each file like a single ingest and ask you before each one.
- **Quick mode:** I analyze all files, show you a summary, and proceed after one confirmation. Best for simple notes with clear topics.

Wait for the user's answer.

## Step 2: SCAN (deterministic, no LLM cost)

Use `list_files` on the target folder. For each file:

1. Check file type (markdown, PDF, DOCX, XLSX, PPTX)
2. For markdown: read frontmatter with `read_file` (first 20 lines only)
3. Check which properties are already set (Themen, Konzepte, Zusammenfassung, etc.)
4. Detect duplicates: if a note with the same title already exists in the vault

Report to the user:
```
Found {N} files in {folder}:
- {X} markdown notes ({Y} with complete frontmatter, {Z} need integration)
- {A} PDFs
- {B} Office documents
- {C} already integrated (skipping)
- {D} potential duplicates (will flag)

Estimated cost: ~${N * 0.10}-${N * 0.15} (entity cache reduces redundant searches)
```

## Step 3: ANALYZE AND GROUP

For each file that needs integration:

1. Read the content (markdown: `read_file`, documents: `read_document`)
2. Identify entities (topics, concepts, persons)
3. **Entity cache:** Before calling `semantic_search`, check the cache:
   - Cache hit: Reuse the previous search result (0 tokens)
   - Cache miss: Run `semantic_search`, store result in cache
4. Group files by their primary topic/cluster

Present groups to the user (in group-review mode):
```
Group 1: "AI Ethics" (5 files)
  - ethics-of-ai.md -> Themen: [[KI]], [[Ethik]]
  - responsible-ai.pdf -> New source note, Themen: [[KI]]
  - fairness-metrics.md -> Konzepte: [[Fairness]]
  ...

Group 2: "Project Management" (3 files)
  - sprint-retro-march.md -> Themen: [[Projektmanagement]]
  ...

Shall I proceed with Group 1?
```

## Step 4: PROCESS (after confirmation)

For each confirmed group:

1. Create a checkpoint (for undo)
2. For each file in the group:
   - **PDF/Office:** Use `ingest_document` (attaches full text automatically)
   - **Markdown:** Use `update_frontmatter` for properties, `write_file` only if body needs wikilinks
3. Create stub notes for genuinely new entities (same rules as knowledge-ingest: no dangling wikilinks)
4. Report progress after each file

After the group is done:
```
Group 1 complete: 5 files integrated, 2 stub notes created.
Proceed to Group 2, or undo Group 1?
```

## Step 5: SUMMARY

After all groups are processed:
```
Batch ingest complete:
- {N} files integrated
- {M} stub notes created
- {K} entities reused from cache (saved ~{K * 0.02} tokens)
- {G} groups, each with a checkpoint for undo

Next: Run vault health check to verify graph integrity?
```

## Entity Cache Rules

- In-memory only, not persisted between sessions
- Key: normalized entity name (lowercase, trimmed)
- Value: { path: string, exists: boolean } from semantic_search result
- Invalidate entry when a stub note is created for that entity
- Max 1000 entries (unlikely to exceed in one batch)

## Critical Rules

1. **NEVER modify existing notes without user confirmation** -- linking is thinking
2. **ALWAYS present proposals before making changes** -- no autonomous batch processing
3. **ONE checkpoint per group** -- each group independently reversible
4. **Prefer existing entities** -- the entity cache enforces this across the batch
5. **No AI slop** -- if unsure about an entity match, ask rather than guess
6. **Report cost** -- show estimated vs. actual token cost at the end

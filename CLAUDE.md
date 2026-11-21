<!-- memoreal:start -->
## Memoreal Long-Term Memory

This session has Memoreal MCP tools available. Use them to access long-term memory across sessions.

### Always Try Memoreal First

- **Finding context**: Call `build_context` with the current namespace and a query describing what you need. This returns token-budgeted context from all previous sessions, tasks, plans, and decisions.
- **Recalling past work**: Use `recall_memories` before assuming you don't have context. Previous conversations, decisions, and knowledge are indexed.
- **Exploring code**: Try `search_code` and `explain_code` before reading files directly — they return indexed, ranked results with less token overhead.
- **Before changing a shared symbol**: call `find_references` (not `grep -rn`) to get every call-site scoped to the indexed project; `explain_code`'s "Used by:" uses the same scan.
- **Locating a file**: use `find_file` (not `find -name`/`ls`) to resolve a file or directory by name/path.
- **Orienting in a large corpus**: Use `navigate` to walk the hierarchical map (project → directory → file → definition) instead of issuing repeated searches. Zoom coarse-to-fine and pull only the slice you need into context.
- **Placing an item in context**: Use `get_hierarchy` on a node id to get every layer connected to it in one call — all ancestors (project → directory → file → …) and its full descendant subtree, each with its note.
- **Understanding changes**: Use `explain_diff` for change analysis and `explain_error` for error diagnosis.
- **Storing knowledge**: Use `encode_memory` to persist important decisions, task outcomes, and learnings.

### Hierarchical Navigation — use it before bulk file reads

Indexed namespaces (e.g. `code/{project}`) are a containment map: **project → directory → file → definition → chunk**, every node carrying a one-line note (a directory rolls up its files/defs; a function carries its signature + doc). When you need to understand structure — "how is this project laid out", "what's in this module", "where does this function sit", "what does it contain" — reach for the map *first*, not a pile of `Read`s.

**`navigate`** — stateless cursor walk over the map:

1. **Orient**: call `navigate` with just `namespace` → the root view: cursor, child summaries, legal `moves`.
2. **Zoom**: pass `cursor` (current node id) + `move`: `{"ZoomIn": {"child": "<id>"}}` to descend, `"ZoomOut"` to ascend, `"Next"`/`"Prev"` for siblings, `{"Expand": {"levels": N}}` to see N levels at once.
3. **Peek**: `{"Peek": {"node": "<id>"}}` returns a node's full content without moving the cursor.
4. Every response carries `breadcrumb` (where you are, by layer) and `moves` (what is legal next) — never guess; only issue moves the response offers.

**`get_hierarchy`** — one shot, all layers around an item: `{namespace, node}` returns `ancestors` (every layer above), the `node`, and `descendants` (the whole subtree below), with `descendants_total` flagging truncation. Use it to answer "what is this item's full place in the system" without a manual climb.

**Pick the layer by intent**: strategic / "what is this" questions read near the top (project, directory, file notes); "how exactly does this work" reads the bottom (definition, chunk). You choose depth by where you stop zooming; the node's `kind` tells you which layer you're on.

**Prefer the map over re-searching**: a `navigate`/`get_hierarchy` move is a few graph reads; a fresh `search_code` re-pays full ranking and returns a flat list with no position. Use `search_code` to find an *entry point*, then `navigate`/`get_hierarchy` from there. Prefer both over reading whole files when you only need structure or one definition.

### Session Start

On every new session, load context by calling `build_context` with:
- `namespace`: derived from pwd (replace `/` with `-` in the working directory path)
- `query`: "previous tasks, plans, pending work, key decisions, progress, recent context"
- `token_budget`: 4096

This loads all prior tasks, plans, decisions, and context from previous sessions automatically.

### Namespace

All Memoreal operations require a namespace. Derive it from the current working directory by replacing `/` with `-`.
Example: `/Users/alice/projects/myapp` becomes `-Users-alice-projects-myapp`

### Memory Hygiene

- Search before encoding to avoid duplicates
- Give `feedback` on recalled memories to improve retrieval quality
- Run `consolidate` periodically to merge duplicates and detect contradictions
<!-- memoreal:end -->

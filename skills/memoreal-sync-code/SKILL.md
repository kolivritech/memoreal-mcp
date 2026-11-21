---
name: memoreal-sync-code
description: Index the current project's code into Memoreal for search and explanation.
argument-hint: [--depth shallow|deep|full] [--lang rust,ts,python]
allowed-tools: Bash
context: fork
---

Index the current working directory's code project into Memoreal.

This extracts function definitions, class structures, logic patterns, doc comments, TODOs, test names, config/manifest entries (Cargo.toml, package.json, yaml, …), and git history into semantic memories that power the `search_code`, `explain_code`, `find_references`, `find_file`, `explain_diff`, and `explain_error` MCP tools. It also records the containment metadata (relative file paths, directory paths, line spans, per-file and per-directory nodes with rollup notes) that the `navigate` and `get_hierarchy` MCP tools use to walk the project as a hierarchical map.

Determine the project path from the current working directory. Read `MEMOREAL_API_URL` / `MEMORIA_API_URL` and `MEMOREAL_API_KEY` / `MEMORIA_API_KEY` from `$HOME/.memoreal/config.env` or `$HOME/.memoria/config.env` (without sourcing) and run against the Memoreal Cloud API (`https://memoreal.kolivri.com`):

```bash
CFG_FILE=""
for f in "$HOME/.memoreal/config.env" "$HOME/.memoria/config.env"; do
  if [ -f "$f" ]; then CFG_FILE="$f"; break; fi
done
API_URL=$(grep -E '^(MEMOREAL_API_URL|MEMORIA_API_URL)=' "$CFG_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '"'\'' ')
API_KEY=$(grep -E '^(MEMOREAL_API_KEY|MEMORIA_API_KEY|MEMOREAL_KEY|MEMORIA_KEY)=' "$CFG_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '"'\'' ')
API_URL="${MEMOREAL_API_URL:-${MEMORIA_API_URL:-${API_URL:-https://memoria.kolivri.com}}}"
API_KEY="${MEMOREAL_API_KEY:-${MEMORIA_API_KEY:-${MEMOREAL_KEY:-${MEMORIA_KEY:-$API_KEY}}}}"
SYNC_BIN="$HOME/.memoreal/bin/memoreal-sync"
if [ ! -x "$SYNC_BIN" ]; then
  SYNC_BIN="${MEMOREAL_SYNC_BIN:-${MEMORIA_SYNC_BIN:-$HOME/.memoria/bin/memoria-sync}}"
fi
if [ -x "$SYNC_BIN" ]; then
  "$SYNC_BIN" code \
    --path "$CWD" \
    --api-url "$API_URL" \
    ${API_KEY:+--api-key "$API_KEY"} \
    $ARGUMENTS
fi
```

If `~/.memoreal/bin/memoreal-sync` (or `~/.memoria/bin/memoria-sync`) is not installed locally, index the current repository directly into Memoreal Cloud using the `batch_encode` MCP tool under namespace `$($HOME/.memoreal/bin/memoreal-ns 2>/dev/null || $HOME/.memoria/bin/memoria-ns)` (encoding key modules, exported functions/types/classes, and architecture summaries with `[["file", "<relative_path>"], ["category", "code"]]`).

After indexing, report: files indexed, memories created, project name, namespace.

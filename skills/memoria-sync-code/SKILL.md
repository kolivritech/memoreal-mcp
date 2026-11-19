---
name: memoria-sync-code
description: Index the current project's code into Memoria for search and explanation.
argument-hint: [--depth shallow|deep|full] [--lang rust,ts,python]
allowed-tools: Bash
context: fork
---

Index the current working directory's code project into Memoria.

This extracts function definitions, class structures, logic patterns, doc comments, TODOs, test names, config/manifest entries (Cargo.toml, package.json, yaml, …), and git history into semantic memories that power the `search_code`, `explain_code`, `find_references`, `find_file`, `explain_diff`, and `explain_error` MCP tools. It also records the containment metadata (relative file paths, directory paths, line spans, per-file and per-directory nodes with rollup notes) that the `navigate` and `get_hierarchy` MCP tools use to walk the project as a hierarchical map.

Determine the project path from the current working directory. Read `MEMORIA_API_URL` and `MEMORIA_API_KEY` from `$HOME/.memoria/config.env` (without sourcing) and run against the Memoria Cloud API (`https://memoria.kolivri.com`):

```bash
API_URL=$(grep -E '^MEMORIA_API_URL=' "$HOME/.memoria/config.env" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '"'\'' ')
API_KEY=$(grep -E '^MEMORIA_API_KEY=' "$HOME/.memoria/config.env" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '"'\'' ')
"${MEMORIA_SYNC_BIN:-$HOME/.memoria/bin/memoria-sync}" code \
  --path "$CWD" \
  --api-url "${API_URL:-https://memoria.kolivri.com}" \
  ${API_KEY:+--api-key "$API_KEY"} \
  $ARGUMENTS
```

If `~/.memoria/bin/memoria-sync` is not installed locally, index the current repository directly into Memoria Cloud using the `batch_encode` MCP tool under namespace `$($HOME/.memoria/bin/memoria-ns)` (encoding key modules, exported functions/types/classes, and architecture summaries with `[["file", "<relative_path>"], ["category", "code"]]`).

After indexing, report: files indexed, memories created, project name, namespace.

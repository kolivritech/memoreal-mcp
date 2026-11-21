---
name: memoria-sync-code
description: Index the current project's code into Memoria/Memoreal for search and explanation (canonical: /memoreal-sync-code).
argument-hint: [--depth shallow|deep|full] [--lang rust,ts,python]
allowed-tools: Bash
context: fork
---

# /memoria-sync-code — Index Project Code into Memoreal / Memoria

> **Note**: `/memoreal-sync-code` is the canonical command. `/memoria-sync-code` is maintained as a backward-compatible alias.

Index the current working directory's code project into Memoreal Cloud.

This extracts function definitions, class structures, logic patterns, doc comments, TODOs, test names, config/manifest entries, and git history into semantic memories powering `search_code`, `explain_code`, `find_references`, `find_file`, `explain_diff`, and `explain_error`.

1. Read `MEMOREAL_API_URL` / `MEMORIA_API_URL` and `MEMOREAL_API_KEY` / `MEMORIA_API_KEY` from `$HOME/.memoreal/config.env` or `$HOME/.memoria/config.env`.
2. Run `${MEMOREAL_SYNC_BIN:-${MEMORIA_SYNC_BIN:-$HOME/.memoreal/bin/memoreal-sync}}` code (or `$HOME/.memoria/bin/memoria-sync` code) against the Memoreal API.
3. If not installed locally, index via the `batch_encode` MCP tool under namespace `$($HOME/.memoreal/bin/memoreal-ns 2>/dev/null || $HOME/.memoria/bin/memoria-ns)`.
4. Report: files indexed, memories created, project name, namespace.

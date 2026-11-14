---
name: memoria-sync
description: Sync Claude Code conversations, plans, and tasks into Memoria long-term memory.
argument-hint: [--verbose | --dry-run | --reset | --project <name>]
allowed-tools: Bash
context: fork
---

Sync Claude Code data into Memoria Cloud (`https://brain.kolivri.com`) for long-term retrieval across sessions.

1. Read `MEMORIA_API_URL` and `MEMORIA_API_KEY` from `$HOME/.memoria/config.env` (without sourcing as shell code).
2. If `${MEMORIA_SYNC_BIN:-$HOME/.memoria/bin/memoria-sync}` exists, run it against the Memoria Cloud API:

```bash
API_URL=$(grep -E '^MEMORIA_API_URL=' "$HOME/.memoria/config.env" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '"'\'' ')
API_KEY=$(grep -E '^MEMORIA_API_KEY=' "$HOME/.memoria/config.env" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '"'\'' ')
"${MEMORIA_SYNC_BIN:-$HOME/.memoria/bin/memoria-sync}" \
  --api-url "${API_URL:-https://brain.kolivri.com}" \
  ${API_KEY:+--api-key "$API_KEY"} \
  $ARGUMENTS
```

3. If `memoria-sync` is not installed locally, sync directly via the Memoria Cloud MCP tools (`batch_encode` / `encode_memory` and `consolidate`) using the current project namespace (`$($HOME/.memoria/bin/memoria-ns)`): scan `.claude/plans/`, `.opencode/plans/`, and `design-log/` markdown files in the project and encode their plans, decisions, and status into Memoria Cloud.

After sync completes, report the summary: plans/files processed, memories encoded, and namespace statistics (`stats`).

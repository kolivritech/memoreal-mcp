---
name: memoreal-sync
description: Sync Claude Code conversations, plans, and tasks into Memoreal long-term memory.
argument-hint: [--verbose | --dry-run | --reset | --project <name>]
allowed-tools: Bash
context: fork
---

Sync Claude Code data into Memoreal Cloud (`https://memoreal.kolivri.com`) for long-term retrieval across sessions.

1. Read `MEMOREAL_API_URL` / `MEMORIA_API_URL` and `MEMOREAL_API_KEY` / `MEMORIA_API_KEY` from `$HOME/.memoreal/config.env` or `$HOME/.memoria/config.env` (without sourcing as shell code).
2. If `${MEMOREAL_SYNC_BIN:-${MEMORIA_SYNC_BIN:-$HOME/.memoreal/bin/memoreal-sync}}` or `$HOME/.memoria/bin/memoria-sync` exists, run it against the Memoreal Cloud API:

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
  "$SYNC_BIN" \
    --api-url "$API_URL" \
    ${API_KEY:+--api-key "$API_KEY"} \
    $ARGUMENTS
fi
```

3. If `memoreal-sync` (or `memoria-sync`) is not installed locally, sync directly via the Memoreal Cloud MCP tools (`batch_encode` / `encode_memory` and `consolidate`) using the current project namespace (`$($HOME/.memoreal/bin/memoreal-ns 2>/dev/null || $HOME/.memoria/bin/memoria-ns)`): scan `.claude/plans/`, `.opencode/plans/`, and `design-log/` markdown files in the project and encode their plans, decisions, and status into Memoreal Cloud.

After sync completes, report the summary: plans/files processed, memories encoded, and namespace statistics (`stats`).

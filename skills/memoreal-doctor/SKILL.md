---
name: memoreal-doctor
description: Diagnose Memoreal Cloud connectivity, API key health, namespace statistics, and session hooks.
---

# /memoreal-doctor — Diagnose Memoreal Cloud Health

Check that Memoreal Cloud is connected and working correctly, and report any issues.

## Steps

1. **Cloud Config check**: Verify `$HOME/.memoreal/config.env` (or legacy `$HOME/.memoria/config.env`) exists and defines `MEMOREAL_API_URL` / `MEMORIA_API_URL` (default `https://memoria.kolivri.com`) and a non-empty `MEMOREAL_API_KEY` / `MEMORIA_API_KEY`.
   - If missing or empty, instruct the user to run the installer from `/account` or `/downloads` with `MEMOREAL_KEY=mem_dev_...`.

2. **Cloud HTTP API check**: Run (passing the Bearer token via `curl -K -` stdin so it is never exposed in `ps`):
   ```bash
   CFG_FILE=""
   for f in "$HOME/.memoreal/config.env" "$HOME/.memoria/config.env"; do
     if [ -f "$f" ]; then CFG_FILE="$f"; break; fi
   done
   API_URL=$(grep -E '^(MEMOREAL_API_URL|MEMORIA_API_URL)=' "$CFG_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '"'\'' ')
   API_KEY=$(grep -E '^(MEMOREAL_API_KEY|MEMORIA_API_KEY|MEMOREAL_KEY|MEMORIA_KEY)=' "$CFG_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '"'\'' ')
   API_URL="${MEMOREAL_API_URL:-${MEMORIA_API_URL:-${API_URL:-https://memoria.kolivri.com}}}"
   API_KEY="${MEMOREAL_API_KEY:-${MEMORIA_API_KEY:-${MEMOREAL_KEY:-${MEMORIA_KEY:-$API_KEY}}}}"
   printf 'header = "Authorization: Bearer %s"\n' "$API_KEY" | curl -sf --proto '=https' --tlsv1.2 -K - "${API_URL:-https://memoria.kolivri.com}/v1/health"
   ```
   Report HTTP reachability and cloud engine status.

3. **MCP connection**: Call `health` MCP tool. Report memory count, edge count, tier distribution.

4. **Namespace check**: Derive namespace from pwd (`$HOME/.memoreal/bin/memoreal-ns 2>/dev/null || $HOME/.memoria/bin/memoria-ns`). Call `stats` for this namespace. Report memory count and types.
   - If zero memories: suggest running `/memoreal-sync` or `/memoreal-wrap-up`.

5. **Hook check**: Verify hooks are installed by checking `$HOME/.claude/settings.json` (Claude Code) and/or `$HOME/.config/opencode/plugins/memoreal-hooks.js` (OpenCode).

6. **Instructions check**: Verify `$HOME/.claude/CLAUDE.md` and/or `$HOME/.config/opencode/AGENTS.md` contains the `<!-- memoreal:start -->` (or legacy `<!-- memoria:start -->`) section.

7. **Recall test**: Call `recall_memories` with the namespace and query `"test"` with limit 3. Report if results come back.

8. **Print report** as a table:

| Check | Status | Details |
|-------|--------|---------|
| Cloud Config | OK/MISSING | `~/.memoreal/config.env` & API key |
| Cloud HTTP API | OK/FAIL | `https://memoria.kolivri.com/v1/health` |
| MCP server | OK/FAIL | memory count, edge count |
| Namespace | OK/EMPTY | namespace name, memory count |
| Hooks | OK/MISSING | Claude Code / OpenCode hooks |
| Instructions | OK/MISSING | CLAUDE.md / AGENTS.md section |
| Recall | OK/FAIL | result count |

9. If any check fails, print specific fix instructions.

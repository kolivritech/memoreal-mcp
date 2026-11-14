# /memoria-doctor — Diagnose Memoria Cloud Health

Check that Memoria Cloud is connected and working correctly, and report any issues.

## Steps

1. **Cloud Config check**: Verify `$HOME/.memoria/config.env` exists and defines `MEMORIA_API_URL` (default `https://brain.kolivri.com`) and a non-empty `MEMORIA_API_KEY`.
   - If missing or empty, instruct the user to run the installer from `/account` or `/downloads` with `MEMORIA_KEY=mem_dev_...`.

2. **Cloud HTTP API check**: Run (passing the Bearer token via `curl -K -` stdin so it is never exposed in `ps`):
   ```bash
   API_URL=$(grep -E '^MEMORIA_API_URL=' "$HOME/.memoria/config.env" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '"'\'' ')
   API_KEY=$(grep -E '^MEMORIA_API_KEY=' "$HOME/.memoria/config.env" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '"'\'' ')
   printf 'header = "Authorization: Bearer %s"\n' "$API_KEY" | curl -sf --proto '=https' --tlsv1.2 -K - "${API_URL:-https://brain.kolivri.com}/v1/health"
   ```
   Report HTTP reachability and cloud engine status.

3. **MCP connection**: Call `health` MCP tool. Report memory count, edge count, tier distribution.

4. **Namespace check**: Derive namespace from pwd (`$HOME/.memoria/bin/memoria-ns`). Call `stats` for this namespace. Report memory count and types.
   - If zero memories: suggest running `/memoria-sync` or `/memoria-wrap-up`.

5. **Hook check**: Verify hooks are installed by checking `$HOME/.claude/settings.json` (Claude Code) and/or `$HOME/.config/opencode/plugins/memoria-hooks.js` (OpenCode).

6. **Instructions check**: Verify `$HOME/.claude/CLAUDE.md` and/or `$HOME/.config/opencode/AGENTS.md` contains the `<!-- memoria:start -->` section.

7. **Recall test**: Call `recall_memories` with the namespace and query `"test"` with limit 3. Report if results come back.

8. **Print report** as a table:

| Check | Status | Details |
|-------|--------|---------|
| Cloud Config | OK/MISSING | `~/.memoria/config.env` & API key |
| Cloud HTTP API | OK/FAIL | `https://brain.kolivri.com/v1/health` |
| MCP server | OK/FAIL | memory count, edge count |
| Namespace | OK/EMPTY | namespace name, memory count |
| Hooks | OK/MISSING | Claude Code / OpenCode hooks |
| Instructions | OK/MISSING | CLAUDE.md / AGENTS.md section |
| Recall | OK/FAIL | result count |

9. If any check fails, print specific fix instructions.

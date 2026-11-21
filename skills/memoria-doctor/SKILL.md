---
name: memoria-doctor
description: Diagnose Memoria/Memoreal Cloud connectivity, API key health, namespace statistics, and session hooks (canonical: /memoreal-doctor).
---

# /memoria-doctor — Diagnose Memoreal / Memoria Cloud Health

> **Note**: `/memoreal-doctor` is the canonical command. `/memoria-doctor` is maintained as a backward-compatible alias.

Check that Memoreal Cloud is connected and working correctly, and report any issues.

## Steps

1. **Cloud Config check**: Verify `$HOME/.memoreal/config.env` or `$HOME/.memoria/config.env` exists and defines `MEMOREAL_API_KEY` / `MEMORIA_API_KEY`.
2. **Cloud HTTP API check**: Verify HTTP reachability via `https://memoria.kolivri.com/v1/health` with Bearer auth.
3. **MCP connection**: Call `health` MCP tool. Report memory count and edge count.
4. **Namespace check**: Derive namespace from pwd (`$HOME/.memoreal/bin/memoreal-ns 2>/dev/null || $HOME/.memoria/bin/memoria-ns`). Call `stats` for this namespace.
5. **Hook check**: Verify hooks in `$HOME/.claude/settings.json` and/or `$HOME/.config/opencode/plugins/memoreal-hooks.js`.
6. **Instructions check**: Verify `CLAUDE.md` / `AGENTS.md` contains `<!-- memoreal:start -->` or `<!-- memoria:start -->`.
7. **Recall test**: Call `recall_memories` with query `"test"`.
8. Report status table and suggest fixes for any failed checks.

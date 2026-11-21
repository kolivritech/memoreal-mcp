---
name: memoria-sync
description: Sync Claude Code conversations, plans, and tasks into Memoria/Memoreal long-term memory (canonical: /memoreal-sync).
argument-hint: [--verbose | --dry-run | --reset | --project <name>]
allowed-tools: Bash
context: fork
---

# /memoria-sync — Sync Claude Code Data into Memoreal / Memoria

> **Note**: `/memoreal-sync` is the canonical command. `/memoria-sync` is maintained as a backward-compatible alias.

Sync Claude Code data into Memoreal Cloud (`https://memoreal.kolivri.com`) for long-term retrieval across sessions.

1. Read `MEMOREAL_API_URL` / `MEMORIA_API_URL` and `MEMOREAL_API_KEY` / `MEMORIA_API_KEY` from `$HOME/.memoreal/config.env` or `$HOME/.memoria/config.env`.
2. Run `${MEMOREAL_SYNC_BIN:-${MEMORIA_SYNC_BIN:-$HOME/.memoreal/bin/memoreal-sync}}` (or `$HOME/.memoria/bin/memoria-sync`) if present.
3. If not installed locally, sync directly via the Memoreal Cloud MCP tools (`batch_encode` / `encode_memory` and `consolidate`) using the current project namespace (`$($HOME/.memoreal/bin/memoreal-ns 2>/dev/null || $HOME/.memoria/bin/memoria-ns)`): scan `.claude/plans/`, `.opencode/plans/`, and `design-log/` markdown files in the project and encode their plans, decisions, and status into Memoreal Cloud.
4. Report summary of plans processed, memories encoded, and namespace statistics (`stats`).

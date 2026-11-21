# 001 — PRD: Rebrand `memoria-mcp` to `Memoreal` (`@kolivri/memoreal-mcp`)

Today: 2026-11-21
**Status**: Approved Architecture & Workstream Manifest
**Repository**: `memoria-mcp`
**Worktree**: `/Users/stasarshanski/Projects/Kolivri/memoria-mcp/.worktrees/feat-rebrand-memoreal`
**Branch**: `feat/rebrand-memoreal`

---

## Pre-Design Checkpoint

1. **Package & schema fields verified**: `package.json:1-37` defines `name`, `version`, `mcpName`, `bin`, `repository`, `homepage`; `.actor/actor.json` defines `actorSpecification: 1`, `name`, `title`, `environmentVariables`; `.cursor-plugin/plugin.json` defines `name`, `displayName`, `homepage`, `repository`.
2. **States & protocol enums verified**: `src/apify-main.mjs#VALID_ACTIONS` (`recall`, `context`, `encode`, `search_code`, `health`, `standby_mcp`) and `src/schemas.mjs#MCP_TOOLS` (14 tools with `annotations` and `outputSchema`) remain 100% preserved for Glama TDQS `4.7/5.0` Grade A parity.
3. **Functions verified**: `src/server.mjs#createMemoriaMcpService` (`lines 25-260`) and `src/apify-main.mjs#executeMemoriaActorAction` (`lines 157-240`) verified in full; exporting `createMemorealMcpService` + `executeMemorealActorAction` alongside backward-compatible named aliases preserves all callers.
4. **Concrete `file#symbol` references**: Every module and test file (`test/memoria-mcp.test.mjs`, `test/apify-actor.test.mjs`) verified by reading full contents.
5. **Lifecycle traced end-to-end**: Stdio & Apify callers pass `MEMOREAL_API_KEY` (or legacy `MEMORIA_API_KEY`) -> `server.mjs` resolves endpoint -> forwards JSON-RPC 2.0 to `/v1/mcp`.
6. **Callers checked**: Checked `test/memoria-mcp.test.mjs`, `test/apify-actor.test.mjs`, `hooks/hooks.json`, and `install.sh`.

---

### Problem Solver Decision Record

- **Broken Assumption & Escape Altitude $L^*$**: Rebranding an active MCP connector must update both isolated `"Memoria"` display strings and compound identifiers (`createMemorealMcpService`, `memoreal-session-start`, `memorealApiKey`, `memoreal-ns`, `memoreal-workflow`, `/memoreal-*`) without breaking existing `MEMORIA_*` env vars (`L11` Wire Protocol).
- **Concept-Tree Occam Prune**: Pruned splitting into two separate git repositories; dual `"bin": { "memoreal-mcp": "src/server.mjs", "memoria-mcp": "src/server.mjs" }` and dual env/prompt resolution handle both canonical and legacy callers in one zero-dependency codebase.
- **Unified Concept Set (Speed & Reliability)**: Disjoint 2-worker Wave 0 (`WS-0` code/actor/tests + `WS-1` manifests/hooks/skills/docs) with dual `MEMOREAL_* ?? MEMORIA_*` resolution.
- **Rejected Epicycle & Solution Occam Delta**: Zero external dependencies added (`dependencies: undefined`).
- **Chosen Mechanism**: Rung 1/3 static schema & dual-alias exports.
- **Codebase Consolidation**: Reuses `src/server.mjs`, `src/schemas.mjs`, and `src/apify-main.mjs` in-place.
- **Verification Proof Contract**:
  - Repro Command: `npm test`
  - Invariant Assertion: `serverInfo.name === '@kolivri/memoreal-mcp'`, all 14 tools retain `annotations` + `outputSchema`, both `MEMOREAL_API_KEY` and `MEMORIA_API_KEY` authenticate, both `memoreal-session-start` and `memoria-session-start` prompts resolve, and Apify `.actor/actor.json` validates as `memoreal-mcp`.
  - Regression Suite: `npm test` (`19+` passing, `0` failures).

---

## Questions & Answers

- **Q1: What default endpoint URL should `src/server.mjs` use when neither `MEMOREAL_API_URL` nor `MEMORIA_API_URL` is set?**
  - **A1**: Default runtime `apiUrl` to `'https://memoria.kolivri.com'` (which is live with valid TLS today and serves `/v1/mcp` `200 OK` permanently per Design Log `014` even after `memoreal.kolivri.com` DNS is added), while honoring `process.env.MEMOREAL_API_URL || process.env.MEMORIA_API_URL`.

---

## Workstream Manifest
```json
{
  "prdId": "001-rebrand-memoreal-mcp",
  "worktreePath": "/Users/stasarshanski/Projects/Kolivri/memoria-mcp/.worktrees/feat-rebrand-memoreal",
  "openQuestions": 0,
  "integrationVerifyCmd": "npm test",
  "workstreams": [
    {
      "id": "WS-0",
      "wave": 0,
      "layer": "providers_parallel",
      "title": "Rebrand MCP Server, Schemas, Apify Actor, Package & Unit/Integration Tests",
      "description": "Update package.json (@kolivri/memoreal-mcp, mcpName io.github.kolivritech/memoreal-mcp, dual bin memoreal-mcp & memoria-mcp), src/server.mjs (createMemorealMcpService + createMemoriaMcpService alias, MEMOREAL_* || MEMORIA_* env vars, serverInfo.name '@kolivri/memoreal-mcp', dual memoreal-*/memoria-* prompt handlers), src/schemas.mjs (Memoreal Cloud instructions, tool titles/descriptions, /memoreal-sync-code, MEMOREAL_*, memoreal-* prompts), src/apify-main.mjs (executeMemorealActorAction + executeMemoriaActorAction alias, MEMOREAL_* || MEMORIA_*), .actor/actor.json (name 'memoreal-mcp'), .actor/input_schema.json, test/memoria-mcp.test.mjs, and test/apify-actor.test.mjs.",
      "ownedFiles": [
        "package.json",
        "src/server.mjs",
        "src/schemas.mjs",
        "src/apify-main.mjs",
        ".actor/actor.json",
        ".actor/input_schema.json",
        "test/memoria-mcp.test.mjs",
        "test/apify-actor.test.mjs"
      ],
      "readOnlyContext": [
        "prd/001-rebrand-memoreal-mcp.md"
      ],
      "verifyCmd": "npm test"
    },
    {
      "id": "WS-1",
      "wave": 0,
      "layer": "providers_parallel",
      "title": "Rebrand README, CLAUDE.md, Manifests, Cursor Plugin, Hooks, Rules, Agents & Skills",
      "description": "Rebrand README.md, CLAUDE.md (<!-- memoreal:start -->), server.json (io.github.kolivritech/memoreal-mcp), smithery.yaml (memorealApiKey), manifest.json, mcp.json, .mcp.json, .cursor-plugin/plugin.json (name 'memoreal'), install.sh (~/.memoreal with ~/.memoria symlink & dual MEMOREAL_*/MEMORIA_*), hooks/hooks.json (~/.memoreal/bin/memoreal-ns falling back to ~/.memoria/bin/memoria-ns), and create/update bin/memoreal-ns, bin/memoria-ns, rules/memoreal.mdc, rules/memoria.mdc, agents/memoreal.md, agents/memoria.md, opencode/memoreal-hooks.js, opencode/memoria-hooks.js, skills/memoreal-{doctor,sync,sync-code,wrap-up}/SKILL.md, and skills/memoria-{doctor,sync,sync-code,wrap-up}/SKILL.md.",
      "ownedFiles": [
        "README.md",
        "CLAUDE.md",
        "server.json",
        "smithery.yaml",
        "manifest.json",
        "mcp.json",
        ".mcp.json",
        ".cursor-plugin/plugin.json",
        "install.sh",
        "hooks/hooks.json",
        "bin/memoreal-ns",
        "bin/memoria-ns",
        "rules/memoreal.mdc",
        "rules/memoria.mdc",
        "agents/memoreal.md",
        "agents/memoria.md",
        "opencode/memoreal-hooks.js",
        "opencode/memoria-hooks.js",
        "skills/memoreal-doctor/SKILL.md",
        "skills/memoreal-sync/SKILL.md",
        "skills/memoreal-sync-code/SKILL.md",
        "skills/memoreal-wrap-up/SKILL.md",
        "skills/memoria-doctor/SKILL.md",
        "skills/memoria-sync/SKILL.md",
        "skills/memoria-sync-code/SKILL.md",
        "skills/memoria-wrap-up/SKILL.md"
      ],
      "readOnlyContext": [
        "prd/001-rebrand-memoreal-mcp.md"
      ],
      "verifyCmd": "node -e \"const fs=require('fs');['server.json','manifest.json','mcp.json','.mcp.json','.cursor-plugin/plugin.json','hooks/hooks.json'].forEach(f=>JSON.parse(fs.readFileSync(f,'utf8')));console.log('JSON_OK');\""
    }
  ]
}
```

---

## Verification Criteria

1. `npm test` passes 100% of stdio MCP and Apify Actor tests (`19+` passing, `0` failures).
2. All JSON manifests (`package.json`, `server.json`, `manifest.json`, `mcp.json`, `.mcp.json`, `.cursor-plugin/plugin.json`, `.actor/actor.json`, `.actor/input_schema.json`, `hooks/hooks.json`) parse cleanly and reflect `Memoreal` / `memoreal`.
3. Both `MEMOREAL_*` and legacy `MEMORIA_*` environment variables and prompt names (`memoreal-*` and `memoria-*`) execute without error.

---

## Implementation Results

- **Wave 0 (`WS-0` & `WS-1` in parallel)**:
  - `WS-0`: Rebranded `package.json` (`@kolivri/memoreal-mcp`, `mcpName: io.github.kolivritech/memoreal-mcp`, dual `bin` `memoreal-mcp` & `memoria-mcp`), `src/server.mjs` (`createMemorealMcpService` + `createMemoriaMcpService` alias, dual `MEMOREAL_*/MEMORIA_*` env vars, dual `memoreal-*/memoria-*` prompts), `src/schemas.mjs`, `src/apify-main.mjs` (`executeMemorealActorAction` + alias), `.actor/actor.json` (`memoreal-mcp`), `.actor/input_schema.json`, and expanded test suites (`24/24` passing).
  - `WS-1`: Rebranded `README.md`, `CLAUDE.md` (`<!-- memoreal:start -->`), `server.json`, `smithery.yaml` (`memorealApiKey`), `manifest.json`, `mcp.json`, `.mcp.json`, `.cursor-plugin/plugin.json` (`memoreal`), `install.sh`, `hooks/hooks.json`, and added `bin/memoreal-ns`, `rules/memoreal.mdc`, `agents/memoreal.md`, `opencode/memoreal-hooks.js`, and `skills/memoreal-{doctor,sync,sync-code,wrap-up}/SKILL.md` with backward-compatible legacy delegates (`JSON_OK`).
- **Full Integration Verification (`npm test`)**: **`24 / 24` tests passing** (`0` failures). Zero deviations from the approved design.


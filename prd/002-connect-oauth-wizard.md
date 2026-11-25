# 002 — PRD: Memoreal Chrome OAuth Device-Pairing & IDE Setup Wizard (`@kolivri/memoreal-mcp`)

Today: 2026-11-26
**Status**: Approved Architecture & Workstream Manifest
**Repository**: `memoria-mcp` (`@kolivri/memoreal-mcp`)
**Worktree**: `/Users/stasarshanski/Projects/Kolivri/memoria-mcp/.worktrees/feat-connect-wizard`
**Branch**: `feat/connect-wizard`

---

## Pre-Design Checkpoint

1. **Fields & config schemas verified**:
   - `src/schemas.mjs#MCP_TOOLS` (`lines 41-456`) defines 14 frozen tool descriptors, each carrying `name`, `title`, `description`, `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), `inputSchema`, and `outputSchema`.
   - `install.sh` (`lines 81-83`) defines the canonical 6-key `config.env` format (`MEMOREAL_URL`, `MEMOREAL_API_URL`, `MEMOREAL_API_KEY`, `MEMORIA_URL`, `MEMORIA_API_URL`, `MEMORIA_API_KEY`) and IDE JSON shapes (`lines 223-305`: `.mcp.memoreal` in `~/.config/opencode/opencode.json`; `.mcpServers.memoreal` in `~/.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json`, `~/.vscode/mcp.json`, Claude Desktop `claude_desktop_config.json`, and existing `~/.claude.json`).
   - `package.json` (`lines 7-10`) maps both `memoreal-mcp` and `memoria-mcp` binaries to `src/server.mjs`.
2. **States & enum constraints verified**:
   - `connect_account` input `action` enum is `['start', 'status']` (`required: []`).
   - `connect_account` output `status` enum is `['already_connected', 'waiting_for_browser', 'connected', 'not_started', 'denied', 'expired']`.
   - Device poll statuses from `POST /v1/auth/device/poll` (`pending` / `authorization_pending`, `approved`, `denied` / `access_denied`, `expired` / `expired_token`) transition deterministically.
   - Glama TDQS invariants in `test/memoria-mcp.test.mjs` (`lines 146-153`) require every tool in `MCP_TOOLS` to publish boolean `annotations.readOnlyHint`, `outputSchema.type === 'object'`, and a `description` matching `/Use (when|at|to|after|before)/i`.
3. **Referenced functions verified**:
   - `src/server.mjs#createMemorealMcpService` (`lines 25-419`), `requireApiKey` (`lines 52-60`), `forwardCloudRpc` (`lines 62-103`), `callTool` (`lines 105-145`), `startMcpStdioServer` (`lines 423-471`), and `isDirectExecution` (`lines 473-485`) verified by reading full source.
   - `src/apify-main.mjs#normalizeInput` (`lines 17-48`) and `executeMemorealActorAction` (`lines 157-244`) verified to confirm how `apiKey: ''` in `test/apify-actor.test.mjs` (`lines 166-199`) interacts with `createMemorealMcpService`.
   - `opencode/memoreal-hooks.js#resolveCloudConfig` (`lines 45-90`), `fetchSessionStartContext` (`lines 92-135`), `MemorealHooksPlugin` (`lines 236-339`), and `setup` (`lines 350-463`), plus `opencode/memoria-hooks.js` (`lines 1-26`) and `hooks/hooks.json` (`lines 1-119`), verified in full.
4. **Concrete `file#symbol` references**: Every architectural claim above cites exact file paths and symbol/line ranges with zero unverified assumptions.
5. **End-to-end lifecycle traced**:
   - **Unconfigured start**: `SessionStart` hook (`hooks/hooks.json` / `opencode/memoreal-hooks.js`) or `src/server.mjs#requireApiKey` detects missing or placeholder key (`mem_dev_your_key_here`, `mem_dev_...`, `YOUR_API_KEY`, `<MEMOREAL_API_KEY>`) and instructs the AI assistant to drive the 3-Click Interactive In-Chat Wizard via `AskUserQuestion` / `question` while keeping `Read`/`Edit`/`Write` hooks silent.
   - **Device pairing**: Calling `connect_account({ action: 'start' })` posts to `${apiUrl}/v1/auth/device/start`, opens Chrome non-blockingly (`open` / `xdg-open` / `cmd /c start ""`), starts an `.unref()`ed background poller against `${apiUrl}/v1/auth/device/poll`, and immediately returns `waiting_for_browser` with `user_code`, `verification_uri`, and `verification_uri_complete`.
   - **Approval & zero-restart hot-reload**: When `/v1/auth/device/poll` returns `approved`, the poller writes `0600` `~/.memoreal/config.env` and `~/.memoria/config.env` (`0700` dirs, honoring `MEMOREAL_HOME`), merges `memoreal` into existing IDE config directories with `.bak` backups (skipping malformed JSON), sets `runtimePairedApiKey` in memory inside `createMemorealMcpService`, and caches `{ status: 'connected', workspace }` with all secret fields stripped so subsequent `encode_memory` / `build_context` calls succeed immediately without restarting the IDE.
6. **Callers & consumers checked**:
   - `test/memoria-mcp.test.mjs:190-208` passes `{ MEMOREAL_API_KEY: '', MEMORIA_API_KEY: '' }` expecting `Missing Memoreal API key: set MEMOREAL_API_KEY`; `resolveEffectiveApiKey` honors explicit empty `MEMOREAL_API_KEY === ''` in ambient `HOME` while still allowing `runtimePairedApiKey` and isolated `MEMOREAL_HOME` / `MEMOREAL_CONFIG_DIR` hot-reload.
   - `test/apify-actor.test.mjs:166-199` deletes `MEMOREAL_API_KEY` and passes `{ apiKey: '' }`; `src/apify-main.mjs#executeMemorealActorAction` passes `disableConfigFileFallback: true` when `rawInput.apiKey` is explicitly empty so developer `~/.memoria/config.env` files never pollute actor unit tests.

---

### Problem Solver Decision Record

- **Broken Assumption & Escape Altitude $L^*$**: Shatters the assumption that stdio MCP connectors have static startup-only credentials requiring users to copy-paste raw API keys into chat or restart their IDE; ascends to `L11` (Wire / IPC Protocol) and `L14` (Bootstrap / Initialization) via Alien-Domain Isomorphism `L28` (RFC 8628 OAuth 2.0 Device Authorization Grant + copy-on-write `.bak` config persistence).
- **Concept-Tree Occam Prune**: Pruned spawning an ephemeral localhost OAuth HTTP callback listener inside stdio MCP processes (eliminating port collisions across multi-window IDEs and OS firewall popups) and pruned third-party npm packages (`open`, `dotenv`, `inquirer`) in favor of zero-dependency Node.js `>= 18` built-ins (`fetch`, `readline`, `child_process.spawn`, `fs`).
- **Unified Concept Set (Speed & Reliability)**: Fuses *Canonical Entry Normalization* (`sanitizeApiKey` rejecting placeholder tokens across env vars, `config.env`, and hooks) with *Dual In-Memory + On-Disk Hot-Reload* (`runtimePairedApiKey` + per-request `readSavedMemorealConfig`), collapsing 4 credential sources and 2 onboarding entrypoints (`connect_account` MCP tool + `setup`/`login`/`init` CLI) into 1 shared `src/config-store.mjs` + `src/wizard.mjs` primitive ($K \to 1$).
- **Rejected Epicycle & Solution Occam Delta**: Rejects Rung 6 LLM chat copy-paste of raw secrets (preventing secret exposure in LLM context windows) and Rung 5 local port locks; uses Rung 1/3 deterministic FSM and `0600` file persistence with $\Delta\text{dependencies} = 0$ and $\Delta\text{src modules} = +2$ (`src/config-store.mjs`, `src/wizard.mjs`).
- **Chosen Mechanism**: Rung 1 static MCP schema (`connect_account` with strict secret-redaction invariant) + Rung 3 deterministic device-code poller, placeholder-aware `resolveEffectiveApiKey`, `.bak`-guarded IDE JSON merger, and unregistered-silent hook gate.
- **Codebase Consolidation**: Extends `src/server.mjs#createMemorealMcpService`, `src/schemas.mjs#MCP_TOOLS`, `opencode/memoreal-hooks.js#resolveCloudConfig`, and `install.sh`'s exact 6-variable `config.env` layout.
- **Verification Proof Contract**:
  - Repro Command: `node --test ./test/connect-wizard.test.mjs`
  - Invariant Assertion: `MCP_TOOLS.length === 15` with 100% Glama TDQS compliance, `connect_account` transitions `waiting_for_browser` -> `connected` and hot-reloads `encode_memory` in-process without restart, `config.env` mode is `0600` (`0700` dir) under isolated `MEMOREAL_HOME`, `.bak` backups are created before IDE JSON merges while malformed JSON is preserved untouched, hooks produce zero output on `Read`/`Edit`/`Write` when unregistered, and raw `api_key` never appears in any MCP output or CLI stdout.
  - Regression Suite: `npm test`

---

## Questions & Answers

- **Q1: How does `resolveEffectiveApiKey` support zero-restart `config.env` hot-reload without breaking `test/memoria-mcp.test.mjs:190` (`MEMOREAL_API_KEY: ''`) on developer machines that already have `~/.memoreal/config.env` or `~/.memoria/config.env`?**
  - **A1**: `resolveEffectiveApiKey` checks `overrideKey`, `runtimePairedApiKey`, `options.apiKey`, and `MEMOREAL_API_KEY` / `MEMOREAL_KEY` / `MEMORIA_API_KEY` / `MEMORIA_KEY` (filtering placeholders via `sanitizeApiKey`). When all are empty, it skips `$HOME` config-file fallback if `options.disableConfigFileFallback === true` or if `'MEMOREAL_API_KEY' in env && env.MEMOREAL_API_KEY === ''` without an explicit `MEMOREAL_HOME` / `MEMOREAL_CONFIG_DIR` test directory override. Placeholder strings such as `mem_dev_your_key_here` are non-empty in `env`, so they fall through to `config.env` hot-reload once paired.
- **Q2: How should the AI assistant guide unregistered users in chat across Claude Code, OpenCode, and Cursor?**
  - **A2**: `MCP_SERVER_INSTRUCTIONS`, `requireApiKey` / `401` errors, `connect_account` messages, `hooks/hooks.json`, `opencode/memoria-hooks.js` (`opencode/memoreal-hooks.js`), and `skills/memoreal-connect/SKILL.md` instruct the assistant to drive the **3-Click Interactive In-Chat Wizard** via `AskUserQuestion` (Claude Code) or `question` (OpenCode & Cursor): Step 1 `"Connect in 1 Click via Google / Browser (Recommended)"` vs `"Skip for this session"`, Step 2 `connect_account({ action: "start" })` + clickable `/connect?code=XXXX-YYYY` link + `"I clicked Authorize — Verify"` (`connect_account({ action: "status" })`), and Step 3 `"Yes — Index repo now (Recommended)"` vs `"Later"`, never asking users to paste raw API keys into chat.

---

## Workstream Manifest
```json
{
  "prdId": "002-connect-oauth-wizard",
  "worktreePath": "/Users/stasarshanski/Projects/Kolivri/memoria-mcp/.worktrees/feat-connect-wizard",
  "openQuestions": 0,
  "integrationVerifyCmd": "npm test",
  "workstreams": [
    {
      "id": "WS-0",
      "wave": 0,
      "layer": "architecture_base",
      "title": "Placeholder Detection, Dynamic Config Store, IDE Config Merger & Unit Tests",
      "description": "Create .gitignore ignoring .worktrees/, implement src/config-store.mjs for placeholder filtering, dynamic config.env resolution, 0600 persistence, and .bak IDE merging under MEMOREAL_HOME, and build unit tests in test/config-store.test.mjs.",
      "atomicChanges": [
        ".gitignore: create ignore rules for `.worktrees/`, `node_modules/`, `.DS_Store`, and `*.bak`.",
        "src/config-store.mjs: implement `isPlaceholderApiKey(raw)`, `sanitizeApiKey(raw)`, and `POLITE_ONBOARDING_ACTION` driving the 3-Click Wizard via `AskUserQuestion` or `question`.",
        "src/config-store.mjs: implement `resolveHomeDir(options)`, `readSavedMemorealConfig(options)`, `resolveEffectiveApiKey(overrideKey, options)`, and `resolveEffectiveApiUrl(overrideUrl, options)` honoring `runtimePairedApiKey`, explicit blank `MEMOREAL_API_KEY === ''` isolation, and `MEMOREAL_HOME`.",
        "src/config-store.mjs: implement `saveMemorealConfig({ apiKey, apiUrl, homeDir, env })` (`0700` dir, `0600` `config.env` + `.bak`) and `configureDetectedIdes({ apiKey, apiUrl, homeDir, env, preferredTool })` merging `memoreal` into `.config/opencode/opencode.json` (using OpenCode native `.mcp.memoreal = { type: 'remote', url, enabled: true, headers }`, never `.mcpServers`, and creating it when `preferredTool === 'opencode'`), `.cursor/mcp.json`, `.codeium/windsurf/mcp_config.json`, `.vscode/mcp.json`, Claude Desktop `claude_desktop_config.json`, and existing `.claude.json` with `.bak` backups while skipping malformed JSON.",
        "test/config-store.test.mjs: build unit tests verifying placeholder key filtering, `resolveEffectiveApiKey` test isolation, `0600` `config.env` persistence, and `.bak` IDE config merging (leaving malformed JSON untouched) strictly inside `MEMOREAL_HOME`."
      ],
      "ownedFiles": [
        ".gitignore",
        "src/config-store.mjs",
        "test/config-store.test.mjs"
      ],
      "readOnlyContext": [
        "prd/002-connect-oauth-wizard.md",
        "src/server.mjs",
        "install.sh",
        "test/memoria-mcp.test.mjs"
      ],
      "verifyCmd": "node --test ./test/config-store.test.mjs"
    },
    {
      "id": "WS-1",
      "wave": 0,
      "layer": "interfaces_first",
      "title": "connect_account Schema, memoreal-connect Skill & Schema Unit Tests",
      "description": "Update src/schemas.mjs with 3-Click Wizard instructions and the 15th connect_account tool schema, author skills/memoreal-connect/SKILL.md, and update unit tests in test/memoria-mcp.test.mjs.",
      "atomicChanges": [
        "src/schemas.mjs: update `MCP_SERVER_INSTRUCTIONS` (preserving `Memoreal Cloud`) to instruct assistants to run the 3-Click Interactive In-Chat Wizard via `AskUserQuestion` or `question` when unauthenticated and never ask users to paste raw API keys.",
        "src/schemas.mjs: append `connect_account` to `MCP_TOOLS` (15 tools total) with `annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }`, `inputSchema` (`action`, `open_browser`, `client_name`, `required: []`), `outputSchema` (`type: 'object'`), and `Use when` disambiguation text.",
        "skills/memoreal-connect/SKILL.md: create `/memoreal-connect` slash-command skill driving the 3-Click Interactive In-Chat Wizard (`AskUserQuestion` / `question` Step 1 connect card, Step 2 `connect_account` start/status verification card, Step 3 repo code-graph indexing card).",
        "test/memoria-mcp.test.mjs: update unit tests for 15 tools (`MCP_TOOLS.length === 15`), asserting `connect_account` satisfies Glama TDQS `annotations`, `outputSchema`, `/Use (when|at|to|after|before)/i`, and `required: []`."
      ],
      "ownedFiles": [
        "src/schemas.mjs",
        "skills/memoreal-connect/SKILL.md",
        "test/memoria-mcp.test.mjs"
      ],
      "readOnlyContext": [
        "prd/002-connect-oauth-wizard.md",
        "src/server.mjs"
      ],
      "verifyCmd": "node --test ./test/memoria-mcp.test.mjs"
    },
    {
      "id": "WS-2",
      "wave": 1,
      "layer": "providers_parallel",
      "dependsOn": ["WS-0"],
      "title": "Device-Pairing Wizard Controller, Terminal CLI Setup & Unit Tests",
      "description": "Implement src/wizard.mjs providing non-blocking OS browser launch, background /v1/auth/device/poll state machine with strict api_key redaction, and runCliSetupWizard(), plus unit tests in test/wizard-unit.test.mjs.",
      "atomicChanges": [
        "src/wizard.mjs: implement `openUrlInBrowser(url, options)` spawning `open` (`darwin`), `xdg-open` (`linux`), or `cmd /c start \"\"` (`win32`) detached with `.unref()` and silent error handling while respecting `MEMOREAL_NO_BROWSER=1`.",
        "src/wizard.mjs: implement `sanitizeWorkspaceMetadata(workspace)` stripping secret properties (`api_key`, `apiKey`, `token`, `secret`) and `normalizeClientToolSlug(rawName)` mapping host clients to `'opencode'`, `'cursor'`, `'claude-code'`, `'vscode'`, `'windsurf'`, `'zed'`, or `'codex'`.",
        "src/wizard.mjs: implement `createConnectWizardController(options)` handling `already_connected` `/v1/health` check, `action: 'start'` (`POST /v1/auth/device/start` sending `{ client_name: args.client_name || connectedClientName || 'Memoreal MCP', tool }` + `.unref()` background `POST /v1/auth/device/poll` saving `0600` config, merging IDE configs with `preferredTool: tool`, invoking `onApproved`, and returning 3-Click Wizard Step 2 message), and `action: 'status'`.",
        "src/wizard.mjs: implement `runCliSetupWizard(options)` supporting `--browser` auto-start and interactive TTY choices `[1] Sign in via Browser with Google / Email (Recommended — 1,000 free calls, zero copy-paste)` and `[2] Enter an existing API key (hidden input)`, saving `0600` config, updating IDEs, verifying `/v1/health`, and printing a secret-free summary.",
        "test/wizard-unit.test.mjs: build unit tests verifying `sanitizeWorkspaceMetadata` redaction, `openUrlInBrowser` platform/flag handling, `createConnectWizardController` start/poll/status transitions, and `runCliSetupWizard` mock execution."
      ],
      "ownedFiles": [
        "src/wizard.mjs",
        "test/wizard-unit.test.mjs"
      ],
      "readOnlyContext": [
        "prd/002-connect-oauth-wizard.md",
        "src/config-store.mjs",
        "src/schemas.mjs"
      ],
      "verifyCmd": "node --test ./test/wizard-unit.test.mjs"
    },
    {
      "id": "WS-3",
      "wave": 1,
      "layer": "providers_parallel",
      "dependsOn": ["WS-0"],
      "title": "Silent-When-Unregistered Hooks, Doctor Sync & Hook Unit Tests",
      "description": "Sync hooks/hooks.json, opencode/memoreal-hooks.js, opencode/memoria-hooks.js, and skills/memoreal-doctor/SKILL.md so Read/Edit/Write hooks stay silent when unregistered and SessionStart emits the one-time 3-Click Wizard prompt, with unit tests in test/hooks-onboarding.test.mjs.",
      "atomicChanges": [
        "hooks/hooks.json: filter placeholder keys (`mem_dev_your_key_here`, `mem_dev_*...*`, `YOUR_API_KEY`, `<*>`) and exit silently on `PreCompact`, `PostCompact`, `UserPromptSubmit`, `PostToolUse` (`TaskCreate`, `Write`, `Edit`, `Read`), `TaskCompleted`, and `Stop` when unregistered while emitting the polite one-time 3-Click Wizard message on `SessionStart`.",
        "opencode/memoreal-hooks.js: reject placeholder keys in `resolveCloudConfig`, return the one-time 3-Click Wizard (`AskUserQuestion` / `question`) prompt from `fetchSessionStartContext` when `!apiKey`, and suppress `Read`/`Write`/`Edit`/`todowrite`/compaction/correction/stop hook output when `!resolveCloudConfig().apiKey`.",
        "opencode/memoria-hooks.js: re-export `isPlaceholderApiKey` and `ONBOARDING_WIZARD_PROMPT` alongside `MemorealHooksPlugin` and `setup` so OpenCode plugins expose the 3-Click Interactive In-Chat Wizard contract.",
        "skills/memoreal-doctor/SKILL.md: ensure zero `brain.kolivri.com` references, detect placeholder keys in `~/.memoreal/config.env`, and direct unconfigured users to the 3-Click Wizard (`connect_account` or `npx -y @kolivri/memoreal-mcp setup`) without pasting raw keys.",
        "test/hooks-onboarding.test.mjs: build unit tests verifying `hooks/hooks.json` and `opencode/memoria-hooks.js` emit zero output on `Read`/`Edit`/`Write` when unregistered or using placeholder keys, emit the one-time 3-Click Wizard prompt on `SessionStart`, and `skills/memoreal-doctor/SKILL.md` contains no `brain.kolivri.com`."
      ],
      "ownedFiles": [
        "hooks/hooks.json",
        "opencode/memoreal-hooks.js",
        "opencode/memoria-hooks.js",
        "skills/memoreal-doctor/SKILL.md",
        "test/hooks-onboarding.test.mjs"
      ],
      "readOnlyContext": [
        "prd/002-connect-oauth-wizard.md",
        "src/config-store.mjs"
      ],
      "verifyCmd": "node --test ./test/hooks-onboarding.test.mjs"
    },
    {
      "id": "WS-4",
      "wave": 2,
      "layer": "consumers_after",
      "dependsOn": ["WS-0", "WS-1", "WS-2"],
      "title": "Wire Dynamic Hot-Reload, connect_account & CLI Entrypoint in server.mjs",
      "description": "Integrate config-store.mjs and wizard.mjs into src/server.mjs and src/apify-main.mjs for zero-restart key hot-reload, polite 3-Click Wizard 401/missing-key errors, connect_account dispatch, and CLI setup/login/init subcommands, updating unit tests in test/apify-actor.test.mjs.",
      "atomicChanges": [
        "src/server.mjs: update `createMemorealMcpService` to track `runtimePairedApiKey`, resolve keys and URLs dynamically via `resolveEffectiveApiKey` and `resolveEffectiveApiUrl`, and append `POLITE_ONBOARDING_ACTION` (keeping `'Missing Memoreal API key: set MEMOREAL_API_KEY'`) in `requireApiKey` and HTTP `401` errors in `forwardCloudRpc`.",
        "src/server.mjs: capture sanitized `params?.clientInfo?.name` into `connectedClientName` on `initialize`, instantiate `createConnectWizardController` with `getConnectedClientName`, route `callTool('connect_account', args)` locally without requiring an existing API key, and invoke `wizard.close()` when `startMcpStdioServer` closes.",
        "src/server.mjs: update the `isDirectExecution` entrypoint to dispatch `runCliSetupWizard({ argv: process.argv.slice(2) })` when `process.argv[2]` is `'setup'`, `'login'`, or `'init'` instead of starting the JSON-RPC stdio server.",
        "src/apify-main.mjs: sanitize placeholder keys in `normalizeInput` via `sanitizeApiKey` and pass `disableConfigFileFallback: ('apiKey' in rawInput && !sanitizeApiKey(rawInput.apiKey))` to `createMemorealMcpService` in `executeMemorealActorAction`.",
        "test/apify-actor.test.mjs: update unit tests to assert placeholder keys (`mem_dev_your_key_here`) and explicit empty `apiKey: ''` fail with `Missing Memoreal API key` and `Polite Onboarding Action` without leaking ambient `config.env`."
      ],
      "ownedFiles": [
        "src/server.mjs",
        "src/apify-main.mjs",
        "test/apify-actor.test.mjs"
      ],
      "readOnlyContext": [
        "prd/002-connect-oauth-wizard.md",
        "src/config-store.mjs",
        "src/schemas.mjs",
        "src/wizard.mjs",
        "test/memoria-mcp.test.mjs"
      ],
      "verifyCmd": "node --test ./test/apify-actor.test.mjs ./test/memoria-mcp.test.mjs"
    },
    {
      "id": "WS-5",
      "wave": 3,
      "layer": "consumers_after",
      "dependsOn": ["WS-2", "WS-3", "WS-4"],
      "title": "End-to-End Connect Wizard, Hot-Reload, CLI & Quiet-Hooks E2E Suite",
      "description": "Create end-to-end integration test suite test/connect-wizard.test.mjs verifying connect_account OAuth device pairing over stdio MCP, zero-restart hot-reload, 0600 permissions, .bak IDE config merging, placeholder/401 guidance, and node src/server.mjs setup --browser.",
      "atomicChanges": [
        "test/connect-wizard.test.mjs: add end-to-end stdio MCP test verifying `initialize` `clientInfo.name` (for example `'OpenCode'` or `'Cursor'`) forwards `client_name` and normalized `tool` slug (`'opencode'`, `'cursor'`, `'claude-code'`, `'vscode'`, `'windsurf'`, `'zed'`, `'codex'`) to `POST /v1/auth/device/start`, completes `connect_account` (`start` -> `poll` -> `status: 'connected'`), hot-reloads `encode_memory` without restart, writes `0600` `config.env` under `MEMOREAL_HOME`, and never exposes raw `api_key` in any MCP response.",
        "test/connect-wizard.test.mjs: add end-to-end IDE config merge test strictly within `MEMOREAL_HOME` verifying `.bak` backups, OpenCode native `.mcp.memoreal` (`type: 'remote'`, never `.mcpServers`) in `.config/opencode/opencode.json`, and `.mcpServers.memoreal` across `.cursor/mcp.json`, `.codeium/windsurf/mcp_config.json`, `.vscode/mcp.json`, Claude Desktop `claude_desktop_config.json`, and existing `.claude.json` while leaving malformed JSON untouched.",
        "test/connect-wizard.test.mjs: add end-to-end stdio MCP test for placeholder key rejection (`mem_dev_your_key_here`, `mem_dev_...`, `YOUR_API_KEY`, `<MEMOREAL_API_KEY>`), cross-process `config.env` hot-reload, and HTTP `401` responses containing `'Missing Memoreal API key: set MEMOREAL_API_KEY'` and 3-Click Wizard guidance.",
        "test/connect-wizard.test.mjs: add end-to-end CLI process test spawning `node src/server.mjs setup --browser` (and `login` / hidden-key input) against a local mock HTTP server with `MEMOREAL_NO_BROWSER=1` and isolated `MEMOREAL_HOME`, verifying `0600` `config.env`, `/v1/health` verification, and zero raw `api_key` in stdout."
      ],
      "ownedFiles": [
        "test/connect-wizard.test.mjs"
      ],
      "readOnlyContext": [
        "prd/002-connect-oauth-wizard.md",
        "src/config-store.mjs",
        "src/schemas.mjs",
        "src/wizard.mjs",
        "src/server.mjs",
        "hooks/hooks.json",
        "opencode/memoreal-hooks.js",
        "opencode/memoria-hooks.js",
        "skills/memoreal-doctor/SKILL.md",
        "skills/memoreal-connect/SKILL.md"
      ],
      "verifyCmd": "npm test"
    }
  ]
}
```

---

## Verification Criteria

1. `npm test` passes 100% across `test/memoria-mcp.test.mjs`, `test/apify-actor.test.mjs`, and `test/connect-wizard.test.mjs` with zero skipped or stubbed assertions.
2. `MCP_TOOLS` exports 15 tools (`connect_account` + 14 memory/code tools), all satisfying Glama TDQS `annotations`, `outputSchema`, and `/Use (when|at|to|after|before)/i` description checks.
3. Placeholder keys (`mem_dev_your_key_here`, `mem_dev_...`, `YOUR_API_KEY`, `<MEMOREAL_API_KEY>`) are treated as unconfigured, `test/memoria-mcp.test.mjs:190` passes on machines with or without `~/.memoreal/config.env`, and `requireApiKey` / `401` errors include `'Missing Memoreal API key: set MEMOREAL_API_KEY'`, `'Polite Onboarding Action'`, and 3-Click Interactive In-Chat Wizard guidance.
4. `connect_account` and `node src/server.mjs setup --browser` persist `0600` `config.env` inside `0700` directories under `MEMOREAL_HOME`, back up existing IDE configs to `.bak` without corrupting malformed JSON, hot-reload `encode_memory` immediately without restart, and never expose raw `api_key` values in MCP responses or CLI output.
5. `hooks/hooks.json` and `opencode/memoria-hooks.js` (`opencode/memoreal-hooks.js`) emit zero output on `Read`/`Edit`/`Write` when unregistered and emit a polite one-time 3-Click Wizard prompt on `SessionStart`.

---

## Implementation Results

- **Wave 0 (`WS-0` & `WS-1`)**:
  - `WS-0`: Created `.gitignore`, `src/config-store.mjs` (`isPlaceholderApiKey`, `sanitizeApiKey`, `resolveEffectiveApiKey`, `resolveEffectiveApiUrl`, `saveMemorealConfig` with `0700`/`0600` permissions + `.bak`, `configureDetectedIdes` with OpenCode native `.mcp.memoreal` vs `.mcpServers.memoreal` across Cursor/Windsurf/VS Code/Claude Desktop/existing `.claude.json` while skipping malformed JSON, and `POLITE_ONBOARDING_ACTION`), and `test/config-store.test.mjs` (`22/22` passing).
  - `WS-1`: Updated `src/schemas.mjs` (`MCP_SERVER_INSTRUCTIONS` + 15th `connect_account` tool descriptor with Glama TDQS compliance), created `skills/memoreal-connect/SKILL.md`, and updated `test/memoria-mcp.test.mjs` (`8/8` passing).
- **Wave 1 (`WS-2` & `WS-3`)**:
  - `WS-2`: Created `src/wizard.mjs` (`normalizeClientToolSlug`, `sanitizeClientName`, `sanitizeWorkspaceMetadata`, `openUrlInBrowser`, `createConnectWizardController`, `runCliSetupWizard`) and `test/wizard-unit.test.mjs` (`18/18` passing).
  - `WS-3`: Updated `hooks/hooks.json`, `opencode/memoreal-hooks.js`, `opencode/memoria-hooks.js`, and `skills/memoreal-doctor/SKILL.md`, and added `test/hooks-onboarding.test.mjs` (`16/16` passing).
- **Wave 2 (`WS-4`)**:
  - `WS-4`: Wired dynamic hot-reload (`runtimePairedApiKey` + `config.env`), `initialize` `clientInfo.name` capture, `connect_account` routing, `401` / missing-key 3-Click Wizard guidance, and `setup`/`login`/`init` CLI dispatch into `src/server.mjs`, `src/apify-main.mjs`, and `test/apify-actor.test.mjs` (`24/24` passing).
- **Wave 3 (`WS-5`) & Precedence Refinements**:
  - `WS-5`: Added end-to-end integration suite `test/connect-wizard.test.mjs`, refined placeholder-to-fallback candidate precedence across `src/config-store.mjs`, `src/wizard.mjs`, `hooks/hooks.json`, and `opencode/memoreal-hooks.js`, and passed Critic review (`PASS`; full `npm test`: `92/92` passing across `26` suites, `0` failures). Zero deviations from the approved design.


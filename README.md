# `@kolivri/memoria-mcp` — Open-Source Deterministic AI Memory & Code Intelligence MCP Server

[![kolivritech/memoria-mcp MCP server](https://glama.ai/mcp/servers/kolivritech/memoria-mcp/badges/score.svg)](https://glama.ai/mcp/servers/kolivritech/memoria-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-brightgreen.svg)](./LICENSE)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18.0.0-339933)](./package.json)

`@kolivri/memoria-mcp` is an open-source, zero-dependency Node.js ESM **Model Context Protocol (MCP)** server (`stdio` JSON-RPC 2.0) that gives AI coding agents (**Claude Code, OpenCode, Cursor, Windsurf, VS Code, Cline, Roo Code, Zed, Goose, and Claude Desktop**) deterministic long-term memory, BM25 + salience graph retrieval, code symbol intelligence, and multi-agent wing handoffs.

It runs **100% standalone offline/local with zero API keys required** (persisting memories and graph edges to `~/.memoria/local-memories.json`), and optionally supports hybrid cloud sync with [Memoria Cloud](https://memoria.kolivri.com) when `MEMORIA_API_KEY` is set.

---

## Architecture (`src/server.mjs` + `src/memory-store.mjs`)

```text
┌───────────────────────────────────────────────────────────────────────────┐
│ AI Coding Host (Claude Desktop / Claude Code / Cursor / OpenCode / Docker)│
└─────────────────────────────────────┬─────────────────────────────────────┘
                                      │ JSON-RPC 2.0 over stdio
                                      ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ src/server.mjs — Standard MCP Server                                      │
│ • initialize, notifications/initialized, ping                             │
│ • tools/list & tools/call (14 deterministic memory & code tools)          │
│ • resources/list & resources/read (memory://rules, recent, stats)         │
│ • prompts/list & prompts/get (session-start, wrap-up, handoff)            │
└───────────────────┬───────────────────────────────────┬───────────────────┘
                    │ Always-on Local Store             │ Optional Cloud Sync
                    ▼                                   ▼
┌───────────────────────────────────────┐ ┌─────────────────────────────────┐
│ src/memory-store.mjs                  │ │ Memoria Cloud (Optional)        │
│ • BM25 (k1=1.5, b=0.75) + phrase boost│ │ • Triggered only if             │
│ • Salience + Tier + Freshness scoring │ │   MEMORIA_API_KEY is set        │
│ • Supersedes / ConsolidatedInto graph │ │ • Syncs with                    │
│ • Persists ~/.memoria/local-memories  │ │   https://memoria.kolivri.com   │
└───────────────────────────────────────┘ └─────────────────────────────────┘
```

- **`src/server.mjs`**: Zero-dependency MCP JSON-RPC 2.0 `stdio` server handling `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `prompts/list`, and `prompts/get`.
- **`src/memory-store.mjs`**: Self-contained `LocalMemoryStore` implementing tokenized BM25 ranking ($k_1 = 1.5, b = 0.75$), tier weighting (`Core`, `Semantic`, `Episodic`, `Buffer`), temporal freshness decay, Jaccard belief-revision edges (`Supersedes`, `RelatedTo`, `ConsolidatedInto`), workspace code scanning (`search_code`, `explain_code`), and specialist wing handoffs (`architect`, `reviewer`, `qa`, `security`, `ops`).

---

## Quick Start (100% Local Standalone — No API Key Required)

### 1. Run via `npx` (Direct from GitHub)

```bash
npx -y github:kolivritech/memoria-mcp
```

### 2. Clone & Run Locally with Node.js (`>= 18`)

```bash
git clone https://github.com/kolivritech/memoria-mcp.git
cd memoria-mcp
node src/server.mjs
```

### 3. Run via Docker

```bash
docker build -t memoria-mcp .
docker run -i --rm memoria-mcp
```

---

## Client Configuration (`stdio`)

### Claude Desktop (`claude_desktop_config.json`) & Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "memoria": {
      "command": "npx",
      "args": ["-y", "github:kolivritech/memoria-mcp"],
      "env": {
        "MEMORIA_NAMESPACE": "default"
      }
    }
  }
}
```

Or pointing directly to a local clone:

```json
{
  "mcpServers": {
    "memoria": {
      "command": "node",
      "args": ["/absolute/path/to/memoria-mcp/src/server.mjs"],
      "env": {
        "MEMORIA_NAMESPACE": "my-project",
        "MEMORIA_STORAGE_PATH": "/Users/you/.memoria/local-memories.json"
      }
    }
  }
}
```

### Claude Code (`claude mcp add`)

```bash
claude mcp add memoria -- npx -y github:kolivritech/memoria-mcp
```

### OpenCode (`~/.config/opencode/opencode.json`)

```json
{
  "mcp": {
    "memoria": {
      "type": "local",
      "command": ["npx", "-y", "github:kolivritech/memoria-mcp"],
      "environment": {
        "MEMORIA_NAMESPACE": "default"
      },
      "enabled": true
    }
  }
}
```

---

## 14 MCP Tools

| Tool | Required Args | Description |
| --- | --- | --- |
| `encode_memory` | `content` | Store a new memory with tier (`episodic`, `semantic`, `buffer`, `core`), `salience` (`0.0–1.0`), `namespace`, and `context` pairs. Automatically links `Supersedes` / `RelatedTo` graph edges. |
| `batch_encode` | `memories` | Atomically encode an array of memories in a single call. |
| `recall_memories` | `query` | Retrieve top memories ranked deterministically by BM25, salience, tier boost, feedback score, and recency within `token_budget`. |
| `build_context` | `query` | Assemble a token-budgeted `<memory_context>` block grouped into Core Rules, Established Facts, and Recent Context. |
| `forget_memory` | `id` | Delete a specific memory and its incident graph edges by ID. |
| `delete_by_context` | `key`, `value` | Delete all memories matching a specific `[key, value]` context metadata pair. |
| `feedback` | `id`, `useful` | Record positive/negative utility feedback on a memory and adjust its salience score (`±0.08`). |
| `consolidate` | `namespace` | Deduplicate near-identical memories (`ConsolidatedInto` edges) and promote high-salience episodic memories to `Semantic` tier. |
| `health` | *(none)* | Return engine health, active memory/edge counts, storage path, tier distribution, and mode (`local-standalone` or `cloud-hybrid`). |
| `stats` | `namespace` | Return per-namespace memory count, edge count, tier distribution, average salience, and handoff count. |
| `search_code` | `query` | Search workspace source files for matching symbol definitions and references with file paths and line numbers. |
| `explain_code` | `target` | Explain a symbol: definitions, live workspace references, related test files, and associated architectural memories. |
| `list_agent_wings` | *(none)* | List specialist multi-agent wings (`architect`, `reviewer`, `qa`, `security`, `ops`), active memory counts, and recent handoffs. |
| `handoff_to_agent` | `from_wing`, `to_wing`, `summary`, `task` | Record a structured context handoff between specialist agent wings and persist a high-salience handoff memory. |

---

## 3 MCP Resources & 3 MCP Prompts

### Resources (`resources/list` & `resources/read`)

| URI | MIME Type | Description |
| --- | --- | --- |
| `memory://rules` | `application/json` | Active `Core` and high-salience (`>= 0.80`) architectural rules and invariants. |
| `memory://recent` | `application/json` | Most recently encoded non-superseded memories across active namespaces. |
| `memory://stats` | `application/json` | Global engine health, storage location, tier distribution, and graph edge counts. |

### Prompts (`prompts/list` & `prompts/get`)

| Prompt | Arguments | Description |
| --- | --- | --- |
| `memoria-session-start` | `namespace?` | Instructs the agent to call `build_context` and `health` at session start. |
| `memoria-wrap-up` | `namespace?` | Instructs the agent to apply the write gate, encode key learnings, and run `consolidate`. |
| `memoria-handoff` | `from_wing`, `to_wing`, `task` | Prepares a structured multi-agent wing handoff via `handoff_to_agent`. |

---

## Environment Variables & Optional Memoria Cloud Sync

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `MEMORIA_NAMESPACE` | No | `default` | Default namespace when omitted from tool arguments |
| `MEMORIA_STORAGE_PATH` | No | `~/.memoria/local-memories.json` | File path for the local persistent JSON graph store |
| `MEMORIA_API_KEY` | No | *(unset — local standalone)* | Optional [Memoria Cloud](https://memoria.kolivri.com) API key (`mem_dev_...`) to enable hybrid cloud sync |
| `MEMORIA_API_URL` | No | `https://memoria.kolivri.com` | Memoria Cloud base URL used when `MEMORIA_API_KEY` is set |

When `MEMORIA_API_KEY` is set, `@kolivri/memoria-mcp` switches to `cloud-hybrid` mode: every tool executes deterministically against the local store and synchronizes over HTTPS JSON-RPC with `https://memoria.kolivri.com/v1/mcp`.

---

## Running the Integration Test Suite

```bash
npm test
# or: node --test ./test/memoria-mcp.test.mjs
```

---

## License

MIT © [Kolivri Ltd](https://memoria.kolivri.com)

# `@kolivri/memoreal-mcp` — Deterministic AI Memory & Code Intelligence MCP for Claude Code, OpenCode, Cursor & Claude Desktop

[![kolivritech/memoreal-mcp MCP server](https://glama.ai/mcp/servers/kolivritech/memoreal-mcp/badges/score.svg)](https://glama.ai/mcp/servers/kolivritech/memoreal-mcp)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18.0.0-339933)](./package.json)

`@kolivri/memoreal-mcp` is the official zero-dependency Node.js ESM **Model Context Protocol (MCP)** connector (`stdio` & HTTP) for **[Memoreal Cloud](https://memoreal.kolivri.com)** — giving AI coding and operator agents (**Claude Code, OpenCode, Cursor, Windsurf, VS Code, Cline, Roo Code, Zed, Goose, and Claude Desktop**) deterministic long-term memory, cross-session recall, and code intelligence powered by `memoreal.kolivri.com`.

- **Memoreal Cloud Portal & API Keys**: [https://memoreal.kolivri.com](https://memoreal.kolivri.com) ([Get API Key](https://memoreal.kolivri.com/register) — includes **1,000 free API calls/memories**; paid tiers: **Developer $19/mo**, **Startup $79/mo**, **Business $299/mo**)
- **Documentation & Benchmarks**: [https://memoreal.kolivri.com/docs](https://memoreal.kolivri.com/docs) (`500/500 = 100.0%` LongMemEval at `12.9 ms` p50, `102/102 = 100.0%` Hebrew LongMemEval across 15 languages)
- **Support**: `stas@kolivri.com` · WhatsApp `054-787-5670`

---

## Environment Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `MEMOREAL_API_KEY` | **Yes** | — | Your Memoreal Cloud API key (`mem_dev_...`, `mem_start_...`, or `mem_biz_...`) from [memoreal.kolivri.com/register](https://memoreal.kolivri.com/register) |
| `MEMOREAL_API_URL` | Optional | `https://memoria.kolivri.com` | Memoreal Cloud base URL (or `https://memoreal.kolivri.com`) |
| `MEMOREAL_NAMESPACE` | Optional | `default` | Default project/workspace namespace when omitted from tool arguments |

> **Backward Compatibility**: Legacy `MEMORIA_API_KEY`, `MEMORIA_API_URL`, and `MEMORIA_NAMESPACE` environment variables remain 100% supported as automatic fallbacks across all transports.

---

## Installation

### 1. One-Line Auto-Installer (15 AI Clients + Claude Code Lifecycle Hooks)

Automatically configures Claude Code, Cursor, Windsurf, VS Code, Claude Desktop, OpenCode, Cline, Roo Code, Continue, Zed, Goose, PearAI, Trae, Void, and Melty:

```bash
# macOS / Linux / WSL
curl -fsSL --proto '=https' --tlsv1.2 https://memoreal.kolivri.com/downloads/install.sh | MEMOREAL_KEY=YOUR_MEMOREAL_API_KEY bash
```

```powershell
# Windows PowerShell
$env:MEMOREAL_KEY="YOUR_MEMOREAL_API_KEY"; irm https://memoreal.kolivri.com/downloads/install.ps1 | iex
```

### 2. Claude Code (`claude mcp add`)

```bash
claude mcp add memoreal \
  -e MEMOREAL_API_KEY="your-memoreal-api-key" \
  -- npx -y @kolivri/memoreal-mcp
```

### 3. Cursor (`~/.cursor/mcp.json`) & Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "memoreal": {
      "command": "npx",
      "args": ["-y", "@kolivri/memoreal-mcp"],
      "env": {
        "MEMOREAL_API_KEY": "your-memoreal-api-key",
        "MEMOREAL_NAMESPACE": "my-project"
      }
    }
  }
}
```

### 4. OpenCode (`~/.config/opencode/opencode.json`)

```json
{
  "mcp": {
    "memoreal": {
      "type": "local",
      "command": ["npx", "-y", "@kolivri/memoreal-mcp"],
      "environment": {
        "MEMOREAL_API_KEY": "your-memoreal-api-key",
        "MEMOREAL_NAMESPACE": "my-project"
      },
      "enabled": true
    }
  }
}
```

### 5. Docker

```bash
docker build -t memoreal-mcp .
docker run -i --rm \
  -e MEMOREAL_API_KEY="your-memoreal-api-key" \
  -e MEMOREAL_NAMESPACE="my-project" \
  memoreal-mcp
```

---

## 14 MCP Tools (`https://memoreal.kolivri.com/v1/mcp`)

| Tool | Required Args | Description |
| --- | --- | --- |
| `encode_memory` | `content` | Store a new memory in Memoreal Cloud with tier (`episodic`, `semantic`, `buffer`, `core`), `salience` (`0.0–1.0`), `namespace`, and `context` pairs. |
| `batch_encode` | `memories` | Atomically encode an array of memories in a single call. |
| `recall_memories` | `query` | Retrieve top memories ranked deterministically by Memoreal Cloud within `token_budget`. |
| `build_context` | `query` | Assemble a token-budgeted `<memory_context>` block grouped into Core Rules, Established Facts, and Recent Context. |
| `forget_memory` | `id` | Delete a specific memory and its incident graph edges by ID. |
| `delete_by_context` | `key`, `value` | Delete all memories matching a specific `[key, value]` context metadata pair. |
| `feedback` | `id`, `useful` | Record positive/negative utility feedback on a memory and adjust its salience score. |
| `consolidate` | `namespace` | Deduplicate memories within a namespace and promote recurring high-salience episodic memories to `Semantic` tier. |
| `health` | *(none)* | Return Memoreal Cloud engine health, active memory/edge counts, and tier distribution. |
| `stats` | `namespace` | Return per-namespace memory count, edge count, and tier distribution. |
| `search_code` | `query` | Search indexed code symbol definitions and references with file paths and line numbers. |
| `explain_code` | `target` | Explain a symbol: definitions, workspace references, related tests, and associated architectural memories. |
| `list_agent_wings` | *(none)* | List specialist multi-agent wings (`architect`, `reviewer`, `qa`, `security`, `ops`) and active memory counts. |
| `handoff_to_agent` | `from_wing`, `to_wing`, `summary`, `task` | Record a structured context handoff between specialist agent wings. |

---

## Running Connector Tests

```bash
npm test
```

## License

Connector package licensed under MIT. Memoreal Cloud (`https://memoreal.kolivri.com`) is a commercial hosted service by [Kolivri](https://kolivri.com).

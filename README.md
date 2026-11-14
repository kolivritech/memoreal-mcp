# Memoria MCP (`io.github.kolivritech/memoria-mcp`)

[![Glama MCP Server](https://glama.ai/mcp/servers/kolivritech/memoria-mcp/badge)](https://glama.ai/mcp/servers/kolivritech/memoria-mcp)
[![Memoria Cloud](https://img.shields.io/badge/Memoria_Cloud-memoria.kolivri.com-3ce0c0)](https://memoria.kolivri.com)
[![LongMemEval](https://img.shields.io/badge/LongMemEval-500%2F500_(100.0%25)-brightgreen)](https://memoria.kolivri.com/#benchmarks)
[![Latency](https://img.shields.io/badge/Recall_Latency-12.9_ms-blue)](https://memoria.kolivri.com/#benchmarks)

**Stop trusting probabilistic guesses. Give your AI coding agents deterministic long-term memory.**

Memoria is a deterministic long-term memory and code intelligence MCP server for **15 AI coding clients**: **Claude Code, OpenCode, Cursor, Windsurf, VS Code (GitHub Copilot), Codex CLI, Gemini CLI, Zed, Cline, Roo Code, Kilo Code, Continue, Goose, Amp, and Claude Desktop**.

- **Portal & Free API Key (1,000 free calls/memories):** [https://memoria.kolivri.com/register](https://memoria.kolivri.com/register)
- **Documentation & API Reference:** [https://memoria.kolivri.com/docs](https://memoria.kolivri.com/docs)
- **Competitor Comparisons (vs. Mem0, Zep, Letta, Cognee, Supermemory, Graphify):** [https://memoria.kolivri.com/alternatives](https://memoria.kolivri.com/alternatives)

---

## Verified Benchmarks

| Benchmark | Memoria Score | Latency / Cost | Comparison |
|---|---|---|---|
| **LongMemEval (ICLR 2025, 500 questions)** | **`500 / 500 (100.0%)`** | `0.14 s / query` · `0` LLM tokens | Supermemory `81.6%` · Zep `71.2%` · Mem0 `~67%` |
| **Multilingual LongMemEval (15 Languages incl. Hebrew)** | **`102 / 102 (100.0%)`** | `0` LLM tokens | Native RTL & multilingual symbolic reasoning |
| **IntelBench Retrieval Latency** | **`12.9 ms` (`83.3%`)** | Sub-15ms p50 | 15–150x faster than LLM write-wrappers |
| **Synthetic Stress & Belief Revision (`Supersedes`)** | **`5 / 5 (100.0%)`** | Deterministic | Outdated facts automatically superseded |

---

## 30-Second Installation (All 15 AI Coding Clients)

1. Get your free API key (`1,000` free API calls & memories) at **[https://memoria.kolivri.com/register](https://memoria.kolivri.com/register)**.
2. Run the 1-line installer for **macOS / Linux / WSL**:

```bash
curl -fsSL https://memoria.kolivri.com/downloads/install.sh | MEMORIA_KEY=mem_dev_your_key_here bash
```

Or on **Windows PowerShell**:

```powershell
$env:MEMORIA_KEY="mem_dev_your_key_here"; irm https://memoria.kolivri.com/downloads/install.ps1 | iex
```

Or add directly to **Claude Code**:

```bash
claude mcp add -s user --transport http memoria https://memoria.kolivri.com/v1/mcp --header "Authorization: Bearer mem_dev_your_key_here"
```

---

## What Gets Configured Automatically

- **30 Deterministic MCP Tools**: `encode_memory`, `batch_encode`, `recall_memories`, `build_context`, `forget_memory`, `delete_by_context`, `consolidate`, `feedback`, `health`, `stats`, `search_code`, `explain_code`, `find_references`, `find_file`, `explain_diff`, `explain_error`, `navigate`, `get_hierarchy`, `list_agent_wings`, `handoff_to_agent`, and more.
- **3 MCP Resources**: `memory://rules`, `memory://recent`, `memory://stats`.
- **8 Automatic Session Hooks**: `SessionStart`, `UserPromptSubmit`, `PostToolUse` (`Write`, `Edit`, `Read`, `TaskCreate`, `TaskCompleted`), `PreCompact`, `PostCompact`, and `Stop`.
- **Multi-Agent Specialist Wings**: Isolate and hand off architectural context across `architect`, `reviewer`, `qa`, `security`, and `ops` wings.

## License

MIT © [Kolivri Ltd](https://memoria.kolivri.com)

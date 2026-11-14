#!/bin/bash
set -e

MEMORIA_DIR="$HOME/.memoria"
BIN_DIR="$MEMORIA_DIR/bin"
CONFIG_ENV="$MEMORIA_DIR/config.env"
SETTINGS_JSON="$HOME/.claude/settings.json"
COMMANDS_DIR="$HOME/.claude/commands"
OPENCODE_DIR="$HOME/.config/opencode"
OPENCODE_JSON="$OPENCODE_DIR/opencode.json"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Preserve existing API key from ~/.memoria/config.env if none was passed on this invocation
EXISTING_API_KEY=""
if [ -f "$CONFIG_ENV" ]; then
  EXISTING_API_KEY="$(grep -E '^MEMORIA_API_KEY=' "$CONFIG_ENV" 2>/dev/null | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || true)"
fi

# Memoria Cloud MCP and HTTP API endpoints:
MEMORIA_URL="${MEMORIA_URL:-https://memoria.kolivri.com/v1/mcp}"
DEFAULT_API_URL="${MEMORIA_URL%/v1/mcp}"
DEFAULT_API_URL="${DEFAULT_API_URL%/}"
MEMORIA_API_URL="${MEMORIA_API_URL:-$DEFAULT_API_URL}"
MEMORIA_API_KEY="${MEMORIA_API_KEY:-${MEMORIA_KEY:-$EXISTING_API_KEY}}"

# Validate URLs (require HTTPS for all remote hosts; allow HTTP only on local loopback for tests)
validate_url() {
  case "$1" in
    https://*[!A-Za-z0-9._:/-]*) return 1 ;;
    https://?*) return 0 ;;
    http://localhost*|http://127.0.0.1*) return 0 ;;
    *) return 1 ;;
  esac
}

if ! validate_url "$MEMORIA_URL" || ! validate_url "$MEMORIA_API_URL"; then
  echo "Error: MEMORIA_URL and MEMORIA_API_URL must use https:// (or http://localhost for local tests)." >&2
  exit 1
fi

if [ -n "$MEMORIA_API_KEY" ] && ! printf '%s' "$MEMORIA_API_KEY" | grep -Eq '^[A-Za-z0-9_.-]+$'; then
  echo "Error: Invalid MEMORIA_KEY format (only alphanumeric, '_', '.', '-' allowed)." >&2
  exit 1
fi

echo "Memoria - Claude Code & OpenCode Cloud Plugin"
echo "=============================================="
echo ""
echo "Cloud API:  $MEMORIA_API_URL"
echo "Cloud MCP:  $MEMORIA_URL"
if [ -n "$MEMORIA_API_KEY" ]; then
  echo "API Key:    ${MEMORIA_API_KEY:0:12}..."
else
  echo "API Key:    (not set — pass MEMORIA_KEY=mem_dev_... to authenticate)"
fi
echo ""

umask 077
mkdir -p "$MEMORIA_DIR" "$BIN_DIR"
chmod 700 "$MEMORIA_DIR" "$BIN_DIR" 2>/dev/null || true

# --- Persist cloud configuration for SessionStart hooks and slash commands ---
printf 'MEMORIA_URL="%s"\nMEMORIA_API_URL="%s"\nMEMORIA_API_KEY="%s"\n' \
  "$MEMORIA_URL" "$MEMORIA_API_URL" "$MEMORIA_API_KEY" > "$CONFIG_ENV"
chmod 600 "$CONFIG_ENV" 2>/dev/null || true
echo "Saved cloud config to $CONFIG_ENV (mode 0600)"

# Clean up deprecated binary
if [ -f "$BIN_DIR/memoria-mcp" ]; then
  rm -f "$BIN_DIR/memoria-mcp"
  echo "  Removed deprecated memoria-mcp"
fi

# --- Install memoria-ns helper (needed by hooks regardless of transport) ---
if [ -f "$SCRIPT_DIR/bin/memoria-ns" ]; then
  cp "$SCRIPT_DIR/bin/memoria-ns" "$BIN_DIR/memoria-ns"
  chmod +x "$BIN_DIR/memoria-ns"
fi

# --- Register MCP server (HTTP transport, shared across all Claude Code sessions) ---
echo ""
echo "Registering Cloud MCP server..."

if [ "${MEMORIA_SKIP_CLAUDE_CLI:-0}" != "1" ] && command -v claude >/dev/null 2>&1; then
  claude mcp remove -s user memoria 2>/dev/null || true
  if [ -n "$MEMORIA_API_KEY" ]; then
    claude mcp add -s user --transport http memoria "$MEMORIA_URL" --header "Authorization: Bearer $MEMORIA_API_KEY"
  else
    claude mcp add -s user --transport http memoria "$MEMORIA_URL"
  fi
  echo "  MCP registered (user scope, transport=http, url=$MEMORIA_URL)"
else
  echo "  'claude' CLI skipped or not found. Register manually:"
  if [ -n "$MEMORIA_API_KEY" ]; then
    echo "    claude mcp add -s user --transport http memoria $MEMORIA_URL --header \"Authorization: Bearer $MEMORIA_API_KEY\""
  else
    echo "    claude mcp add -s user --transport http memoria $MEMORIA_URL"
  fi
fi

# --- Install slash commands ---
echo ""
echo "Installing slash commands..."
mkdir -p "$COMMANDS_DIR" "$OPENCODE_DIR/commands"

for SKILL_DIR in "$SCRIPT_DIR/skills"/*/; do
  SKILL_NAME="$(basename "$SKILL_DIR")"
  if [ -f "$SKILL_DIR/SKILL.md" ]; then
    cp "$SKILL_DIR/SKILL.md" "$COMMANDS_DIR/$SKILL_NAME.md"
    cp "$SKILL_DIR/SKILL.md" "$OPENCODE_DIR/commands/$SKILL_NAME.md"
    echo "  /$SKILL_NAME (Claude Code & OpenCode)"
  fi
done

# --- Install hooks ---
echo ""
echo "Installing hooks..."
HOOKS_JSON="$SCRIPT_DIR/hooks/hooks.json"

if command -v jq >/dev/null 2>&1 && [ -f "$HOOKS_JSON" ]; then
  if [ -f "$SETTINGS_JSON" ]; then
    cp "$SETTINGS_JSON" "$SETTINGS_JSON.bak"
    jq --slurpfile plugin_hooks "$HOOKS_JSON" '
      .hooks //= {} |
      reduce ($plugin_hooks[0].hooks | to_entries[]) as $entry (
        .;
        .hooks[$entry.key] = (
          [(.hooks[$entry.key] // [])[] | select(
            (.hooks | tostring | test("\\[memoria[\\]-]")) | not
          )] + $entry.value
        )
      )
    ' "$SETTINGS_JSON.bak" > "$SETTINGS_JSON"
    echo "  Hooks merged into $SETTINGS_JSON"
  else
    mkdir -p "$(dirname "$SETTINGS_JSON")"
    jq --slurpfile plugin_hooks "$HOOKS_JSON" -n '{ hooks: $plugin_hooks[0].hooks }' > "$SETTINGS_JSON"
    echo "  Created $SETTINGS_JSON with hooks"
  fi
else
  echo "  Warning: jq not found, skipping hook installation"
fi

# --- Install CLAUDE.md and OpenCode AGENTS.md instructions ---
echo ""
echo "Installing memory instructions..."
GLOBAL_CLAUDE_MD="$HOME/.claude/CLAUDE.md"
OPENCODE_AGENTS_MD="$OPENCODE_DIR/AGENTS.md"
MEMORIA_CLAUDE_MD="$SCRIPT_DIR/CLAUDE.md"

upsert_memoria_instructions() {
  local TARGET_MD="$1"
  if [ -f "$TARGET_MD" ]; then
    cp "$TARGET_MD" "$TARGET_MD.bak"
    if grep -q '<!-- memoria:start -->' "$TARGET_MD"; then
      sed '/<!-- memoria:start -->/,/<!-- memoria:end -->/d' "$TARGET_MD.bak" > "$TARGET_MD"
    fi
    echo "" >> "$TARGET_MD"
    cat "$MEMORIA_CLAUDE_MD" >> "$TARGET_MD"
    echo "  Updated $TARGET_MD"
  else
    mkdir -p "$(dirname "$TARGET_MD")"
    cp "$MEMORIA_CLAUDE_MD" "$TARGET_MD"
    echo "  Created $TARGET_MD"
  fi
}

if [ -f "$MEMORIA_CLAUDE_MD" ]; then
  upsert_memoria_instructions "$GLOBAL_CLAUDE_MD"
  upsert_memoria_instructions "$OPENCODE_AGENTS_MD"
  upsert_memoria_instructions "$HOME/.codex/AGENTS.md"
fi

# --- Install OpenCode plugin & MCP config ---
echo ""
echo "Installing OpenCode plugin & MCP configuration..."
mkdir -p "$OPENCODE_DIR/plugins"
if [ -f "$SCRIPT_DIR/opencode/memoria-hooks.js" ]; then
  cp "$SCRIPT_DIR/opencode/memoria-hooks.js" "$OPENCODE_DIR/plugins/memoria-hooks.js"
  echo "  Installed $OPENCODE_DIR/plugins/memoria-hooks.js"
fi

if command -v jq >/dev/null 2>&1; then
  if [ -f "$OPENCODE_JSON" ]; then
    cp "$OPENCODE_JSON" "$OPENCODE_JSON.bak"
    jq --arg url "$MEMORIA_URL" --arg key "$MEMORIA_API_KEY" '
      .mcp //= {} |
      .mcp.memoria = ((.mcp.memoria // {}) + { "type": "remote", "url": $url, "enabled": true } + (if ($key | length) > 0 then { "headers": { "Authorization": ("Bearer " + $key) } } else {} end))
    ' "$OPENCODE_JSON.bak" > "$OPENCODE_JSON"
    chmod 600 "$OPENCODE_JSON" 2>/dev/null || true
    echo "  Updated MCP server in $OPENCODE_JSON"
  else
    jq -n --arg url "$MEMORIA_URL" --arg key "$MEMORIA_API_KEY" '{
      "$schema": "https://opencode.ai/config.json",
      "mcp": {
        "memoria": ({
          "type": "remote",
          "url": $url,
          "enabled": true
        } + (if ($key | length) > 0 then { "headers": { "Authorization": ("Bearer " + $key) } } else {} end))
      }
    }' > "$OPENCODE_JSON"
    chmod 600 "$OPENCODE_JSON" 2>/dev/null || true
    echo "  Created $OPENCODE_JSON with Memoria Cloud MCP"
  fi

  upsert_mcp_servers_json() {
    local TARGET_JSON="$1"
    local LABEL="$2"
    mkdir -p "$(dirname "$TARGET_JSON")"
    if [ -f "$TARGET_JSON" ]; then
      cp "$TARGET_JSON" "$TARGET_JSON.bak"
      jq --arg url "$MEMORIA_URL" --arg key "$MEMORIA_API_KEY" '
        .mcpServers //= {} |
        .mcpServers.memoria = ({ "type": "http", "url": $url } + (if ($key | length) > 0 then { "headers": { "Authorization": ("Bearer " + $key) } } else {} end))
      ' "$TARGET_JSON.bak" > "$TARGET_JSON"
      chmod 600 "$TARGET_JSON" 2>/dev/null || true
      echo "  Updated $LABEL MCP config in $TARGET_JSON"
    else
      jq -n --arg url "$MEMORIA_URL" --arg key "$MEMORIA_API_KEY" '{
        "mcpServers": {
          "memoria": ({ "type": "http", "url": $url } + (if ($key | length) > 0 then { "headers": { "Authorization": ("Bearer " + $key) } } else {} end))
        }
      }' > "$TARGET_JSON"
      chmod 600 "$TARGET_JSON" 2>/dev/null || true
      echo "  Configured $LABEL MCP in $TARGET_JSON"
    fi
  }

  upsert_mcp_servers_json "$HOME/.cursor/mcp.json" "Cursor"
  upsert_mcp_servers_json "$HOME/.codeium/windsurf/mcp_config.json" "Windsurf"
  upsert_mcp_servers_json "$HOME/.codex/mcp.json" "OpenAI Codex CLI"
  upsert_mcp_servers_json "$HOME/.gemini/settings.json" "Gemini CLI"
  upsert_mcp_servers_json "$HOME/.vscode/mcp.json" "VS Code / GitHub Copilot"
  upsert_mcp_servers_json "$HOME/.cline/mcp_settings.json" "Cline"
  upsert_mcp_servers_json "$HOME/.roo/mcp.json" "Roo Code"
  upsert_mcp_servers_json "$HOME/.kilocode/mcp.json" "Kilo Code"
  upsert_mcp_servers_json "$HOME/.continue/mcpServers/memoria.json" "Continue.dev"
  upsert_mcp_servers_json "$HOME/.config/goose/mcp.json" "Goose"
  upsert_mcp_servers_json "$HOME/.config/amp/settings.json" "Amp"

  # Zed uses .context_servers.memoria
  ZED_SETTINGS="$HOME/.config/zed/settings.json"
  mkdir -p "$(dirname "$ZED_SETTINGS")"
  if [ -f "$ZED_SETTINGS" ]; then
    cp "$ZED_SETTINGS" "$ZED_SETTINGS.bak"
    jq --arg url "$MEMORIA_URL" --arg key "$MEMORIA_API_KEY" '
      .context_servers //= {} |
      .context_servers.memoria = ({ "url": $url } + (if ($key | length) > 0 then { "headers": { "Authorization": ("Bearer " + $key) } } else {} end))
    ' "$ZED_SETTINGS.bak" > "$ZED_SETTINGS" 2>/dev/null || cp "$ZED_SETTINGS.bak" "$ZED_SETTINGS"
    chmod 600 "$ZED_SETTINGS" 2>/dev/null || true
    echo "  Updated Zed MCP config in $ZED_SETTINGS"
  else
    jq -n --arg url "$MEMORIA_URL" --arg key "$MEMORIA_API_KEY" '{
      "context_servers": {
        "memoria": ({ "url": $url } + (if ($key | length) > 0 then { "headers": { "Authorization": ("Bearer " + $key) } } else {} end))
      }
    }' > "$ZED_SETTINGS"
    chmod 600 "$ZED_SETTINGS" 2>/dev/null || true
    echo "  Configured Zed MCP in $ZED_SETTINGS"
  fi

  if [ "$(uname -s 2>/dev/null || echo '')" = "Darwin" ]; then
    upsert_mcp_servers_json "$HOME/Library/Application Support/Claude/claude_desktop_config.json" "Claude Desktop"
  else
    upsert_mcp_servers_json "$HOME/.config/Claude/claude_desktop_config.json" "Claude Desktop"
  fi
fi

# --- Clean up stale config from old installs ---
STALE_MCP="$HOME/.claude/.mcp.json"
if [ -f "$STALE_MCP" ] && command -v jq >/dev/null 2>&1; then
  if jq -e '.mcpServers.memoria' "$STALE_MCP" >/dev/null 2>&1; then
    jq 'del(.mcpServers.memoria) | if .mcpServers == {} then del(.mcpServers) else . end' "$STALE_MCP" > "$STALE_MCP.tmp"
    if [ "$(jq 'length' "$STALE_MCP.tmp" 2>/dev/null)" = "0" ]; then
      rm -f "$STALE_MCP" "$STALE_MCP.tmp"
    else
      mv "$STALE_MCP.tmp" "$STALE_MCP"
    fi
    echo "  Cleaned stale .mcp.json"
  fi
fi

if [ -f "$SETTINGS_JSON" ] && command -v jq >/dev/null 2>&1; then
  if jq -e '.mcpServers.memoria' "$SETTINGS_JSON" >/dev/null 2>&1; then
    cp "$SETTINGS_JSON" "$SETTINGS_JSON.bak"
    jq 'del(.mcpServers.memoria) | if .mcpServers == {} then del(.mcpServers) else . end' "$SETTINGS_JSON.bak" > "$SETTINGS_JSON"
    echo "  Cleaned stale mcpServers from settings"
  fi
  if jq -e '.enabledPlugins["memoria@local-plugins"]' "$SETTINGS_JSON" >/dev/null 2>&1; then
    jq 'del(.enabledPlugins["memoria@local-plugins"])' "$SETTINGS_JSON" > "$SETTINGS_JSON.tmp" \
      && mv "$SETTINGS_JSON.tmp" "$SETTINGS_JSON"
  fi
fi

# --- Done ---
echo ""
echo "============================="
echo "Plugin installed (Cloud API)."
echo ""
echo "  Cloud API: $MEMORIA_API_URL"
echo "  Cloud MCP: $MEMORIA_URL"
echo "  Clients:   Claude Code, Cursor, Windsurf, OpenCode, Claude Desktop, Codex CLI, Gemini CLI, VS Code, Zed, Cline, Roo Code, Kilo Code, Continue, Goose, Amp"
echo "  Config:    $CONFIG_ENV"
echo "  Hooks:     $SETTINGS_JSON & $OPENCODE_DIR/plugins/memoria-hooks.js"
echo "  Commands:  /memoria-sync, /memoria-sync-code, /memoria-wrap-up, /memoria-doctor"
echo ""
echo "Restart your AI coding client to activate."
echo ""

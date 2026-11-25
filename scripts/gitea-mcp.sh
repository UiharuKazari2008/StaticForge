#!/usr/bin/env bash
# Starts gitea-mcp (stdio) for Yozora with this session's own token; the token is read from a file at start,
# exported only in gitea-mcp's environment (never a flag, never echoed, never in a config file).
set -u
BIN="${GITEA_MCP_BIN:-$HOME/.local/bin/gitea-mcp}"
if [ "${FLEET_SESSION:-}" = "1" ]; then
  TOKEN_FILE="${YOZORA_TOKEN_FILE:-$HOME/.secrets/yozora-yozora.token}"
else
  TOKEN_FILE="$HOME/.secrets/yozora-claude.token"
  [ -r "$TOKEN_FILE" ] || TOKEN_FILE="$HOME/.secrets/yozora-grok.cursor.token"
fi
[ -r "$TOKEN_FILE" ] || { echo "gitea-mcp: no readable Yozora token file" >&2; exit 1; }
GITEA_ACCESS_TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"
export GITEA_ACCESS_TOKEN
export GITEA_HOST="${GITEA_HOST:-https://yozora.bluesteel.737.jp.net}"
exec "$BIN" -t stdio

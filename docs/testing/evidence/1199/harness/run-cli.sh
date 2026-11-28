#!/bin/bash
# usage: run-cli.sh <fleet|item> '<prompt>'   (runs as agents)
# A REAL Claude Code process with the launcher-written per-session MCP config (--strict-mcp-config on purpose:
# the nested process must not start a second agent-coord under this session's identity).
set -u
KIND="${1:?fleet|item}"; PROMPT="${2:?prompt}"
ACC="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))[sys.argv[2]]['config'])" "$ACC/sessions.json" "$KIND")"
[ -f "$CONFIG" ] || { echo "no config file for $KIND" >&2; exit 2; }
mkdir -p "$ACC/cli-cwd" "$ACC/out" && cd "$ACC/cli-cwd" || exit 2
OUT="$ACC/out/cli-$KIND-$(date +%Y%m%d-%H%M%S).jsonl"
/home/agents/.local/bin/claude -p "$PROMPT" --mcp-config "$CONFIG" --strict-mcp-config --model haiku \
  --allowedTools "mcp__dreamscape__list_clients,mcp__dreamscape__bind_session,mcp__dreamscape__get_studio_state" \
  --output-format stream-json --verbose > "$OUT" 2> "$OUT.stderr"
echo "claude exit: $?  output: $OUT"
[ -s "$OUT.stderr" ] && { echo "stderr (first 400 chars):"; head -c 400 "$OUT.stderr"; echo; }
node "$ACC/cli-summary.js" "$OUT"

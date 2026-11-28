#!/bin/bash
# One acceptance step (#1199): run a trigger, wait, read the notice on a client, take a screenshot, log it.
#   step.sh <label> <desktop|phone|both> <wait-ms> <trigger: cli-fleet|cli-item|mcp-fleet|mcp-item|mcp-compare|none> <tool|-> <argsJson|->
# cli-* = a real Claude Code process started with the launcher-written MCP config (acc/run-cli.sh)
# mcp-* = one MCP HTTP call with the same headers Claude Code would send (acc/mcp.js)
set -u
SP=/tmp/claude-1001/-srv-rack-replicas-fleet-37a93128-src/37a93128-a5db-44f8-9fb4-243b69174959/scratchpad
export NODE_PATH="$SP/deps/node_modules"
LABEL="$1"; WHO="$2"; WAIT="$3"; TRIG="$4"; TOOL="${5:--}"; ARGS="${6:--}"
LOG="$SP/evidence/run-log.txt"; SHOTS="$SP/evidence/shots"; mkdir -p "$SHOTS"
say() { echo "$*" | tee -a "$LOG"; }
say ""
say "=== $LABEL  ($(date -u +%H:%M:%SZ))"
case "$TRIG" in
  cli-fleet|cli-item)
    KIND="${TRIG#cli-}"
    PROMPT="Call the dreamscape MCP tool $TOOL with the arguments $ARGS exactly once and print its raw result. Do nothing else."
    say "trigger: real Claude Code CLI as the $KIND session: tool $TOOL $ARGS"
    "$SP/acc/run-cli.sh" "$KIND" "$PROMPT" 2>&1 | grep -E '^(claude exit|mcp_servers|claude_code_version|tool_use mcp__)' | cut -c1-330 | sed -E 's#/tmp/claude-1001/[^ ]*/scratchpad#$SP#g' | tee -a "$LOG"
    ;;
  mcp-fleet|mcp-item|mcp-compare)
    KIND="${TRIG#mcp-}"
    say "trigger: MCP call as $KIND: tools/call $TOOL $ARGS"
    (cd "$SP/acc" && MAX=260 node mcp.js "$KIND" tools/call "$TOOL" "$ARGS" 2>&1 | cut -c1-330) | tee -a "$LOG"
    ;;
  none) say "trigger: none";;
esac
node -e "setTimeout(()=>{}, $WAIT)"
for W in desktop phone; do
  if [ "$WHO" = "$W" ] || [ "$WHO" = both ]; then
    N=$(cd "$SP/web" && node cdp.js "$W" notice 2>&1)
    say "$W notice: $N"
    (cd "$SP/web" && node cdp.js "$W" shot "$SHOTS/$LABEL-$W.png" >/dev/null 2>&1) && say "$W screenshot: shots/$LABEL-$W.png"
  fi
done

#!/usr/bin/env bash
# Usage: scripts/claude-runner.sh <worktree> <prompt-file> [max-turns]
# Runs Claude Code headless in <worktree> with a clean env; OAuth token read from file, never printed or on argv.
set -euo pipefail
WT="${1:?worktree}"; PROMPT="${2:?prompt-file}"; TURNS="${3:-80}"
TOKEN_FILE="${CLAUDE_TOKEN_FILE:-$HOME/.secrets/claude-max.oauth}"
[ -d "$WT" ] && [ -f "$PROMPT" ] && [ -r "$TOKEN_FILE" ] || { echo "missing worktree/prompt/token file" >&2; exit 2; }
cd "$WT"
exec env -i HOME="$HOME" PATH="$HOME/.npm-global/bin:/usr/bin:/bin" LANG=C.UTF-8 \
  CLAUDE_CODE_OAUTH_TOKEN="$(cat "$TOKEN_FILE")" \
  claude -p --permission-mode bypassPermissions --output-format stream-json --verbose \
  --max-turns "$TURNS" < "$PROMPT"

# StaticForge / Dreamscape — Claude Code

The Cursor rules in `.cursor/rules/` (nested clone of `DreamScape/cursor-rules`,
synced by `sync.sh`) are canonical for this repo. Claude Code follows them too.
Treat "Cursor agent" in those rules as "any coding agent, including Claude Code".

@.cursor/rules/agent-busy-lock.mdc
@.cursor/rules/keyboard-characters.mdc
@.cursor/rules/no-dreamscape-restart.mdc
@.cursor/rules/director-idle-before-restart.mdc
@.cursor/rules/no-retype-on-move.mdc
@.cursor/rules/no-stash-to-pretty-commit.mdc
@.cursor/rules/rename-scope.mdc
@.cursor/rules/nai-critical-dump.mdc
@.cursor/rules/client-browser-testing.mdc
@.cursor/rules/agent-session-client-update.mdc
@.cursor/rules/agent-session-studio.mdc
@.cursor/rules/yozora-cursor-agent.mdc
@.cursor/rules/yozora-ingest-2stage.mdc

## Yozora access from Claude Code

- API base: `https://yozora.bluesteel.737.jp.net/api/v1`
- Token: Claude's own PAT (login `claude`, display "Claude Code"; scopes cover
  issues and org project board moves) at `~/.secrets/yozora-claude.token`. If that file
  is missing, fall back to `~/.secrets/yozora-grok.cursor.token` and say in comments
  that it is a Claude Code session acting through `grok.cursor`. Read the token at
  call time; never echo, print, commit, or paste it into a comment or chat.
- Team: `DreamScape/ClaudeAgents` (code, issues, PRs, projects, wiki write) on
  StaticForge, nai-prompt-guide, DSApp-Kotlin, cursor-rules.
- Git push to Yozora as `claude`, never via the checkout's stored credentials:
  `git -c credential.helper= -c 'credential.helper=!f(){ echo username=claude; echo "password=$(tr -d "[:space:]" < ~/.secrets/yozora-claude.token)"; }; f' push origin <branch>`
- Identity: a Claude Code agent, not Cursor, not Yukimi. Where the rules say
  "auth as `grok.cursor`" or "Cursor agent (`grok.cursor`)", use the Claude
  account and wording instead. Every other rule (timers, labels, Done comment,
  hard stops, credit) applies unchanged.

```bash
YZ_TOKEN_FILE=~/.secrets/yozora-claude.token
[ -r "$YZ_TOKEN_FILE" ] || YZ_TOKEN_FILE=~/.secrets/yozora-grok.cursor.token
curl -sS -H "Authorization: token $(cat "$YZ_TOKEN_FILE")" \
  "https://yozora.bluesteel.737.jp.net/api/v1/repos/DreamScape/StaticForge/issues?state=open&type=issues&limit=50"
```

Yukimi has authorized Yozora reads and writes (comments, labels, stopwatch,
assignees, board moves, new issues) at any time, following `yozora-cursor-agent.mdc`.

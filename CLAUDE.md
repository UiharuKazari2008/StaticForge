# StaticForge / Dreamscape — Claude Code

The Cursor rules in `.cursor/rules/` (nested clone of `DreamScape/cursor-rules`,
synced by `sync.sh`) are canonical for this repo. Claude Code follows them too.
Treat "Cursor agent" in those rules as "any coding agent, including Claude Code".

## Priority (read first)

These are hard requirements for Claude Code and every subagent / workflow agent it starts. They outrank
speed, convenience, a brief's wording and "too minor to matter" judgments. Work that breaks one is not
done, whatever else it achieves.

0. **Nothing on the phone depends on a WebView page** (Yukimi, Nov 17 2026, extremely hard rule): background
   services, status bar handlers, notification drivers and alerts run in the app through CaféReady as portable
   task code shipped with the app, and the app uses their output whenever CaféReady is online -
   `cafeready-background`. Never make a phone duty work only while the page runs or has been opened.
1. **Safety and the shared tree:** `agent-busy-lock`, `no-dreamscape-restart` / `director-idle-before-restart`,
   `no-stash-to-pretty-commit`, `android-app-builds` (never loop installs).
2. **Performance and power on every change** (Yukimi, Nov 17 2026, #890: "prevent the need to keep doing
   massive optimisation passes"): `phone-power-client`, `phone-power-server`, `phone-power-native`,
   `server-push-not-polling`, `app-scope-ownership`. Write it optimised the first time:
   - `node scripts/check-perf-rules.js` (and `--dsapp <tree>` for the app) and `node scripts/check-app-scope.js`
     pass before every commit; the pre-commit hook enforces the first (`git config core.hooksPath .githooks`
     in a fresh clone; never `--no-verify`).
   - A file you touch leaves with fewer hits than it came with when the fix is in reach; lower the
     baseline with `--update`.
   - Briefs for subagents and workflows name these rules and the check.
3. **Behaviour and look:** `ui-standard`, `no-native-browser-ui`, `fix-ui-issues-you-find`, notifications
   and status indicators never silenced to save power.

@.cursor/rules/cafeready-background.mdc
@.cursor/rules/agent-busy-lock.mdc
@.cursor/rules/keyboard-characters.mdc
@.cursor/rules/no-dreamscape-restart.mdc
@.cursor/rules/director-idle-before-restart.mdc
@.cursor/rules/phone-power-client.mdc
@.cursor/rules/phone-power-server.mdc
@.cursor/rules/phone-power-native.mdc
@.cursor/rules/server-push-not-polling.mdc
@.cursor/rules/app-scope-ownership.mdc
@.cursor/rules/no-retype-on-move.mdc
@.cursor/rules/no-stash-to-pretty-commit.mdc
@.cursor/rules/rename-scope.mdc
@.cursor/rules/nai-critical-dump.mdc
@.cursor/rules/client-browser-testing.mdc
@.cursor/rules/agent-session-client-update.mdc
@.cursor/rules/agent-session-studio.mdc
@.cursor/rules/yozora-cursor-agent.mdc
@.cursor/rules/yozora-ingest-2stage.mdc
@.cursor/rules/vista-icons-not-fa.mdc
@.cursor/rules/copyrights-not-1to1.mdc
@.cursor/rules/fix-ui-issues-you-find.mdc
@.cursor/rules/sliders-platform.mdc
@.cursor/rules/tray-balloons.mdc
@.cursor/rules/emulator-instances.mdc
@.cursor/rules/android-app-builds.mdc
@.cursor/rules/ui-standard.mdc
@.cursor/rules/no-native-browser-ui.mdc
@.cursor/rules/melaton-bars-native-layouts.mdc
@.cursor/rules/cafe-ready-name.mdc

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

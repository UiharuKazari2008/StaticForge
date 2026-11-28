# StaticForge / Dreamscape — Claude Code

The Cursor rules in `.cursor/rules/` (nested clone of `DreamScape/cursor-rules`,
synced by `sync.sh`) are canonical for this repo. Claude Code follows them too.
Treat "Cursor agent" in those rules as "any coding agent, including Claude Code".

## Priority (read first)

These are hard requirements for Claude Code and every subagent / workflow agent it starts. They outrank
speed, convenience, a brief's wording and "too minor to matter" judgments. Work that breaks one is not
done, whatever else it achieves.

0. **Installed clients start with zero server waits** (Yukimi, Nov 18 2026, TOP RULE): the Dreamscape app (phone, cover,
   DeX window) goes straight to the desktop or Today by its own rules with not one request to the server awaited;
   server checks, authentication, sessions and updates happen inside the running app afterwards -
   `installed-boot-zero-wait`. A slow or flaky network must look like a fast start.
0. **Nothing on the phone depends on a WebView page** (Yukimi, Nov 17 2026, extremely hard rule): background
   services, status bar handlers, notification drivers and alerts run in the app through CaféReady as portable
   task code shipped with the app, and the app uses their output whenever CaféReady is online -
   `cafeready-background`. Never make a phone duty work only while the page runs or has been opened.
0. **Never a manual install step** (Yukimi, Nov 27 2026): no install prompt left on a phone, no "please install" to her;
   a failed silent route is fixed or replaced by the next one in the same turn - `no-manual-install-step`.
1. **Heavy work on the rack host** (Yukimi, Nov 27 2026): builds, emulator tests, browser sandboxes, Windows tests and development
   servers run on Fat Misaka through Rack Manager (`dsapp_build`, coord's emulator grants, `rack_role` / `rack_exec`, a replica instead
   of a live restart), with a lease, never as a bare background process; Dreamscape serves, Yukimi's PCs are the fallback -
   `rack-host-first`.
1. **Safety and the shared tree:** `fold-off-limits` (the Fold only for the final install step; the A53 is the agents' own phone; everything else on the emulator lane), `agent-busy-lock`, `no-dreamscape-restart` / `director-idle-before-restart`,
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
   - **No base64 images** (Yukimi, Nov 21 2026): a picture that can show again is a file with an address (server URL,
     the app's appassets handler over its cache folder, a revoked blob URL), never a `data:` string; only tiny or
     shown-once pictures may be inline - `no-base64-images`.
2. **Commit every turn and delegate to Sonnet** (Yukimi, Nov 24 2026): a turn that changed files ends with your
   own work committed and pushed where your workflow lands, unless a failing check, a half-done change, a hard stop
   or a secret holds it (then `wip/<agent-id>`) - `commit-each-turn`. Subagents, workflow agents and
   `claude_dispatch` sessions start on Sonnet unless a named reason says otherwise, with a brief Sonnet can finish -
   `subagents-sonnet`.
3. **Behaviour and look:** `ui-standard`, `no-native-browser-ui`, `fix-ui-issues-you-find`,
   `notification-discipline` (a notice is a call to action or data the user asked for - no status echoes, no
   telling the user what they just did, no sound without a user action, every notice registered and
   switchable, and Melaton Mobile boots silent), notifications and status indicators never silenced to save
   power. `node scripts/check-notifications.js` passes before every commit (every notice emit site - toast,
   balloon, message box, sound, Android notification - carries a registered source id; counts only go down;
   the pre-commit hook enforces it), and the Supervisor reviews every new or changed notice against N1-N11.

@.cursor/rules/fold-off-limits.mdc
@.cursor/rules/installed-boot-zero-wait.mdc
@.cursor/rules/cafeready-background.mdc
@.cursor/rules/agent-busy-lock.mdc
@.cursor/rules/no-dreamscape-restart.mdc
@.cursor/rules/director-idle-before-restart.mdc
@.cursor/rules/no-stash-to-pretty-commit.mdc
@.cursor/rules/android-app-builds.mdc
@.cursor/rules/no-manual-install-step.mdc
@.cursor/rules/apk-installs-via-adb.mdc
@.cursor/rules/phone-power-client.mdc
@.cursor/rules/phone-power-server.mdc
@.cursor/rules/phone-power-native.mdc
@.cursor/rules/server-push-not-polling.mdc
@.cursor/rules/app-scope-ownership.mdc
@.cursor/rules/rack-host-first.mdc
@.cursor/rules/no-base64-images.mdc
@.cursor/rules/commit-each-turn.mdc
@.cursor/rules/subagents-sonnet.mdc
@.cursor/rules/ui-standard.mdc
@.cursor/rules/no-native-browser-ui.mdc
@.cursor/rules/fix-ui-issues-you-find.mdc
@.cursor/rules/notification-discipline.mdc
@.cursor/rules/keyboard-characters.mdc
@.cursor/rules/cafe-ready-name.mdc
@.cursor/rules/rename-scope.mdc

## Rules on demand

Before touching an area in this table, read its rule with the Read tool: "I didn't know" is not an excuse. These rules are not loaded into every session; they bind exactly like the imported ones (Priority above).

| Rule | Read it when |
| --- | --- |
| `.cursor/rules/design-decisions.mdc` | changing how something looks or behaves; a change that contradicts `docs/design/design-decisions.md` is confirmed with Yukimi first |
| `.cursor/rules/no-retype-on-move.mdc` | moving large blocks of code between files (copy by script with start/end markers, never retype) |
| `.cursor/rules/client-update-never-in-place.mdc` | any client asset update: the service worker apply path, `update_client` / a restart decision, hot CSS, or anything that would put a changed asset into a running page (hard ban: a running client reloads, it never applies in place) |
| `.cursor/rules/client-browser-testing.mdc` | testing the bound Dreamscape client tab via MCP (update, wait for download/ready, restart only for JS/HTML, then inspect) |
| `.cursor/rules/phone-data-via-activesync.mdc` | the server's ADB does not see a phone or it is unauthorized (get its data through ActiveSync before asking Yukimi) |
| `.cursor/rules/emulator-instances.mdc` | needing a Windows Mobile emulator (check out your own instance from the emulator manager `~/.config/wm-emu/emu`) |
| `.cursor/rules/vista-icons-not-fa.mdc` | icons in Vista desktop windows (Vista's own icons, Font Awesome only when Vista has none) |
| `.cursor/rules/copyrights-not-1to1.mdc` | a 1:1 copy of Vista, Windows 3.x, Setup or boot text (copyright holder is rewritten: Microsoft becomes Xyridian) |
| `.cursor/rules/sliders-platform.mdc` | any slider or `input type=range` (Vista trackbar on desktop, WM trackbar on phone) |
| `.cursor/rules/scroll-lists-keep-position.mdc` | actions inside a scrollable list (close, toggle, rename, refresh, data push; scroll position is kept) |
| `.cursor/rules/tray-balloons.mdc` | desktop tray balloons, popups anchored on a tray icon (PopoverManager / toastManager); files `public/scripts/**/*.js` |
| `.cursor/rules/melaton-bars-native-layouts.mdc` | Melaton Mobile status bar elements and popups (native layout definitions CaféReady draws, synced on app, system, theme and version changes) |
| `.cursor/rules/status-icon-tables.mdc` | adding a Melaton Mobile status bar icon (Yukimi decides its place in the three status icon tables first) |
| `.cursor/rules/agent-session-client-update.mdc` | `POST /agent/session/update` (15 s Cancel dialog, then apply and restart); files `modules/agentClientBridge.js`, `public/scripts/comp/agentClientBridge.js`, `agentClientUpdateDialog.js`, `docs/client-api/agent-session.md`, `rest-api.md`, `ws/agentSession.md` |
| `.cursor/rules/agent-session-studio.mdc` | `POST /agent/session/studio` (autoApply is silent; Studio opens like open-image); files `modules/agentClientBridge.js`, `public/scripts/comp/agentClientBridge.js`, `studioChangeJson.js`, the same client-api docs |
| `.cursor/rules/nai-critical-dump.mdc` | NovelAI staff / webapp dumps (detect critical contract changes, file and start a StaticForge issue the same hour) |
| `.cursor/rules/yozora-cursor-agent.mdc` | reading, commenting on, time-tracking or closing Yozora issues (labels `cursor-agent` / `cursor-take`; timers, Done comment, hard stops, credit) |
| `.cursor/rules/yozora-ingest-2stage.mdc` | Yozora ingest sweeps and the Yozora ingest automation (Ask-mode plan, then Multitask vs inline) |

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
- **Fleet sessions are Yozora on Yozora** (Yukimi, Nov 24 2026): a session Fleet / the Supervisor started has
  `FLEET_SESSION=1`; it uses Yozora's token (`$YOZORA_TOKEN_FILE`, login `director.yozora`) for every Yozora
  API call and pushes with a plain `git push` (its git already signs in as `director.yozora`). Only the host
  session (not started by Fleet) uses the `claude` token and push command above.
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

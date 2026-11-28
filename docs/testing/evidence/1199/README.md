# #1199 acceptance: Fleet access has its own MCP keys, and the Remote Access notice says so

Run on Nov 28 2026 (08:16 to 08:37 UTC) on Fat Misaka against replica `fleet-37a93128`, server and client code = `origin/main`
`4dc7cdca9` (the feature commits are `60a0577b4`, `219377ce0`, `ca7e6f81c`). Design: `docs/fleet/fleet-mcp-identity.md`.

Acceptance in the issue: "Let a Fleet agent take a remote session: the notice on the other client says Fleet access, not Cursor
or Claude Code. An item session still shows as itself."

## Result

| Caller | How it called | Desktop balloon (`shots/D1-D4-desktop-balloons.png`) | Phone notification (`shots/P1-…`, `P3-…`, `P4-…`) |
|---|---|---|---|
| Fleet session "Fix the tray clock" (key **Fleet**) | a real Claude Code 2.1.332 process started with the launcher-written `--mcp-config`, tool `bind_session` | `Your session was accessed by Fleet access "Fix the tray clock"` | the same words, title `Remote Access`, soft keys `Disconnect` / `Dismiss` |
| the same Fleet session, next call | `get_studio_state` | `Studio was read by Fleet access "Fix the tray clock"` | the same note changes its words in place (`P2` in `shots/P2-P3-P4-P10-phone-notes.png`) |
| Work item session, work item #1 "Remote Access notice says Fleet" (key **Fleet work items**) | a real Claude Code process, `bind_session` | `Your session was accessed by Fleet access, work item #1 "Remote Access notice says Fleet"` | the same words; a new note replaces the Fleet session's |
| Comparison key **Claude Code** | one MCP call, `bind_session` | `Your session was accessed by "Claude Code"` | `Your session was accessed by "Claude Code"` |

Every line of the table is in `run-log.txt` with the text read from the page and the screenshot taken at that moment.

Switches and the action:

| Step | What was done | Result |
|---|---|---|
| P6, P7 | Phone: Settings > Sounds & Notifications > Notifications > Event "Other notifications" > "Display message on screen" cleared by touch taps (`shots/P6-phone-settings-display-off.png`), then a Fleet access | no bubble; the note waits in the title bar, the left soft key reads `Notification 1` (`shots/P7-phone-fleet-access-switch-off.jpg`) |
| P8, P9 | Phone: the same path, ticked again, then a work item access | the bubble shows again (`shots/P9-phone-before-disconnect.jpg`) |
| P10 | Phone: a touch tap on `Disconnect` | the page is no longer bound, the note is gone, soft keys back to `Pictures` / `Menu` (`shots/P10-phone-after-disconnect.jpg`) |
| D5, D6 | Desktop: the Remote Access popup switched off, then on (`shots/D5-D6-desktop-switch-off-then-on.png`) | off: no balloon for a Fleet bind; on: the balloon shows for the next bind |

## Separate keys (scope item 1)

- `server/keys.txt`: the replica's auth database held no application key before the run. The real `ensureFleetKey` minted **Fleet**
  and **Fleet work items** (user agent `DreamscapeFleet/1.0`, 18 scopes each, no `universal`, no mail, Plaud or fleet dispatch scope).
  The third key, "Claude Code", is the comparison key the harness made.
- `server/launcher-configs.txt`: the real `claudeSessionLauncher.start()` (only tmux and the account helpers were replaced) wrote one
  config per session. The Fleet session's `headersHelper` reads `fleet.key`, the work item session's reads `fleet-items.key`, each with
  its own session id for `X-Fleet-Session`. Mode 0600, no key in the file or on the command line.
- `server/auth.txt`: both keys sign in on the MCP route (119 tools each, `bind_session` and `run_client_js` present, no mail tool).
- `server/labels-frames-after-restart.txt`: what the server sent to a bound client for each caller (`agent_session_bound`,
  `mcp_activity`, `agent_session_command`): the two Fleet callers, a Fleet key without the header (`Fleet access`), and "Claude Code".

## How it was done

- **Clients:** two Rack Manager browser sandboxes signed in to the replica: `acc1199-desktop` (1600 x 900, `uiShell` desktop) and
  `acc1199-phone` (412 x 915 at 2.625, touch, `uiShell` mobile, so Melaton Mobile). `harness/browser-harness-README.md` has the detail.
- **Callers:** `harness/harness.js` ran the real key and launcher code against the replica's auth database; the two sessions' names and
  the work item row were put in the replica server's own agent-coord store, where the server looks them up.
- **A real Fleet agent:** `harness/run-cli.sh` starts Claude Code with the launcher-written config. The init event of every run lists
  `dreamscape` as `connected` (source `dynamic`), then the tool call (`run-log.txt`).
- **Each step:** `harness/step.sh` triggers one call, waits, reads the notice from the page's DOM and takes the screenshot.
- No key, path id or sign-in secret is in this folder (scanned before the commit).

## What this does not show

- **Not the Android app.** The phone client is the Melaton Mobile page in headless Chromium. CaféReady, the native bars, sound and
  vibration are not in it. The lane emulators' app signs in to the live server, which did not run this code yet (see below).
- **Not the live server.** Dreamscape was last restarted before `60a0577b4`, so until its next restart a Fleet session there still
  appears under the old shared key. On the replica the same thing was seen before its restart: the server sent the raw names.
- **Fleet sessions on Fat Misaka** have no `dreamscape` MCP at all (they work on their replica), so they never raise this notice on
  the live server. Only a Fleet session that runs on Dreamscape does.
- The desktop switch was set with the function the Customize Notifications page calls (`traySetPopupHidden`), not through the dialog.

## Found on the way

- **A replica can run older code than its worktree.** This replica's server started on commit `4cace0fd0` (the image's commit) at
  07:56:10 UTC; the worktree was moved to `origin/main` at 07:56:47. The server kept the old modules in memory until it was restarted
  (build gate 385). Restart a session's replica before testing server behaviour on it.
- **Blank left soft key** (`shots/found-1441-blank-left-soft-key.png`): with a note waiting in the title bar, opening and closing
  Settings leaves the left soft key empty (it read `Notification 1` before). Same family as #1441; reported there.

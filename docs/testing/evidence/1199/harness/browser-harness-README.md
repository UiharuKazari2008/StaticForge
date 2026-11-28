# Browser harness for the Remote Access notice (#1199)

All results here were taken AFTER the planner's restart of replica `fleet-37a93128` (current client files:
the served `/scripts/comp/mcpActivityClient.js` is the compiled copy whose "Source SHA256" equals the SHA-256 of the
worktree file, and the page's `showAgentSessionTrayNotice` contains `phoneNote` / `appNote`; the comment
`remote-access-phone` is stripped by the optimiser, so it is not a usable marker).

Replica: `https://192.168.100.42:9402/` (HTTPS needed: the session cookie is `secure`).

## Sandboxes (Rack Manager `sandboxes` role, headless Chromium, RAM-disk profile)
- `acc1199-desktop`: id `sbx-15160e`, CDP port 9400, 1600x900 dpr 1, not mobile. `uiShell` = `desktop`.
- `acc1199-phone`: id `sbx-e17555`, CDP port 9401, 412x915 dpr 2.625, mobile. `uiShell` = `mobile`.
- `sandboxes.json` has ids and ports.

### How the phone shell is obtained
`public/app.html` picks `mobile` when `innerWidth < 1200` and the page is touch-first (`(pointer: coarse)`, or
maxTouchPoints > 0 with any-pointer coarse and no any-hover). The sandbox is created with a Pixel 8 user agent and
`--touch-events=enabled`, but its window-size flag gives a 502x774 page and no coarse pointer. So `holder.js` (below)
sets `Emulation.setDeviceMetricsOverride {412x915, dpr 2.625, mobile}`, `Emulation.setTouchEmulationEnabled
{maxTouchPoints 5}` and `Emulation.setEmitTouchEventsForMouse` BEFORE the page loads. Result: innerWidth 412, pointer
coarse, `window.uiShell === 'mobile'`, `typeof window.wmShell.appNote === 'function'`.

### holder.js (needed, keep it running)
CDP emulation ends when its session detaches, so one holder session per sandbox stays open and keeps the emulation and
`Security.setIgnoreCertificateErrors {ignore:true}` on. They run as tmux sessions `acc1199-hold-desktop` and
`acc1199-hold-phone`, owned by user `agents`, started with `rack_exec` as root:
`runuser -u agents -- tmux new-session -d -s acc1199-hold-<desktop|phone> "cd $SP/web && NODE_PATH=$SP/deps/node_modules node holder.js <desktop|phone> <port>"`
(user `rack` cannot read the scratch folder, so it could not run them). Logs: `holder-*.log`.
If a holder dies, the phone loses its touch/size emulation: restart it the same way and reload the page. Stop them with
`tmux kill-session -t acc1199-hold-phone` (as `agents`) when the test is over.

## cdp.js
```
SP=/tmp/claude-1001/-srv-rack-replicas-fleet-37a93128-src/37a93128-a5db-44f8-9fb4-243b69174959/scratchpad
NODE_PATH=$SP/deps/node_modules node $SP/web/cdp.js <desktop|phone> <command>
  eval '<js expression>'          awaitPromise + returnByValue
  shot <out.png>                  Page.captureScreenshot of the viewport at device scale (creates the folder)
  clientid                        { clientId, uiShell, wsConnected }
  notice                          desktop { uiShell, visible, title, text } | phone { uiShell, noteUp, bubbleShown, title, text, toastTitle, toastText, softKeys }
  wake                            (desktop) one mouse move, see "Balloon timer" below
  display-state                   (phone) { display } for the class "Other notifications"
  softkey <left|right>            (phone) a touch tap (Input.dispatchTouchEvent) at the soft key's centre
  other-notifications-display <on|off>   (phone) the Settings flow, screenshots in shots/settings-<on|off>-<n>-<what>.png
```
Other files: `lib.js` (CDP client, `tap`, `tapSel`), `signin.js` (`ACC_PIN=<pin> node signin.js <desktop|phone>`, the PIN only
from the environment; taps the logon PIN pad; expands the pad first if it is minimised), `nav.js <w> <url> <ms> <png>`
(navigate, wait, print location/size/shell, screenshot), `dump.js <w> [sel <css> [<textRegex>] | x y]` (optional tap, then list visible text of `#wmShell`).

### Client id as the server knows it
`WebSocketClient.readStoredAgentClientId()` (public/scripts/websocket.js): the id the server's `connection` welcome
carried, stored in localStorage `dreamscape.agentClientId` and resumed on reload (`?agentClientId=`). `cdp.js clientid`
prints it. (`agentClientBridge.js`'s `sessionClientId` is module-private and only set after `session_share_start` or a bind.)
Desktop `06df45fb9a59`, phone `e77832745e65` (resumed across reloads and the restart).

## Selectors used for the notice
- Desktop balloon: `.popover.tray-balloon.show` whose `.popover-header` text contains `Remote Access`; title = header
  `textContent.trim()`, text = `.popover-body` `textContent` (popover is anchored on `#mcpActivityIndicator`, popupId `remote-access`).
- Phone: `.wm-notify` (bubble, not `hidden`), title `.wm-notify-name`, text `.wm-notify-body .toast-message`;
  soft keys `.wm-softkey[data-side="left|right"]`; `noteUp` = the toast element of `showAgentSessionTrayNotice.phoneNote`
  is connected and not `.removing`; `toastTitle/toastText` read the same toast (`.toast-title`, `.toast-message`).
- Display switch value: `window.wmShell.sounds.eventPrefs('notification').display`.

## Phone Settings flow (all real touch taps)
Start (`.wm-start`) > Settings (`.wm-startmenu` item) > Sounds & Notifications > tab Notifications > Event combo
(`[data-act="event"]`) > `Other notifications` (`.wm-popup-item`) > checkbox `input[name="msg-on"]` ("Display message on
screen") > the title bar's ok (`.wm-title-action`) twice back to Today. Every step is `Input.dispatchTouchEvent` at the
element's centre; the page is only read to find the target and to verify the checkbox. No step uses a page function.
The switch is stored when ok is pressed (settings write `d.dev.ev.notification.display`).

## Balloon timer (matters for tests)
A tray balloon's 8 s only counts while there was mouse/keyboard/touch input in the last 30 s (`PopoverManager.presence`
in popoverManager.js). The headless desktop has no input, so a balloon raised there stays up until the next input.
Run `cdp.js desktop wake` (one mouse move), then it hides about 8 s later (checked: gone after ~8 s). For an
auto-hide test, call `wake` before raising the notice (or right after, then time 8 s).

## Passed on the way to the desktop / Today (not raised by the harness)
Both pages show, at start-up on this replica: the message box "Account Data Unavailable" (no NovelAI key; Continue) and
then a Director error "Cursor is not logged in" (ok). They block Today and the soft keys, so they were passed once per page load.
Nothing else was dismissed. The desktop also runs a one-time "Install Melaton" screen of about 3 minutes on a fresh load.
After a restart the logon page can come up with the PIN pad minimised (opacity 0): `signin.js` handles it.

## Not covered
This is the page in headless Chromium, not the Android app (no CaféReady, no native status bar or notification, no
real sound or vibration, no real touch hardware, no DeX). Rendering is software GL. The phone's Today differs a little
from the app's (this replica has no account data).

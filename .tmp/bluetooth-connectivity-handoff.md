# Handoff: Bluetooth / Connectivity bubble work (Nov 22 2026)

## Objective

Fix how connected Bluetooth devices appear in the phone's Connectivity/status-bar UI.

Original request (verbatim):
> "we dont show the bluetooth devices in connectivity when the bluetooth icon is shown in the status bar. you also dont show "Bluetooth Devices" aka devices with no name. use the CE standard battery icon for them with no percentage and dont show devices with no battery value, where you have Bluetooth: Connected you can add a badge for the number of connnected devies. Dont include devices with no name or devices without any normal profile in that count or list."

Corrections from the user (these override my earlier misreadings):
1. "use the status bar icon like the dock uses" — the ROM status-battery sprite (same as Continuity dock), not an ActiveSync PNG or custom SVG, and no percentage.
2. "if the bluetooth icon is shown in the status bar i better not see bluetooth devices or its status in the connectivity popup. There a bluetooth popup so you duplicated info for no reason." — with the icon visible, Connectivity must contain **no Bluetooth status row and no device rows**.
3. "The line is separating each radio and network connection" — keep the divider between Bluetooth, Wi-Fi and Mobile Broadband (each radio/network row is its own section). The only place with **no** divider is between the Bluetooth status row and its own device rows.
4. "why is Wireless Manager in Bluetooth popup?" — remove Wireless Manager from the Bluetooth bubble.
5. "Ensure the items are vertically aligned" — badge/glyph rows must be centred with their text.

## Final behaviour

- **Connectivity bubble (`data` role, page-drawn)**
  - Bluetooth row + devices are added **only while the Bluetooth status icon is hidden or `wm-shed`**. If the icon is shown, neither appears — the Bluetooth popup owns that information.
  - Bluetooth, Wi-Fi and Mobile Broadband are separate sections, so the section border/divider between each stays.
  - The Bluetooth status row and its (max 3) device rows are one section: no divider between them.
  - Count badge beside "Bluetooth: Connected" when valid devices exist.
- **Bluetooth bubble**
  - Says "Bluetooth: Connected" when at least one *valid* device is connected; otherwise "On"/"Off".
  - Shows all valid device rows with the status-battery glyph.
  - No Wireless Manager link; Settings foot link and Hide button remain.
- **Fallback popups (`status-popups.js`, app-native)**
  - Connectivity never carries Bluetooth (no icon-visibility signal available there).
  - Bluetooth popup carries the same valid-device filter, Connected label and count; no Wireless Manager.

Valid device predicate (both page and fallback): connected, non-empty name, not "Bluetooth Devices" (and not address-as-name), has a normal profile (`a2dp`, `headset`, `handsfree`, `hfp`, `le_audio`, `leaudio`, `hid`, `wireless stereo`, `hands free`, `input device`), and a numeric battery 0–100. DSApp's field is `profiles`; `services` is also accepted.

## Files changed (uncommitted, working tree)

- `public/scripts/comp/wmShell.js`
  - `btListed()` filter, `btConnected()` uses it, `btCountBadge()`, `btDeviceRow()` uses `.wm-status-icon wm-bt-baticon` with `data-icon` stages `battery-empty/1/2/3/full` (same stages as the dock) and no `%`.
  - `bubbleSpecOf()` records an `icon` field for status-icon right parts so a battery-stage change refreshes the app's copy.
  - `statusBubble('data')`: `showBt` gate on `!btIcon || btIcon.hidden || btIcon.classList.contains('wm-shed')`; BT section pushes row+devices together; Wi-Fi and Mobile are separate sections again; original `{ rule: true }` after Wireless Manager restored.
  - `statusBubble('bluetooth')`: Connected label, badge, no Wireless Manager link, `is-badge` alignment class.
  - Radio/Bluetooth pushes repaint an open `data` bubble as well as the `bluetooth` bubble.
- `public/css/wm-shell.css`
  - `.wm-bubble .wm-cty-baticon, .wm-bubble .wm-bt-baticon` share the status-atlas glyph styling (16px, `--wm-icon-unit: var(--wm-px)`, `filter: invert(1)`).
  - `.wm-bubble-pair.is-batt/.is-badge` and matching `.wm-bubble-right` use `align-items: center`.
  - Old `.wm-bt-batt` SVG/percentage styles removed.
- `public/scripts/tasks/status-popups.js`
  - `btDevices(n)` reads `n.sys.bluetoothDevices` with the same filter (fallback channel; see caveats).
  - `data()` has no Bluetooth lines; `bluetooth()` uses Connected label, filtered device names, no Wireless Manager.
- `scripts/test-cafe-status-bar.js`
  - Added assertions: Connectivity has no Bluetooth; Bluetooth popup says Connected, counts one, lists only the valid device, and has no Wireless Manager link.

## Verification done

- `node --check` on both edited scripts: OK
- `node scripts/test-cafe-status-bar.js`: OK
- `node scripts/check-perf-rules.js`: OK (1465 files)
- `node scripts/test-status-stream.js`: OK
- `node scripts/test-wm-shell-menu-filter.js`: OK
- `bash scripts/notify-service-worker-update.sh --silent`: 3 assets recompiled, SW cache refreshed, 10 clients notified
- Agent lock `.agent-claude-bt-connectivity-3` was created and removed; no lock left behind.

Pre-existing failures unrelated to this change (present in the already-dirty tree):
- `node scripts/check-ui-standard.js`: 5 rises (traffic-light hex in `wmShell.js`, `wmTraffic.js`, claudedesk CSS/JS).
- `node scripts/check-app-scope.js`: many pre-existing `page-global` rises; neither `wmShell.js` nor `status-popups.js` is listed.
- `node scripts/test-melaton-network.js`: fails on `connectionName: 'Nightshade Network'` vs `'VPN Connection'`.

## Caveats / follow-ups

- No commit was made. Repo was already ahead 61 / behind 119 with a large dirty tree.
- Native fallback popups only know Bluetooth devices via `n.sys.bluetoothDevices`; no code in this repo (or the checked-out DSApp-Kotlin clone) sends that field, so the fallback Bluetooth popup may only show the Connected/count line if the app starts sending it. The page-drawn bubble reads `window.AndroidBluetooth` directly and works without it.
- `NativeBubble.kt` (DSApp-Kotlin) ignores the new `icon` field in pair values; the status-battery glyph is drawn by the page-published layout, not by the app's text-only fallback. If a true native glyph is required in the fallback, DSApp-Kotlin needs a corresponding draw change.
- Visual verification on the phone/DeX has not been done in this session; the SW/cache was notified, so a client update/reload is needed before checking.

## Quick re-check checklist

1. Status bar Bluetooth icon visible → tap Connectivity → no "Bluetooth:" row and no device rows; dividers still separate Bluetooth/Wi-Fi/Mobile when the icon is hidden.
2. Hide Bluetooth icon (or fold it) → Connectivity shows the row + up to 3 named/profiled/battery-readable devices with the status-battery glyph, no `%`, and a count badge.
3. Tap Bluetooth icon → "Bluetooth: Connected" with the same device list; no Wireless Manager link.
4. Rows and right-hand badge/glyph visually centred.

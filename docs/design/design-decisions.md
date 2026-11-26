# Design decisions

The register of decisions about how Dreamscape looks and behaves. Rule:
`.cursor/rules/design-decisions.mdc` (cursor-rules). Yukimi, 2026-11-23, Yozora #1137.

## How this file works

- A decision about how something should look or behave is written here when it is made, in the
  same change that acts on it. Newest entries go at the end of their section.
- An entry has: the decision, who made it and when, the issue, and where it is enforced
  (rule, check, doc).
- **A change that contradicts an entry is not made silently.** Ask Yukimi first (see the rule).
  Until she confirms, the entry stands. After she confirms, update the entry in the same change
  and keep the old wording under "Superseded" with the date.
- Detail lives in the linked docs; this file is the index with the one-line decision.

## Platforms and look

| Decision | By / when | Source |
| --- | --- | --- |
| One UI standard for every app: one skin, one factory, one control kit, literals only in theme files, named themes with zero leak between them | Yukimi, 2026-11-15, #851 | `docs/design/ui-standard.md`, `ui-standard.mdc`, `scripts/check-ui-standard.js` |
| Desktop look is Vista ("Vista or nothing"); XP comes later as a complete second theme, zero leak | Yukimi, 2026-11-15, #851 | `ui-standard.md` section 1 |
| Phone look is Windows Mobile 6.1 or 6.5, user-selectable; desktop and phone UIs never cross over | #851 | `ui-standard.md`, `wm61-icon-style.md` |
| Reference measurements (Vista VM, XP VM, WM emulator) are 1:1; no interim approximations | Yukimi, Oct 2026 | `ui-standard.md` preamble |
| Every window has an image icon; children use the parent's | Oct 2026 | `ui-standard-window-inventory.md` |
| Vista icons, not Font Awesome | Yukimi | `vista-icons-not-fa.mdc` |
| Sliders are the platform's: Vista trackbar on desktop, WM trackbar on phones, never the browser's | Yukimi | `sliders-platform.mdc` |
| Nothing the browser draws on its own reaches the screen (selects, pickers, alerts, progress, scroll bars, focus rings) | Yukimi, #851 | `no-native-browser-ui.mdc` |
| Phone scroll bars and controls use the WM version's own art, measured on the emulator | Yukimi, Nov 2026 | `melaton-bars-native-layouts.mdc` |
| Notifications and status indicators are never silenced to save power | Yukimi, Nov 17 2026 | `phone-power-client.mdc` |
| Pictures that can show again are files with an address, not `data:` strings | Yukimi, Nov 21 2026 | `no-base64-images.mdc` |
| CaféReady and Melaton Café are written with the é wherever people read them | Yukimi | `cafe-ready-name.mdc` |
| The open Fold's inner screen may keep two windows, and it is **opt-in**: unset (`wmSplitLeft`) means `none` - an unfolded program fills the inner screen exactly as on the cover screen. Settings > Screen > Open Fold picks the left pane (nothing / Start screen / Today); with Start there, the program stands on the right. When it is on, a pane draws its own backdrop - Start's own copy of Today's picture and the ROM's 50 % sheet - because neither the shell's picture layer nor Today's page is behind a pane (the shell's white `.wm-content` is); a pane is never a bare white page | Yukimi, Nov 23 2026, #1131; made opt-in Nov 25 2026 - "yes but we should not have added it so fully fleshed out" (a wish in the plan became a second pane on every unfold, on her phone too); pane backdrop fixed the same night | `public/scripts/comp/wmShell.js` (`applySplit`, `splitPref`), `public/scripts/comp/wmPrograms.js` (Open Fold page), `public/css/wm65.css`, `public/scripts/comp/wmStart65.js` (`paintWallpaper`) |

## Behaviour

| Decision | By / when | Source |
| --- | --- | --- |
| Installed clients start with zero server waits; checks, sign-in and updates run inside the running app afterwards | Yukimi, Nov 18 2026 (top rule) | `installed-boot-zero-wait.mdc` |
| Nothing on the phone depends on a WebView page; background duties run as CaféReady task code | Yukimi, Nov 17 2026 | `cafeready-background.mdc` |
| Server pushes, clients do not poll under 60 s | Yukimi, Nov 13 2026 | `server-push-not-polling.mdc` |
| UI defects an agent sees are fixed or handed on, never left | Yukimi, Nov 7 2026 | `fix-ui-issues-you-find.mdc` |
| Hidden screens never redraw; mark stale and redraw in full on show | Yukimi, Nov 2026 | memory `no-offscreen-redraws` |
| Density first in DreamStudio: no page indicators or extra rows, one-row bars | Yukimi, Nov 15 2026 | memory `dreamstudio-density-first` |
| Menus hold real settings, never copies of what is visible; nothing is desktop-only in the phone Studio | Yukimi, Nov 2026 | memory `dreamstudio-full-build-meaningful-menus` |
| Phone shows real device quirks (WM glitches, draw order, slowdowns) | Yukimi, Nov 2026 | memory `copy-device-quirks` |
| Dialogs for in-app information, notifications for background events (phone) | Yukimi, Nov 2026 | memory `wm-phone-ui-feedback` |
| Test UI by real taps through the visible path, on the hardware phone for phone UI | Yukimi, Nov 2026 | `client-browser-testing.mdc` |
| A Director turn raises no notification while she is watching that chat on a live page of hers - any client counts (a phone's DeX window and its own shell page, a laptop: the union), so the phone's shell page raises no toast of its own for a chat its DeX window shows (she sees it there; the phone does not repeat it), none for a turn a steer cut short, and at most one notice per turn when she is away (a finish under an id still waiting changes it in place, silently). Question, error and finished-while-away notices still go out. This is presence-based, not power-based: it never silences what she cannot see, so "Notifications and status indicators are never silenced to save power" stands | Yukimi, Nov 25 2026, #1168 | `modules/notificationInboxSources.js` (`present`, `noteSteer`, `onDirectorStatus`), `modules/ws/handlers/directorImpl.js` (director_abort steer), `public/scripts/comp/wmDirector.js` (`noteTurns`, `status.watched`), `modules/cursorDirector.js` (`directorStatus.watched`), `scripts/test-steer-no-notification.js` |
| A running client never takes a changed asset in place: no in-place stylesheet swap, no second sheet beside the live one, no hot CSS apply, no partial mixture. An update is applied by reloading the client, which must stay rare, quick and predictable | Yukimi, Nov 25 2026, #1162 / #1167 | `client-update-never-in-place.mdc`, `public/scripts/comp/serviceWorkerManager.js`, `public/scripts/comp/agentClientBridge.js`, `public/sw.js` |
| 6.5 Today glass band: the glasslight edge light stays a hint (rims about 0.28 white at the top, 0.2 at the bottom; the ti-3000 art carries its own lines), the middle edge is the ti-3000 art's own, with no overlay line on it (a bright lip and then a crease both looked wrong: "put it back"); the weather effect belongs to the clock item only (gone with any other item in the glass; the Super Bar keeps its own) | Yukimi, Nov 25 2026, #1109 | `public/css/wm-titanium.css` (glasslight `::before`, `.wm-ti-wxfx`), `public/scripts/comp/wmTitanium.js` (`wxOnClock`, `syncWx`) |
| XM Radio cut names are a durable store that every SiriusXM read is MERGED into, never assigned (the old Lizumi engine's rule): identity is channel + cut start; length, end and guid always refresh; title, artist and show change only while the stored text is a placeholder (empty, an ignored word, the channel's name, an ad), the record is not edited by a person, and fewer than 10 different answers were tried; the list is never cut to the poll's window; songs kept a day, shows a week, cuts under 65 s not kept. One writer: the recorder service. A tape's names come from this store, so a cut keeps its name after the poll that named it has slid past | Yukimi, Nov 26 2026, #1252 (S1) | `modules/xmRadioMeta.js`, `modules/xmRadioRecorder.js` (`metaLook`, `metaRange`, `cutsFor`), `modules/xmRadio.js` (`liveUpdateRange`), `scripts/test-xmradio-meta.js` |
| XM Radio recordings come from ONE common queue that every producer feeds (Recently Played, one-touch Record, the deck's REC, timers, alerts, search terms); a dispatcher hands the next due entry (soonest out of the five-hour buffer, then the order added) to a free virtual radio - a slot with its own SiriusXM account that is signed in, entitled to the channel and not already streaming. One stream per account, the radio's own account included ("streams per account" is a console setting, 1 by default, up to 4). Nothing is pinned to a slot. An entry that leaves the buffer before a radio comes free is kept as Missed with its reason, never dropped. The radio app's own live listening does not count as a stream | Yukimi, Nov 26 2026, #1252 (S2, S3) | `modules/xmRadioRecorder.js` (`dispatch`, `poolView`, `adoptEntry`), `modules/xmRadioSlots.js`, `scripts/test-xmradio-queue.js`, `scripts/test-xmradio-slots.js` |
| An XM Radio recording keeps a healthy buffer and never drops audio: the recorder never fetches within `healthyBuffer` segments of the live edge (3 by default) and, when it catches up or SiriusXM stalls, PAUSES until the buffer refills, then continues. Each segment is verified (length, decryption, AAC frames to the last byte) and a partial one is fetched again from the same address (same bytes). Raw segments stay on disk for the whole recording, and the cut files (or the long file) are assembled when it ends from the segments and the durable cut store; assembly can be re-run, and replaces its own files on the tape. A hole (audio that left SiriusXM's window) is a hole: it is filled with silence of its exact length, so later times stay true, and marked in the file (" (gap)" in the title, a "missing audio" comment, a "Missing audio" chapter) and in the console; a partial recording is never presented as complete. Raw segments are kept `keepSegmentsHours` (24 by default) after assembly for Re-assemble | Yukimi, Nov 26 2026, #1252 (S6, S7) | `modules/xmRadioPump.js` (`adtsClean`, healthy buffer, gap), `modules/xmRadioRecorder.js` (`assemble`, held list, keep sweep), `scripts/test-xmradio-behind.js`, `scripts/test-xmradio-assembly.js` |
| Weather pictures are prompted as scenes with dynamic generation for the place (!dg_time, !dg_season, !dg_weather) and carry no readings; the rain alarm's popup and notice show the current weather, its glyph and the next hour's graph, and rain that has already started reads "now", never "in 0 min" | Yukimi, Nov 26 2026, #1267 | `modules/weatherDaily.js`, `modules/weatherService.js`, `public/scripts/comp/weatherAlerts.js`, `modules/notificationInboxSources.js` (`onRainAlarm`) |

## Superseded

- **Each finished Director turn is news** (the notice sounds again under the same id: `alert: true` in `onDirectorStatus`, Yozora #889). Superseded Nov 25 2026 by Yukimi, #1168: "there should not be 2 or even 1" while she uses the desktop client on the phone. Now see the Director turn row under Behaviour; the notice no longer carries the alert flag.

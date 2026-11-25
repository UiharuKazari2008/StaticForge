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

## Superseded

- **Each finished Director turn is news** (the notice sounds again under the same id: `alert: true` in `onDirectorStatus`, Yozora #889). Superseded Nov 25 2026 by Yukimi, #1168: "there should not be 2 or even 1" while she uses the desktop client on the phone. Now see the Director turn row under Behaviour; the notice no longer carries the alert flag.

# Notification discipline

The hard lines are in `.cursor/rules/notification-discipline.mdc` (N1-N11). This document is the part that
makes them stick: what the Supervisor inspects, what it says when a notice fails, and how the whole notice
surface gets audited instead of argued about one popup at a time.

Yukimi, 2026-11-26, Yozora #1299: the notices, dialogs and tray popups are "extremely annoying and getting
out of control"; the Supervisor "needs to inspect every single notification, status icon, tray popup, dialog,
confirmation, etc. and directly call out 'bullshit' notices, sounds, and non-call to action user annoyance".

## The verdicts the Supervisor gives

A verdict names the line and the `file:line`. "Looks fine" is not a verdict.

| Verdict | Means | Line |
| --- | --- | --- |
| **bullshit** | it exists to say something happened. No reason to reach the user at all. Remove it. | N1, N2, N3 |
| **no action** | the user cannot do anything with it: no destination, no button, no content they asked for. Give it one or drop it. | N4 |
| **no switch** | the user cannot turn this source off where they would look for it. Register it and give it a switch. | N5 |
| **duplicate** | the same fact reaches them twice (two paths, two clients, a second sound for the same id). Deduplicate by id. | N6, N9 |
| **sound** | a sound with no user action and nothing asked for behind it. Silent. | N7, N8 |
| **stack** | it queues behind another notice, or shows again because the first was missed. Coalesce, newest wins. | N9 |
| **over the top** | it covers a window that already says the same thing, or it says nothing useful ("Something went wrong"). | N10 |
| **announces itself** | a status icon that balloons, beeps or shows text about its own change. | N11 |

## What is inspected

Everything that reaches the user without being asked for. The list to work from, by area (evidence with
`file:line` lives in the audit, not here):

1. **Page / desktop emitters** - `toastManager` (`showGlassToast`, the desktop toast policy), the tray popup
   path, `appWebSocketHandlers.js` (`system_message`, `notification`, `agent_notice`, `receipt`), the ws
   handlers (`Queue Blocked`, `Queue Unblocked`, cost receipts), `websocket.js` (Connected / Connecting /
   Nightshade balloon / latency popup), `bootMessageBox.js`, `confirmationDialog.js`.
2. **WM / mobile emitters** - `wmShell.notify` / `messageBox` / `appNote` / `confirmationNotice` /
   `window.alert` routing, battery low, "Text messages stopped", weather alerts, chat arrival, the inbox.
3. **Native phone notices** - the WM notices the app draws itself (`InboxNotifier.kt`, camera, battery, CaféReady task
   notices). A Dreamscape notice is never an Android notification (#1321, `design-decisions.md`): a new
   `NotificationCompat.Builder` or `NotificationChannel` fails the audit unless it is one of the kept entries listed there
   (foreground services, media controls, the ringing alarm clock).
4. **Sounds** - `desktopSounds.play` (boot, balloon, im-message, critical-stop, prints, recycle), the WM
   `SND_EVENTS` table and every `playSystemSound` call, and Android's channel sounds and vibrations.
5. **Status icons** - every role in `public/scripts/tasks/status-order.js`, plus the app's native roles: does
   it ever announce its own change?

## The standing duty

- **New or changed notice: reviewed before landing.** A work item that adds or alters an emitter, a sound, a
  channel, a title or a text, or an icon's behaviour carries the verdict in its report: which lines it
  satisfies and why, `file:line`.
- **The audit is repeated, not one-off.** Waves are listed on the audit issue; each wave takes one area of
  the five above, classifies every notice in it (trigger: user action / server push / timer / boot; click
  action yes/no; sound yes/no; kill switch yes/no), and lands fixes with the check.
- **Enforcement**: `node scripts/check-notifications.js` - every notice emit site must carry a registered
  source id, and per-file counts may only go down (the `check-ui-standard.js` / `check-perf-rules.js`
  pattern). A new unregistered notice fails the pre-commit hook. A rise needs Yukimi's decision.
- **A finding is an action, not a note.** Fix it, or file it with the verdict and the evidence; "noted" and
  "cosmetic" are not outcomes (`fix-ui-issues-you-find`).

## How the audit reports

One line per notice:

```
file:line  | what raises it        | trigger      | action | sound | switch | verdict
toastManager.js:924 | tray balloon | server push | yes (program) | scheme | trayRegistry | ok
websocket.js:20 | "Connected" toast | socket state | none | no | none | bullshit (N1, N5)
```

and a per-area count of what was removed, what was given an action, what was given a switch.

## Where things already exist (do not reinvent)

- `tray-balloons.mdc` - the balloon standard: click action, one at a time, `popupId`, auto-hide while
  present. It is the model.
- `modules/activeSyncNotifyFilter.js` - the phone's own system noise (charging, System UI, Play services,
  promotion channels) is already classified as *not sent*; `as_notify_prefs` (Device Center) is the user's
  override. The same judgement applies to our own notices.
- `trayRegistry.trayPopupHidden` / `trayNotePopup` - the desktop tray popup switch, already used for the
  update balloon.
- `wmSounds` / `wmSoundMode` (`wmShell.js`) - per-event sound, display and vibrate on the phone, per device.
- `modules/notificationInboxSources.js` (`present`, `noteSteer`) - the presence rule for Director turns
  (#1168): do not notify what she is already looking at.

## What is *not* a notice (never audited as one)

Data the user asked for arriving where they asked for it: a chat message in the open chat, a reply they are
waiting on, a job they started finishing, a mail in the inbox they opened, a print they started landing in
the prints list, an error line in the window that failed. These are deliverables; the sound rules (N7) still
apply to their sounds.

## Decisions taken in the first audit (2026-11-27, #1299)

The audit does not hand its open points to Yukimi; each was decided against N1-N11 and the decision is the default until she changes it.

| Point | Decision | Why |
| --- | --- | --- |
| Cost receipts of a print / upscale / vibe (the toast) | stays removed | N2: the cost of the user's own action; deposits (money arriving) keep their balloon |
| Battery fully charged (phone note, ActiveSync balloon) | stays, silent | her own #829 request, and it is a call to action (unplug); no sound (N7), switch in Sounds & Notifications / the ActiveSync icon menu |
| Remote Access balloon | stays | her only live sight of an agent in her session; has the tray switch and a click target |
| Remote Access on Melaton Mobile (#1199, 2026-11-28) | one phone notification, silent, class "Other notifications" | the phone has no taskbar, so the balloon never showed there; same words as the balloon, Disconnect while an agent is bound, one note at a time; no row of its own in Sounds & Notifications, so it follows "Other notifications" (Display message on screen off: it waits in the title bar); proof in `docs/testing/evidence/1199/` |
| Wallet renewal / Anlas-expiring balloons | stay | money, a call to action, switchable |
| Main Battery Low / Very Low default tone | stays | the phone is about to die: a hardware-style alert, one per stage |
| Inbox channel HIGH for status classes (#1314) | status classes move to a quiet channel | needs a new channel id in the app; filed on #1314 for the next app change |
| Instant Hotspot "is using your data" notice | tap opens Dreamscape | filed on #1313 with the in-app switch |
| "Other notifications" class | ships with sound on; progress and account notes are silent | a note that names no event is not a delivery |
| Desktop "High Latency Detected" balloon | **removed** (N11) | the ping warning icon and its tooltip carry it; its Notification Area row went with it |
| Package-restart modal, power nags | filed on #1317 | not an audit-time change |

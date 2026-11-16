# WebSocket: Notification inbox

Server handler: `modules/ws/handlers/294-notificationInboxHandler.js` (logic in `modules/notificationInbox.js`). Yozora #845.
Client: `public/scripts/comp/wmNotificationInbox.js` (Melaton Mobile catch-up on resume); producers are Lapis Remote and Traffic (more to follow).

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling. `admin` or `dev_admin`; each user type has its own queue.

A durable store of the notices producers raise, so a phone that was not connected shows them when it opens, the shell shows on resume what was not cleared or acted on elsewhere, and the DSApp foreground service can post them as Android notifications while the WebView is paused. Producers call `notificationInbox.publish()` as well as their own live broadcast; a notice keeps a stable `id` so a later one of the same id supersedes it, and a short-lived one (a run countdown) carries `expiresAt`.

## Packet index

| Request | Body -> reply |
|---|---|
| `inbox_list` | `{ since?, includeCleared? }` -> `{ notices }` (newest first, not expired; cleared ones left out unless asked) |
| `inbox_ack` | `{ id, state: 'seen'|'acted'|'cleared', device? }` -> `{ ok }`. State never steps back. Destructive. |
| `reminder_snooze` | `{ id, minutes? \| at? }` -> `{ ok, at }`. A `rem:` notice is cleared now and published again with the same id at `at` (or in `minutes`, default 5). Destructive. |
| `reminder_dismiss` | `{ id }` -> `{ ok, cleared }`. A reminder dismissed in the desktop Calendar: marked fired (never fires later) and its notice cleared. Destructive. |
| `reminder_status` | `{}` -> `{ started, lastScanAt, lastError, next[], snoozed[] }`: the reminder scheduler's queue. |

A notice: `{ id, app, cls, title, text, actions[], data, createdAt, expiresAt, state, actedBy }`. `cls` is the wmShell notification class (sound and icon); `data.open` names the app layer / direction to open; `state` is `new` -> `seen` -> `acted`, or `cleared`.

## Broadcast (same user type's clients)

- `inbox_updated` `{ reason: 'new', notice }` when a notice is published, or `{ reason: 'ack', id, state, device }` when its state changes (so a notice cleared or acted on one device clears on the others).

## Reminders (Yozora #876)

`modules/reminderScheduler.js` fires calendar appointment and task reminders from the server, whether or not a page runs. It reads every workspace's `Calendars/*.ics` with the Calendar package's parser (VALARM relative or absolute triggers, RRULE, EXDATE, all-day, VTODO reminders of tasks not completed; the phone mirror calendars `X-MELATON-SOURCE:phone:` and the calendars hidden in Calendar are left out), rescans when a `.ics` changes (`vfsDatabase.onUserFilesChanged`), keeps one timer for the next reminder, and remembers fired ids in `reminders.db` (those due in the last 15 minutes while the server was down fire once on start).

A due reminder is an inbox notice: `cls: 'reminder'`, `app: 'calendar'|'tasks'`, id `rem:<fileId>:<uid>:<occurrenceStartMs>` (tasks `rem:task:<uid>:<reminderAtMs>`), title `"<h:mm> | Reminder"`, text the subject, the time and the location on their own lines, `data { app, kind: 'reminder', uid, start, end?, allDay?, due?, task?, fileId, calendar, subject, when, location }`; it expires when the appointment ends (a task's after a day). Melaton Mobile shows it live as Windows Mobile's reminder notification (Dismiss | Menu with the Snooze items); the desktop Calendar's Reminders window clears or snoozes it too.

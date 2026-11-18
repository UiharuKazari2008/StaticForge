# WebSocket: Notification inbox

Server handler: `modules/ws/handlers/294-notificationInboxHandler.js` (logic in `modules/notificationInbox.js`). Yozora #845.
Client: `public/scripts/comp/wmNotificationInbox.js` (Melaton Mobile catch-up on resume); producers are Lapis Remote, Traffic, the reminder scheduler and the server-side sources in `modules/notificationInboxSources.js` (see below).

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling. `admin` or `dev_admin`; each user type has its own queue.

A durable store of the notices producers raise, so a phone that was not connected shows them when it opens, the shell shows on resume what was not cleared or acted on elsewhere, and the DSApp foreground service can post them as Android notifications while the WebView is paused. Producers call `notificationInbox.publish()` as well as their own live broadcast; a notice keeps a stable `id` so a later one of the same id supersedes it, and a short-lived one (a run countdown) carries `expiresAt`.

## Packet index

| Request | Body -> reply |
|---|---|
| `inbox_list` | `{ since?, includeCleared? }` -> `{ notices, total }` (newest first, not expired; cleared ones left out unless asked). `since` (ms, #890 round 5 W2): only the rows created or changed (`createdAt` or `updatedAt` at or after it), cleared ones included so the page closes its copy; send the newest `createdAt` / `updatedAt` the page holds and merge by `id` (each row carries `updatedAt`, when its state last moved; it equals `createdAt` until then). Expired and pruned rows are not listed: the page drops a notice past its `expiresAt` itself. `total`: how many notices a full list holds (not cleared, not expired). Without `since`: unchanged. |
| `inbox_ack` | `{ id, state: 'seen'|'acted'|'cleared', device? }` -> `{ ok }`. State never steps back. Destructive. |
| `inbox_prefs` | `{ quiet: [cls...] }` -> `{ ok, quiet }`. The phone's Settings > Sounds & Notifications classes with Display message off (#876). A notice of a quiet class is stored as `seen` (kept for the title bar's state), never popped on resume and never sent to the phones' background links. Stored per user type; the default is none. |
| `reminder_snooze` | `{ id, minutes? \| at? }` -> `{ ok, at }`. A `rem:` notice is cleared now and published again with the same id at `at` (or in `minutes`, default 5). Destructive. |
| `reminder_dismiss` | `{ id }` -> `{ ok, cleared }`. A reminder dismissed in the desktop Calendar: marked fired (never fires later) and its notice cleared. Destructive. |
| `reminder_status` | `{}` -> `{ started, lastScanAt, lastError, next[], snoozed[] }`: the reminder scheduler's queue. |
| `phone_status_prefs` | `{ mailAll?, smsAll? }` -> `{ ok }`. Messaging > Tools > Options "status icon for any unread mail / text" (#908), kept on the server for the phones' status icons (`modules/phoneStatus.js`, sent to the app as `as_event status.snapshot`). The page sends them on connect and when they change. |
| `msg_new_state` | `{}` -> `{ mail, sms, known }`. The envelope icons' "new since last opened" (#907, `modules/messageNew.js`): mail = an unread inbox message (household mailbox, IMAP inboxes) newer than the last time a phone opened a mail list; sms = a conversation that got an incoming text since Text Messaging was last opened and is still unread. Kept in the inbox prefs (survives restarts); also in the phones' `status.snapshot` as `mail.new` / `sms.new`. `known` false before the server's first answer. |
| `msg_new_seen` | `{ cls: 'mail' \| 'sms' }` -> `{ ok }`. A phone opened the mail (Messaging on a mail / IMAP list) or Text Messaging: what is there is not new any more. |

## Delivery to the phones (#908)

Every notice sent to a phone's background link (`as_event inbox.notice`) is a delivery row until the app confirms it (`as_event inbox.posted { id, how }`: posted, shown by a page in front that said so through `AndroidInbox.shown`, or already showing). Unconfirmed, it is sent again after 15 s, 45 s, 2 min and 5 min, and on every hello of that phone. The rows outlive a server restart. A notice already seen, acted on or cleared anywhere is not sent again, and a phone's hello does not re-send what that phone confirmed. A new text's notice (`sms:`) carries its conversation (`data.title, sender, address, isGroup, date, account, guid`) and is the text's only path to the app, which renders it as a MessagingStyle conversation. Server-raised kinds: `dmail:` (household mailbox), `question:` (Director questions), `emotion:`, `system:` (warning / error notices), `api-key:`.

A notice: `{ id, app, cls, title, text, actions[], data, createdAt, expiresAt, state, actedBy }`. `cls` is the wmShell notification class (sound and icon); `data.open` names the app layer / direction to open; `state` is `new` -> `seen` -> `acted`, or `cleared`.

## Broadcast (same user type's phone pages)

- `inbox_updated` `{ reason: 'new', notice }` when a notice is published, or `{ reason: 'ack', id, state, device }` when its state moves to `acted` or `cleared` (so a notice cleared or acted on one device clears on the others). A move to `seen` is not broadcast (no page acts on it; #890 round 5).
- `msg_new_state` `{ mail, sms }` when either changes (phone pages only; a sleeping page gets the newest).
- Phone pages only (`modules/websocket.js` PHONE_ONLY_TYPES: the only reader, `wmNotificationInbox.js`, loads in the mobile shell). A sleeping page (client_dormant) gets `reason: 'new'` at once (reminders and missed notices wake it) but no `reason: 'ack'`: it catches up with `inbox_list { since }` when it wakes (W7).

## Reminders (Yozora #876)

`modules/reminderScheduler.js` fires calendar appointment and task reminders from the server, whether or not a page runs. It reads every workspace's `Calendars/*.ics` with the Calendar package's parser (VALARM relative or absolute triggers, RRULE, EXDATE, all-day, VTODO reminders of tasks not completed; the phone mirror calendars `X-MELATON-SOURCE:phone:` and the calendars hidden in Calendar are left out), rescans when a `.ics` changes (`vfsDatabase.onUserFilesChanged`), keeps one timer for the next reminder, and remembers fired ids in `reminders.db` (those due in the last 15 minutes while the server was down fire once on start).

A due reminder is an inbox notice: `cls: 'reminder'`, `app: 'calendar'|'tasks'`, id `rem:<fileId>:<uid>:<occurrenceStartMs>` (tasks `rem:task:<uid>:<reminderAtMs>`), title `"<h:mm> | Reminder"`, text the subject, the time and the location on their own lines, `data { app, kind: 'reminder', uid, start, end?, allDay?, due?, task?, fileId, calendar, subject, when, location }`; it expires when the appointment ends (a task's after a day). Melaton Mobile shows it live as Windows Mobile's reminder notification (Dismiss | Menu with the Snooze items); the desktop Calendar's Reminders window clears or snoozes it too.

## Server-raised notices (Yozora #876)

`modules/notificationInboxSources.js` publishes the phone's notifications from the server at the point it learns of the event, so they reach the phone while Melaton Mobile's page is not running. The page still raises its own live WM notification; both use the same id, so the inbox copy of a live one is only marked seen. Reading, answering or dismissing the thing anywhere clears the notice (`clear(..., 'server')`).

| Id | `cls` | Raised by / cleared when |
| --- | --- | --- |
| `mail:<account>:<folder>:<uid>` | `mail` | `mailAccounts` new mail with notify on ("New E-mail Message", 7 days); cleared on `\Seen`, removal, or the account deleted (`clearWhere 'mail:<account>:'`) |
| `sms:<account>:<chatGuid>` | `sms` | `textMessaging` new text with notify on ("New Text Message", the conversation's newest line, 7 days); cleared when the conversation is read or answered |
| `tm-signin:<account>` | `notification` | `textMessaging` `signin_lost` ("Text messages stopped") |
| `chat:<chatId>` | `chat` | `chatImpl`: a persona's reply to a request from the phone (7 days) |
| `director:<sessionId>:turn` | `director` | `cursorDirector` status: the turn finished (1 day); cleared when the next turn on that session starts |
| `print:<jobId>` | `print` / `print-error` | the generation FIFO (`bindPrintQueue`, bound by the inbox handler): a print the phone asked for is ready or failed (1 day); admin / dev_admin jobs only |
| `wx:<placeId>:<alertId>` | `weather-alert` / `weather-severe` | `weatherService` alerts for Home / Work; expires half a day after the alert ends |
| `rain:<placeId>` | `rain-alarm` | `weatherService` rain alarm; expires when the rain is due |

`data` carries `{ app, kind, ... }` (what to open on a tap). Titles and texts are the page's own WM wording.

## Phones' background link (ActiveSync, #876)

Every published notice that is not quiet also goes to each partnered phone's ActiveSync service socket (`activeSync.sendInboxNotice`) as server `as_event` `inbox.notice` `{ ...notice, user, pageConnected }`; `pageConnected` says a Melaton page of that phone is on its link (it shows the notice itself), otherwise the app posts an Android notification. When a notice becomes `acted` / `cleared`, or expires while not acted on, `activeSync.sendInboxCleared` sends `inbox.cleared` `{ id }` so the app cancels its Android copy. See [activeSync.md](./activeSync.md).

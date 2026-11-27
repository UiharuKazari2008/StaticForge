# WebSocket: Device consent

Server handler: `modules/ws/handlers/296-deviceConsentHandler.js` (notices in `modules/deviceConsentNotices.js`, the lease logic in `modules/deviceConsent.js`). Yozora #1284.

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling. `admin` or `dev_admin` only; a test-lane device (`modules/testDevices.js`) is refused.

Before an agent can use a shared phone, the household is asked on the phone's screen. The question and the "in use" status travel as ordinary notices of the notification inbox (see [Notification inbox](notificationInbox.md)): published through `notificationInbox.publish`, pushed to the phones as `as_event inbox.notice`, cleared by `notificationInbox.clear` when no longer true. This packet takes the answer back.

## Packet index

| Request | Body -> reply |
|---|---|
| `device_consent_answer` | `{ id, answer: 'allow' \| 'deny' }` -> `{ ok, error? }`. `id` is the ask notice's id (`device-ask:<leaseId>`) or the bare lease id. Answered through `deviceConsent.answer(leaseId, answer, by)`; the ask's notice is cleared at once, whatever the result (an answer that came too late is still dealt with). `error` is `'bad request'` (missing id or an answer other than allow / deny), `'test device'`, or the lease logic's own reason. Destructive. |
| `device_consent_settings_get` | `{}` -> `{ ok, settings }`. `settings` is `deviceConsent.settings()`: `{ timeoutSec, onTimeout: 'wait' \| 'deny' \| 'allow', readOnly: 'ask' \| 'allow', consentDevices: [id, ...] }` (defaults 60, `wait`, `ask`, `['a53', 'fold']`). Fleet reads it once when its Phone Consent page opens and after a save; never polled. |
| `device_consent_settings_set` | `{ patch }` -> `{ ok, settings }` or `{ ok: false, error }`. `patch` holds any of the four fields; it is merged through `deviceConsent.setSettings(patch)` and the settings in force come back. `timeoutSec` is a whole number of seconds from 10 to 600 here (the lease logic itself accepts 1 to 3600). `onTimeout` is what happens when nobody answers: `wait` (stays pending, never granted), `deny`, or `allow` (grants without asking). `readOnly` `allow` lets read-only shell checks (dumpsys, getprop, pm list ...) run without asking. `error` is `'bad request'` (no `patch` object), `'test device'`, or the validation message. Destructive. |

No broadcast: the packets are request / response only (so they need no entry in the `modules/websocket.js` audience lists).

## Notices

All for user `admin`, app `claudedesk`, class `notification` (the "Other notifications" sound she chose; never `fleet`, #1305), no stack.

| Notice | id | Sound | Life | Content |
|---|---|---|---|---|
| Ask | `device-ask:<leaseId>` | sounds once (digest `ask:<leaseId>`: a repeat sync is silent); silent, still shown, when the same agent asked for the same phone within 15 min or another ask sounded in the last minute | 12 h | title `<agent> wants the <label>`, text `For up to <minutes> min. Why: <why>.`, buttons Allow / Deny. `data { app, kind: 'device-ask', leaseId, device, buttons: [{id, label}], answerType: 'device_consent_answer', page: 'devices' }` |
| Hold | `device-hold:<device>` (one per device) | published `alert: false`: silent always (a new row, an update, a later hold after the last one was cleared; #1305), with an End button (`data.buttons`, `answerType`) | until the lease's `endsAt` + 5 min | title `<label> is in use by <agent>`, text `<why>. Until HH:MM.`, `data { app, kind: 'device-hold', device, leaseId, page: 'devices' }` |

A button press sends `device_consent_answer { id: <notice id>, answer: <button id> }`. After the answer time (`timeoutSec`) passes the ask is published again silent (still shown); an ask or hold that is no longer true is cleared by the next `deviceConsentNotices.sync(snapshot, settings, { quiet })`.

Answerable notices (`data.answerType`, #1305): the class's "Display message on screen" off never swallows them; a phone's catch-up carries every unconfirmed one (quietly) before its one top notice; they cannot be snoozed (`reminder_snooze` refuses `device-ask:` / `device-hold:`); the phone status waiting list carries their `answerType` and `buttons` so the app rebuilds the keys with the page asleep. A lease marked `lane: 'test'` (the test consent lane: the A53 test phone or an emulator) is published under user `test` only, so only test devices see it; Yukimi's phones never do.

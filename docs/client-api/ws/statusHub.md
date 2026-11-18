# Status hub (server-push status feeds) and boot notes

Modules: `modules/ws/statusHub.js`, `modules/ws/handlers/294-statusHubHandler.js`,
`modules/ws/handlers/169-clientBootNoteHandler.js` (Nov 15 2026; rule
`.cursor/rules/server-push-not-polling.mdc`).

Clients do not poll for status on intervals. Each status source is one **feed** with one server
timer, shared by every subscriber. The timer runs only while someone is subscribed, reads the
upstream once per tick, and pushes only the items that changed, only to that feed's subscribers.
Each feed decides who may subscribe (`allow(clientInfo)`).

## `status_subscribe`

Request: `{ type: "status_subscribe", feed: "<name>", requestId }`

Response: `{ type: "status_subscribe_response", requestId, feed, data: { feed, items }, timestamp }`
- the feed's current state. Read `data.items` (the request promise resolves with `data`); the
top-level `items` copy is gone (#890 round 5, W3: the snapshot went twice). A snapshot younger than the
feed's interval answers it without an upstream read (one is kept for an interval after the last
subscriber leaves, so a phone that left Today and came back is answered from it); otherwise the feed is
sampled now. The next read follows when that snapshot is one interval old.

Errors: unknown feed → `NOT_FOUND` ("Unknown status feed"); a refused or failed subscribe →
`STATUS_SUBSCRIBE_FAILED` (or the feed's own error code).

## `status_unsubscribe`

Request: `{ type: "status_unsubscribe", feed: "<name>", requestId? }`

Response (only when `requestId` is sent): `{ type: "status_unsubscribe_response", requestId, ok: true }`.
A subscriber also leaves on socket close or a failed send.

## Pushed packet

`{ type: <feed pushType>, feed, changed: { key: value }, removed: [key], timestamp }` — sent only when
an item differs from the last value sent; nothing while nothing changes.

## `client_boot_note` (fire-and-forget)

`{ type: "client_boot_note", shell, entry: { desktopMs, nav, note: { reason, hidden, screenOff, from } | null } }`

A page that just booted reports why (`melatonBootLog` in `public/scripts/comp/modalUtils.js`).
The server writes one `📱 boot …` log line per boot (device guessed from the user agent);
`note: null` means started outside the page (Android app or OS). Authenticated sockets only; no reply.

## `client_dormant` (fire-and-forget)

`{ type: "client_dormant", on: true|false, dex?: 1 }`

A phone page whose screen went off, or that went behind another app, says so. The server then holds
status pushes nothing is waiting on (`WebSocketServer.setDormant`) and sends them when it wakes.
New mail still goes at once. Authenticated sockets only; no reply.

A phone's DeX window sends it too, with `dex: 1` (#890 P18; the server marks the socket `clientInfo.dexWindow`): it is
then held for exactly like a sleeping phone page. What is held (`DORMANT_HOLD` in `modules/websocket.js`): `ping`,
`queue_update`, `search_indexing_status`, `as_peers_updated`, `runpod_pods_status_update`, `browsing_sessions_changed`,
`runtime_compile_progress`, `lapis_updated`, `dovecote_mailbox_updated` (newest only); `vfs_updated` (newest per folder);
`traffic_updated` (newest per direction); `ma_event` (except `new`); `mcp_activity` (the generating flag and the log line,
newest of each); `director_computer_status` (a change of the running turns goes at once, anything else newest only);
`wm_program_icons_job` (newest per job);
`xlink_status`, `service_worker_cache_update`, `runtime_compile_complete` (all, in order). Since #890 round 5 also:
`tm_event` (texts, edits, reactions, reads, chats, pairing and `signin_lost` go at once; `typing` is dropped; `account`,
`resync`, `settings`, `sync`, `syncprogress` newest per account; `reload` newest per conversation); `inbox_updated`
(`new` goes at once, `ack` is dropped: the page lists with `since` on waking); `weather_rain_status`,
`weather_alerts_changed`, `weather_places_changed`, `traffic_settings_changed`, `account_data_health_updated`,
`account_pictures_changed`, `director_rentan_agent_default_changed`, `runtime_compile_error` (newest only);
`weather_delta` (newest per place), `workspace_css_updated` (per stylesheet), `app_package_updated` (per package),
`note_content_updated` (per note); `desktop_shortcut_added` / `_updated` / `_removed`, `desktop_positions_updated`,
`note_created` / `_updated` / `_deleted` (all, in order). A hold rule may drop a packet outright (it returns `false`):
nothing is kept and nothing goes on waking. Notifications (`weather_alert_issued`, `weather_rain_alarm`,
`traffic_report`, `system_message`, `agent_notice`, `receipt_notification`, `lapis_notice`) are never held. Replies
(`requestId`) are never held. Held packets go out in order when it wakes (`on: false`), over its Continuity / Miniport carrier for a DeX window
that has no socket of its own; a broadcast for both of a phone's windows leaves the sleeping one out of the carrier's
copy (`_cc`).

While asleep it also gets no Director streaming updates (and does not pace them); on waking it is sent the turn's newest
update whole ([director.md](./director.md#streaming-updates-director_streaming_update)). Its own socket, if it has one,
keeps the long heartbeat window ([websocket.md](../websocket.md#phones-and-the-android-app-890)).

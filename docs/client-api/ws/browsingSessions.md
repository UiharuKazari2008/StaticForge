# WebSocket: Browsing sessions (Restore Session, Other Devices)

Server handler: `modules/ws/handlers/302-browsingSessionsHandler.js` (logic and storage in `modules/browsingSessions.js`,
`.cache/browsing-sessions.json`). Clients: `public/scripts/comp/browsingSessions.js` (`window.browsingSessions`, every tab),
`browsingRestore.js` (desktop Restore Session and Sessions settings), `grimoireIeChrome.js` (Quick Tabs > Other Devices,
Send to Device), `wmBrowser.js` (the phone's IE). Yozora #756.

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

## Model

A **device** is one browser profile (localStorage `dreamscape.deviceId`, 16 to 32 lowercase hex digits). A **client
session** is one page load on that device (a new id each load, 8 to 64 of `[a-z0-9_-]`). A session holds the client's
Internet Explorer **windows**, each with its **tabs**:

```json
{ "id": "grimoire:3", "kind": "alchemy", "alchemyId": "<32 hex>", "url": "https://example.com/", "title": "Example",
  "history": [{ "type": "web", "url": "https://example.com/", "title": "Example" }], "historyIndex": 0, "active": true }
```

The phone reports its IE windows as the tabs of one window (`wmie`). A tab with `alchemyId` has a live Alchemy page in
`services/grimoire-browser`; the service keeps an owned page open only while Dreamscape renews its lease.

States: `live` (a socket of the session is connected), `idle` (the last socket closed; Alchemy pages stay open for
`idleMinutes`), `stored` (pages closed; addresses and history kept until `keepMinutes` after the session went idle).
With `roam` on, a session that goes idle may be restored by any device (pass the session to the next computer).

Settings: `userGlobalSettings.alchemy.sessions` `{ idleMinutes (1..1440), keepMinutes (> idleMinutes, no upper limit),
showAtStartup, alwaysRestore, roam }` (Internet Properties > General > Tabs > Sessions; the phone's Options > Sessions).

## Packets

Signed-in sessions. Every reply is `{ success, ... }`; a refusal is `{ success: false, code, error }`.

| Request type | Response | Notes |
| --- | --- | --- |
| `browsing_session_hello` `{ sessionId, deviceId, deviceName, deviceKind: 'desktop' \| 'mobile' }` | `{ sessionId, settings, restorable }` | On every connect. A session id belongs to one device (`NOT_OWNER`). |
| `browsing_session_update` `{ sessionId, windows }` | `{}` | The client's windows and tabs (the whole list, 24 windows x 64 tabs at most). |
| `browsing_session_list` | `{ sessionId, deviceId, settings, sessions, restorable }` | Other Devices: every session with tabs (administrators; others see their own device). `restorable`: this device's earlier sessions and roaming ones, not dismissed with New. Each session has `state`, `expiresAt` and `killAt` (idle: when its pages close). |
| `browsing_session_restore` `{ ids, pick: { [sessionId]: [tabId] } \| null, size }` | `{ windows: [{ id, title, from, tabs }] }` | The ticked tabs come to this client; the rest of those sessions is discarded. A tab with a live page has `session: { sessionId, viewUrl }` (moved, no reload); others reopen from `url`. |
| `browsing_session_discard` `{ ids, keep }` | `{ discarded }` | Discard (`keep` false): the sessions go and their pages close. New (`keep` true): they stay stored, Restore Session stops offering them. |
| `browsing_session_take` `{ sessionId, tabId, windowId, newTabId, size }` | `{ tab, from }` | Other Devices. An Alchemy tab moves (the old viewer gets `transferred`); a Grimoire tab is copied. |
| `browsing_session_take_back` `{ alchemyId, windowId, newTabId, size }` | `{ tab, from }` | Take a page back by its Alchemy id ("Take it back", ActiveSync's `open.item`). |

Pushes (no `requestId`):

| Type | Data | When |
| --- | --- | --- |
| `browsing_sessions_changed` | | A session's windows or state changed (Other Devices refreshes). |
| `browsing_session_tab_taken` | `{ tabId, alchemyId, to }` | Another device took one of this client's tabs. |

## Alchemy service (services/grimoire-browser)

`POST /sessions` takes `owner { deviceId, deviceName, deviceKind, clientSession, windowId, tabId }` and `performance`.
`GET /sessions` lists every page with its owner; `POST /sessions/lease { ids, ttlMs }` renews owned pages (unknown ids
come back in `missing`); `POST /sessions/:id/transfer { owner, width, height }` gives a page a new owner and viewer
token, telling the old viewer `{ type: 'transferred', to, kind, at }`. `POST /browser/settings { performance }` and
`POST /browser/restart { performance }` take Internet Properties' Alchemy performance options
(`userGlobalSettings.alchemy.performance`); `/health` shows them and `pendingRelaunch`.

Viewer messages added: `visibility { hidden }` (only shown tabs are captured), `memory-override` (lift the per-tab
memory limit for this tab); from the service: `memory { level: ok | warn | over, usedMb, limitMb }`, `memory-limit`.

# Rack Manager (WebSocket)

The MMC console `rackmgr.msc` (Administrative Tools > Rack Manager) manages the rack servers' iLO and their roles.
Server: `modules/rackManager/index.js`, packets in `modules/ws/handlers/322-rackManagerHandler.js`; the design is
`docs/rack-manager/README.md` (rackd's HTTP API and the role actions are listed there).

## Who may use it

Every packet is refused with `error` (`details: INSUFFICIENT_PERMISSIONS`) unless the connection is an **administrator with
a full sign-in** (same guard as the Administrator Terminal, `docs/client-api/ws/adminTerminal.md`: no application key,
no approved-IP or client-certificate session). Writes (`rack_action`, `rack_ilo_action`, `rack_job`) read the stored session
fresh; reads accept a verdict up to 10 s old. These packets run commands as root on the rack hosts.

## Answers

Each request is answered by `<type>_response` with the request's `requestId` and `data.success`. An expected refusal is
answered in the response, never as `error`: `{ success: false, refused: true, code, error }`. Codes: `NOT_DEPLOYED` (no token
file: rackd is not installed on that host), `TUNNEL_DOWN`, `ILO_DOWN`, `RACKD_ERROR` (rackd answered 4xx/5xx; `error` is its
message), `ILO_ERROR`, `UNKNOWN_SERVER`, `BAD_REQUEST`.

## Client to server

| Packet | Fields | `data` of the response |
| --- | --- | --- |
| `rack_list` | none | `servers: [{ name, label, model, ilo: { connected, power }, rackd: { state: 'up' \| 'down' \| 'not-deployed' \| 'connecting', error?, info? } }]` (`info` is rackd's `/v1/info`) |
| `rack_get` | `server`, `role` (`metrics` (GET only: the host load history, `params: { range, points }` -> cpu, mem, disk, net, load and counts of vms / avds / sandboxes / containers / replicas / builds / jobs; a host that is off answers `HOST_OFF`), `vms`, `android`, `sandboxes`, `terminal`, `storage`, `networking`, `services`, `logs`, `updates`, `containers`, `builds`, `info`, `jobs`), `params?` (query, e.g. logs filters) | `role`, `data` (rackd's state of the role) |
| `rack_action` | `server`, `role`, `action`, `params?` | `result` (rackd's answer) or `job` (`{ id, ... }` for long work) |
| `rack_ilo` | `server`, `what`: `servers` (this server's iLO service entry: `label`, `gen`, `driveLayout`, `sensorNames`, `driveTemp`, `connected`, `power`), `isos` (the ISO library `[{name, size, url}]`), `health`, `power`, `history`, `logs`, `memory`, `media`, `settings`, `users`; `params?` (`range`, `points`, `to`, `which`, `fresh`) | `data` |
| `rack_ilo_action` | `server`, `action`: `power` (`params.op`: `press`, `hold`, `reset`, `cold`), `powercap` (`watts`, 0 = off), `powersaver` (`mode` 1-4), `media` (`device`, `action`, `iso` or `url`, `bootOnce`), `users` (`params: { action: 'add' \| 'modify' \| 'delete', login, password?, name?, privs? }`; the password is never logged or audited; `dream_admin` cannot be added, changed or deleted) | `result` (for `users`: the iLO's user list) |
| `rack_subscribe` | `server` | `server`; the first subscriber of a server opens the SSE stream to rackd, the last unsubscribe (or socket close) closes it |
| `rack_unsubscribe` | `server` | `server` |
| `rack_job` | `server`, `id?`, `cancel?`, `tail?` | `job` (one job with its log tail; `cancel` cancels it) or `jobs` (no `id`) |
| `rack_power` | `server`, `action`: `status`, `on` (iLO power button), `off` (graceful shutdown through rackd); `reason?`, `force?`, `confirm?` | `{ state, since, post?: { stage, pct, eta, code }, bootSeconds?, postSeconds?, leases: [{ id, purpose, who, since, ends }], idle: { idle, idleSince, busy: [{ kind, id, why }] }, deadline, settings: { auto, idleShutdownMin, wakeOnDemand } }` (`ends` null for a console lease; `deadline`: ms time of the idle shutdown or null); `off` is refused `LEASES_OPEN` (with `leases`, `busy`) while work is open unless `force: true` |
| `rack_power_settings` | `server`, `settings`: `{ auto?, idleShutdownMin? (1-10080), wakeOnDemand? }` | `settings`, `power` (the new status brief); saved in `servers.json` |

`rack_get`, `rack_action` and `rack_job` accept `wake: true`: a host that is off is powered on and the call waits for it (at most 10 minutes). Without it a host that
is off is refused in the response: `{ success: false, refused: true, code: 'HOST_OFF', power: 'off' }` (`HOST_BOOTING` while it powers on or boots, `HOST_SHUTTING_DOWN`;
`wakeOnDemand: false` refuses the wake too). `rack_subscribe` takes a lease (purpose `console`) that keeps the host awake until `rack_unsubscribe` or the socket closes.
Power states: `unknown` (not reported yet), `off`, `powering-on`, `booting`, `up`, `shutting-down`; `rack_list` rows carry `power: { state, since, post? }`.

## Server to client (push, to the subscribed socket only)

| Packet | Data |
| --- | --- |
| `rack_event` | `{ server, role, kind, id?, data }`: rackd's events (`state`, `added`, `removed`, `job`, `log`, `metrics`); `role: 'rackd', kind: 'state'` reports the ssh tunnel (`data.state`); `role: 'power', kind: 'state'` reports the host power (`data: { state, since, post?: { stage, pct, eta, code } }`, `post` while `powering-on`, one push per new POST step); `role: 'ilo', kind: 'power'` (`data: { on, t }`) and `kind: 'health'` (`data: { colour: 'green' \| 'yellow' \| 'red', glance: { <part>: <status> } }`) are pushed by the iLO service when it sees a change (no polling) |

## HTTP and WebSocket upgrades (same guard; the upgrade also needs a same-origin request)

| Path | What |
| --- | --- |
| `GET /rack/:server/ilo/screenshot.png` | the iLO console framebuffer, streamed |
| `POST /rack/:server/ilo/iso-upload?name=<x.iso>` | an ISO (`.iso` / `.img`) for the iLO virtual media: the raw body is streamed to the iLO service's library; answers `{ ok, name }` |
| `GET /rack/:server/files/:kind/:name`, `/rack/:server/files/artifacts/:runId/:name` | rackd files (screenshots, exports, build artifacts), streamed, `Range` supported |
| `WS /rack/:server/ilo/ws` | the live iLO console (binary video rects, JSON input; protocol in `~/ilo-console/README.md`) |
| `WS /rack/:server/terminal/ws?cols&rows&cmd` | rackd's interactive pty; `cmd` (for example `tmux attach -t name`, under 500 characters) is passed through to rackd |

## Audit

Every write is appended to `.cache/rack-manager/audit.jsonl`: `{ t, who, via: 'ws' | 'fleet', server, role, action, params, ok, error? }`
(keys that look like passwords, tokens or secrets are dropped from `params`).

## rackd `metrics` events

`rack_event` with `role: 'rackd'`-side data is passed through unchanged. rackd's `metrics` data (every 10 s while subscribed) is
`{ cpu (percent), mem: { totalB, availB }, load: [1, 5, 15], net: { rxBps, txBps }, disk: { readBps, writeBps } }`.

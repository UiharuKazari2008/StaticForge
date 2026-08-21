# StaticForge Client API Documentation

Comprehensive reference for building **custom clients** (Android, Linux desktop, automation scripts) with feature parity against the web app at `/app`.

## Architecture overview

StaticForge is a monolithic Node/Express server (default port **9220**) with:

| Layer | Role |
|-------|------|
| **REST (HTTP)** | Authentication, static assets, image bytes, preset webhooks, admin log viewer, VFS file download, service-worker manifest |
| **WebSocket** | Primary API for generation, gallery, workspaces, presets, search, chat, admin, VFS, references |
| **Session cookies** | `connect.sid` (express-session) — required for authenticated REST and WS after login |
| **Optional Bearer token** | `config.loginKey` — bypasses PIN when sent as `Authorization: Bearer …` or `?auth=` |

The web client (`public/scripts/websocket.js` → `WebSocketClient`) speaks the same protocol documented here.

```
┌─────────────┐     POST / { action: login }      ┌──────────────┐
│   Client    │ ────────────────────────────────► │   Express    │
│             │ ◄── Set-Cookie: connect.sid ───── │   + Session  │
└─────────────┘                                   └──────┬───────┘
       │                                                 │
       │  ws://host:9220  (same cookie on upgrade)       │
       └────────────────────────────────────────────────►│
                    JSON { type, requestId, … }          │
```

## Quick start

1. **Check server readiness:** `OPTIONS /status` → `{ isReady, stage, … }`
2. **Authenticate:** `POST /` with `{ "action": "login", "data": { "pin": "……" } }` — store session cookie
3. **Validate session:** `OPTIONS /app` → `{ success, userType, vfsPathUuid, serverVersion }`
4. **Connect WebSocket:** `ws://<host>:9220/` (or `wss://`) — include session cookie on handshake
5. **Receive `connection` message** with `{ authenticated, userType, vfsPathUuid, … }`
6. **Send requests** with `{ type, requestId, …fields }` — correlate `{type}_response` by `requestId`

See [authentication.md](./authentication.md) and [websocket.md](./websocket.md) for details.

## User types

| `userType` | Login PIN | Capabilities |
|------------|-----------|--------------|
| `admin` | `config.loginPin` | Full access including destructive WS ops, admin REST/WS, log viewer UUID |
| `readonly` | `config.readOnlyPin` | Read + non-destructive ops; blocked from `isDestructiveOperation()` list |
| *(none)* | — | WS: critical messages only; REST: 401 on protected routes |

Read-only login can be disabled via `config.userPinLoginEnabled === false`.

## Documentation index

### Core

| Document | Contents |
|----------|----------|
| [authentication.md](./authentication.md) | Login, logout, sessions, cookies, Bearer token, PIN lockout, headers |
| [websocket.md](./websocket.md) | WS URL, handshake, protocol, server push events, reconnection, heartbeats |
| [rest-api.md](./rest-api.md) | Every HTTP route: methods, auth, inputs, responses, errors |
| [client-only-features.md](./client-only-features.md) | Web-only UI, localStorage, service worker, Android bridges |
| [feature-map.md](./feature-map.md) | UI feature → REST/WS matrix |
| [README-CHILD.md](../README-CHILD.md) | Child/ephemeral replication deployment (master pairing, bootstrap, daily ops) |

### WebSocket domains (285 request types)

| Domain | File | Packets |
|--------|------|---------|
| Generation | [ws/generation.md](./ws/generation.md) | 12 |
| Gallery | [ws/gallery.md](./ws/gallery.md) | 9 |
| Presets | [ws/presets.md](./ws/presets.md) | 11 |
| Workspaces | [ws/workspace.md](./ws/workspace.md) | 34 |
| Search & tags | [ws/search.md](./ws/search.md) | 12 |
| Grimoire / Wiki | [ws/wiki.md](./ws/wiki.md) | 7 |
| Chat | [ws/chat.md](./ws/chat.md) | 9 |
| Director | [ws/director.md](./ws/director.md) | 12 |
| Notes (+ novels) | [ws/notes.md](./ws/notes.md) | 14 |
| NAX | [ws/nax.md](./ws/nax.md) | 11 |
| Agora (NovelAI Explore) | [ws/explore.md](./ws/explore.md) | 3 |
| Text replacements | [ws/textReplacements.md](./ws/textReplacements.md) | 6 |
| Favorites | [ws/favorites.md](./ws/favorites.md) | 3 |
| Account & app bootstrap | [ws/account.md](./ws/account.md) | 2 |
| Generation quips | [ws/quips.md](./ws/quips.md) | 4 |
| Character database | [ws/characterDb.md](./ws/characterDb.md) | 5 |
| Knowledge / memories | [ws/knowledge.md](./ws/knowledge.md) | 7 |
| Persona | [ws/persona.md](./ws/persona.md) | 2 |
| User settings | [ws/userSettings.md](./ws/userSettings.md) | 2 |
| Config editor | [ws/configEditor.md](./ws/configEditor.md) | 3 |
| Cache & runtime | [ws/cache.md](./ws/cache.md) | 7 |
| Infrastructure | [ws/infrastructure.md](./ws/infrastructure.md) | 5 |
| Admin / security (+ application auth) | [ws/admin.md](./ws/admin.md) | 31 |
| VFS & desktop | [ws/vfs.md](./ws/vfs.md) | 27 |
| References & vibes | [ws/references.md](./ws/references.md) | 22 |
| **Replication** | [ws/replication.md](./ws/replication.md) | **12** |

## Related legacy docs

- [docs/websocket_android_guide.md](../websocket_android_guide.md) — older Android-focused subset (Kotlin examples); superseded by this tree for completeness
- [docs/ANDROID_BRIDGE.md](../ANDROID_BRIDGE.md) — WebView-only native bridges (not server API)

## Source of truth (when docs drift)

| Concern | Location |
|---------|----------|
| REST routes | `web_server.js` |
| Auth middleware | `modules/auth.js` |
| WS server | `modules/websocket.js` |
| WS packet handlers | `modules/ws/handlers/*.js`, `modules/vfsWebSocketHandlers.js`, `modules/referencesWebSocketHandlers.js` |
| WS registry | `modules/ws/wsPacketRegistry.js` |
| Client WS client | `public/scripts/websocket.js` |
| Replication routes | `modules/replication/routes/*.js`, `registerRoutes.js` |
| Critical (unauthenticated) WS | `modules/websocket.js` → `CRITICAL_MESSAGE_TYPES` |

## Maintenance

When adding client-facing endpoints, update this documentation tree. See `.cursor/rules/client-api-documentation.mdc`.

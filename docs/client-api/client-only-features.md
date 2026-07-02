# Client-Only Features

Features implemented in the web app (`public/`) that **do not** map 1:1 to a server endpoint, or that add behavior on top of server APIs.

Custom Android/Linux clients may omit these or reimplement selectively.

---

## UI & desktop chrome

| Feature | Location | Notes |
|---------|----------|-------|
| Modal system | `public/scripts/comp/modalUtils.js`, `confirmationDialog.js` | Keyboard registry, focus trap — no server |
| Desktop windowing | `public/scripts/comp/focusOverlayManager.js`, workspace window positions | Positions synced via WS `workspace_update_window_positions` |
| System tray / menu bar | `public/scripts/comp/systemTrayManager.js`, `mainMenuManager.js` | OS integration only on supported shells |
| Keyboard shortcuts | `public/scripts/comp/keyboardShortcuts.js`, `modalKeyboardRegistry.js` | Local binding |
| Connection dial / pre-startup auth UI | `public/scripts/websocket.js` | Desktop Melaton startup modal |
| Glass toasts / banners | `public/scripts/comp/toastManager.js`, `websocket.js` BannerManager | WS status UX |
| Lightbox / compare view | `public/scripts/comp/lightbox.js`, `compareViewManager.js` | Uses `/images/` REST for bytes |
| Context menus | `public/scripts/comp/contextMenu.js` | Invokes WS APIs from menu actions |
| Custom dropdowns | `public/scripts/comp/dropdown.js` | Pure UI — see `.cursor/rules/dropdown-setup.mdc` |

---

## localStorage & session persistence

| Key | Set by | Purpose |
|-----|--------|---------|
| `userType` | Login, OPTIONS /app | Admin vs readonly UI gating |
| `logViewerPathUuid` | Admin login | Log viewer REST base path |
| `vfsPathUuid` | Login | VFS REST base path |
| `userData` | Login (optional) | Extra user payload if server sends |
| `loginTimestamp` | Login | Client-side session age display |
| Various applet prefs | DSAP applets, settings modals | Client-only UI prefs in `localStorage` (not synced to server unless a WS packet exists). Examples: `explorerSortField`, `explorerViewMode`, `chat-show-metadata`, `galleryWindowMode`, `focusCoverEnabled`, `virtualKeyboardEnabled`, `generationCelebrationEffect`, `weather_units_metric`, `useFahrenheit`. Auth keys synced via `syncAuthLocalStorageFromServer()` — see table above. |

Web app does **not** store PIN in localStorage.

Sync helper: `syncAuthLocalStorageFromServer()` in `public/scripts/comp/connectionManager.js`

---

## Service worker & offline cache

| Component | File | Server interaction |
|-----------|------|-------------------|
| Service worker | `public/sw.js` | `OPTIONS /` manifest hash compare |
| SW manager | `public/scripts/comp/serviceWorkerManager.js` | POST `/` ping, fetch `/sw.js`, WS push `service_worker_cache_update` |
| Runtime assets | Server `.cache/runtime-assets/` | Transparent `/css/`, `/scripts/` optimization |

Custom native clients typically **skip** service worker entirely; use direct HTTP for static assets.

After server-side client edits, web deploy runs `scripts/notify-service-worker-update.sh`.

---

## Android WebView bridges (not server API)

Documented in [docs/ANDROID_BRIDGE.md](../ANDROID_BRIDGE.md):

| Global | Purpose |
|--------|---------|
| `AndroidCaption` | Window insets / drag |
| `AndroidNotification` | Heads-up notifications |
| `AndroidPersistentNotification` | Foreground service notification |
| `AndroidBlobSave` | Save blob URLs to storage |
| `AndroidBackgroundRefresh` | Poll `GET /android/background-notification` |

Only relevant when embedding the PWA in DreamScape Android WebView.

---

## Grimoire / DSAP pseudo-browser

| Component | Role |
|-----------|------|
| `dsapRegistry.js` | Pseudo-URL routing (`edtx://`, `en.grimoire.jp`, …) |
| `grimoireCoreDomains.js` | Built-in wiki/search/home routes |
| `*DsapApplet.js` | Lazy-loaded mini-apps |

Server-backed pieces use WS (`search_tag_wiki`, `resolve_grimoire_url`, etc.) but **routing, history, panes, standalone windows** are client-only.

---

## Generation UI orchestration

| Layer | File | Server |
|-------|------|--------|
| Manual modal state | `manualModalManager.js`, `manualPreviewManager.js` | Calls WS `generate_image` |
| Generation orchestrator | `generationOrchestrator.js` | Sequences WS calls client-side |
| Dynamic generation UI | `dynamicGenerationManager.js`, carousel | WS `compile_dynamic_generation`, progress pushes |
| Credit cost dialog | `creditCostDialog.js` | Computes cost locally via `calculateUpscaleInfo()` in `utilities.js` using image dimensions + `window.optionsData.user.subscription` (Opus free tier). Does **not** fetch balance over WS/REST at dialog open; subscription data comes from server options loaded at init. |
| Streaming step previews | `websocket.js` streaming session | Interprets `image_generation_progress` |

---

## Gallery client logic

| Behavior | Implementation |
|----------|----------------|
| Virtual scrolling / PhotoSwipe | `galleryView.js` |
| Incremental `gallery_updated` handling | `ws/handlers/20-galleryInbound.js` |
| Bulk selection UI | `bulkOperationsManager.js`, `galleryActions.js` |
| Toolbar download | `galleryToolbar.js` — `fetch(/images/...)` |

Server sends data via `request_gallery`; client decides render strategy.

---

## Search UI debouncing

`fileSearch.js`, `autocompleteUtils.js` debounce and cache WS `search_files` / `search_tags` results locally.

---

## Novel manager UI

`novelManager.js` — combines WS novel packets with local UI state. **All novel CRUD/generation is WS-only** — handlers in `modules/websocketHandlers.js` (`novel_list`, `novel_get`, `novel_update`, `novel_generate`, `novel_undo`, `novel_resolve_image`); registered via `modules/grimoireDomainRegistry.js`. No dedicated REST routes. Mutations use the notes database under the hood; pushes: `novel_progress`, `novel_updated`, `novel_generate_complete`.

---

## Traces viewer

`public/traces.js` — REST `/traces/*` only; UI is web-only.

---

## Pin modal vs login page

Two login UX paths:

- `public/scripts/login.js` — standalone `/` page
- `public/scripts/comp/pinModal.js` — in-app re-auth on WS `auth_error`

Both POST same `/` login action.

---

## Developer / debug surfaces

| Feature | Access |
|---------|--------|
| Event viewer / log applet | Admin REST `/{logViewerPathUuid}/*` + WS |
| Flow maps | `docs/flow-maps/` — dev tooling |
| Traces | REST `/traces` |
| Config editor applet | WS `config_editor_*` |

---

## What custom clients must implement for parity

**Required:**

1. Session auth (cookie or Bearer)
2. WebSocket client with full protocol
3. Image display via `/images/:filename` or WS base64 responses
4. Workspace + gallery state machines
5. Generation flow + progress handling

**Optional (web parity niceties):**

- Service worker caching
- Desktop shortcuts / VFS explorer UI
- DSAP Grimoire browser
- Android bridges
- Modal/keyboard infrastructure

---

## State not stored on server

| State | Where |
|-------|-------|
| Selected gallery items | Client memory |
| Modal open/closed | Client |
| Autocomplete recent queries | Client / localStorage |
| Unsaved manual modal edits | Client until generate/save preset |
| PhotoSwipe zoom position | Client |

Persist via WS when server has an equivalent (`gallery_position_hint`, `workspace_update_window_positions`, preset save, etc.).

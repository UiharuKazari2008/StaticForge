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
| `galleryShowSharedRemote` | Gallery context menu (`#galleryToggleGroup`), `assetUrlResolver.js` | `'1'` / `'0'` — session override for shared remote gallery when `replication.gallerySharedDefault` is `manual` |

Web app does **not** store PIN in localStorage.

Sync helper: `syncAuthLocalStorageFromServer()` in `public/scripts/comp/connectionManager.js`

---

## Service worker & offline cache

| Component | File | Server interaction |
|-----------|------|-------------------|
| Service worker | `public/sw.js` | `OPTIONS /` manifest hash compare |
| SW manager | `public/scripts/comp/serviceWorkerManager.js` | POST `/` ping, fetch `/sw.js`, WS push `service_worker_cache_update` |
| Runtime assets | Server `.cache/runtime-assets/` | Transparent `/css/`, `/scripts/` optimization |
| Browser-agent mode | `/app?agent=1` | Skips worker registration and cache updates, clears Cache Storage after old-worker cleanup, forces desktop/windowed boot. `/agent` preloads app-shell CSS/JS into a 120s private HTTP cache for `dev_admin` sessions; optional `GET /agent/assets.zip`. Loopback `POST /agent/broadcast` shows a toast or confirmation dialog on all connected clients. Localhost `/agent/clients` + `/agent/bind` + `/agent/session/*` drive one bound Studio tab (Ivory/Menma: loopback + Bearer, not the PIN pad). `GET /agent/scopes` and `POST /agent/packet` honor named app-key scopes (`generation`, `vfs`, `autofill`) without a bind. `POST /agent/session/update` shows the mandatory 15s Client Update dialog on the bound tab, then applies client updates and restarts that tab. |

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
| Menma progress | Windowed DSAP at `menma.dyna.dreamscape.jp` (`menmaDsapApplet.js`). Open from Control Panel (`dsap://dreamscape.jp/`), not the Start menu. Loads via WS `get_menma_state`; Open in Studio on breakfast thumbs. |
| Wiki Manager DSAP (`fandomWikiManagerDsapApplet.js`, `dsap://wiki.dyna.dreamscape.jp`) | Lists cached Fandom / NovelAI / MediaWiki / static wikis; import, pull/update, delete. Talks WS `get_fandom_wiki_manager`, `import_fandom_wiki_page` (Fandom + generic MediaWiki `/api.php`), `import_static_wiki`, `update_wiki_import`, `delete_fandom_wiki_import`. Open uses `rdf://wiki.fandom.jp/…`, `docs.novelai.jp`, or `edtx://en.grimoire.jp/docs/<siteId>`. |
| Zanzou DSAP (`similarImageDsapApplet.js`, `dsap://zanzou.dyna.dreamscape.jp`, aliases `similar` / `review`) | Control Panel only (`startMenu: false`). Afterimage / near-dupe review. Keep parks a group in localStorage `similarImageReviewedGroups` (no delete); Scrap selected / scrap-all-but-one calls WS `scrap_similar_images`. Open in Studio uses `openManualModalWithContent`. |

Server-backed pieces use WS (`search_tag_wiki`, `resolve_grimoire_url`, etc.) but **routing, history, panes, standalone windows** are client-only.

---

## Generation UI orchestration

| Layer | File | Server |
|-------|------|--------|
| Manual modal state | `manualModalManager.js`, `manualPreviewManager.js` | Calls WS `generate_image` |
| Generation orchestrator | `generationOrchestrator.js` | Sequences WS calls client-side |
| Dynamic generation UI | `dynamicGenerationManager.js`, carousel | WS `compile_dynamic_generation`, progress pushes |
| Credit cost dialog | `creditCostDialog.js` | Computes cost locally via `calculateUpscaleInfo()` in `utilities.js` using image dimensions + `window.optionsData.user.subscription` (Opus free tier). Does **not** fetch balance over WS/REST at dialog open; subscription data comes from server options loaded at init. |
| Streaming step previews | `websocket.js` streaming session | Interprets `image_generation_progress`; `stage_complete` swaps the editor preview to that stage's result without ending the run |
| Staged results review | `stageResultsReview.js` | Opens a Studio tool window at staged-generate start with one gallery tile per expected saved stage; fills from `stage_complete` / `complete` / response `filenames[]`; click opens Lumen |
| Studio change JSON | `studioChangeJson.js` (+ desktop shortcut type `studio-change`, prompt context menu, clipboard paste) | Client-only compact studio delta (`v:1`, `dreamscape:"change"`): export/copy/paste/apply params, prompt/UC chunks, characters (optional per-slot `position` `{x,y}`/`cell`), request expanders, optional vibe ids. Contract: `docs/studio-change-json.md`. Helpers: `window.applyStudioChangePayload`, `window.tryApplyStudioChangeJsonFromText`, `window.openStudioChangeExportDialog`, `window.buildStudioChangeSnapshot`, `window.STUDIO_CHANGE_AI_SPEC`. Loopback `/agent/session/studio` awaits `applyStudioChangePayload` on the bound tab when `autoApply` is true (default). After a successful apply, `autoGenerate` (default false) clicks `#manualGenerateBtn` (existing Studio Generate path). Flags are siblings of `change`, not Change-JSON fields. `GET /agent/session/state` returns that snapshot as `change` (empty Studio is valid; no image required; character `position` echoed when stored). |

---

## Gallery client logic

| Behavior | Implementation |
|----------|----------------|
| Virtual scrolling / PhotoSwipe | `galleryView.js` |
| Incremental `gallery_updated` handling | `ws/handlers/20-galleryInbound.js` |
| Bulk selection UI | `bulkOperationsManager.js`, `galleryActions.js` |
| Toolbar download | `galleryToolbar.js` — `fetch(/images/...)` |

Server sends data via `request_gallery`; client decides render strategy.

### Replication gallery & delegation (client-only orchestration)

| Component | File | Server interaction |
|-----------|------|-------------------|
| Asset URL resolver | `public/scripts/comp/assetUrlResolver.js` | Builds local `/images/` or remote `{masterAccessUrl}/replication/assets/...` URLs; sends `galleryShowSharedRemote` on `request_gallery` |
| Master WS bridge | `public/scripts/comp/masterWsBridge.js` | `GET /replication/delegation/bridge-config`; secondary WS to master via `authenticate_replication`; wraps delegated wiki/autocomplete packets |
| Gallery connectivity banner | `public/scripts/comp/replicationGalleryBanner.js` | Renders `replicationWarning` from gallery response when master unreachable |
| Shared gallery toggle | `mainMenuManager.js` → `#galleryToggleGroup` context menu | Cloud icon; calls `setGalleryShowSharedRemote()`; hidden when `connectivity === 'airgapped'` or no `masterAccessUrl` |
| Replication DSAP panels | `dataManagementDsapApplet.js`, `replicationDsapSeparation.js`, `replicationDsapCargo.js`, `replicationDsapSync.js` | REST `/replication/*` + WS replication packets |
| Maintenance/progress ticker | `public/scripts/ws/handlers/130-replicationInbound.js` | Handles `replication_maintenance`, `replication_progress` pushes |

Operational guide: [README-CHILD.md](../../README-CHILD.md).

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

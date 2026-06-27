# Modal Event Listener Refactor Plan

Phase 0–1 deliverable. Builds on the prior audit; verified against code in `public/scripts` and `public/app.html` (June 2026).

## Goals

1. Stop modal-related document/window listeners from living forever when modals close.
2. Provide a shared attach/detach contract (`modal._listenerScope` + `AbortController`).
3. Migrate incrementally — no big-bang — via six parallel worker workstreams after core plumbing lands.

---

## Phase 0–1 Status (implemented)

| Item | Location | Status |
|------|----------|--------|
| Core scope API | `public/scripts/comp/modalListenerScope.js` | **Done** |
| `openModal` / `closeMainModal` hooks | `public/scripts/comp/modalUtils.js` | **Done** |
| `_modalClickHandler` → `{ signal }` | `openModal` mousedown handler | **Done** (legacy cleanup kept) |
| Confirmation dialog keydown | `public/scripts/comp/confirmationDialog.js` | **Done** |
| Script load order | `public/app.html` after `modalUtils.js` | **Done** |
| Keyboard registry | `public/scripts/comp/modalKeyboardRegistry.js` | **Done** (Worker 1) |

### Core API

```javascript
attachModalListeners(modal, fn)   // fn(AbortSignal) — registered once, invoked each open
detachModalListeners(modal, { clearCallbacks })  // abort active scope; optional clear registry
getModalListenerSignal(modal)     // current signal while open, else null
onModalOpened(modal)              // called from openModal — creates AbortController
onModalClosed(modal)              // called from closeMainModal cleanup — aborts scope
```

Dev logging: `console.debug('[modalListeners]', …)` when `localStorage.staticforge_dev_mode === 'true'`.

---

## Listener inventory (document / window)

Counts from ripgrep across `public/scripts/**/*.js` (excluding examples). **83** root `.modal` elements in `app.html`; **~124** synchronous script tags.

### Tier A — P0: Permanent globals in `modalUtils.js` (never detached)

| Listener | Target | Purpose | Refactor |
|----------|--------|---------|----------|
| `focus` | `window` | Focus grace period for active window | Keep global; not per-modal |
| `visibilitychange` | `document` | Tab visibility → focus grace | Keep global |
| `mousedown/mousemove/mouseup` | `document` | Drag + resize (`initializeModalDragging`) | Keep global; handlers gate on `data-dragging` / `data-resizing` |
| `touchstart/touchmove/touchend` | `document` | Touch drag/resize | Keep global |
| `click` (×2) | `document` | Minimize button; desktop empty-space click | Keep global |
| `click` | `document` | Start menu outside close (transient) | Migrate to start-menu scope or `{ once }` pattern |
| `contextMenuAction` | `document` | Taskbar context menu actions | Keep global (desktop chrome) |
| `click` | `document` | Start menu row / shutdown | Init-time only on `#startMenu` subtree |
| `resize` (×2) | `window` | Gallery window mode; desktop viewport position sync | Gallery-specific → gallery scope in Worker 1 |
| `DOMContentLoaded` | `document` | Bootstrap dragging, taskbar, start menu | Init once |

### Tier B — P0: `openModal` / `closeMainModal` lifecycle

| Listener | Target | Before | After Phase 0–1 |
|----------|--------|--------|-----------------|
| `mousedown` click-to-front | modal element | Manual `_modalClickHandler` remove | `{ signal }` via `onModalOpened` + legacy remove |
| Per-manager attach fns | document/window | N/A | `attachModalListeners` registry (Worker 2+) |

### Tier C — P1: Transient dialogs (good show/hide pattern, partial scope)

| File | Listeners | Notes |
|------|-----------|-------|
| `confirmationDialog.js` | `keydown` on document | **Migrated** to `attachModalListeners` + `{ signal }` |
| `creditCostDialog.js` | `keydown` add on show, remove on hide | Migrate same pattern as confirmation |
| `pinModal.js` | `keydown` on document, init-time, never removed | Scope to `#pinModal` open/close |
| `logViewerApplet.js` | `click` outside glass popover (injected) | Wire via dialog `setTimeout(0)` + scope |
| `serverManagement.js` | Injected dialog dropdown wiring | Use `attachModalListeners` in dialog open path |
| `quipsDsapApplet.js` | Injected settings dropdowns | Same as logViewer pattern |

### Tier D — P1: High-waste document `keydown` (always on, modal-gated in handler)

| File | Modal(s) | Issue |
|------|----------|-------|
| `spellbookModal.js` | `#spellbookModal` | `keydown` Escape registered in constructor, never removed |
| `pinModal.js` | `#pinModal` | Same |
| `keyboardShortcuts.js` | Global + modal checks | Central keyboard router candidate (Worker 1) |
| `datasetTagToolbar.js` | Toolbar overlay | Capture-phase `keydown`; add/remove on toolbar open |
| `compareViewManager.js` | Compare view | Document keydown |
| `focusOverlayManager.js` | Manual focus overlay | keydown + window focus/blur/scroll |
| `lightbox.js` | PhotoSwipe shell | keydown capture on open |

### Tier E — P2: Modal managers with init-time wiring (`registerInitStep`)

**37** files call `registerInitStep`. Modal-adjacent steps use integer priorities **460–487** (June 2026 renumber; see table below).

| Step | File | Wiring |
|------|------|--------|
| 470 | `manualModalManager.js` | Preview toolbar + chrome → `attachModalListeners(#manualModal)` |
| 471 | `manualPreviewManager.js` | Init placeholder (toolbar in step 470) |
| 472 | `characterPromptManager.js` | Position dialog + auto-position → scoped listeners |
| 473 | `manualTabManager.js` | Tab + document `focusin` → `#manualModal` scope |
| 474 | `manualGenerationParams.js` | Form control listeners → `#manualModal` scope |
| 475 | `pipelineStageControls.js` | Global toggles + drag `document` mouse → `#manualModal` scope |
| 476 | `metadataDialogManager.js` | `#metadataDialog` scoped listeners |
| 477 | `randomPromptManager.js` | Random prompt UI → `#manualModal` scope |
| 478 | `directorLearningAdmin.js` | `#directorFeedbackModal` / `#directorRulesModal` scope |
| 479 | `developerModal.js` | Modal open refresh; `devBridge*` stays on `window` |
| 480 | `websocketRequestsModal.js` | Auto-update + close btn → modal scope |
| 485 | `apiKeyModal.js` | API key modal DOM listeners (Worker 4) |
| 486 | `manualDropdownManager.js` | Resolution/dropdown listeners (Worker 4) |
| 487 | `autocompleteUtils.js` | document click ×2 for autocomplete hide (Worker 4) |
| 460 | `requestBodyReplacementsModal.js` | Main + create modals scoped |
| 461 | `presetManager.js` | Preset manager |
| 462 | `compileToPromptsApplet.js` | Compile applet |
| 38–39 | `imageBias.js`, `inpaint.js` | Tool modals — document mouse listeners |
| 36–37 | `lightbox.js`, `promptTextareaToolbar.js` | Gallery/lightbox tooling |

Many wire **once at boot** and register `attachModalListeners` callbacks; listeners attach on first `openModal` and abort on close.

#### Init step renumber map (old → new)

| Old priority | New priority | File |
|--------------|--------------|------|
| 46 | 460 | `requestBodyReplacementsModal.js` |
| 47 | 470 | `manualModalManager.js` |
| 47.05 | 471 | `manualPreviewManager.js` |
| 47.1 | 472 | `characterPromptManager.js` |
| 47.2 | 473 | `manualTabManager.js` |
| 47.4 | 474 | `manualGenerationParams.js` |
| 47.45 | 475 | `pipelineStageControls.js` |
| 47.5 | 485 | `apiKeyModal.js` *(duplicate resolved)* |
| 47.5 | 486 | `manualDropdownManager.js` *(duplicate resolved)* |
| 47.55 | 487 | `autocompleteUtils.js` |
| 47.6 | 476 | `metadataDialogManager.js` |
| 47.7 | 477 | `randomPromptManager.js` |
| 47.8 | 478 | `directorLearningAdmin.js` |
| 46 | 461 | `presetManager.js` |
| 46 | 462 | `compileToPromptsApplet.js` |
| — | 479 | `developerModal.js` *(new WS init step)* |
| — | 480 | `websocketRequestsModal.js` *(new WS init step)* |

*Follow-up 1 (June 2026): `presetManager.js` and `compileToPromptsApplet.js` renumbered from shared priority 46 → 461 / 462.*

### Follow-ups 1–3 status (June 2026)

| Follow-up | Scope | Status |
|-----------|--------|--------|
| **1** | Renumber init steps 46 → 461/462 (`presetManager.js`, `compileToPromptsApplet.js`) | **Done** |
| **2** | `creditCostDialog.js` + `datasetTagToolbar.js` → `whenOpen` via `openModal`/`closeModal` + `modalStack` | **Done** |
| **3** | `galleryView.js` batch-selection keydown → `registerKeyboardListener` `whenFocused` `#galleryWindow` | **Done** |
| **4** | Lazy JS loading | **Not started** (deferred) |

**Follow-up 2 details:** Both overlays now use `openModal` + `assignModalZIndex` on show and `closeModal` on hide (transient `tool-window on-top`). Keyboard handlers registered once with `type: 'whenOpen'` (transient on-top) or `type: 'whenFocused'` (standard modals) and `modalId` matching element id (`creditCostDialog`, `datasetTagToolbar`).

**Follow-up 3 details:** `onGalleryBatchSelectionKeydown` moved from `attachModalListeners` document capture listener to `registerKeyboardListener({ id: 'galleryWindow.batchSelectionKeydown', type: 'whenFocused', modalId: 'galleryWindow', priority: 55 })`. Gallery scroll/nav keydown remains on `attachModalListeners` signal scope.

### Listener scope types (`global` / `whenOpen` / `whenFocused`)

| Type | Dispatch (handler fires) | Alt overlay (shows entry) |
|------|--------------------------|---------------------------|
| **`global`** | Always | Always |
| **`whenOpen`** | Modal is **open** on stack (visible, not `hidden` / `hidden-alt`) — does **not** require focus | Only when that modal is the **active/focused** window |
| **`whenFocused`** | Modal is **open** and is the **active window** capturing input (`isModalActive(modal)` / `currentActiveWindowId`) | Only when that modal is the **active/focused** window |

**`whenOpen`** — shortcuts that should apply while the applet/modal is open even if another window has focus (rare). Example: compare-view Alt/Shift peek on `#manualModal` while focus is elsewhere.

**`whenFocused`** — default for modal-specific actions (F-keys, Esc close, Enter save, gallery nav, mask tools, tag wiki, etc.) that only make sense when that window is the active input target.

Implementation: `isKeyboardListenerActive(entry, { forOverlay: true })` in `modalKeyboardRegistry.js` applies the overlay column rules; dispatch omits `forOverlay`.

Transient on-top dialogs (`confirmationDialog`, `creditCostDialog`, `pinModal`) use **`whenOpen`** — they are blocking overlays that should respond while on stack.

### Alt overlay API (June 2026)

Universal **Alt-held shortcut overlay** is driven by keyboard registry metadata — not hardcoded profile tables in `keyboardShortcuts.js`.

**Registration fields** (optional on `registerKeyboardListener`):

| Field | Purpose |
|-------|---------|
| `label` | Human-readable action name shown in overlay |
| `keys` | Display string, e.g. `Alt+S`, `F5`, `Ctrl+Enter` |
| `showInOverlay` | Opt out with `false`; default **true** when both `label` and `keys` are set, otherwise **false** |
| `overlayGroup` | Optional group label; inserts dividers in wide list; use `classic-left` / `classic-right` for two-column classic layout |
| `overlayIcon` | Optional icon class for overlay row |
| `overlayAlt` | Style as Alt-variant row (`.shortcut-item.alt`) |
| `overlayFnRow` | `'primary'` or `'alt'` — render on FN-key row instead of list (set via `overlayOnly` registrations in `keyboardShortcuts.js`) |
| `overlayOnly` | Display-only entry (no-op handler, skipped by dispatch) |

**Listing:** `getActiveKeyboardOverlayEntries()` returns entries active for overlay display: **`global` always**; **`whenOpen` and `whenFocused` only when that modal is the focused/active window** (via `isKeyboardListenerActive(entry, { forOverlay: true })`). Dispatch uses separate rules — `whenOpen` handlers fire for any open modal on stack. Priority/critical affect dispatch only — overlay lists all active overlay entries with `showInOverlay !== false`.

**UI:** Hold **Alt** to show overlay; release to hide. Context changes while Alt is held refresh via `setKeyboardOverlayRefreshCallback` (wired from `keyboardShortcuts.js` on modal open/close). Second key in an Alt combo suppresses overlay until all Alt keys release.

**Example:**

```javascript
registerKeyboardListener({
    id: 'spellbookModal.escape',
    handler: escapeHandler,
    type: 'whenFocused',
    modalId: 'spellbookGenerationModal',
    label: 'Close',
    keys: 'Esc',
    overlayIcon: 'fas fa-times',
    overlayGroup: 'Spellbook'
});

registerKeyboardListener({
    id: 'overlay.confirmation.digits',
    type: 'whenOpen',
    modalId: 'confirmationDialog',
    label: 'Choose option',
    keys: '1–9',
    overlayGroup: 'Dialog',
    overlayOnly: true,
    priority: -10
});
```

### Tier F — P2: Dropdown / outside-click pattern (shared with modals)

| File | Pattern |
|------|---------|
| `dropdown.js` | `document.click` per open dropdown (`container._dropdownOutsideClick`) |
| `referenceManager.js` | IE dropdown outside click |
| `imageBias.js` | document click |
| `autocompleteUtils.js` | document click (×2) |
| `popoverManager.js` | document click per popover |
| `contextMenu.js` | Heavy document/window set (mousedown, click, touch*, keydown, resize, blur) |
| `director.js` | click outside preview panels |

Dropdown outside-click should eventually use `{ signal }` tied to dropdown open state; modal refactor can share `getModalListenerSignal(modal)` when dropdown lives inside a modal.

### Tier G — P3: Desktop chrome / non-modal but modal-adjacent

| File | Notes |
|------|-------|
| `desktopShortcuts.js` | keydown for icon selection |
| `systemTrayManager.js` | touchstart/focus for tray |
| `galleryView.js` | keydown batch selection (capture) |
| `virtualKeyboard.js` | focusin/focusout + resize |
| `windowControlsOverlay.js` | WCO events |
| `exitConfirmation.js` | document click |
| `workspaceUtils.js` | Mixed workspace modal wiring |

### Tier H — P3: Applet / dynamic DOM modals

| File | Modal ID | Notes |
|------|----------|-------|
| `tagWikiSearchModal.js` | `#tagWikiSearchModal` | Split pane: window resize + document mousedown; partial teardown in `unwireSplitListeners` |
| `developerModal.js` | `#developerModal` | devBridge window events — permanent |
| `websocketRequestsModal.js` | WS debug modal | Init at parse |
| `bracketGenerationApplet.js` | `#bracketGenerationModal` | mouseup during drag |
| `naxtApplet.js`, `configEditorApplet.js`, etc. | Various | Lazy fallback via `openModal(getElementById(...))` |

---

## Refactor priority matrix

| Priority | Scope | Rationale |
|----------|-------|-----------|
| **P0** | Core scope + open/close hooks + keyboard router design | Blocks all workers |
| **P1** | Always-on document keydown (spellbook, pin, tag wiki split, credit cost) | Highest leak/waste |
| **P1** | Transient dialogs + injected wiring | Low risk, high pattern value |
| **P2** | WS-init modal managers (manual cluster, request body, api key) | Large surface, boot coupling |
| **P2** | Dropdown-heavy modals (desktop settings in modalUtils, reference, autocomplete) | Shared dropdown pattern |
| **P3** | Desktop chrome, gallery, context menu, remaining applets | Global by design or lower frequency |

---

## Shared interface vs custom handling

### Use `attachModalListeners(modal, fn)` (standard)

- Any modal using `openModal` / `closeModal` / `closeMainModal`.
- Tool windows with `data-parent-modal-id`.
- Transient on-top dialogs (`confirmationDialog`, `creditCostDialog`).
- `#pinModal`, `#spellbookModal`, `#tagWikiSearchModal`, `#apiKeyModal`, `#metadataDialog`, `#requestBodyReplacementsModal`, `#websocketRequestsModal`, `#developerModal` (bridge listeners stay on window; modal UI listeners scoped).
- Injected confirmation/input dialog content wired in `setTimeout(0)` after `showConfirmationDialog`.

### Custom handling required

| Case | Reason | Approach |
|------|--------|----------|
| Drag/resize (`initializeModalDragging`) | Single delegated handler for all modals | Keep global; already gated by modal attributes |
| `keyboardShortcuts.js` | App-wide shortcut layer | Central router dispatches to top modal; don't duplicate per modal |
| `contextMenu.js` | Overlay system orthogonal to modals | Separate scope object (`contextMenu._listenerScope`) — same AbortController pattern |
| `dropdown.js` outside click | Per-dropdown, not per-modal | Option: pass `signal` from parent modal when dropdown opens inside modal |
| Gallery batch keydown (`galleryView.js`) | Gallery window, not generic modal | Scope to gallery open state via `attachModalListeners(galleryWindow, …)` |
| `virtualKeyboard.js` | Transient tool, special focus contract | Scope to `#virtualKeyboard` open/close |
| `devBridge*` window events | Developer modal lifecycle ≠ modal visibility | Keep on `window`; only wire modal DOM via scope |
| PhotoSwipe / Lumen (`imageViewer.js`) | Custom open path skips parts of `openModal` | Call `onModalOpened`/`onModalClosed` explicitly from imageViewer lifecycle |
| Startup/connection modals | Shown before WS init completes | Use scope; listeners still work pre-init |

---

## Dynamic JS loading analysis

### How scripts load today

1. **Early head**: `fatalErrorBootstrap.js`, utils (`deviceUtils`, etc.).
2. **Body end (~124 tags)**: Synchronous `<script src>` block starting at `toastManager.js` → `modalUtils.js` → **`modalListenerScope.js`** → `websocket.js` → … → `app.js` / `appInitSteps.js`.
3. All modal HTML is inline in `app.html` (~83 root modals).
4. **No dynamic `import()` or script injection** for modal managers today.

### How WS init plumbing works

- `websocket.js` defines `WebSocketClient.registerInitStep(priority, message, fn, runOnReconnect, options)`.
- Steps sorted by priority; executed after WS connect during boot splash (`executeInitSteps`).
- `appInitSteps.js` registers steps 0.44–100 (settings, gallery, UI wiring, finalize).
- Modal managers register at priorities **36–47.8** and **84–88** — listeners attach **after connect**, not at parse time, but still **never detach** on modal close.
- `nonBlocking: true` (e.g. desktop gallery load) allows boot to proceed without awaiting.

### Feasibility of lazy-loading modal JS

| Aspect | Assessment |
|--------|------------|
| **Pros** | Smaller initial parse; load spellbook/tag wiki/director only when launched; aligns with init-step philosophy |
| **Cons** | Monolith assumes globals (`openModal`, `wsClient`, dropdown helpers); 124 script order dependencies; many cross-refs (`window.spellbookModalManager`, presetManager → spellbook); HTML already ships all modals |
| **Breaking changes** | Start menu / run command / context menu actions reference managers at click time; would need dynamic loader + readiness promise; SW cache manifest per chunk |
| **app.html changes** | Remove script tags for lazy bundles; add `loadModalScript('spellbook')` helper; keep `modalUtils` + `modalListenerScope` + `websocket` in core bundle |
| **HTML lazy load** | Modals could stay in DOM (current) or fetch partials — partials are a larger change |

### Recommendation

**Phase now: listener scope (done in 0–1). Phase later: lazy script loading.**

1. Complete listener scope migration first — modals can detach correctly regardless of when JS loaded.
2. Defer full lazy-load until a **`loadScriptOnce(url)`** helper exists (mirror SW asset URLs + cache buster) and start menu / `runCommandIndex` use async open:

   ```javascript
   await loadScriptOnce('/scripts/comp/spellbookModal.js');
   spellbookModalManager.openModal();
   ```

3. First lazy-load candidates (low coupling): `configEditorApplet.js`, `naxtApplet.js`, `bracketGenerationApplet.js`, `directorLearningAdmin.js` — already have `getElementById` + `openModal` fallbacks in start menu.
4. **Do not** lazy-load `modalUtils.js`, `modalListenerScope.js`, `confirmationDialog.js`, `dropdown.js`, or manual-modal cluster (47.x) in v1 — too many hard dependencies.
5. WS init steps remain the right place to **wire listeners**; optional future: split "register DOM listeners" into `attachModalListeners` on first open instead of init step.

---

## Worker workstreams (6 parallel tasks)

**Prerequisite for all workers:** Phase 0–1 core (`modalListenerScope.js` + `openModal`/`closeMainModal` hooks) merged.

---

### Worker 1: Core modalUtils globals + keyboard router

**Name:** `modal-listeners-w1-core-globals`

**Status:** **Done** (June 2026)

**Files:**
- `public/scripts/comp/modalListenerScope.js` (extend if needed)
- `public/scripts/comp/modalUtils.js`
- `public/scripts/comp/keyboardShortcuts.js`
- `public/scripts/comp/modalKeyboardRegistry.js` (**new**)
- `public/scripts/comp/systemTrayManager.js` (tray icon boot list)
- `public/css/desktop-shell.css` (dev-warnings tray styles)
- `public/app.html` (script load order)

**Changes:**
- Document Tier A globals in code comments (which stay permanent).
- Migrate gallery `window.resize` listeners to `attachModalListeners(galleryWindow, …)`.
- Migrate start-menu transient `document.click` closeHandler to AbortController scoped to `#startMenu.open`.
- Design **keyboard router**: single capture-phase `document.keydown` that consults `modalStack` / `getTopModal()` and delegates Escape/Enter to active modal; deprecate duplicate Escape handlers incrementally.
- Export helper `getTopOpenModal()` if not already sufficient via `modalStack`.

**Implemented (Worker 1):**

| Item | Location | Notes |
|------|----------|-------|
| Keyboard registry API | `modalKeyboardRegistry.js` | `registerKeyboardListener`, `deregisterKeyboardListener`, types `global` / `whenOpen` / `whenFocused`, priority + `critical` blocking |
| Central capture handler | `modalKeyboardRegistry.js` | Single `document` keydown/keyup (capture); routes active listeners by priority |
| Dev warnings tray | `modalKeyboardRegistry.js` + `desktop-shell.css` | `#devWarningsTrayIcon` — no dialog; click opens popover listing warnings |
| Direct-listener patch | `modalKeyboardRegistry.js` | Patches `document.addEventListener` for keydown/keyup; records warnings for non-registry listeners |
| Unhandled keydown detection | `modalKeyboardRegistry.js` | Debounced warnings when no registered handler consumes meaningful keydown |
| Modal open/close hooks | `modalListenerScope.js` | Calls `onModalKeyboardModalOpened` / `onModalKeyboardModalClosed` |
| `getTopOpenModal()` | `modalUtils.js` | Returns top of `modalStack` |
| Tier A comments | `modalUtils.js` `initializeModalDragging` | Documents permanent globals vs scoped listeners |
| Gallery resize scope | `modalUtils.js` `activateGalleryResizeListener` | Both gallery resize callbacks use `{ signal }` via `attachModalListeners(galleryWindow)` |
| Start menu outside-click | `modalUtils.js` | `wireStartMenuOutsideClick` / `unwireStartMenuOutsideClick` on open/close; start button wired once |
| keyboardShortcuts migration | `keyboardShortcuts.js` | Main keydown/keyup + escape/character-detail handlers registered via registry |
| Script load order | `app.html` | `modalKeyboardRegistry.js` after `modalListenerScope.js`, before `websocket.js` |

**Dependencies:** Phase 0–1 interface.

**Acceptance criteria:**
- [x] Gallery resize listeners detach when gallery window closes.
- [x] Start menu outside-click does not accumulate handlers across open/close cycles.
- [ ] Keyboard router handles Escape for at least one migrated modal (e.g. spellbook) without duplicate firings — **deferred to Worker 3** (spellbook still uses direct `document.keydown`; patch records tray warning).
- [x] Dev log shows scope open/close for gallery window.
- [x] No regression in drag/resize/minimize/desktop empty-click.

**Follow-ups for other workers:**
- **Worker 2–6:** Migrate remaining direct `document.keydown` / `keyup` listeners to `registerKeyboardListener` (tray will list offenders until migrated).
- **Worker 3:** Spellbook, pin, tag wiki Escape handlers → `whenOpen` registrations with modal id.
- **Worker 6:** Gallery batch keydown → `whenOpen` on `#galleryWindow`.

---

### Worker 2: Confirmation / transient dialogs + injected wiring

**Name:** `modal-listeners-w2-transient-dialogs`

**Files:**
- `public/scripts/comp/confirmationDialog.js` (reference implementation — done)
- `public/scripts/comp/creditCostDialog.js`
- `public/scripts/comp/serverManagement.js`
- `public/scripts/comp/quipsDsapApplet.js`
- `public/scripts/comp/logViewerApplet.js`

**Changes:**
- Migrate `creditCostDialog.js` keydown to `attachModalListeners` (mirror confirmation).
- Audit `showConfirmationDialog` / `showInputDialog` injectors: wire dropdowns in `setTimeout(0)` with modal-scoped `document` listeners using `{ signal }`.
- `logViewerApplet.js`: scope `_glassPopoverOutsideHandler` to popover open state.
- `serverManagement.js` / `quipsDsapApplet.js`: replace bare `document.addEventListener` in dialog inject paths.

**Dependencies:** Phase 0–1 interface.

**Acceptance criteria:**
- Open/close credit cost dialog 10× — no duplicate keydown handlers (verify via dev log or listener count).
- Injected restart/settings dialogs: dropdown outside-click cleaned on dialog close.
- Log viewer glass popover: outside click handler removed on close.
- Follow `no-modal-native-select-controls` rule for any touched dialog HTML.

---

### Worker 3: High-waste document keydown modals

**Name:** `modal-listeners-w3-keydown-modals`

**Files:**
- `public/scripts/comp/spellbookModal.js`
- `public/scripts/comp/pinModal.js`
- `public/scripts/comp/tagWikiSearchModal.js`
- `public/scripts/comp/datasetTagToolbar.js`
- `public/scripts/comp/compareViewManager.js`

**Changes:**
- **Spellbook:** move Escape `keydown` from constructor to `attachModalListeners(this.modal, …)`; remove permanent `document.addEventListener`.
- **Pin:** same — scope keydown to pin modal open; call from `show()`/`open` path that uses `openModal`.
- **Tag wiki:** consolidate `document.mousedown`, `window.resize` (split pane) into scope; ensure `unwireSplitListeners` uses shared detach or `{ signal }`.
- **Dataset tag toolbar:** attach capture keydown only while toolbar visible.
- **Compare view:** scope keydown to compare modal open.

**Dependencies:** Phase 0–1; prefer Worker 1 keyboard router if landed (coordinate Escape handling).

**Acceptance criteria:**
- With dev mode on, opening/closing spellbook 5× logs exactly one scope cycle per open.
- Pin modal: no keydown handling when `#pinModal.hidden`.
- Tag wiki split: resize listener absent when modal closed.
- Escape closes spellbook/pin once per keypress.

---

### Worker 4: Dropdown-heavy modals

**Name:** `modal-listeners-w4-dropdown-modals`

**Files:**
- `public/scripts/comp/modalUtils.js` (desktop settings modal section ~6500–7600)
- `public/scripts/comp/apiKeyModal.js`
- `public/scripts/comp/manualDropdownManager.js`
- `public/scripts/comp/referenceManager.js`
- `public/scripts/comp/autocompleteUtils.js`
- `public/scripts/comp/dropdown.js` (optional: accept external `signal`)

**Changes:**
- Desktop settings / wallpaper / API key modals: wrap init-time `document`/`window` listeners in `attachModalListeners` for respective modal elements.
- `manualDropdownManager.js`: defer document-level autocomplete/outside listeners to manual modal scope.
- `referenceManager.js`: scope IE dropdown outside-click to dropdown open (or parent modal signal).
- `autocompleteUtils.js` (step 47.55): pass `{ signal: getModalListenerSignal(manualModal) }` for click-to-dismiss.
- Optional `dropdown.js` enhancement: `setupDropdown(..., { listenerSignal })` for outside click.

**Dependencies:** Phase 0–1.

**Acceptance criteria:**
- Open desktop settings, change dropdown, close — no orphaned outside-click handlers.
- API key modal listeners only active while modal open.
- Autocomplete hides on outside click; no duplicate handlers after manual modal close/reopen.
- No new CSS classes; use existing dropdown pattern per workspace rule.

---

### Worker 5: WS-init modals (manual cluster + request body + developer)

**Name:** `modal-listeners-w5-ws-init-modals`

**Files:**
- `public/scripts/comp/manualModalManager.js`
- `public/scripts/comp/manualPreviewManager.js`
- `public/scripts/comp/manualGenerationParams.js`
- `public/scripts/comp/manualTabManager.js`
- `public/scripts/comp/characterPromptManager.js`
- `public/scripts/comp/pipelineStageControls.js`
- `public/scripts/comp/metadataDialogManager.js`
- `public/scripts/comp/randomPromptManager.js`
- `public/scripts/comp/directorLearningAdmin.js`
- `public/scripts/comp/requestBodyReplacementsModal.js`
- `public/scripts/comp/developerModal.js`
- `public/scripts/comp/websocketRequestsModal.js`

**Changes:**
- For each `registerInitStep` wiring function: split **persistent DOM refs** (query once) from **listener attachment** (via `attachModalListeners` on `#manualModal` or child tool modals).
- `manualModalManager.js`: preview toolbar already has remove — align with scope.
- `pipelineStageControls.js`: scope `document.mouseup` drag-end to pipeline UI active drag.
- `metadataDialogManager.js`: scope document click.
- `requestBodyReplacementsModal.js`: scope all document/window listeners to modal element.
- `developerModal.js`: scope modal UI listeners; keep `devBridge*` on window.
- Keep init steps for **data loading**; move **listener attach** to first open if safer.

**Dependencies:** Phase 0–1; coordinate with Worker 4 for manual dropdown/autocomplete overlap.

**Status:** **Done** (June 2026) — init steps renumbered 460–480; listeners use `attachModalListeners` + `{ signal }`.

**Acceptance criteria:**
- Close manual modal → preview toolbar document listeners inactive (signal aborted).
- Request body replacements modal: full listener teardown on close.
- WS reconnect re-runs init steps without duplicating modal listeners (idempotent attach registration).
- Developer modal: devBridge events still work; modal-only listeners scoped.

---

### Worker 6: Remaining modal managers batch

**Name:** `modal-listeners-w6-remaining-batch`

**Files:**
- `public/scripts/comp/imageViewer.js`
- `public/scripts/comp/lightbox.js`
- `public/scripts/comp/inpaint.js`
- `public/scripts/comp/imageBias.js`
- `public/scripts/comp/emphasisGroupsToolManager.js`
- `public/scripts/comp/novelManager.js`
- `public/scripts/comp/notepadManager.js`
- `public/scripts/comp/bracketGenerationApplet.js`
- `public/scripts/comp/naxtApplet.js`
- `public/scripts/comp/configEditorApplet.js`
- `public/scripts/comp/runApplet.js`
- `public/scripts/comp/focusOverlayManager.js`
- `public/scripts/comp/virtualKeyboard.js`
- `public/scripts/comp/presetManager.js`
- `public/scripts/comp/textReplacementManager.js`
- `public/scripts/comp/chatSystem.js`
- `public/scripts/comp/director.js`
- `public/scripts/comp/galleryView.js` (gallery window scope)
- `public/scripts/comp/creditCostDialog.js` (if not taken by W2)

**Changes:**
- **Lumen / imageViewer:** call `onModalOpened`/`onModalClosed` from custom lifecycle; migrate document mouse/touch/blur to `{ signal }`.
- **Lightbox / inpaint / imageBias:** scope document mouse listeners to tool open.
- **Tool modals** (novel, emphasis groups, notepad, run): use parent modal signal where `data-parent-modal-id` set.
- **Applets** with drag mouseup: scope to active drag session.
- **focusOverlayManager / virtualKeyboard:** scope to overlay/keyboard visible.
- **galleryView:** batch selection keydown scoped to gallery window open.

**Dependencies:** Phase 0–1; Worker 1 for gallery window pattern.

**Acceptance criteria:**
- Lumen viewer close removes document mouse/touch listeners.
- Inpaint global mousedown/mouseup inactive when editor closed.
- Virtual keyboard focusin/out handlers inactive when keyboard hidden.
- No regressions in tool windows linked to manual modal.

---

## Copy-paste worker prompts (for parent agent)

See section **Worker workstreams** above — each block is self-contained with name, files, changes, dependencies, and acceptance criteria.

---

## Open questions / blockers

1. **Keyboard router ownership:** Should Escape be handled only by the router (Worker 1) or remain per-modal with guard checks? Recommendation: router for Escape/Enter; modals keep specific shortcuts (digits 1–9 in confirmation).
2. **Init step idempotency:** ~~Several steps at priority **47.5** share priority (api key vs manual dropdown).~~ Resolved: api key **485**, manual dropdown **486** (see renumber map). Reconnect re-runs init steps without duplicating modal listeners (`attachModalListeners` dedupes by fn reference).
3. **Legacy approval:** Desktop settings block inside `modalUtils.js` (~1500 lines) is legacy — Worker 4 should prefer scoping without structural refactor unless user approves.
4. **`imageViewer.js` bypass:** Confirm explicit `onModalOpened`/`onModalClosed` calls with imageViewer owner before Worker 6 lands.

---

## Verification checklist (Phase 0–1)

- [ ] `modalListenerScope.js` loads after `modalUtils.js` in `app.html`
- [ ] Open any modal → `getModalListenerSignal(modal)` non-null
- [ ] Close modal → signal aborted (`signal.aborted === true`)
- [ ] Confirmation dialog Escape works once; no duplicate handlers after 5 open/close cycles
- [ ] Dev mode: `[modalListeners]` debug lines on open/close
- [ ] Run `bash scripts/notify-service-worker-update.sh` after deploy to client assets

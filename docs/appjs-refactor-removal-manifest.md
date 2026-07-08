# app.js Refactor — Removal Manifest

Master coordination document for extracting `public/scripts/app.js` into `public/scripts/comp/`. **Phase 1 rule:** copy/extract into comp files and wire init. **Do not delete from `app.js` until Phase 2.** After client edits: `bash scripts/notify-service-worker-update.sh --recompile`.

---

## Phase 1 complete

All eight Phase 1 extraction workers are **COMPLETE**. Assets and listeners are duplicated in comp files; originals remain in `app.js` for safe rollback until Phase 2 scripted removal.

### New files created

| File | In `app.html` | Init |
|------|---------------|------|
| `comp/dynamicGenerationManager.js` | Yes (7589) | `registerInitStep(85.1, 'Wiring Dynamic Generation UI', …)` |
| `comp/pipelineStageControls.js` | Yes (7595) | `wirePipelineStageControls(stageId)` on add; `wirePipelineGlobalToggles()` @ step 85 |
| `comp/focusOverlayManager.js` | Yes (7596) | `wireFocusOverlayListeners()` @ `DOMContentLoaded` |
| `comp/mainMenuManager.js` | Yes (7597) | `wireMainMenuListeners()` @ step 85 |
| `comp/compareViewManager.js` | Yes (7598) | `wireCompareViewListeners()` @ `DOMContentLoaded` |
| `comp/compiledPromptInspector.js` | Yes (7599) | `wireCompiledPromptInspectorListeners()` @ `DOMContentLoaded` |
| `comp/exitConfirmation.js` | Yes (7600) | `wireExitConfirmationListeners()` @ script load |
| `comp/systemTrayManager.js` | Yes (7601) | `wireSystemTrayListeners()` @ step 84 / tray boot |

### Known duplicate-listener state (until Phase 2)

`app.js` still registers many listeners in `setupEventListeners` and related blocks. Compare, compiled prompt, search toggle, and autocomplete dismiss duplicates **removed** in Phase 2 batch 1. Remaining subsystems may still double-fire until their manifest ranges are removed.

Compare state globals and function bodies **removed from `app.js`** (Phase 2 batch 1). Comp files own compare + compiled prompt.

### Phase 2 batch 1 (compare + compiled prompt + safe dangling listeners)

Script: `scripts/phase2-remove-appjs-blocks.py` — 2,188 lines removed from `app.js` (28,770 → 26,580). All `node --check` passed.

### Phase 2 batch 2 (dynamic generation UI removal)

Script: `scripts/phase2-remove-appjs-blocks.py` — 1,310 lines removed from `app.js` (26,580 → 25,270). All `node --check` passed. Wiring deduped to `wireDynamicGenerationUI()` @ init step 85.1 in `dynamicGenerationManager.js`.

### Phase 2 batch 3 (Wave 2: character prompt position, manual tabs, WCO)

Script: `scripts/phase2-remove-appjs-blocks.py` — 978 lines removed from `app.js` (25,273 → 24,295). All `node --check` passed.

| Section | app.js lines (pre-removal) | Status |
|---------|---------------------------|--------|
| Position dialog listeners (`setupEventListeners`) | L8811–L8862 | ✅ **Removed** → `wireCharacterPromptPositionListeners()` |
| Manual tab listeners (`setupEventListeners`) | L8940–L8983 | ✅ **Removed** → `wireManualTabListeners()` |
| Manual tab functions (`switchManualTab`, etc.) | L9424–L9657 | ✅ **Removed** → `manualTabManager.js` |
| Position dialog functions (`updateAutoPositionToggle` … `confirmPosition`) | L15775–L15977 | ✅ **Removed** → `characterPromptManager.js` |
| `getCellLabelFromCoords` | L21455–L21465 | ✅ **Removed** → `characterPromptManager.js` |
| WCO `DOMContentLoaded` body (helpers + observer) | L24842–L25241 | ✅ **Removed** → `initWindowControlsOverlay()` |
| `activateTitlebarResizeListeners` | L25248–L25271 | ✅ **Removed** → `windowControlsOverlay.js` |

### Phase 2 batch 4 (text overlay suite + dangling listener peels)

Script: `scripts/phase2-remove-appjs-blocks.py` — 1,408 lines removed from `app.js` (24,296 → 22,888). All `node --check` passed.

| Section | app.js lines (pre-removal) | Status |
|---------|---------------------------|--------|
| Text overlay functions (`addTextOverlay` … `extractTextFromPrompt`) | L15939–L16774 | ✅ **Removed** → `textOverlayManager.js` |
| Manual preview close listener (`setupEventListeners`) | L7227–L7240 | ✅ **Removed** → `registerManualPreviewToolbarListeners()` |
| Inline preset listeners (`setupEventListeners`) | L7242–L7267 | ✅ **Removed** → `wireInlinePresetListeners()` |
| Manual preview core toolbar (`setupEventListeners`) | L7279–L7430 | ✅ **Removed** → `registerManualPreviewToolbarListeners()` |
| Gallery keyboard nav (`setupEventListeners`) | L8089–L8183 | ✅ **Removed** → `wireGalleryKeyboardNav()` |
| ESC/character detail keys (`setupEventListeners`) | L8185–L8242 | ✅ **Removed** → `wireEscapeAndCharacterDetailKeys()` |
| Director reference listeners (`setupEventListeners`) | L8619–L8657 | ✅ **Removed** → `wireDirectorReferenceListeners()` |
| Cache browser close/tabs (`setupEventListeners`) | L8660–L8700 | ✅ **Removed** → `wireCacheBrowserCloseAndTabs()` |
| `imageBiasHidden.change` (`setupEventListeners`) | L8755–L8758 | ✅ **Removed** → `wireImageBiasHiddenChange()` |
| Auto-position toggle listener (`setupEventListeners`) | L8799–L8809 | ✅ **Removed** → `wireCharacterPromptPositionListeners()` (auto-position wired) |
| Preset toggle listener (`setupEventListeners`) | L8920–L8931 | ✅ **Removed** → `wireInlinePresetListeners()` |
| Gallery toolbar listeners (`setupEventListeners`) | L8967–L9033 | ✅ **Removed** → `wireGalleryToolbarListeners()` |
| Sprout/load seed listeners (`setupEventListeners`) | L9054–L9066 | ✅ **Removed** → `wireSeedListeners()` |
| Generate button context menus (`setupEventListeners`) | L9058–L9063 | ✅ **Removed** → `wireGenerateButtonContextMenus()` |
| Main menu wheel column size (context menu init) | L22892–L22917 | ✅ **Removed** → `wireMainMenuBarColumnWheel()` |

**Retained in `app.js`:** `initVirtualKeyboard` + `wsClient.init` + `wireFocusOverlayListeners()` in `DOMContentLoaded`; full character prompt CRUD (`addCharacterPrompt`, `getCharacterPrompts`, …); `renderAddItemDropdown` text-overlay option (calls `addTextOverlay`); pipeline stage bodies; gallery `contextMenuAction` handler.

**Skipped (blockers):** pipeline stage bodies; character prompt CRUD; gallery `contextMenuAction` handler.

### Phase 2 batch 5 (manual preview extended toolbar + nav/handle + preset autocomplete)

Script: `scripts/phase2-remove-appjs-blocks.py` — 136 lines removed from `app.js` (22,888 → 22,752). All `node --check` passed.

| Section | app.js lines (pre-removal) | Status |
|---------|---------------------------|--------|
| Manual preview extended toolbar (`setupEventListeners`) | L7237–L7335 | ✅ **Removed** → `registerManualPreviewToolbarListeners()` |
| Preset autocomplete keydown/input (`setupEventListeners`) | L7631–L7633 | ✅ **Removed** → `wireInlinePresetListeners()` |
| Manual preview prev/next nav (`setupEventListeners`) | L8327–L8341 | ✅ **Removed** → `registerManualPreviewToolbarListeners()` |
| Manual preview handle (`setupEventListeners`) | L8453–L8468 | ✅ **Removed** → `registerManualPreviewToolbarListeners()` |

**Note:** Compare source (`manualPreviewUseAsSourceBtn`) was already wired in `compareViewManager.js` (batch 1); no duplicate listener existed in app.js.

### Phase 2 batch 6 (duplicate feature bodies owned by comp files)

Script: `scripts/phase2-remove-appjs-blocks.py` — 2,264 lines removed from `app.js` (22,752 → 20,488). All `node --check` passed. Preset autocomplete functions **moved** to `presetManager.js` before removal.

| Section | app.js lines (pre-removal) | Status |
|---------|---------------------------|--------|
| Exit confirmation else body (`setupEventListeners`) | L8434–L8592 | ✅ **Removed** → `exitConfirmation.js` (`wireExitConfirmationListeners` @ parse) |
| Focus overlay + title bar scroll (`setupEventListeners`) | L7534–L7754 | ✅ **Removed** → `wireFocusOverlayListeners()` |
| `isInSearchMode` | L567–L570 | ✅ **Removed** → `fileSearch.js` |
| `toggleSearchContainer` + `closeSearchContainer` | L8661–L8747 | ✅ **Removed** → `fileSearch.js` |
| Preset autocomplete DOM refs | L13–L14 | ✅ **Moved** → `presetManager.js` |
| Preset autocomplete functions | L10914–L11073 | ✅ **Moved** → `presetManager.js` |
| `prepareSystemTrayBackground` + `startBackgroundTrayServices` | L12548–L12678 | ✅ **Removed** → `systemTrayManager.js` |
| `setupTrayIconPopovers` + `startPopoverAutoHideTimer` | L12681–L12905 | ✅ **Removed** → `systemTrayManager.js` |
| `setupServiceWorkerTrayContextMenu` + `formatBytes` + tray DOMContentLoaded boot | L13347–L13497 | ✅ **Removed** → `systemTrayManager.js` |
| `setupWindowManagementButtons` + `setupMainMenuContextMenus` | L20663–L21781 | ✅ **Removed** → `mainMenuManager.js` (`wireMainMenuListeners`) |

**Retained in `app.js` (coupled / do-not-remove):** TOD/season helpers (`setTodOverride`, `setDynamicOverride`, …); tray indicator updaters (`updateSubscriptionRenewalIndicator`, `updateFixedCreditsIndicator`, …) called by `systemTrayManager.js`; `buildWindowManagementButtonMenuConfig` / `getWindowManagementApplicationItems` (helpers for `mainMenuManager.js`); character prompt CRUD; pipeline stage core; gallery `contextMenuAction`; WebSocket block.

### Phase 2 batch 7 (text replacement lock inspector suite)

Script: `scripts/phase2-remove-appjs-blocks.py` — 2,774 lines removed from `app.js` (20,488 → 17,714). All `node --check` passed. Helpers + `wireTextReplacementLockModalListeners()` added to `textReplacementManager.js` before removal.

| Section | app.js lines (pre-removal) | Status |
|---------|---------------------------|--------|
| Lock inspector helpers (`currentTextReplacementSeeds`, `copyTextReplacementOptionToSeed`, … `refreshInspectorTextReplacementsFromPrompts`) | L2729–L3225 | ✅ **Removed** → `textReplacementManager.js` |
| Lock modal suite (`buildInspectorStageTargetBadgeHtml` … `updateTextReplacementLockItem`) | L3228–L5263 | ✅ **Removed** (1:1 duplicate verified) → `textReplacementManager.js` |
| Lock modal listeners (`setupEventListeners`) | L6980–L7217 | ✅ **Removed** → `wireTextReplacementLockModalListeners()` |

**Skipped (batch 7):** `setupEventListeners` peel (manual form, upload, resolution, generation params — not yet wired in comp); `showCompiledPromptModal` (body already removed batch 1); do-not-remove hubs (updateManualPreview, pipeline, character CRUD, WebSocket, carousel).

| Section | app.js lines (pre-removal) | Status |
|---------|---------------------------|--------|
| `initDynamicCarousel` | L1612–L1628 | ✅ **Removed** → `dynamicGenerationManager.js` |
| `setupDynamicGenerationContextMenus` | L6171–L7092 | ✅ **Removed** → `dynamicGenerationManager.js` |
| Dynamic-gen `contextMenuAction` listener | L7172–L7364 | ✅ **Removed** → `wireDynamicGenerationContextMenuActions()` |
| Time/date + weather modal listeners (`setupEventListeners`) | L8103–L8157 | ✅ **Removed** → `wireTimeDateModalControls()` / `wireWeatherLocationModalControls()` |
| Time/date wheel inputs (`setupEventListeners`) | L10131–L10171 | ✅ **Removed** → `wireTimeDateWheelInputs()` |
| Rentan toggle + TOD/weather/season/creative listeners | L10266–L10330 | ✅ **Removed** → `wireDynamicGenerationButtons()` |
| `setupDynamicGenerationContextMenus()` + `initDynamicCarousel()` calls (`setupEventListeners`) | L10367–L10371 | ✅ **Removed** (deduped to step 85.1) |
| `setupDynamicGenerationContextMenus()` call (init step 85) | L26108 | ✅ **Removed** (deduped to step 85.1) |
| Compiled prompt modal close listener | — | ✅ Already removed in batch 1 (`compiledPromptInspector.js` + `wireCompiledPromptModalClose()`) |

**Retained in `app.js`:** TOD/season helpers (`setTodOverride`, `setDynamicOverride`, …), gallery `contextMenuAction` handler (L23471+).

### Phase 2 batch 8 (setupEventListeners peel)

Script: `scripts/phase2-remove-appjs-blocks.py` — 913 lines removed from `app.js` (17,714 → 16,805). All `node --check` passed. Wire functions added before removal.

| Section | app.js lines (pre-removal) | Status |
|---------|---------------------------|--------|
| Manual modal chrome + form + controls (`setupEventListeners`) | L4337–L4421, L4444–L4452, L4498–L4700 | ✅ **Removed** → `wireManualModalChromeListeners()` + `saveRequestAsDesktopShortcut()` |
| Seed input/clear (`setupEventListeners`) | L4454–L4472 | ✅ **Removed** → `wireSeedListeners()` (presetManager.js) |
| Paid request toggles (`setupEventListeners`) | L4474–L4496 | ✅ **Removed** → `wireManualGenerationParamsListeners()` |
| Upload/clipboard/base image (`setupEventListeners`) | L4788–L4805, L5126–L5161 | ✅ **Removed** → `wireUploadClipboardListeners()` |
| Resolution/dimension listeners (`setupEventListeners`) | L4813–L5124 | ✅ **Removed** → `wireManualResolutionDimensionListeners()` |
| Generation params price/wheel/variety (`setupEventListeners`) | L4807–L4811, L5163–L5309, L5381–L5394 | ✅ **Removed** → `wireManualGenerationParamsListeners()` |
| Manual dropdown setup (`setupEventListeners`) | L5396–L5427 | ✅ **Removed** → `wireManualDropdownSetup()` |

**New file:** `public/scripts/comp/manualGenerationParams.js` (in `app.html` after `manualModalManager.js`).

**`setupEventListeners` after batch 8:** ~185 lines (API key modal, character autocomplete, metadata dialog, `wirePipelineGlobalToggles()`, random prompt, director modals, cache browser refs).

### Phase 2 batch 9 (setupEventListeners final peel)

Script: `scripts/phase2-remove-appjs-blocks.py` — 1,125 lines removed from `app.js` (16,805 → 15,680). All `node --check` passed. Wire functions + copied bodies added before removal.

| Section | app.js lines (pre-removal) | Status |
|---------|---------------------------|--------|
| API key modal listeners (`setupEventListeners`) | L4340–L4359 | ✅ **Removed** → `wireApiKeyModalListeners()` (`apiKeyModal.js`, init 47.5) |
| Main prompt autocomplete (`setupEventListeners`) | L4361–L4408 | ✅ **Removed** → `wireMainPromptAutocompleteListeners()` (`autocompleteUtils.js`, init 47.55) |
| Metadata dialog listeners (`setupEventListeners`) | L4410–L4438 | ✅ **Removed** → `wireMetadataDialogListeners()` (`metadataDialogManager.js`, init 47.6) |
| `wirePipelineGlobalToggles()` call (`setupEventListeners`) | L4447–L4448 | ✅ **Removed** → `registerInitStep(47.45)` (`pipelineStageControls.js`) |
| Random prompt listeners (`setupEventListeners`) | L4450–L4465 | ✅ **Removed** → `wireRandomPromptListeners()` (`randomPromptManager.js`, init 47.7) |
| Director feedback/rules listeners (`setupEventListeners`) | L4467–L4499 | ✅ **Removed** → `wireDirectorLearningAdminListeners()` (`directorLearningAdmin.js`, init 47.8) |
| Cache browser toolbar refs (`setupEventListeners`) | L4501–L4514 | ✅ **Removed** → `wireCacheBrowserToolbarRefs()` (`referenceManager.js`) |
| `setupEventListeners` shell + migration summary | L4339–L4571 | ✅ **Deleted** — init step 85 no longer calls it |
| Director feedback/rules functions | L2827–L3343 | ✅ **Removed** → `directorLearningAdmin.js` |
| Random prompt functions | L9169–L9375 | ✅ **Removed** → `randomPromptManager.js` |
| Metadata dialog functions | L7472–L7635 | ✅ **Removed** → `metadataDialogManager.js` |

**New files:** `apiKeyModal.js`, `metadataDialogManager.js`, `randomPromptManager.js`, `directorLearningAdmin.js` (in `app.html` after `manualGenerationParams.js`).

**`setupEventListeners` after batch 9:** **deleted** (0 lines). All listeners wired via comp `registerInitStep` 47.45–47.8.

**Skipped (batch 9 Part B):** `manualPreviewManager.js` — hub `updateManualPreview` @ L4736+ (~1,150 lines with `updateManualPreviewBlurredBackground`, `renderManualPreviewDialogs`, `updateManualPreviewDirectly`, `updateManualPreviewNavigation`); high coupling to gallery/WS/generation; document for batch 10 COPY-first.

### Phase 2 batch 10 (manualPreviewManager + dynamicGenerationCarousel)

Script: `scripts/phase2-remove-appjs-blocks.py` — 2,651 lines removed from `app.js` (15,680 → 13,028). All `node --check` passed. COPY-first bodies in comp files before removal.

| Section | app.js lines (pre-removal) | Status |
|---------|---------------------------|--------|
| Manual preview image src lifecycle | L698–L757 | ✅ **Removed** → `manualPreviewManager.js` |
| `slimLastGenerationRef` + `loadTempImagePreview` | L759–L861 | ✅ **Removed** → `manualPreviewManager.js` |
| `backgroundUpdateState` + `updateBlurredBackground` | L513–L526 | ✅ **Removed** → `manualPreviewManager.js` |
| Background update utils (`canUpdateBackground`, `forceBackgroundUpdate`, …) | L4419–L4474 | ✅ **Removed** → `manualPreviewManager.js` |
| Manual preview hub (`updateManualPreviewBlurredBackground` … `restoreOriginalImage`) | L4477–L5858 | ✅ **Removed** → `manualPreviewManager.js` |
| Lightbox handlers (`initializeManualPreviewLightbox`, `handleManualPreviewClick`, `handleManualPreviewScroll`) | L6137–L6278 | ✅ **Removed** → `manualPreviewManager.js` |
| Workspace overlay (`showWorkspaceImageOverlay`, `loadImageIntoManualPreview`, …) | L6507–L6603 | ✅ **Removed** → `manualPreviewManager.js` |
| Rentan carousel suite (`formatCarouselItems`, `updateDynamicCarousel`, `requestDynamicContextResolution`, …) | L922–L1707 | ✅ **Removed** → `dynamicGenerationCarousel.js` |

**New files:** `manualPreviewManager.js` (in `app.html` after `manualModalManager.js`, init 47.05), `dynamicGenerationCarousel.js` (before `dynamicGenerationManager.js`).

**Retained in `app.js` (coupled / do-not-remove):** TOD/season helpers (`setTodOverride`, `setDynamicOverride`, …), `getAnalogClockIcon` / `formatTimezoneInfo` (carousel deps), character prompt CRUD; pipeline stage core (`addPipelineStage`, `renderExpandCanvasStage`, …); gallery `contextMenuAction`.

### Phase 2 batch 11 (WebSocket handlers + init steps + pipeline data load)

Manual extraction — 1,399 lines removed from `app.js` (13,028 → 11,629). All `node --check` passed.

| Section | app.js lines (pre-removal) | Status |
|---------|---------------------------|--------|
| WebSocket `wsClient.on` handlers + gallery helpers | L12223–L12612 | ✅ **Removed** → `appWebSocketHandlers.js` |
| `registerInitStep` boot sequence (0.44–100) | L12614–L12973 | ✅ **Removed** → `appInitSteps.js` |
| `loadExpandCanvasStageData` + `loadEnhanceStageData` | L10135–L10733 | ✅ **Removed** → `pipelineStageManager.js` |
| `hideStageIndicators` | L12212–L12221 | ✅ **Removed** → `pipelineStageManager.js` |

**New files:** `appWebSocketHandlers.js`, `appInitSteps.js` (in `app.html` before `app.js`), `pipelineStageManager.js` (after `pipelineStageControls.js`).

**Retained in `app.js`:** `DOMContentLoaded` (`initVirtualKeyboard`, `wsClient.init`, `wireFocusOverlayListeners`); full character prompt CRUD; `addPipelineStage` / render suite / stage getters.

**Skipped (batch 11 Part C):** `addCharacterPrompt`, `loadCharacterPrompts` — remain in `app.js` (~600 lines CRUD).

### Phase 2 batch 12 (character CRUD + pipeline core + API key modal + gallery ops)

Script: `scripts/phase2-remove-appjs-blocks.py` — 5,843 lines removed from `app.js` (11,499 → 5,656). All `node --check` passed.

| Section | app.js lines (pre-removal) | Status |
|---------|---------------------------|--------|
| `apiKeyModalState` global | L26–L32 | ✅ **Removed** → `apiKeyModal.js` |
| API key modal functions (`resetApiKeyModalState` … `saveNewApiKey`) | L1029–L1610 | ✅ **Removed** → `apiKeyModal.js` |
| `findTrueImageIndexInGallery` | L400–L420 | ✅ **Removed** → `galleryView.js` |
| Gallery scraps/pin/cache (`moveToScraps` … `updateGalleryPinButtons`) | L2084–L2540 | ✅ **Removed** → `galleryView.js` |
| Gallery download/delete (`downloadImage` … `deleteImage`) | L3579–L3723 | ✅ **Removed** → `galleryView.js` |
| Character prompt CRUD (`buildCharacterUcTabContainerHtml` … `updateCharacterPromptItemNames`) | L5451–L6497 | ✅ **Removed** → `characterPromptManager.js` |
| Character prompt collapse (`toggleCharacterPromptCollapse` … `updateCharacterPromptPreview`) | L10031–L10082 | ✅ **Removed** → `characterPromptManager.js` |
| Pipeline stage core (`renderAddItemDropdown` … `getBiasName`) | L6499–L10020 | ✅ **Removed** → `pipelineStageManager.js` |

**Wiring:** `wireCharacterPromptManager()` @ init step 47.1; `wireApiKeyModalListeners()` extended with add-key modal buttons @ 47.5.

### Phase 2 batch 13 (final shell)

Script: `scripts/phase2-batch13-extract.py` — 5,614 lines removed from `app.js` (5,655 → 41). All `node --check` passed. Twenty new comp files; `app.html` script tags before `appWebSocketHandlers.js`.

| Section | app.js lines (pre-removal) | Status |
|---------|---------------------------|--------|
| `toggleWeatherUnits` + TOD/weather/season overrides | L28–288, L555–1462 | ✅ **Removed** → `dynamicGenerationOverrides.js` |
| Preset glue (`handlePresetUpdate` … `updateManualPresetPlaceholder`) | L407–553 | ✅ **Removed** (duplicate) → `presetManager.js` |
| `loadOptions` / `handleWorkspaceDataFromOptions` / `isAppDataReady` | L1468–1623 | ✅ **Removed** → `appBootstrap.js` |
| Submenu + `updateBalanceDisplay` | L1625–1770 | ✅ **Removed** → `balanceDisplay.js` |
| `rerollImage` / `checkManualModalBeforeLoad` / `upscaleImage` | L1772–2163 | ✅ **Removed** → `galleryActions.js` |
| `handleLogout` / `fetchWithAuth` / `handleServerPing` / session | L2166–2211, L2998–3004, L4401–4405, L4585–4714 | ✅ **Removed** → `connectionManager.js` |
| `saveManualPreset` / `handleManualSave` / `generateImage` / preview delete | L362–368, L2231–2585 | ✅ **Removed** → `generationOrchestrator.js` |
| `handleError` / `showError` / sub-header / `handleAuthError` | L338–357, L370–371, L2587–2684 | ✅ **Removed** → `errorDisplay.js` |
| `handleToastButtonClick` | L299–336 | ✅ **Removed** (duplicate) → `toastManager.js` |
| Manual form helpers (`updateMenuBarHeight` … `resetMetadataTable`) | L2686–2753 | ✅ **Removed** → `manualFormHelpers.js` |
| Seed sprout suite | L2756–2995 | ✅ **Removed** → `seedSproutManager.js` |
| Upload + clipboard handlers | L3007–3143, L3731–3791 | ✅ **Removed** → `uploadHandlers.js` |
| Tray indicators + subscription/credits | L3145–3728 | ✅ **Removed** → `trayIndicators.js` |
| `activateMainResizeListeners` / `resizeHandler` | L3797–3828 | ✅ **Removed** → `uiResize.js` |
| Manual base-image upload/delete | L3831–3974 | ✅ **Removed** → `manualUploadHandlers.js` |
| Bulk gallery ops | L3976–4231, L4717–4988 | ✅ **Removed** → `bulkOperationsManager.js` |
| Generate-button popover | L4242–4321 | ✅ **Removed** → `generateButtonPopover.js` |
| Theme / blur / focus-cover prefs | L4323–4395 | ✅ **Removed** → `themePreferences.js` |
| Android notification bridge | L4407–4408, L4415–4583 | ✅ **Removed** → `androidNotificationBridge.js` |
| Read-only mode + cache rebuild | L4991–5196 | ✅ **Removed** → `cacheAndReadOnly.js` |
| Window management menu helpers | L5198–5441 | ✅ **Removed** → `windowManagementHelpers.js` |
| Stage indicators + generation progress | L5443–5637 | ✅ **Removed** → `generationProgress.js` |

**MUST remain in `app.js` (41 lines):**

| Item | Why |
|------|-----|
| `bypassConfirmation` + `__dreamscapeFence['app.js']` | Parse-order fence; must run before/after comp scripts |
| `t5Tokenizer` global | Declared here; initialized in `appInitSteps.js` after tokenizer script |
| `pinModalPromise` | Shared mutable session-reauth state for `connectionManager.js` |
| `resizeTimeout` | Legacy global referenced by `uiResize.js` |
| `window.u1` bridge | Exposes protected tag-highlight dataset to comp scripts |
| `DOMContentLoaded` | Boots `initVirtualKeyboard`, `wsClient.init`, `wireFocusOverlayListeners` only |

**Final:** `app.js` **41 lines** (~**99.9%** reduced from 30,281; ~**99.3%** from post-batch-12 5,655).

---

## Phase 2 COMPLETE

All scripted removal batches (1–13) are **COMPLETE**. `public/scripts/app.js` is a 41-line thin shell.

### Verification (2026-06-24)

| Check | Result |
|-------|--------|
| `app.js` line count | **41 lines** — matches manifest |
| `node --check` | **PASS** — `app.js`, `appWebSocketHandlers.js`, `appInitSteps.js`, all 20 batch-13 comp files |
| `app.html` script order | **PASS** — no duplicate `.js` tags; `characterPromptManager.js` (7602) and all comp files load before `app.js` (7637); batch-13 block (7615–7634) before `appWebSocketHandlers.js` → `appInitSteps.js` → `app.js` |
| Critical globals | **PASS** — `loadOptions` (`appBootstrap.js`), `generateImage` / `isGenerating` / `isQueueStopped` (`generationOrchestrator.js`), `addCharacterPrompt` (`characterPromptManager.js`), `updateManualPreview` (`manualPreviewManager.js`); `setupEventListeners` removed (replaced by per-comp `registerInitStep` wiring) |
| HTTP smoke (`:9220`) | **PASS** — `app.html` + sampled scripts return 200 |

### Residual shell (`app.js`)

| Global / block | Consumer |
|----------------|----------|
| `bypassConfirmation` | `exitConfirmation.js`, `mainMenuManager.js`, `serviceWorkerManager.js`, … |
| `t5Tokenizer` | `appInitSteps.js` init step 5; `emphasisSubgroup.js`, `presetTokenCount.js`, … |
| `pinModalPromise` | `connectionManager.js` |
| `resizeTimeout` | Declared for legacy contract; `uiResize.js` uses local `mainResizeTimeout` |
| `window.u1` bridge | Protected tag-highlight dataset |
| `DOMContentLoaded` | `initVirtualKeyboard`, `wsClient.init`, `wireFocusOverlayListeners` |

### Post-refactor housekeeping (non-blocking)

- [ ] Smoke-test: manual modal, gallery, generation, compare, Rentan, tray, exit guard
- [ ] `bash scripts/notify-service-worker-update.sh --recompile`
- [ ] Remove stale `systemTrayManager.js` comment referencing tray indicators in `app.js`
- [ ] Optional: dedupe duplicate `loadDynamicGenerationQuips()` call in `appBootstrap.js` (L48–56)

### Wave 2 complete (Phase 1 copy-only)

| File | In `app.html` | Init |
|------|---------------|------|
| `manualTabManager.js` | Yes (7596) | `registerInitStep(47.2, …)` → `wireManualTabListeners()` |
| `textOverlayManager.js` | Yes (7597) | Assets only; `addTextOverlay` called from app.js `renderAddItemDropdown` |
| `characterPromptManager.js` | Yes (7595) | `registerInitStep(47.1, …)` → `wireCharacterPromptManager()` |
| `windowControlsOverlay.js` | Yes (7605) | `initWindowControlsOverlay()` @ `DOMContentLoaded`; `activateTitlebarResizeListeners()` global |

**characterPromptManager.js:** Full CRUD + position dialog + drag/drop + subject-tag sync (batch 12).

### Next step

**Phase 2 removal:** ✅ **COMPLETE** (batches 1–13). See [Phase 2 COMPLETE](#phase-2-complete). Remaining work: manual smoke tests + SW recompile.

---

## Phase 1 worker status

| # | Worker | ID | Scope | Target file(s) | Status | Notes |
|---|--------|-----|-------|----------------|--------|-------|
| 1 | Dangling listeners | `c0843cb8` | 15 listener groups → existing `comp/*.js` | `fileSearch.js`, `galleryView.js`, `manualModalManager.js`, `imageBias.js`, `referenceManager.js`, `presetManager.js`, `autocompleteUtils.js`, `keyboardShortcuts.js`, `textReplacementManager.js`, `compileToPromptsApplet.js` | **COMPLETE** | Wiring only; originals stay in `setupEventListeners` |
| 2 | Dynamic generation | `cc3d398a` | Rentan assets + listeners | `dynamicGenerationManager.js` | **COMPLETE** | In `app.html`; init step 85.1 |
| 3 | Pipeline stage controls | `3c8faf45` | Stage toolbar/DnD/events | `pipelineStageControls.js` | **COMPLETE** | Hooks in `app.js`; some bodies removed with manifest placeholder comments |
| 4 | Main menu + focus overlay | `6f4fceae` | Menu bar + privacy cover | `mainMenuManager.js`, `focusOverlayManager.js` | **COMPLETE** | In `app.html`; step 85 + `DOMContentLoaded` |
| 5 | System tray + exit guard | `cbceac93` | Tray + navigation protection | `systemTrayManager.js`, `exitConfirmation.js` | **COMPLETE** | `setupTrayIconPopovers` wired in `wireSystemTrayListeners()` |
| 6 | Dangling assets | `d779b56f` | Functions/vars → existing files | `fileSearch.js`, `galleryView.js`, `presetManager.js`, `characterPromptManager.js`, `textReplacementManager.js` | **COMPLETE** | 5 files updated; assets only (not listeners) |
| 7 | Compare + compiled prompt | `d13e79a4` | Isolated high-priority features | `compareViewManager.js`, `compiledPromptInspector.js` | **COMPLETE** | Self-init on `DOMContentLoaded` |
| 8 | Master manifest | `714510ea` | This document | `docs/appjs-refactor-removal-manifest.md` | **COMPLETE** | Coordinates Phase 1 workers; tracks Phase 2 removal |

---

## Phase 1: Pipeline Stage Controls

**New file:** `public/scripts/comp/pipelineStageControls.js`  
**Script order:** After `manualModalManager.js`, before `app.js` (see `public/app.html`).

### Public API (globals)

| Function | Purpose |
|----------|---------|
| `buildPipelineStageToolbar(stageId)` | Creates stage header toolbar DOM + click listeners |
| `wirePipelineStageControls(stageId, options?)` | Wires per-stage body events (expand/variation) + re-inits drag-and-drop |
| `unwirePipelineStageControls(stageId)` | Aborts per-stage wire controller (call on delete) |
| `wirePipelineGlobalToggles()` | Wires save-stage-0 and enable-stage-generation toggles (once) |

Also moved (internal globals, same names as former app.js helpers):

- `initializePipelineStageDragAndDrop()`
- `setupExpandCanvasStageEvents(stageId)`
- `setupStageCustomResolutionControls(stageId, resolutionDropdown, resolutionInput)`
- `setupEnhanceStageEvents(stageId, initialUseBaseImage?)`
- `setupStageAdvancedControls(stageId)`

### app.js call-site hooks (Phase 1)

| Location | Change |
|----------|--------|
| `addPipelineStage` | `buildPipelineStageToolbar(stageId)` + `wirePipelineStageControls(stageId, options)` |
| `deletePipelineStage` | `unwirePipelineStageControls(stageId)` before DOM removal |
| `setupEventListeners` | `wirePipelineGlobalToggles()` replaces inline toggle listeners |
| `renderExpandCanvasStage` | Removed `setupExpandCanvasStageEvents` call (wired via `wirePipelineStageControls`) |
| `renderEnhanceStage` | Removed `setupEnhanceStageEvents` call (wired via `wirePipelineStageControls`) |

### Original app.js line ranges (baseline at Phase 1 start)

> Line numbers drift as app.js edits land. Grep manifest comments in app.js (`Phase 1 removal manifest`) for current placeholder locations.

| Section | Original lines | Status |
|---------|----------------|--------|
| Stage toolbar buttons (in `addPipelineStage`) | L21334–L21512 | **Replaced** with `buildPipelineStageToolbar` call |
| Stage drag-and-drop (`initializePipelineStageDragAndDrop`) | L21733–L21904 | **Removed** from app.js → `pipelineStageControls.js` |
| `setupExpandCanvasStageEvents` | L23029–L23208 | **Removed** from app.js → `pipelineStageControls.js` |
| `setupStageCustomResolutionControls` | L23211–L23454 | **Removed** from app.js → `pipelineStageControls.js` |
| `setupEnhanceStageEvents` | L23744–L24210 | **Removed** from app.js → `pipelineStageControls.js` |
| `setupStageAdvancedControls` | L24213–L24467 | **Removed** from app.js → `pipelineStageControls.js` |
| Save stage 0 / enable stage generation toggles (in `setupEventListeners`) | L12164–L12197 | **Replaced** with `wirePipelineGlobalToggles()` |

### app.js placeholder comments (pending full cleanup)

After Phase 1, app.js retains one-line manifest comments where full function bodies were removed:

- `// initializePipelineStageDragAndDrop → public/scripts/comp/pipelineStageControls.js (Phase 1 removal manifest)`
- `// setupExpandCanvasStageEvents → …`
- `// setupStageCustomResolutionControls → …`
- `// setupEnhanceStageEvents → …`
- `// setupStageAdvancedControls → …`

**Phase 2+:** Delete placeholder comments once no references remain.

### Verification

```bash
node --check public/scripts/comp/pipelineStageControls.js
node --check public/scripts/app.js
```

After client edits: `bash scripts/notify-service-worker-update.sh --recompile`

---

## Phase 1: Compare View Manager

**New file:** `public/scripts/comp/compareViewManager.js`  
**Script order:** After `mainMenuManager.js`, before `app.js` (see `public/app.html`).

### Public API (globals)

| Function | Purpose |
|----------|---------|
| `wireCompareViewListeners()` | Wires compare preview pointer/keyboard/blur listeners + use-as-source context menu |

Also moved (same names as former app.js helpers):

- `getCompareColorSubmenu`, `getManualCompareElements`, `getCurrentPreviewDimensions`
- Compare display/state: `updateCompareDisplayState`, `updateCompareControlsState`, `applyCompareRuntimeSettings`, etc.
- Baseline/sync: `setCompareSourceFromCurrentPreview`, `syncCompareSourceAfterPreviewResize`, `registerCompareBaseline`, etc.
- Pointer/modifier: `startComparePointerDrag`, `updateComparePointerDrag`, `endComparePointerDrag`, `updateCompareShiftOverrides`
- Hotkey: `compareAltF10CycleHotkey`

### app.js line ranges (baseline at Phase 1 extract)

| Section | app.js lines | Status |
|---------|--------------|--------|
| Compare state globals (`previewRatio`, `compareSourceImageData`, `COMPARE_*`, flags) | L26–L92 | ✅ **Removed** → `compareViewManager.js` |
| `compareAltF10ComboIndex` | L557 | ✅ **Removed** → `compareViewManager.js` |
| Compare functions | L94–L1169 | ✅ **Removed** → `compareViewManager.js` |
| Compare listeners (`setupEventListeners`) | L10814–L10883 | ✅ **Removed** → `wireCompareViewListeners()` |

**Original spec mapping:** variables L21–L87, L552; functions L89–L1164; listeners L10819–L10878.

**Init:** Self-init on `DOMContentLoaded` in comp file.

**Dependencies (remain in app.js):** `contextMenu`, `showGlassToast`, `RESOLUTIONS`, manual preview DOM.

### Verification

```bash
node --check public/scripts/comp/compareViewManager.js
```

---

## Phase 1: Compiled Prompt Inspector

**New file:** `public/scripts/comp/compiledPromptInspector.js`  
**Script order:** After `compareViewManager.js`, before `app.js`.

### Public API (globals)

| Function | Purpose |
|----------|---------|
| `showCompiledPromptModal(compiledPromptData?)` | Renders and opens `#compiledPromptModal` |
| `clearCompiledPrompt()` | Confirms and clears `window.dynamicGenerationData.compiled_prompt` |
| `wireCompiledPromptInspectorListeners()` | Wires `#closeCompiledPromptBtn` → `closeModal` |

### app.js line ranges (baseline at Phase 1 extract)

| Section | app.js lines | Status |
|---------|--------------|--------|
| `showCompiledPromptModal` | L6536–L7434 | ✅ **Removed** → `compiledPromptInspector.js` |
| `clearCompiledPrompt` | L7437–L7479 | ✅ **Removed** → `compiledPromptInspector.js` |
| Close button listener (`setupEventListeners`) | L12510–L12520 | ✅ **Removed** → `wireCompiledPromptInspectorListeners()` |

**Original spec mapping:** L6532–L7429, L7432–L7474.

**Init:** Self-init on `DOMContentLoaded` in comp file. `clearCompiledPrompt` still invoked from context menu routing in `app.js`.

**Dependencies (remain in app.js):** `dynamicCarousel`, `clearDynamicGenerationLockState`, `updateDynamicGenerationToggleBtn`, `showGlassToast`, `showConfirmationDialog`, `openModal`, `closeModal`.

### Verification

```bash
node --check public/scripts/comp/compiledPromptInspector.js
```

---

## Phase 2 removal checklist (compare + compiled prompt)

- [x] Move compare state globals (app.js L26–L92, L557) into `compareViewManager.js` and delete from `app.js`
- [x] Delete duplicated compare functions (app.js L94–L1169)
- [x] Remove duplicate compare listener block in `setupEventListeners` (L10814–L10883)
- [x] Delete `showCompiledPromptModal` / `clearCompiledPrompt` from `app.js` (L6536–L7479)
- [x] Remove duplicate `#closeCompiledPromptBtn` handler (L12510–L12520)
- [x] Remove dangling listeners: search toggle (`fileSearch.js`), autocomplete dismiss (`autocompleteUtils.js`)
- [ ] Smoke-test compare overlay/slide/loupe and compiled prompt modal

---

## 8. Suggested removal order (Phase 2)

Execute scripted deletion only after Phase 1 copy + wiring is verified (`node --check`, smoke tests). Order minimizes coupling breakage:

1. **Compare view** (`compareViewManager.js`) — isolated; few external callers
2. **Compiled prompt inspector** — modal-contained
3. **Dynamic generation** (carousel + controls + `contextMenuAction` L9259–L9450) — dedupe L12584/L29810 — ✅ **batch 2 complete** (25,270 lines)
4. **Character prompts** — `characterPromptManager.js` enabled (position dialog); remove app.js CRUD duplicates in Phase 2 — ✅ **position dialog + listeners removed** (batch 3); CRUD remains
5. **Manual preview manager** — after compare
6. **Expander lock inspector** — dedupe `escapeHtml` / `extractBiasFromTextForDisplay`
7. **Pipeline stages** — largest; last major asset move
8. **Peel `setupEventListeners`** — subsystem-by-subsystem as each feature file is stable
9. **Dangling listeners** (§6 in master analysis) — per target file with original `setupEventListeners` blocks
10. **Dangling assets** — presets, gallery ops, utilities
11. **`mainMenuManager.js` / `focusOverlayManager.js`** — remove duplicates L11195–L11415, L27740–L28878
12. **System tray + exit confirmation**
13. **WebSocket handlers + init steps** — when globals stabilized
14. **Window controls overlay** — comp file ready (`windowControlsOverlay.js`); remove app.js L24832–L25271 — ✅ **batch 3 complete**
15. **Residual orchestration** — thin shell: `fetchWithAuth`, cross-feature glue

### Phase 2 checklist (per block)

- [ ] Duplicate exists in comp file and is wired
- [ ] `node --check` on all touched comp files
- [ ] No duplicate `contextMenuAction` / double `addEventListener` on same element
- [ ] Script tag order in `app.html` correct
- [ ] `bash scripts/notify-service-worker-update.sh --recompile`
- [ ] Smoke: manual modal, gallery, generation, compare, Rentan, tray, exit guard

*Last updated: Phase 2 batch 13 — final shell; app.js 41 lines.*

## Wave 2: Manual Tab Manager

**New file:** `public/scripts/comp/manualTabManager.js`  
**Script order:** After `characterPromptManager.js`, before `pipelineStageControls.js` (see `public/app.html`).

### Public API (globals)

| Function | Purpose |
|----------|---------|
| `switchManualTab(targetTab, previouslyFocused?)` | Switches prompt/UC/creative tab in manual modal |
| `syncCharacterPromptTabs(mainTab)` | Syncs character prompt tabs to main tab |
| `syncCharacterPromptTabsShowBoth()` | Shows both panes on all character prompts |
| `toggleManualShowBoth()` | Toggles show-both mode on main prompt tabs |
| `wireManualTabListeners()` | Wires tab buttons, show-both, focusin tracking |

### app.js line ranges (baseline at Wave 2 extract)

| Section | app.js lines | Status |
|---------|--------------|--------|
| Tab functions | L9430–L9657 | **Duplicated** in comp file |
| Tab listeners (`setupEventListeners`) | L8940–L8983 | **Duplicated** via `wireManualTabListeners()` |

**Init:** `registerInitStep(47.2, 'Manual tab listeners', …)`.

**Dependencies:** `prepareManualTabLayout` (utilities.js), `customScrollbar`, emphasis helpers.

### Verification

```bash
node --check public/scripts/comp/manualTabManager.js
```

---

## Wave 2: Text Overlay Manager

**New file:** `public/scripts/comp/textOverlayManager.js`  
**Script order:** After `manualTabManager.js`, before `pipelineStageControls.js`.

### Public API (globals)

`addTextOverlay`, `setupTextOverlayDropdowns`, `renderTextOverlayTargetDropdown`, `renderTextOverlayStageDropdown`, `renderTextOverlayTypeDropdown`, `setupTextOverlayToolbarHandlers`, `selectTextOverlayTarget`, `toggleTextOverlayStage`, `updateTextOverlayStageDisplay`, `groupSequentialStages`, `selectTextOverlayType`, `updateTextOverlayPlaceholder`, `updateAllTextOverlayPlaceholders`, `toggleTextOverlayEnabled`, `deleteTextOverlay`, `clearTextOverlays`, `updateAllTextOverlayTargetDropdowns`, `updateTextOverlayStageVisibility`, `getTextOverlayData`, `loadTextOverlays`, `extractTextFromPrompt`.

### app.js line ranges (baseline at Wave 2 extract)

| Section | app.js lines | Status |
|---------|--------------|--------|
| Text overlay functions | L16482–L17312 | ✅ **Removed** (batch 4) → `textOverlayManager.js` |
| `renderAddItemDropdown` text-overlay option | (calls `addTextOverlay`) | **Remains in app.js** |

**Dependencies:** `textOverlaysContainer`, `textOverlayCounter` (manualModalManager.js); `STAGE_TYPES`, `calculateStageHexId`, `getPipelineStages` (app.js at runtime).

### Verification

```bash
node --check public/scripts/comp/textOverlayManager.js
```

---

## Wave 2: Character Prompt Manager (position dialog)

**File:** `public/scripts/comp/characterPromptManager.js`  
**Script order:** After `manualModalManager.js`, before `manualTabManager.js`.

### Public API (globals)

| Function | Purpose |
|----------|---------|
| `getCellLabelFromCoords(x, y)` | Grid cell label from normalized coords |
| `updateAutoPositionToggle()` | Show/hide position controls per character count |
| `getOccupiedPositionCellLabels(excludeId)` | Occupied cells for position picker |
| `isPositionDialogTopModal()` | Whether position dialog is top modal |
| `showPositionDialog(characterId)` | Opens position grid modal |
| `hidePositionDialog()` | Closes position dialog |
| `confirmPosition()` | Applies selected cell to character |
| `wireCharacterPromptPositionListeners()` | Cancel/confirm/grid/keyboard handlers |

### app.js line ranges (baseline at Wave 2 extract)

| Section | app.js lines | Status |
|---------|--------------|--------|
| `getCellLabelFromCoords` | L21456–L21465 | **Duplicated** in comp file |
| Position dialog functions | L15775–L15977 | **Duplicated** in comp file |
| Position listeners (`setupEventListeners`) | L8811–L8862 | **Duplicated** via `wireCharacterPromptPositionListeners()` |
| Full CRUD (`addCharacterPrompt`, etc.) | L15979+ | ✅ **Removed** (batch 12) → `characterPromptManager.js` |

**Init:** `registerInitStep(47.1, 'Character prompt position dialog', …)`.

### Verification

```bash
node --check public/scripts/comp/characterPromptManager.js
```

---

## Wave 2: Window Controls Overlay

**New file:** `public/scripts/comp/windowControlsOverlay.js`  
**Script order:** After `systemTrayManager.js`, before `app.js`.

### Public API (globals)

| Function | Purpose |
|----------|---------|
| `initWindowControlsOverlay()` | WCO class application, Android caption bridge, mutation observer |
| `updateWindowControlsOverlayClasses()` | Debounced overlay class refresh (on `window`) |
| `isWindowControlsOverlayAvailable()` | Whether WCO/caption-bar is active (on `window`) |
| `updateAndroidCaptionControlsOverlay()` | Native caption button chrome (on `window`) |
| `getWindowControlsOverlayState()` | Debug/diagnostic snapshot (on `window`) |
| `activateTitlebarResizeListeners()` | Deferred resize listener activation |

### app.js line ranges (baseline at Wave 2 extract)

| Section | app.js lines | Status |
|---------|--------------|--------|
| WCO `DOMContentLoaded` body | L24842–L25142, L25145–L25241 | **Duplicated** in `initWindowControlsOverlay()` |
| `initVirtualKeyboard` / `wsClient.init` | L24834–L24840 | **Remain in app.js** |
| `wireFocusOverlayListeners()` call | L25143–L25144 | **Remain in app.js** (also in focusOverlayManager.js) |
| `activateTitlebarResizeListeners` | L25248–L25271 | **Duplicated** in comp file |

**Init:** Self-init on `DOMContentLoaded` in comp file.

### Verification

```bash
node --check public/scripts/comp/windowControlsOverlay.js
```
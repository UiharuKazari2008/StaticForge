# Modal Keyboard Shortcuts Audit — StaticForge

**Date:** June 26, 2026  
**Scope:** `public/app.html` modals + dynamic modals; managers in `public/scripts/comp/`  
**APIs reviewed:** `modalKeyboardRegistry.js`, `keyboardShortcuts.js`, `docs/modal-listener-refactor-plan.md`

---

## Executive Summary

| Metric | Count |
|--------|------:|
| **Modals scanned** | **~83** (79 `class="modal"` in `app.html` + `galleryWindow` + 3 JS-created: `confirmationDialog`, `creditCostDialog`, `datasetTagToolbar`) |
| **Excluded from count** | `manualModalSplash` (splash, not modal); `notepadModalTemplate` / `imageViewerModalTemplate` (clone templates); `directorRulesModal` (referenced in JS/CSS only — **no HTML**) |
| **With functional keyboard shortcuts** | **~22** (registry and/or scoped element listeners) |
| **With Alt overlay metadata only** | **~12** groups |
| **With Esc/Close only** | **~8** |
| **No meaningful shortcuts** | **~45+** |
| **High-priority opportunities** | **~35** actions across **~25** modals |

**Infrastructure:** Central routing via `registerKeyboardListener` (`global` / `whenOpen` / `whenFocused`). Alt overlay driven by registry metadata (`label`, `keys`, `overlayGroup`, `overlayOnly`, `overlayFnRow`). Bare `F1`–`F12` keys render in the wide-layout FN key row (auto via `resolveRegistryOverlayFnRow` in `keyboardShortcuts.js` and `resolveOverlayFnRowForKeys` in `registerModalOverlayEntries`). Manual modal shortcuts still live in global `keyboardShortcuts.js` `handleKeyDown` (priority 50), not per-modal registrations.

---

## Cross-Cutting Recommendations

1. **Migrate direct `document`/`modal` keydown to `registerKeyboardListener`** — dev warnings tray flags offenders (`modalKeyboardRegistry.js` patches `document.addEventListener`).
2. **Standard dialog trio:** `Esc` = cancel/close, `Enter` = primary (skip `TEXTAREA`), `1–9` = option pick (confirmation pattern).
3. **Form modals:** `Ctrl+S` = save/apply; `Esc` = close (confirm if dirty where applicable).
4. **List/pagination modals:** `Page Up`/`Page Down` or `←`/`→` (preset manager pattern).
5. **Overlay groups:** use consistent names — `Dialog`, `Gallery`, `Manual`, `Preset Manager`, `Tag Toolbar`, `Run`, `Explorer`, etc.
6. **`whenFocused` vs `whenOpen`:** use **`whenFocused`** for modal-specific actions (Esc, F-keys, nav) that require the active window; reserve **`whenOpen`** for shortcuts that must fire while the modal is on stack but unfocused (e.g. compare-view peek on `#manualModal`).
7. **Alert-theme modals** (`characterDataConfirmModal`, `biasAdjustmentConfirmDialog`, etc.) should reuse confirmation handler or register equivalent `Esc`/`Enter`/`1–9`.
8. **Run applet:** handlers work on `#runModalInput` but are **not** in registry — migrate handler + keep overlay entries.

---

## Modals With Good Coverage

| Modal | Why |
|-------|-----|
| `manualModal` | Extensive F-keys, Alt combos, preview nav via `keyboardShortcuts.js`; rich Alt overlay (`classic-left` / `classic-right` / FN rows) |
| `galleryWindow` | F1–F8, arrows, Home/End, batch Ctrl+A, double-Esc; registry handlers + `Gallery` overlay |
| `confirmationDialog` / `creditCostDialog` | Esc, Enter, 1–9; `Dialog` overlay |
| `pinModal` | Digits, Enter, Backspace; `PIN` overlay |
| `presetManagerModal` | Esc (nested `updatePresetModal` aware), Page Up/Down; `Preset Manager` overlay |
| `datasetTagToolbar` | Arrow nav, Enter, Esc; `Tag Toolbar` overlay |
| `runModal` | Full list nav (arrows, Enter, Esc, action panel) — **overlay only, handler not in registry** |
| `expansionCompiledPromptDialog` | F1/F2 tab switch via global handler + `expansion` overlay profile |
| `bracketGenerationModal` | Esc registry; F1/F2/F8 + Alt+A/K via global; Tab overlay-only |
| `positionDialog` | Esc/Enter via scoped capture (`characterPromptManager.js`) |
| `compareViewManager` | Alt/Shift peek (manual modal scope; no overlay) |
| `explorerModal` | Ctrl+C/X/V, F2, Delete/Shift+Delete — registry handler + `Explorer` overlay |

---

## Top 10 High-Priority Opportunities

| # | Modal | Missing | Suggested keys | overlayGroup | Priority |
|---|-------|---------|----------------|--------------|----------|
| 1 | `textReplacementManagerModal` cluster | List pagination, create/save, registry Esc | `←`/`→` or PgUp/PgDn; `Ctrl+S` save create; `Esc` | `Text Replacements` | **High** |
| 2 | `maskEditorDialog` | Save, close | `Ctrl+S` → `#saveMaskBtn`; `Esc` close | `Mask Editor` | **High** |
| 3 | `imageBiasAdjustmentModal` | Apply/save, reset | `Enter` apply; `Esc` close; `Ctrl+R` reset | `Image Bias` | **High** |
| 4 | `tagWikiSearchModal` | Result navigation, focus search | `↑`/`↓` results; `Ctrl+L` address; `Enter` open | `Grimoire` | **High** |
| 5 | `compileToPromptsModal` | Apply actions | `Enter` apply; `Shift+Enter` apply+close; `Esc` | `Compile Prompts` | **High** |
| 6 | `imageExpansionDialog` | Run/close | `Enter` run expansion; `Esc` close | `Expansion` | **High** |
| 7 | `naxVibesModal` | Esc, search, grid nav | Mirror `naxtModal`: `Esc`, `Enter` search, arrow grid | `Nax Vibes` | **High** |
| 8 | `explorerModal` | Registry + overlay for existing shortcuts | Document existing Ctrl+C/X/V, F2, Del | `Explorer` | **High** |
| 9 | `desktopSettingsModal` | Save, tab sections | `Ctrl+S` save settings; `Esc` close | `Settings` | **High** |
| 10 | `runModal` | Registry migration | Move `handleKeydown` to `whenOpen` handler | `Run` | **High** (maintainability) |

---

## Detailed Tables by Category

### Startup / Connection (rare, boot-only)

| ID | Manager | Existing | Missing | Suggested | Priority |
|----|---------|----------|---------|-----------|----------|
| `desktopPreStartupModal` | `websocket.js` | None | Continue / dismiss | `Enter` continue if button focused | Low |
| `windowsStartupModal` | `websocket.js` | None | Boot wait UI | None needed | Low |
| `windowsUpdateModal` | `websocket.js` | None | Restart/skip if buttons | `Enter` primary | Low |
| `dreamscapeOsInstallWizardModal` | `websocket.js` | None | Next/back steps | `Enter` next, `Esc` cancel | Medium |
| `connectionDialModal` | `websocket.js` | None | Cancel connect | `Esc` cancel | Low |

### Gallery Cluster

| ID | Manager | Existing | Missing | Suggested | Priority |
|----|---------|----------|---------|-----------|----------|
| `galleryWindow` | `galleryView.js` | F1–F8, arrows, Home/End, batch Ctrl+A, double-Esc; overlay | Close window Esc (desktop stack) | `Esc` close when top | Medium |
| `photoSwipeWindow` | `lightbox.js` | PageUp/PageDown (direct listener) | Esc, overlay, registry | `Esc` close; overlay `PhotoSwipe` | Medium |
| `galleryJumpIndexTool` | `galleryView.js` | None | Jump on Enter | `Enter` jump; `Esc` close | Medium |

### Manual Modal Cluster

| ID | Manager | Existing | Missing | Suggested | Priority |
|----|---------|----------|---------|-----------|----------|
| `manualModal` | `manualModalManager.js` + `keyboardShortcuts.js` | **Excellent** (F1–F10, Alt combos, Ctrl+F/I, preview nav) | Ctrl+S save preset? | Audit if save exists | Low |
| `positionDialog` | `characterPromptManager.js` | Esc, Enter | Overlay | `Esc`/`Enter` overlay `Position` | Low |
| `textReplacementLockModal` | `textReplacementManager.js` | None registry | Esc, apply lock | `Esc`; `Enter` confirm | Medium |
| `textReplacementManualSelectionModal` | `textReplacementManager.js` | None | Select, Esc | `Enter` select; `Esc` | Medium |
| `timeDateModal` | `manualDropdownManager.js` / weather utils | None | Save, verify | `Enter`/`Ctrl+S` → `#saveTimeDateBtn`; `Esc` | Medium |
| `weatherLocationModal` | same | None | Verify, save | `Enter` verify; `Ctrl+S` save | Medium |
| `compiledPromptModal` | `compileToPromptsApplet.js` | None | Close, copy | `Esc`; `Ctrl+C` copy | Low |
| `compileToPromptsModal` | `compileToPromptsApplet.js` | None | Apply/cancel | See top 10 | **High** |
| `directorFeedbackModal` | `directorLearningAdmin.js` | Scoped listeners only | Submit, Esc | `Ctrl+Enter` submit; `Esc` | Medium |
| `measurementsModal` | `director.js` | None | Save measurements | `Ctrl+S`; `Esc` | Medium |
| `characterDataConfirmModal` | `characterPromptManager.js` | Buttons only | Confirmation pattern | Esc/Enter/1–9 | Medium |
| `imageExpansionDialog` | `imageExpansion.js` | F1/F2 in child dialog only | Run, close parent | See top 10 | **High** |
| `expansionCompiledPromptDialog` | `imageExpansion.js` + `keyboardShortcuts.js` | F1/F2, overlay | Esc close | `Esc` | Low |

### Image Tools

| ID | Manager | Existing | Missing | Suggested | Priority |
|----|---------|----------|---------|-----------|----------|
| `maskEditorDialog` | `inpaint.js` | None | Save | See top 10 | **High** |
| `imageBiasAdjustmentModal` | `imageBias.js` | None | Apply, reset, Esc | See top 10 | **High** |
| `biasAdjustmentConfirmDialog` | `imageBias.js` | Alert buttons | Confirmation keys | Esc/Enter | Medium |
| `baseImageChangeAlertModal` | `imageBias.js` | Alert | Confirmation keys | Esc/Enter | Medium |
| `imageBiasMaskAlertModal` | `imageBias.js` | Alert | Confirmation keys | Esc/Enter | Medium |
| `metadataDialog` | `metadataDialogManager.js` | Esc via global escape handler | Tab switch, copy | `Esc` overlay; `Ctrl+C` | Low |

### Managers / Settings

| ID | Manager | Existing | Missing | Suggested | Priority |
|----|---------|----------|---------|-----------|----------|
| `textReplacementManagerModal` | `textReplacementManager.js` | Esc on create modal element | Pagination, registry | See top 10 | **High** |
| `createTextReplacementModal` | same | Esc element | Save | `Ctrl+S` | **High** |
| `favoritesManagerModal` | same | None | Delete, Esc | `Del`; `Esc` | Medium |
| `requestBodyReplacementsModal` | `requestBodyReplacementsModal.js` | Esc element | Create, pagination | `Ctrl+N`; PgUp/PgDn | Medium |
| `createRequestBodyReplacementModal` | same | Esc element | Save | `Ctrl+S` | Medium |
| `presetManagerModal` | `presetManager.js` | **Good** | — | — | — |
| `updatePresetModal` | same | Esc element | Save | `Ctrl+S` | Medium |
| `workspaceManageModal` | `workspaceUtils.js` | None | New, delete, Esc | `Esc`; `Ctrl+N` | Medium |
| `workspaceEditModal` | same | None | Save | `Ctrl+S`; `Esc` | Medium |
| `workspaceDumpModal` | same | None | Confirm dump | Enter/Esc | Low |
| `cacheManagerModal` | `referenceManager.js` | Scoped clicks | Search, delete | `Ctrl+F`; `Del` | Medium |
| `cacheMetadataModal` | `referenceManager.js` | Close btn | Esc | `Esc` | Low |
| `apiKeyModal` | `apiKeyModal.js` | Scoped DOM | Refresh, Esc registry | `F5` refresh; `Esc` | Medium |
| `addApiKeyModal` | same | Scoped | Save | `Ctrl+S`; `Esc` | Medium |
| `desktopSettingsModal` | `modalUtils.js` | Scoped | Save, section tabs | See top 10 | **High** |
| `ipManagementModal` | server mgmt | None | Refresh, close | `F5`; `Esc` | Low |
| `ipDetailsModal` | same | None | Esc | `Esc` | Low |

### Applets / Tools

| ID | Manager | Existing | Missing | Suggested | Priority |
|----|---------|----------|---------|-----------|----------|
| `spellbookGenerationModal` | `spellbookModal.js` | Esc registry + overlay | Generate, tab nav | `Enter` cast; `F5` refresh list | Medium |
| `bracketGenerationModal` | `bracketGenerationApplet.js` | Esc, F1/F2/F8, Alt+A/K | Registry for F8/Alt (global only) | Move handlers to `whenOpen` | Medium |
| `tagWikiSearchModal` | `tagWikiSearchModal.js` | Esc, Enter overlay | List nav | See top 10 | **High** |
| `naxtModal` | `naxtApplet.js` | Esc, Enter overlay (search input) | Grid nav, custom tag | `↑`/`↓` grid; `Esc` on child | Medium |
| `naxVibesModal` | `naxVibesApplet.js` | Enter in search only | Esc, overlay, nav | See top 10 | **High** |
| `naxVibesEncodingPickerModal` | `naxVibesApplet.js` | None | Select, Esc | `Enter`; `Esc` | Medium |
| `naxtCustomTagModal` | `naxtApplet.js` | None | Generate, Esc | `Enter` generate; `Esc` | Medium |
| `configEditorModal` | `configEditorApplet.js` | Esc registry | Save, undo | `Ctrl+S`; `Ctrl+Z` | Medium |
| `configEditorValueModal` | same | None | Save/cancel | `Ctrl+S`; `Esc` | Medium |
| `logViewerModal` | `logViewerApplet.js` | Esc registry | Pause, clear, filter | `Space` pause; `Ctrl+F` filter | Medium |
| `websocketRequestsModal` | `websocketRequestsModal.js` | Scoped auto-refresh | Esc, refresh | `F5`; `Esc` | Low |
| `runModal` | `runApplet.js` | Full nav (element); overlay | Registry handler | See top 10 | **High** |
| `explorerModal` | `explorerApplet.js` | Ctrl+C/X/V, F2, Delete | Registry + overlay | See top 10 | **High** |
| `notebookModal` | `notepadManager.js` | None | New note, save | `Ctrl+S`; `Ctrl+N` | Medium |
| `openNoteModal` / `updateNoteModal` | same | Close btns | Save, Esc | `Ctrl+S`; `Esc` | Medium |
| `novelEditorTool` / `novelProgressTool` | `novelManager.js` | None | Save chapter, Esc | `Ctrl+S`; `Esc` | Low |
| `quipsDsapApplet` | `quipsDsapApplet.js` | Injected dialog wiring | Settings save Esc | Mirror confirmation | Low |
| `bracketGenerationModal` | (see above) | | | | |
| `dreamscapeAppErrorModal` | app error handler | Close btn | Esc, copy | `Esc`; `Ctrl+C` | Low |
| `tokenDisplayModal` | token utils | Close btn | Esc, select all | `Esc`; `Ctrl+A` | Low |
| `virtualKeyboardModal` | `virtualKeyboard.js` | Dispatches synthetic keys | N/A (input device) | — | — |
| `directorRulesModal` | `directorLearningAdmin.js` | **Orphan** (no DOM) | N/A | Remove dead refs or add HTML | Low |

### Upload / Vibe / Chat

| ID | Manager | Existing | Missing | Suggested | Priority |
|----|---------|----------|---------|-----------|----------|
| `unifiedUploadModal` | upload manager | None | Import, Esc | `Enter` import; `Esc` | Medium |
| `vfsImportChoiceModal` | VFS | None | Choose option | 1–2 keys | Low |
| `vibeEncodingModal` | vibe manager | None | Encode, Esc | `Enter`; `Esc` | Medium |
| `vibeManagerDeleteModal` / `MoveModal` | same | Alert-style | Confirm | Esc/Enter | Low |
| `bulkChangePresetModal` | gallery/preset | None | Apply | `Enter`; `Esc` | Medium |
| `chatModal` | `chatSystem.js` | None | Start chat | `Enter` | Low |
| `chatInterfaceModal` | same | Enter send (input); overlay-only | Esc, new line | `Esc`; `Shift+Enter` | Medium |
| `personaSettingsModal` | same | None | Save | `Ctrl+S`; `Esc` | Medium |

### Transient / Security / Misc

| ID | Manager | Existing | Missing | Suggested | Priority |
|----|---------|----------|---------|-----------|----------|
| `pinModal` | `pinModal.js` | **Excellent** | — | — | — |
| `confirmationDialog` | `confirmationDialog.js` | **Excellent** | — | — | — |
| `creditCostDialog` | `creditCostDialog.js` | **Excellent** | — | — | — |
| `datasetTagToolbar` | `datasetTagToolbar.js` | **Excellent** | — | — | — |
| `aboutMelatoninModal` | `modalUtils.js` | None | Close | `Esc` | Low |
| `imageViewerModalTemplate` | `imageViewer.js` | Mouse/touch scoped | Esc close, zoom | `Esc`; `+`/`-` | Medium |
| `notepadModalTemplate` | `notepadManager.js` | None | Save | `Ctrl+S` | Medium |
| `compareViewManager` | (manual child) | Alt/Shift peek | Overlay for peek | `Alt+L/R` overlay | Low |

---

## Registry Inventory (Functional Handlers)

| ID | Type | Modal | Priority |
|----|------|-------|----------|
| `keyboardShortcuts.keydown` / `.keyup` | global | — | 50 |
| `keyboardShortcuts.escapeCharacterDetail` | global | — | 60 |
| `compareView.keydown` / `.keyup` | whenOpen | `manualModal` | 65 |
| `datasetTagToolbar.keydown` | whenOpen | `datasetTagToolbar` | 70 |
| `galleryWindow.batchSelectionKeydown` | whenOpen | `galleryWindow` | 55 |
| `galleryWindow.functionKeys` | whenOpen | `galleryWindow` | 58 |
| `spellbookModal.escape` | whenOpen | `spellbookGenerationModal` | 80 |
| `presetManagerModal.escape` | whenOpen | `presetManagerModal` | 80 |
| `pinModal.keydown` | whenOpen | `pinModal` | 90 |
| `confirmationDialog.keydown` | whenOpen | `confirmationDialog` | 85 |
| `creditCostDialog.keydown` | whenOpen | `creditCostDialog` | 85 |
| `bracketGenerationModal.escape` | whenOpen | `bracketGenerationModal` | 80 |
| `naxtModal.escape` | whenOpen | `naxtModal` | 80 |
| `tagWikiSearchModal.escape` | whenOpen | `tagWikiSearchModal` | 80 |
| `logViewerModal.escape` | whenOpen | `logViewerModal` | 80 |
| `configEditorModal.escape` | whenOpen | `configEditorModal` | 80 |

**Overlay-only registrations:** Manual FN/classic rows, expansion, bracket, gallery, preset pagination, dataset tag toolbar, run, pin, confirmation/creditCost, naxt search, tag wiki search, chat send, global Ctrl+Tab.

---

## Brief Summary

- **Total modals scanned:** ~83  
- **Top 10 high-priority:** text replacement cluster, mask editor, image bias, tag wiki nav, compile-to-prompts, image expansion, nax vibes, explorer registry migration, desktop settings save, run modal registry migration  

**Best-covered today:** `manualModal`, `galleryWindow`, `confirmationDialog`, `creditCostDialog`, `pinModal`, `presetManagerModal`, `datasetTagToolbar`.  
**Biggest gaps:** manual child tool windows, manager modals (text replacement, cache, workspace), image tools (mask/bias), applets without Esc registry (`naxVibes`, `logViewer` beyond Esc, `websocketRequests`).

---

## Overlay validity gates

**Audit date:** June 26, 2026 (overlayValid pass)  
**Registrations with overlay metadata audited:** **124** (overlay-only + handler entries with `label`/`keys`; includes manual FN/classic rows registered via `registerShortcutOverlayListItem`)  
**Given `overlayValid`:** **39** (37 new + 2 pre-existing desktop F2/Delete)

Infrastructure: `overlayValid: () => boolean` on `registerKeyboardListener` options; evaluated in `getActiveKeyboardOverlayEntries()`. `registerModalOverlayEntries()` forwards per-entry `overlayValid`. Manual-modal FN/classic rows pass `overlayValid` via item defs / `registerShortcutOverlayFnRow`. Live refresh while Alt held: `notifyKeyboardOverlayContextChanged()` → `setKeyboardOverlayRefreshCallback(refreshShortcutsOverlayIfVisible)`.

| Group / modal | Shortcut (overlay) | Gate | Refresh trigger |
|---------------|-------------------|------|-----------------|
| **Desktop** | F2 Rename | Exactly 1 shortcut selected | `desktopShortcuts.updateSelectionVisuals` |
| **Desktop** | Delete Remove shortcut | ≥1 shortcut selected | same |
| **Manual** | Alt+F8, Alt+F10, Alt+L/R peek | Compare source image loaded | `setCompareSourceData`, `clearCompareSourceImage` |
| **Manual** | Alt FN row F8/F10 | same | same |
| **Gallery** | Ctrl+A Select all | Batch / selection-mode active | `updateBulkActionsBar` |
| **Gallery** | Del Delete selected | Selection-mode + ≥1 selected | same |
| **Gallery** | Esc×2 Clear selection | Selection-mode + ≥1 selected | same |
| **Explorer** | Ctrl+C/X, Del | ≥1 grid item selected | `updateToolbarState` |
| **Explorer** | F2 Rename | Exactly 1 item selected | same |
| **Explorer** | Ctrl+V Paste | Clipboard non-empty | same (clipboard set/clear) |
| **Run** | ↑/↓/Enter | Results list visible, action panel closed | `renderSuggestions`, action panel open/close |
| **Run** | → Actions panel | Selected result has actions, panel closed | same + selection change |
| **Run** | Esc/← Back to results | Action panel open | action panel open/close |
| **Grimoire** | Alt+← Back | `historyIndex > 0` | `updateNavigationButtons`, history nav |
| **Grimoire** | Alt+→ Forward | `historyIndex < length - 1` | same |
| **Grimoire** | Alt+\\ Split toggle | Right-pane toggle visible | `toggleRightPane` |
| **Grimoire** | Alt+Shift+S Swap | Split mode active | `swapSplitPanes`, split toggle |
| **Grimoire** | Ctrl+Shift+C Copy tag | Active pane has wiki tag | history/content restore |
| **Grimoire** | Ctrl+Shift+A Add to prompt | Tag present + `manualModal` open | history restore; modal open/close (registry) |
| **Grimoire** | ↑/↓/Enter results | Search results list non-empty | `_updateSearchResultHighlight` |
| **Confirmation** | Enter Confirm | Primary action button enabled | modal open (registry) |
| **Confirmation** | 1–9 Choose option | ≥2 enabled action buttons | modal open (registry) |
| **Character data confirm** | Enter / 1–9 | Same as confirmation pattern | modal open (registry) |
| **PIN** | Enter Submit | PIN length === 6 | `updatePinDisplay` |
| **PIN** | Backspace | PIN length > 0 | same |
| **PIN** | 0–9 digits | *(always valid when pin open)* | — |
| **Spellbook** | Enter Cast | Generate button enabled | preset select/clear |
| **Preset manager** | PgUp / PgDn | Not on first / last page | `updatePresetPaginationUI` |

**Intentionally ungated (always valid when scope active):** Esc/Close overlays; gallery F1–F8 and scroll/nav; manual F1–F10 (non-compare); expansion/bracket FN rows; dataset tag toolbar nav; compile/mask/bias/settings Esc+Enter; pin digits; lightbox paging; naxt search Enter; global desktop Ctrl+Tab.

# Desktop window inventory (UI standard, #851 / #867)

Taken 2026-11-15 at commit `eb68cfc1`. Every desktop window and dialog, with the skin its markup
asks for, what is on screen, and what it should be under `docs/design/ui-standard.md` section 3.

How it was taken:

- Static windows: every `.modal` element in `public/app.html` (63) and `public/templates/*.html` (19), parsed, not grepped.
- Script-built windows: every script that sets a `modal` class or builds a `modal-window-title`
  (phone `wm*.js` left out), read at the builder.
- On screen: a signed-in desktop test tab (Ruiko's Chrome, Vista theme, frosted glass). 86 of the 89
  launch ids were opened (not Import, Teleport and the Sidebar) and each window's client colour read from
  computed style; every list C window was opened and looked at, several of them empty (opened without
  their data). Screenshots are in `~/.cache/claude-run/darkglass/shots/`, named by
  window id (not in the repository).
- "DARK GLASS" in the On screen column is the legacy client, computed `rgba(48, 80, 78, 0.97)` with
  white text. "see-through" means the client paints nothing itself.
- A row marked "not opened" could not be reached in the test tab (needs a device, a live
  connection or a fault); its list is from markup alone.

Columns: **Skin in markup** is what the element or its builder writes (`dark` token = the legacy
`modal-content dark` class; it is inert under the light client but is still there). **Run-time
retag** is `vistaDialogs.js`. **Target kind** is the standard's window kind.

## Counts

| List | Meaning | Rows |
| --- | --- | --- |
| A | already correct: attributes in its own markup or builder, or a host shell / custom window drawn that way on purpose | 82 (plus 147 factory dialogs, below) |
| B | correct on screen, but only through run-time retagging or scattered attributes | 45 |
| C | dark glass or otherwise off-standard on screen, seen | 19 |
| C? | off-standard by markup, not opened | 5 |

A row can be a family (the 12 MMC consoles, the 13 games); counts are rows.

## List A: already correct

`desktopPreStartupModal`, `windowsStartupModal`, `connectionDialModal`, `novelEditorTool`, `novelProgressTool`, `studioActivityTool`, `positionDialog`, `generationUsageTool`, `studioVSliderTool`, `promptFindTool`, `promptEmphasisTool`, `studioVSliderEditorTool`, `stageResultsReview`, `timeDateModal`, `weatherLocationModal`, `biasAdjustmentConfirmDialog`, `baseImageChangeAlertModal`, `imageBiasMaskAlertModal`, `compiledPromptModal`, `compileToPromptsModal`, `requestFormWindow`, `directorFeedbackModal`, `createTextReplacementModal`, `createRequestBodyReplacementModal`, `updatePresetModal`, `workspaceEditModal`, `workspaceDumpModal`, `studioSaveNameModal`, `studioSaveFolderModal`, `vfsImportChoiceModal`, `vibeEncodingModal`, `bulkChangePresetModal`, `cacheMetadataModal`, `emphasisGroupsToolTemplate`, `tokenDisplayModal`, `dreamscapeConnectivityErrorTemplate`, `aboutMelatoninModal`, `bracketGenerationModal`, `chatModal`, `configEditorValueModal`, `logViewerModal`, `naxtCustomTagModal`, `updateNoteModal`, `runModal`, `dovecoteNewMailModal`, `desktopDovecoteModal`, `desktopDovecoteCompose…`, `desktopDovecoteReader…`, `desktopDovecoteAttachment_…`, `mailOptionsDialog`, `mmcConsole_<id> (12 consoles)`, `domainConnectModal`, `mainframeServerModal`, `mainframeExceptionDialog`, `workstationLockModal`, `bootMessageBox`, `programFaultDialog<n>`, `fileProgressDialog<n>`, `7-Zip dialogs`, `explorer-phone-doc-window`, `dreamscapeCardSpaceModal`, `deviceManagerModal`, `printQueue_<id>`, `imageSearch properties`, `remoteDesktopConnectionModal`, `melatonCharmapModal (+ Group By)`, `melatonPaintModal_<n>`, `desktopMediaPlayer (+ Open URL)`, `sideshowSimulatorModal-<mode>`, `vista<Game>Modal (13 games) + dialogs`, `vistaJezzballModal (+ Help)`, `vistaSidebar gadget gallery`, `desktopCalculatorModal`, `melatonTaskManagerModal`, `melatonPerfmonModal`, `melatonQuickCastModal (+ child windows)`, `melatonMessengerModal`, `melatonMessagingBridgeModal`, `melatonWordPadModal_<n>`, `melatonSoundRecorderModal`, `melatonSnippingModal (+ editor)`, `melatonWindowsCalendarModal`

Plus every dialog, property sheet and wizard built by `vistaDialogTemplate` (147 call sites, table at
the end): correct by construction.

## List B: correct on screen, not by its own markup

Three groups.

**B1, tagged at run time** (`vistaDialogs.js`, 4 ids, see Part 2): `confirmationDialog`,
`creditCostDialog`, `agentClientUpdateDialog`, `unifiedUploadModal`.

**B2, the look comes from a script or a private sheet, not from the window's attributes:**
`tagWikiSearchModal` (Grimoire: IE 7 chrome drawn by `grimoireIeChrome.js` over dark markup),
`naxtModal` (`naxtVistaChrome.js` sets the light client and `.win7`), the Control Panel and
Welcome Center (`dark cpl-content win7`, no `data-window-client`), `vistaGamesExplorerModal`,
`defenderModal`, `desktopTimerModal`, `pinModal` (alert-theme CSS), the two vpn-dialog status
boxes.

**B3, light client without `.win7`, most still carrying the `dark` token:** the rest of the list.
They are light on screen because of `data-window-client="light"` alone; their controls are styled
per window instead of by the kit.

All of list B: `photoSwipeWindow`, `galleryJumpIndexTool`, `textReplacementLockModal`, `maskEditorDialog`, `imageBiasAdjustmentModal`, `directorWindow`, `textReplacementManagerModal`, `favoritesManagerModal`, `requestBodyReplacementsModal`, `presetManagerModal`, `unifiedUploadModal`, `explorerModal`, `notebookModal`, `pinModal`, `imageViewerModalTemplate`, `dreamscapeAppErrorModal`, `dreamscapeAppErrorWindowTemplate`, `characterDbModal`, `chatInterfaceModal`, `configEditorModal`, `configEditorCheckpointsModal`, `tagWikiWindowTemplate`, `tagWikiSearchModal`, `imagePromptInspectorTemplate`, `imagePromptInspectorJsonTemplate`, `naxtModal`, `notepadModalTemplate`, `spellbookGenerationModal`, `confirmationDialog`, `creditCostDialog`, `agentClientUpdateDialog`, `melatonControlPanelModal, welcomeCenterModal`, `melatonConnectionStatusModal`, `domainCustomizeModal`, `defenderModal`, `imageSearchModal`, `directorToolInspector`, `activeSyncStudioWizard`, `desktopEmotionModal`, `vistaGamesExplorerModal`, `desktopTimerModal`, `melatonPayPassModal (+ child dialogs)`, `melatonXLinkModal (+ child dialogs)`, `melatonMobileDeviceCenterModal`, `melatonWeatherModal`

Making B static is mechanical for B3 (add `.win7` where the window has no prompt boxes, drop the
`dark` token) but each one changes which rules style its controls, so each needs its own
before / after check. It was not done in this pass.

## List C: still dark glass or off-standard on screen

Proposals for Yukimi (ui-review, one approval per window). Nothing here was changed.

| Window | Title | Should become | Size | Screenshot |
| --- | --- | --- | --- | --- |
| `imageExpansionDialog` | Expand Canvas | A Vista form dialog (light client, kit combos for mode / resolution / position, `.vista-dialog-footer` with Generate as the default button). | M | `imageExpansionDialog.png` |
| `expansionCompiledPromptDialog` | Expand Canvas - Prompt | The same light tool window as the Inspector (prompt boxes kept, so no `.win7`; kit footer). | S | `expansionCompiledPromptDialog.png` |
| `characterPositionTool` | Character Positions | A light tool window: the canvas stays a dark picture area, Close / Save / Apply become kit buttons in a footer row. | S | `characterPositionTool.png` |
| `characterAutofillTool` | SmartText | A light tool window with a Vista search box and a list view of results. | M | `characterAutofillTool.png` |
| `openNoteModal` | Open Note | Vista's Open dialog: the `fd-client` file dialog Save As already uses, in open mode (planets as the places bar). | M | `openNoteModal.png` |
| `galleryMoveModal` | Move to Workspace (pictures) | Vista's Move Items dialog (Browse For Folder: tree of planets, Move / Cancel) through `vistaDialogTemplate`; one dialog for both call sites. | M | `galleryMoveModal.png` |
| `cacheMoveToWorkspaceModal` | Move to Workspace (references) | Same Move Items dialog as above (shared). | (with the above) | `cacheMoveToWorkspaceModal.png` |
| `directorHistoryWindow` | Director History | A light app window using the Director window's own transcript client. | S | `directorHistoryWindow.png` |
| `vfsSystemTextViewerModal` | System File | Open the file in Notepad, read-only (the existing Notepad window), and drop this viewer. | S | `vfsSystemTextViewerModal.png` |
| `startMenuOrganizerModal` | Organize Start Menu | A light window with a Vista list view (Explorer on the Start Menu folder is the Vista way; a list view with drag handles is the closest in-house control). | S | `startMenuOrganizerModal.png` |
| `comment dialogs (2)` | Comment / vibes comments | A message box through `showConfirmationDialog` (info icon, OK). | S | `commentDialog.png` |
| `desktopGuacModal` | Remote Desktop Manager | A light app window: connections as an Explorer large-icon view with a command bar (Vista's Remote Desktops snap-in is the reference; none captured yet). | M | `desktopGuacModal.png` |
| `(ledge desk template)` | Ledge | A light app window after Windows Photo Gallery: thumbnails on white, command bar, status bar. | M | `ledgeDesk.png` |
| `virtualKeyboardModal` | On-Screen Keyboard | Vista's On-Screen Keyboard (osk.exe): light keys, menu bar, standard caption; measure on the VM. | M | `virtualKeyboardModal.png` |
| `datasetTagToolbar` | Quick Access tags | A light tool window (caption, kit buttons) or a tool bar docked in Studio. | S | `datasetTagToolbar.png` |
| `bootUiDebugWindow` | Boot UI Debug | A light tool window with `.win7` buttons (developer only). | S | `bootUiDebugWindow.png` |
| `cacheManagerModal` | Reference Manager | Keep the cork board as a custom client, but give the window the light client and a Vista command bar in place of the dark glass tool strip. Needs a design call. | M | `cacheManagerModal.png` |
| `galleryWindow` | Workspaces | Custom (Photo Gallery analogue): replace the floating dark glass tool strip with a Vista command bar. Needs a design call. | M | `galleryWindow.png` |
| `manualModal` | DreamStudio | The flagship editor. Either named a `custom` window (keeps its dark client, tokens in one block) or redrawn on the light client. Needs Yukimi's decision before any work. | L | `manualModal.png` |

Not opened, off-standard by markup (C?): `enhanceMiniDialog` (the credit cost skeleton without the
run-time tags; should be a task dialog, S), `activeSyncPackages-<dev>` (no client attribute; S),
`activeSyncScreen-<dev>` (dark by choice, a phone screen mirror: probably a `custom` window, to
confirm), the Remote Desktop session windows (dark markup; frame only, S) and the
`melatonApps.openWindow` default window (not a light client; make the default light + `.win7`
before a package uses it, S).

Suggested order (cheap and often seen first): Expand Canvas and its prompt window, Character
Positions, SmartText, Open Note, Move to Workspace (both), Director History, System File, Organize
Start Menu, the comment dialogs. Then Remote Desktop Manager, Ledge, the On-Screen Keyboard, and the
three that need a design call.

## Part 2: what left the run-time retag list (#867)

`vistaDialogs.js` tagged 27 window ids at run time. 23 now carry the same attributes in their own
markup or builder (`data-vista-dialog`, `data-vista-icon`, `data-window-client="light"`, `.win7`
on the client unless it holds prompt boxes, `.vista-dialog-footer` on the row the tagger picked):

- `public/app.html` (19): biasAdjustmentConfirmDialog, baseImageChangeAlertModal,
  imageBiasMaskAlertModal, positionDialog, createTextReplacementModal,
  createRequestBodyReplacementModal, updatePresetModal, workspaceEditModal, workspaceDumpModal,
  vibeEncodingModal, bulkChangePresetModal, cacheMetadataModal, timeDateModal,
  weatherLocationModal, vfsImportChoiceModal, directorFeedbackModal, compiledPromptModal,
  requestFormWindow, studioSaveNameModal.
- templates (3): chatModal, naxtCustomTagModal, updateNoteModal.
- builder (1): dovecoteNewMailModal (`desktop-apps/dovecote.js`).

Four stay, each for a reason:

| Id | Why it is still tagged at run time |
| --- | --- |
| `confirmationDialog` | message box or task dialog, icon and text cell are decided per call; the phone shell restyles the same element, so it cannot carry the light client statically |
| `creditCostDialog` | has no caption of its own (the tagger builds one) and two scripts build it; needs a builder change, not attributes |
| `agentClientUpdateDialog` | a phone takeover surface (`wm-shell.css`): a static light client would leak into the phone |
| `unifiedUploadModal` | `vistaImportWizard.js` marks a footer of its own; with the tagger away the footer class lands on a different row (seen in the DOM check), so the two modules must be merged first |

One behaviour differs outside the Vista desktop: the run-time tagger removed its tags when the
desktop left Vista mode (the Classic boot theme, or the legacy "maximise Workspaces = leave the
desktop" state). The 23 static windows keep theirs, exactly like the windows that were already
light in markup. None of them opens during boot.

## Static windows (app.html and templates)

| Window | Opened by | Markup at | Skin in markup | On screen | Run-time retag | Image caption icon | Target kind | Mirrors | List | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `characterAutofillTool` | Studio prompt toolbar: SmartText | `app.html:920` | dark | DARK GLASS (`characterAutofillTool.png`) | no | glyph only | tool |  | C |  |
| `desktopPreStartupModal` | boot: logon / Welcome screen | `app.html:1032` | no client | see-through | no | no | host shell | Vista Welcome screen | A | boot shell, own CSS (desktop-boot.css) |
| `windowsStartupModal` | boot: startup progress box | `app.html:1098` | light + .win7 | light | no | no | host shell |  | A |  |
| `bootUiDebugWindow` | boot debugger (dev only: Step / Step Over) | `app.html:1128` | no client | see-through (`bootUiDebugWindow.png`) | no | yes | tool |  | C | developer tool, text on bare glass |
| `connectionDialModal` | boot: Connecting... (VPN) | `app.html:1162` | no client | light | no | yes | host shell | Vista "Connecting to ..." dialog | A | vpn-dialog class, classic boot dialog by design |
| `photoSwipeWindow` | open a picture from Workspaces (Glancewell) | `app.html:1341` | light | not opened (no client element to read) | no | yes | custom (media) | Windows Photo Gallery Viewer | B | light, own wpg client, no .win7 |
| `galleryJumpIndexTool` | Workspaces: Visual Index | `app.html:1409` | light | light | no | yes | tool |  | B | light, no .win7 |
| `novelEditorTool` | Studio: Novel | `app.html:1458` | light + .win7 | light | no | yes | tool |  | A |  |
| `novelProgressTool` | Studio: Novel Generation | `app.html:1501` | light + .win7 | light | no | yes | tool |  | A |  |
| `studioActivityTool` | Studio: Studio Activity | `app.html:1539` | light + .win7 | light | no | yes | tool |  | A |  |
| `manualModal` | launch `studio` | `app.html:1651` | no client | dark (own) (`manualModal.png`) | no | yes | custom |  | C | the flagship editor: Vista frame and menu bar, dark teal client drawn by its own sheets |
| `positionDialog` | Studio character: Position | `app.html:3260` | vista-dialog form + .win7 (`dark` token) | light (`positionDialog.png`) | no | glyph only | dialog (form) |  | A | static tags since #867 |
| `characterPositionTool` | Studio: Character Positions | `app.html:3322` | dark | DARK GLASS (`characterPositionTool.png`) | no | glyph only | tool |  | C |  |
| `generationUsageTool` | Studio: Usage | `app.html:3383` | light + .win7 | light | no | yes | tool |  | A |  |
| `studioVSliderTool` | Studio: vSlider | `app.html:3433` | light + .win7 | light | no | glyph only | tool |  | A | caption image comes from MODAL_APPLICATION_ICONS at open |
| `promptFindTool` | Studio Edit: Find | `app.html:3468` | vista-dialog find | light | no | glyph only | tool | Notepad Find | A | kind `find` in markup, own ptw client |
| `promptEmphasisTool` | Studio Edit: Emphasis | `app.html:3497` | vista-dialog emphasis | light | no | glyph only | tool |  | A | kind `emphasis` in markup |
| `studioVSliderEditorTool` | vSlider: edit widget | `app.html:3528` | light + .win7 | light | no | glyph only | tool |  | A | caption image from MODAL_APPLICATION_ICONS at open |
| `stageResultsReview` | Studio: Stage Results | `app.html:3563` | light + .win7 | light | no | yes | tool |  | A |  |
| `(ledge desk template)` | Ledge (agent tool `ledge`, Director prints) | `app.html:3608` | dark | see-through (bare glass) (`ledgeDesk.png`) | no | yes | app | Windows Photo Gallery | C | template `#ledgeDeskTemplate`, cloned per desk; no light client |
| `textReplacementLockModal` | Studio: Inspector | `app.html:3664` | light (`dark` token) | light | no | yes | tool |  | B | light, `dark` token, no .win7 |
| `imageExpansionDialog` | picture menu: Expand Canvas | `app.html:3742` | dark | DARK GLASS (`imageExpansionDialog.png`) | no | yes | dialog (form) |  | C |  |
| `expansionCompiledPromptDialog` | Expand Canvas: prompt | `app.html:3990` | dark | DARK GLASS (`expansionCompiledPromptDialog.png`) | no | glyph only | tool |  | C | caption image from MODAL_APPLICATION_ICONS at open |
| `timeDateModal` | Studio preset: time of day | `app.html:4226` | vista-dialog form + .win7 (`dark` token) | light (`timeDateModal.png`) | no | yes | dialog (form) | Date and Time | A | static tags since #867 |
| `weatherLocationModal` | Studio preset: weather location | `app.html:4277` | vista-dialog form + .win7 (`dark` token) | light (`weatherLocationModal.png`) | no | yes | dialog (form) |  | A | static tags since #867 |
| `maskEditorDialog` | Studio: Mask Editor | `app.html:4322` | light (`dark` token) | light | no | yes | app | Paint | B | light (command bar per vista-explorer.css), `dark` token, no .win7 |
| `imageBiasAdjustmentModal` | Studio: Image Bias | `app.html:4388` | light (`dark` token) | light | no | yes | app |  | B | light, `dark` token, no .win7 |
| `biasAdjustmentConfirmDialog` | Image Bias: confirm | `app.html:4463` | vista-dialog message + .win7 (`dark` token) | light (`biasAdjustmentConfirmDialog.png`) | no | yes | dialog (message) |  | A | static tags since #867; a hand-built message box (standard: showConfirmationDialog) |
| `baseImageChangeAlertModal` | Image Bias: replace reference | `app.html:4503` | vista-dialog message + .win7 (`dark` token) | light (`baseImageChangeAlertModal.png`) | no | yes | dialog (message) |  | A | static tags since #867; hand-built message box |
| `imageBiasMaskAlertModal` | Image Bias: mask detected | `app.html:4535` | vista-dialog message + .win7 (`dark` token) | light (`imageBiasMaskAlertModal.png`) | no | yes | dialog (message) |  | A | static tags since #867; hand-built message box |
| `compiledPromptModal` | Studio: Reality Crossover Information | `app.html:4670` | vista-dialog form + .win7 | light (`compiledPromptModal.png`) | no | glyph only | dialog (form) |  | A | static tags since #867; caption image from MODAL_APPLICATION_ICONS |
| `compileToPromptsModal` | Studio: Compile to Prompts | `app.html:4698` | light + .win7 | light | no | yes | app |  | A |  |
| `directorWindow` | launch `director` | `app.html:4750` | light | light (`directorWindow.png`) | no | glyph only | app |  | B | light, own client, no .win7; glyph in markup, image added at open |
| `requestFormWindow` | Director tool request_form | `app.html:4790` | vista-dialog form (`dark` token) | light (`requestFormWindow.png`) | no | yes | dialog (form) |  | A | static tags since #867 (no .win7 on purpose: prompt boxes) |
| `directorFeedbackModal` | Inspector: Report Issue to Rentan | `app.html:4812` | vista-dialog form + .win7 (`dark` token) | light (`directorFeedbackModal.png`) | no | yes | dialog (form) |  | A | static tags since #867 |
| `textReplacementManagerModal` | old Expanders window (launch `expanders` opens the MMC console now) | `app.html:4871` | light (`dark` token) | light | no | yes | app | MMC | B | light, `dark` token, no .win7; superseded by mmcConsole_textExpanders |
| `createTextReplacementModal` | Expanders: Create New Expander | `app.html:4929` | vista-dialog form (`dark` token) | light (`createTextReplacementModal.png`) | no | yes | dialog (form) |  | A | static tags since #867 (no .win7: prompt boxes) |
| `favoritesManagerModal` | Favorites | `app.html:4979` | light (`dark` token) | light | no | yes | app |  | B | light, `dark` token, no .win7 |
| `requestBodyReplacementsModal` | Studio: Text Expanders [Embedded] | `app.html:5016` | light (`dark` token) | light | no | yes | app |  | B | light, `dark` token, no .win7 |
| `createRequestBodyReplacementModal` | Embedded expanders: create | `app.html:5060` | vista-dialog form (`dark` token) | light (`createRequestBodyReplacementModal.png`) | no | yes | dialog (form) |  | A | static tags since #867 (no .win7: prompt boxes) |
| `presetManagerModal` | old Spellbook window (launch `presets` opens the MMC console now) | `app.html:5164` | light (`dark` token) | light | no | yes | app | MMC | B | light, `dark` token, no .win7; superseded by mmcConsole_spellbook |
| `updatePresetModal` | Spellbook: Update Preset | `app.html:5211` | vista-dialog form + .win7 (`dark` token) | light (`updatePresetModal.png`) | no | yes | dialog (form) |  | A | static tags since #867 |
| `workspaceEditModal` | Planet: new / edit | `app.html:5351` | vista-dialog form + .win7 (`dark` token) | light (`workspaceEditModal.png`) | no | yes | dialog (form) |  | A | static tags since #867 |
| `workspaceDumpModal` | Planet: Combine Planets | `app.html:5422` | vista-dialog form + .win7 (`dark` token) | light (`workspaceDumpModal.png`) | no | yes | dialog (form) |  | A | static tags since #867 |
| `cacheManagerModal` | launch `reference` | `app.html:5457` | dark | see-through (`cacheManagerModal.png`) | no | yes | custom |  | C | cork board with a dark glass tool strip; no light client |
| `unifiedUploadModal` | launch `import`, file drop | `app.html:5553` | dark | light (`unifiedUploadModal.png`) | yes: form | no | dialog (wizard) | Vista aero wizard | B | still retagged at run time (see Part 2) |
| `explorerModal` | launch `explorer`, `contacts` | `app.html:5811` | light (`dark` token) | light (`explorerModal.png`) | no | yes | app | Windows Explorer | B | light, `dark` token, no .win7 |
| `studioSaveNameModal` | Studio: Save Preset / Save to Desktop | `app.html:6000` | vista-dialog task + .win7 (`dark` token) | light (`studioSaveNameModal.png`) | no | glyph only | dialog (task) |  | A | static tags since #867; caption image from MODAL_APPLICATION_ICONS |
| `studioSaveFolderModal` | Studio: Save As | `app.html:6032` | vista-dialog file | light | no | yes | dialog | Save As (comdlg32) | A | kind `file` in markup, own fd client |
| `vfsImportChoiceModal` | Cartograph: import / copy choice | `app.html:6132` | vista-dialog form + .win7 (`dark` token) | light (`vfsImportChoiceModal.png`) | no | no | dialog (form) |  | A | static tags since #867; icon from data-icon-owner-id |
| `notebookModal` | launch `notebook` | `app.html:6151` | light | light (`notebookModal.png`) | no | yes | app | Windows Journal | B | light, own jnl client, no .win7 |
| `vibeEncodingModal` | Reference: vibe encoding | `app.html:6238` | vista-dialog form + .win7 (`dark` token) | light (`vibeEncodingModal.png`) | no | no | dialog (form) |  | A | static tags since #867; no caption (gallery-move layout); icon from MODAL_APPLICATION_ICONS |
| `bulkChangePresetModal` | Workspaces: Change Preset Name | `app.html:6323` | vista-dialog form + .win7 (`dark` token) | light (`bulkChangePresetModal.png`) | no | yes | dialog (form) |  | A | static tags since #867 |
| `pinModal` | PIN prompt (lock, protected actions) | `app.html:6355` | no client | see-through (`pinModal.png`) | no | no | dialog |  | B | light on screen through alert-theme CSS only; no tags; also a phone takeover surface |
| `cacheMetadataModal` | Reference: Edit Reference Metadata | `app.html:6421` | vista-dialog form (`dark` token) | light (`cacheMetadataModal.png`) | no | yes | dialog (form) |  | A | static tags since #867 (no .win7: prompt boxes) |
| `emphasisGroupsToolTemplate` | Studio: Weight Rack | `app.html:6649` | light + .win7 | light | no | no | tool |  | A | template, cloned; caption icon set per clone |
| `imageViewerModalTemplate` | open a picture (Lumen) | `app.html:6762` | light | see-through | no | yes | custom (media) | Windows Photo Gallery Viewer | B | light, own wpg client, no .win7 |
| `tokenDisplayModal` | Studio: Token Analysis | `app.html:6838` | light + .win7 | light | no | yes | tool |  | A |  |
| `dreamscapeAppErrorModal` | Spectator (app error list) | `app.html:6879` | light | light | no | yes | app | Problem Reports and Solutions | B | light, own client, no .win7 |
| `dreamscapeAppErrorWindowTemplate` | Spectator: one report | `app.html:6922` | light | light | no | yes | app |  | B | light, own client, no .win7 |
| `dreamscapeConnectivityErrorTemplate` | Connection Failure | `app.html:6966` | vista-dialog message | light | no | no | dialog (message) | Vista message box | A |  |
| `aboutMelatoninModal` | About Melaton | `app.html:7007` | light + .win7 | light | no | yes | dialog | About Windows (winver) | A |  |
| `virtualKeyboardModal` | On-Screen Keyboard (tray / touch) | `app.html:7223` | dark | see-through (`virtualKeyboardModal.png`) | no | no | custom | On-Screen Keyboard (osk.exe) | C | dark glass keys, no caption icon |
| `bracketGenerationModal` | launch `bracket-generation` | `templates/bracket-generation.html:1` | light + .win7 | light (`bracketGenerationModal.png`) | no | yes | app |  | A |  |
| `characterDbModal` | old Characters window (launch `character-db` opens the MMC console now) | `templates/character-db.html:2` | light (`dark` token) | light (`characterDbModal.png`) | no | yes | app | MMC | B | light, `dark` token, no .win7; superseded by mmcConsole_characterDb |
| `chatModal` | Chat: new chat settings | `templates/chat.html:2` | vista-dialog form + .win7 (`dark` token) | light (`chatModal.png`) | no | no | dialog (form) |  | A | static tags since #867; no caption (gallery-move layout) |
| `chatInterfaceModal` | launch `chat` | `templates/chat.html:76` | light | light (`chatInterfaceModal.png`) | no | yes | app |  | B | light, own client, no .win7 |
| `configEditorModal` | launch `config-editor` | `templates/config-editor.html:1` | light | light (`configEditorModal.png`) | no | yes | app | Registry Editor | B | light, own client, no .win7 |
| `configEditorValueModal` | Registry Editor: Edit String / DWORD ... | `templates/config-editor.html:56` | vista-dialog regedit | light | no | no | dialog | regedit Edit Value | A | kind `regedit` in markup |
| `configEditorCheckpointsModal` | Registry Editor: Config Checkpoints | `templates/config-editor.html:132` | light (`dark` token) | light (`configEditorCheckpointsModal.png`) | no | yes | dialog |  | B | light, `dark` token, no .win7 |
| `tagWikiWindowTemplate` | Grimoire: wiki page in its own window; Alchemy pop-ups | `templates/grimoire.html:1` | light (`dark` token) | light (`tagWikiWindowTemplate.png`) | no | yes | app | Internet Explorer 7 | B | light, `dark` token, no .win7 |
| `tagWikiSearchModal` | launch `encyclopedia`, `alchemy`, `explore-gallery`, `novels`, `pantry`, `zanzou` | `templates/grimoire.html:48` | dark | light (IE chrome) (`tagWikiSearchModal.png`) | no | yes | app | Internet Explorer 7 | B | markup is dark with no client; grimoireIeChrome.js draws the IE 7 chrome over it at run time (computed client colour is still the dark token) |
| `imagePromptInspectorTemplate` | picture: Properties | `templates/image-prompt-inspector.html:2` | light (`dark` token) | light (`imagePromptInspectorTemplate.png`) | no | yes | sheet | file Properties | B | light, `dark` token, no .win7 |
| `imagePromptInspectorJsonTemplate` | Properties: Image Metadata JSON | `templates/image-prompt-inspector.html:136` | light (`dark` token) | light (`imagePromptInspectorJsonTemplate.png`) | no | glyph only | tool |  | B | light, `dark` token, no .win7; glyph only in markup |
| `logViewerModal` | launch `event-viewer` | `templates/log-viewer.html:2` | light + .win7 | light (`logViewerModal.png`) | no | yes | app | Event Viewer | A |  |
| `naxtModal` | launch `naxt` | `templates/naxt.html:2` | dark | light (`naxtModal.png`) | no | yes | app |  | B | markup dark with no client; naxtVistaChrome.js sets the light client and .win7 at run time |
| `naxtCustomTagModal` | Atelier: Add Tag | `templates/naxt.html:147` | vista-dialog form + .win7 (`dark` token) | light (`naxtCustomTagModal.png`) | no | yes | dialog (form) |  | A | static tags since #867 |
| `openNoteModal` | Notepad / Journal: Open Note | `templates/notepad.html:2` | dark | DARK GLASS (`openNoteModal.png`) | no | yes | dialog | Open (comdlg32) | C |  |
| `updateNoteModal` | Notepad: Modify Note | `templates/notepad.html:39` | vista-dialog form + .win7 (`dark` token) | light (`updateNoteModal.png`) | no | yes | dialog (form) |  | A | static tags since #867 |
| `notepadModalTemplate` | launch `notepad` | `templates/notepad.html:114` | light | light | no | yes | app | Notepad | B | light, own client, no .win7 |
| `runModal` | launch `run` (Win+R) | `templates/run.html:2` | vista-dialog run | light (`runModal.png`) | no | yes | dialog | Run | A | kind `run` in markup |
| `spellbookGenerationModal` | launch `spellbook` | `templates/spellbook.html:2` | light (`dark` token) | light (`spellbookGenerationModal.png`) | no | yes | app |  | B | light, `dark` token, no .win7 |

## Script-built windows

| Window | Opened by | Markup at | Skin in markup | On screen | Run-time retag | Image caption icon | Target kind | Mirrors | List | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `confirmationDialog` | showConfirmationDialog / showInputDialog (every message box) | `scripts/comp/confirmationDialog.js:195` | dark | light (run time) | yes | n/a (message box) | dialog (message / task) | Vista message box, task dialog | B | retagged at run time: kind, icon and text cell change per call; phone restyles it |
| `creditCostDialog` | paid generation: credit cost | `scripts/comp/creditCostDialog.js:77` | no client (credit-cost-content) | not opened | yes | none | dialog (message) |  | B | retagged at run time: gets its caption there |
| `enhanceMiniDialog` | picture: Enhance (mini dialog) | `scripts/comp/imageExpansion.js:1514` | no client (credit-cost-content) | not opened | no | none | dialog (form) |  | C? | not opened (needs a picture); same skeleton as creditCostDialog but not on the retag list, so dark by markup |
| `agentClientUpdateDialog` | agent client_update (15 s Cancel box) | `scripts/comp/agentClientUpdateDialog.js:91` | dark | not opened | yes | map entry | dialog (message) |  | B | retagged at run time; phone takeover surface (wm-shell.css), so not opened here |
| `dovecoteNewMailModal` | Dovecote: new mail arrives | `scripts/comp/desktop-apps/dovecote.js:4645` | vista-dialog message + .win7 | light (`dovecoteNewMailModal.png`) | no | yes | dialog (message) | Windows Mail new-mail box | A | tags set by its builder since #867 |
| `desktopDovecoteModal` | launch `dovecote` | `scripts/comp/desktop-apps/dovecote.js:409` | light + .win7 | light (`desktopDovecoteModal.png`) | no | yes | app | Windows Mail | A |  |
| `desktopDovecoteCompose…` | Dovecote: New Message / Reply | `scripts/comp/desktop-apps/dovecote.js:2960` | light + .win7 | not opened | no | owner | app | Windows Mail compose | A | not opened |
| `desktopDovecoteReader…` | Dovecote: open a message | `scripts/comp/desktop-apps/dovecote.js:3380` | light + .win7 | not opened | no | owner | app | Windows Mail reader | A | not opened |
| `desktopDovecoteAttachment_…` | Dovecote: open an attachment | `scripts/comp/desktop-apps/dovecote.js:2370` | light + .win7 | not opened | no | owner | app |  | A | not opened |
| `mailOptionsDialog` | Dovecote: Tools > Options | `scripts/comp/mailOptions.js:125` | vista-dialog form | not opened | no | none (sheet) | sheet | Windows Mail Options | A | hand-built sheet (standard: vistaDialogTemplate); not opened |
| `mmcConsole_<id> (12 consoles)` | launch `data-management`, `presets`, `expanders`, `memories`, `character-db`, `server-manager`, `mmc-*` | `scripts/comp/mmcConsole.js:103` | light + .win7 | light (`mmcConsole_dataManagement.png`) | no | yes | app | MMC 3.0 console | A | dataManagement, spellbook, textExpanders, enshutsuka, serverManager, dynamicQuips, autofillRanking, keyManager, frontGate, exchange, wikiCaches, printManagement, characterDb |
| `melatonControlPanelModal, welcomeCenterModal` | launch `control-panel`, `welcome-center` | `scripts/comp/melatonControlPanel.js:280` | no client attribute, `dark cpl-content win7` | light (`melatonControlPanelModal.png`) | no | yes | app | Control Panel, Welcome Center | B | white on screen through cpl CSS; no data-window-client, `dark` token |
| `melatonConnectionStatusModal` | Control Panel / tray: connection Status | `scripts/comp/melatonControlPanel.js:1283` | no client (vpn-dialog) | not opened | no | yes | dialog | Local Area Connection Status | B | vpn-dialog classic skin, not a light client; not opened |
| `domainCustomizeModal` | logon: domain customize | `scripts/comp/melatonControlPanel.js:1439` | no client (vpn-dialog) | not opened | no | yes | dialog |  | B | vpn-dialog; not opened |
| `domainConnectModal` | boot: Connect <domain> | `scripts/comp/melatonNetworkDialogs.js:287` | no client (vpn-dialog, boot-dialog) | not opened | no | yes | host shell | Vista Connect dialog (rasdlg) | A | boot shell |
| `mainframeServerModal` | boot: server start window | `scripts/comp/mainframeServerWindow.js:311` | no client (vpn-dialog, boot-dialog) | not opened | no | not checked | host shell |  | A | boot shell; not opened |
| `mainframeExceptionDialog` | server fault: .NET exception box | `scripts/comp/mainframeExceptionDialog.js:128` | no client (vpn-dialog), caption icon none | not opened | no | none by design | dialog | .NET ThreadExceptionDialog | A | 1:1 clone with its own sheet; not opened |
| `workstationLockModal` | lock (Win+L, server restart) | `scripts/comp/workstationLock.js:66` | no client (boot-dialog) | not opened | no | not checked | host shell | Vista lock screen | A | not opened |
| `bootMessageBox` | boot: message boxes | `scripts/comp/bootMessageBox.js:28` | no client (boot-dialog) | not opened | no | not checked | host shell | Vista logon message | A | also restyled on the phone; not opened |
| `programFaultDialog<n>` | a program faults | `scripts/comp/programFaults.js:472` | vista-dialog task | light | no | none by design | dialog (task) | "... has stopped working" (WER) | A | seen during the census |
| `fileProgressDialog<n>` | copy / move / delete / import | `scripts/comp/fileOperationProgress.js:498` | vista-dialog task | not opened | no | yes | dialog (task) | Vista file progress dialog | A | not opened |
| `7-Zip dialogs` | Cartograph: archive actions | `scripts/comp/explorerArchive.js:301` | vista-dialog form + .win7, caption icon none | not opened | no | taskbar | dialog | 7-Zip | A | not opened |
| `vfsSystemTextViewerModal` | Cartograph: open a system text file | `scripts/comp/vfsSystemOpenRouter.js:218` | dark | DARK GLASS (`vfsSystemTextViewerModal.png`) | no | map entry | app | Notepad | C |  |
| `explorer-phone-doc-window` | Cartograph: open a phone document | `scripts/comp/explorerPhoneDrive.js:679` | light + .win7 | not opened | no | not checked | app |  | A | needs a phone; not opened |
| `dreamscapeCardSpaceModal` | Control Panel: Dreamscape CardSpace | `scripts/comp/cplAuthentication.js:2435` | light + .win7 | not opened | no | yes | app | Windows CardSpace | A | not opened |
| `deviceManagerModal` | launch `mmc-device-manager` | `scripts/comp/cplDeviceManager.js:648` | light + .win7 | light (`deviceManagerModal.png`) | no | yes | app | Device Manager | A |  |
| `printQueue_<id>` | Print Management: open a queue | `scripts/comp/printQueueWindow.js:73` | light + .win7 | not opened | no | yes | app | printer queue window | A | not opened |
| `defenderModal` | launch `security-center` | `scripts/comp/windowsDefender.js:68` | no client (defender-content) | light (own sheet) (`defenderModal.png`) | no | yes | app | Windows Defender | B | right on screen through its own sheet only; no light client attribute |
| `imageSearchModal` | launch `ispy` | `scripts/comp/imageSearchApp.js:224` | light (isx-client) | light (`imageSearchModal.png`) | no | yes | app | Windows Search results (Explorer) | B | light, no .win7 |
| `imageSearch properties` | Image Search: Properties | `scripts/comp/imageSearchApp.js:1971` | light + .win7 | not opened | no | yes | sheet | file Properties | A | hand-built sheet; not opened |
| `directorHistoryWindow` | Director: full history | `scripts/comp/director.js:2736` | dark | DARK GLASS (`directorHistoryWindow.png`) | no | yes | app |  | C |  |
| `directorToolInspector` | Director: inspect a tool call | `scripts/comp/directorToolInspector.js:415` | light | not opened | no | not checked | tool |  | B | light client set in script; not opened |
| `activeSyncStudioWizard` | ActiveSync: Studio session transfer | `scripts/comp/activeSyncStudio.js:186` | light (asw-client) | not opened | no | yes | dialog (wizard) | ActiveSync wizard | B | light, no .win7; hand-built wizard; not opened |
| `activeSyncScreen-<dev>` | Device Center: device screen | `scripts/comp/activeSyncScreen.js:161` | client `dark` (explicit) | not opened | no | yes | custom |  | C? | a phone screen mirror, dark by choice; needs a device, not opened |
| `activeSyncPackages-<dev>` | Device Center: Add/Remove Programs | `scripts/comp/activeSyncPackages.js:61` | no client | not opened | no | yes | dialog | ActiveSync Add/Remove Programs | C? | no client attribute in markup; needs a device, not opened |
| `startMenuOrganizerModal` | Start menu: Organize | `scripts/comp/desktop-apps/startMenuOrganizer.js:496` | dark | DARK GLASS (`startMenuOrganizerModal.png`) | no | map entry | app | Explorer (Start Menu folder) | C |  |
| `desktopGuacModal` | launch `remote-desktop` | `scripts/comp/desktop-apps/guacRemote.js:182` | dark | DARK GLASS (`desktopGuacModal.png`) | no | yes | app | Remote Desktops (MMC) / RDC | C |  |
| `desktopGuacSession windows` | Remote Desktop Manager: open a connection | `scripts/comp/desktop-apps/guacRemote.js:1130` | dark | not opened | no | not checked | custom | mstsc session window | C? | markup dark; needs a live connection, not opened |
| `remoteDesktopConnectionModal` | launch `remote-desktop-connection` | `scripts/comp/desktop-apps/remoteDesktopConnection.js:266` | vista-dialog form + .win7 | light (`remoteDesktopConnectionModal.png`) | no | yes | dialog | Remote Desktop Connection (mstsc) | A |  |
| `melatonCharmapModal (+ Group By)` | launch `charmap` | `scripts/comp/desktop-apps/charmap/charmapApp.js:275` | vista-dialog form + .win7 | light (`melatonCharmapModal.png`) | no | yes | dialog | Character Map | A |  |
| `melatonPaintModal_<n>` | launch `paint` | `scripts/comp/desktop-apps/paint/paintApp.js:193` | light + .win7 | light (`melatonPaintModal_1.png`) | no | yes | app | Paint | A |  |
| `desktopMediaPlayer (+ Open URL)` | launch `media-player` | `scripts/comp/desktop-apps/mediaPlayer.js:1209` | light (wmp-content) | own (WMP skin) (`desktopMediaPlayer.png`) | no | yes | custom (media) | Windows Media Player 11 | A | custom skin by design; Open URL is light + .win7 |
| `desktopEmotionModal` | launch `emotion` | `scripts/comp/desktop-apps/emotion.js:702` | light (`dark` token) | light (`desktopEmotionModal.png`) | no | map entry | app |  | B | light, `dark` token, no .win7 |
| `sideshowSimulatorModal-<mode>` | launch `sideshow-simulator-*` | `scripts/comp/desktop-apps/sideshow/sideshowSimulator.js:279` | light (sss-client) | light (`sideshowSimulatorModal-landscape.png`) | no | yes | custom | Windows SideShow Simulator | A | device simulator, custom by design |
| `vista<Game>Modal (13 games) + dialogs` | launch `game-*` | `scripts/comp/desktop-apps/vista-games/vistaGameEngine.js:937` | light + .win7; dialogs vista-dialog form | light (`vistaChessModal.png`) | no | yes | custom (game) | Vista games | A | Block Drop, Brick Breaker, Chess, Doubles, FreeCell, Hearts, InkBall, Mahjong, Minesweeper, Purble Place, Solitaire, Spider |
| `vistaJezzballModal (+ Help)` | launch `game-jezzball` | `scripts/comp/desktop-apps/vista-games/jezzball.js:656` | no client (jz-content); Help is vista-dialog form | light (`vistaJezzballModal.png`) | no | classic caption | custom (game) | JezzBall (Windows 3.x) | A | classic frame by design |
| `vistaGamesExplorerModal` | launch `games-explorer` | `scripts/comp/desktop-apps/vista-games/gamesExplorer.js:106` | no client attribute, `win7` | light (`vistaGamesExplorerModal.png`) | no | yes | app | Games Explorer | B | white on screen through gx CSS; no data-window-client |
| `vistaSidebar gadget gallery` | Sidebar: Add Gadgets | `scripts/comp/vistaSidebar.js:3905` | light + .win7 | not opened | no | not checked | app | Gadget Gallery | A | not opened |
| `datasetTagToolbar` | Studio: Quick Access tags | `scripts/comp/datasetTagToolbar.js:100` | no client, no content element | DARK GLASS (`datasetTagToolbar.png`) | no | none | tool |  | C | dark glass strip |
| `comment dialogs (2)` | Reference: view comment / vibes comments | `scripts/utils/referenceUtils.js:25` | no client | see-through (`commentDialog.png`) | no | none | dialog (message) |  | C | no caption icon; bare glass (shot `commentDialog.png`) |
| `galleryMoveModal` | Workspaces: Move to Workspace | `scripts/comp/galleryToolbar.js:301` | no client | see-through (`galleryMoveModal.png`) | no | none | dialog (form) | Move Items (Browse For Folder) | C | no caption; see-through over the desktop |
| `cacheMoveToWorkspaceModal` | Reference: Move to Workspace | `scripts/comp/workspaceUtils.js:1153` | no client | see-through (`cacheMoveToWorkspaceModal.png`) | no | none | dialog (form) | Move Items (Browse For Folder) | C | no caption icon |
| `melatonApp-<instance>-<n>` | a package calling melatonApps.openWindow | `scripts/comp/melatonApps.js:139` | no client (`modal-content modal-padding`) | not opened | no | from manifest | app |  | C? | the package default window is not a light client; no shipped app uses it, not opened |
| `desktopCalculatorModal` | launch `calculator` | `apps/calculator/client/calculator.js:329` | light + .win7 (set after build) | light (`desktopCalculatorModal.png`) | no | yes | app | Calculator | A |  |
| `desktopTimerModal` | launch `alarm`, `pomodoro` | `apps/alarm/client/alarm.js:79` | no client | light (`desktopTimerModal.png`) | no | yes | app |  | B | light on screen without a client attribute or .win7; spin boxes draw a second pair of arrows (defect, see report) |
| `melatonTaskManagerModal` | launch `taskmgr` | `apps/taskmgr/client/taskmgr.js:111` | vista-dialog form + .win7 | light (`melatonTaskManagerModal.png`) | no | yes | app | Windows Task Manager | A |  |
| `melatonPerfmonModal` | launch `perfmon` | `apps/perfmon/client/perfmon.js:138` | light + .win7 | light (`melatonPerfmonModal.png`) | no | yes | app | Reliability and Performance Monitor | A |  |
| `melatonPayPassModal (+ child dialogs)` | launch `paypass` | `apps/paypass/client/paypass.js:58` | light (pp-client) | light (`melatonPayPassModal.png`) | no | yes | custom |  | B | light, no .win7; hand-built child dialogs |
| `melatonXLinkModal (+ child dialogs)` | launch `xlink` | `apps/xlink/client/xlink.js:133` | light (xl-client) | light (`melatonXLinkModal.png`) | no | yes | custom (console) |  | B | light, no .win7; hand-built child dialogs |
| `melatonQuickCastModal (+ child windows)` | launch `quickcast` | `apps/quickcast/client/quickcast.js:172` | light (qc-client) | light (`melatonQuickCastModal.png`) | no | yes | custom (hardware console) | video mixer panel | A | custom by design (section 6) |
| `melatonMobileDeviceCenterModal` | launch `mobile-device-center` | `apps/activesync/client/activesync.js:143` | light (asdc-client) | light (`melatonMobileDeviceCenterModal.png`) | no | yes | app | Windows Mobile Device Center | B | light, no .win7 |
| `melatonMessengerModal` | launch `melaton-messenger` | `apps/messenger/client/messenger.js:152` | light + .win7 | light (`melatonMessengerModal.png`) | no | yes | app | Windows Live Messenger | A |  |
| `melatonMessagingBridgeModal` | Messaging Bridge console | `apps/msgbridge/client/msgbridge.js:118` | light + .win7 | not opened | no | yes | app | MMC | A | not opened |
| `melatonWordPadModal_<n>` | launch `wordpad` | `apps/wordpad/client/wordpad.js:347` | light + .win7 | light (`melatonWordPadModal_1.png`) | no | yes | app | WordPad | A |  |
| `melatonSoundRecorderModal` | launch `soundrec` | `apps/soundrec/client/soundrec.js:58` | light + .win7 | light (`melatonSoundRecorderModal.png`) | no | yes | app | Sound Recorder | A |  |
| `melatonSnippingModal (+ editor)` | launch `snipping` | `apps/snipping/client/snipping.js:376` | light + .win7 | light (`melatonSnippingModal.png`) | no | yes | app | Snipping Tool | A |  |
| `melatonWindowsCalendarModal` | launch `calendar` | `apps/calendar/client/calendar.js:467` | light + .win7 | light (`melatonWindowsCalendarModal.png`) | no | yes | app | Windows Calendar | A |  |
| `melatonWeatherModal` | launch `weather` | `scripts/comp/wmWeather.js:2639` | light (wxd-client) | light (`melatonWeatherModal.png`) | no | yes | app |  | B | light, no .win7; the desktop window is built inside a phone script (wmWeather.js) |
| `galleryWindow` | launch `workspace` | `app.html:1204` | no client (gallery-window) | own (`galleryWindow.png`) | no | yes | custom | Windows Photo Gallery | C | Vista frame; the picture wall keeps a dark glass tool strip |

## Factory dialogs (vistaDialogTemplate)

Built by `openDialog` / `openSheet` / `openWizard`: light client, `.win7`, dialog units, bare
caption with a taskbar image. List A by construction; listed by call site, not one row each.

| Script | Dialogs | Sheets | Wizards |
| --- | --- | --- | --- |
| `apps/activesync/client/activesync.js` | 2 |  |  |
| `apps/calendar/client/calendar.js` | 6 |  | 1 |
| `apps/contacts/client/contacts.js` | 5 | 1 |  |
| `apps/snipping/client/snipping.js` | 2 |  |  |
| `apps/wordpad/client/wordpad.js` | 8 | 1 |  |
| `browsingRestore.js` | 4 |  |  |
| `configEditorApplet.js` | 6 |  |  |
| `cplDeviceManager.js` |  | 1 |  |
| `cplDialogs.js` | 6 | 1 |  |
| `cplDialogs2.js` | 3 |  |  |
| `cplInternetOptions.js` | 7 |  |  |
| `cplSearch.js` | 3 | 1 |  |
| `desktop-apps/charmap/charmapApp.js` | 1 |  |  |
| `desktop-apps/paint/paintActions.js` | 2 |  |  |
| `desktop-apps/paint/paintApp.js` | 4 |  |  |
| `desktop-apps/paint/paintBrush.js` | 1 |  |  |
| `desktop-apps/paint/paintColor.js` | 1 |  |  |
| `desktop-apps/paint/paintComps.js` | 1 |  |  |
| `desktop-apps/paint/paintDialogs.js` | 6 |  |  |
| `desktop-apps/paint/paintGenerate.js` | 2 |  |  |
| `desktop-apps/paint/paintLayers.js` | 3 |  |  |
| `desktop-apps/paint/paintPath.js` | 1 |  |  |
| `desktop-apps/paint/paintPrefs.js` | 2 |  |  |
| `desktop-apps/paint/paintPro.js` | 3 |  |  |
| `director.js` | 1 | 1 |  |
| `expanderMakeGlobalWizard.js` |  |  | 1 |
| `grimoireRemoteBrowser.js` | 1 |  |  |
| `journal.js` | 1 |  |  |
| `mmcAppKeys.js` | 2 | 2 | 1 |
| `mmcCharacterDb.js` | 3 | 1 |  |
| `mmcDataManagement.js` | 1 |  |  |
| `mmcEnshutsuka.js` | 5 | 1 | 1 |
| `mmcExchange.js` | 6 | 4 | 2 |
| `mmcExpanders.js` | 3 |  |  |
| `mmcFrontGate.js` |  |  | 3 |
| `mmcSpellbook.js` | 4 | 1 |  |
| `mmcWikiManager.js` |  | 2 | 1 |
| `modalUtils.js` | 1 |  |  |
| `notepadManager.js` | 1 |  |  |
| `notepadVista.js` | 5 |  |  |
| `printQueueWindow.js` |  | 1 |  |
| `soundRecorder.js` | 1 |  |  |
| `workspaceDialogs.js` | 4 | 1 |  |

Message boxes through `showConfirmationDialog` / `showInputDialog` are one window
(`confirmationDialog`) and are not listed per call.

## Not windows

Left out on purpose: the taskbar, Start menu, Sidebar and its gadgets, Flip 3D and the window
switcher, the shortcuts overlay, balloons and menus, the asset preload hold, the shutdown overlay.

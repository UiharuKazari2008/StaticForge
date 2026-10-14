#!/usr/bin/env node
// Import as a Vista Aero Wizard (Yozora #494): on the Vista desktop #unifiedUploadModal gets the
// wizard caption (the Back orb, the Easy Transfer icon, the title) and data-wizard-page from
// vistaImportWizard.js, and vista-import-wizard.css lays out the white page, the main instruction,
// the command links and the #f0f0f0 footer over the light client vistaDialogs.js already gives it.
// Every id the handlers in referenceManager.js look up stays. Run: node scripts/test-import-aero-wizard.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const css = read('public/css/vista-import-wizard.css');
const js = read('public/scripts/comp/vistaImportWizard.js');
const html = read('public/app.html');
const dialogs = require(path.join(ROOT, 'public/scripts/comp/vistaDialogs.js'));
const G = 'body.desktop-mode:not(.windows-classic-theme)';

// wiring
assert.ok(html.includes('<link rel="stylesheet" href="/css/vista-calculator.css">\n    <link rel="stylesheet" href="/css/vista-import-wizard.css">'), 'sheet linked after vista-calculator.css');
assert.ok(html.includes('<script src="scripts/comp/vistaDialogs.js"></script>\n    <script src="scripts/comp/vistaImportWizard.js"></script>'), 'script loads after vistaDialogs.js');
assert.ok(JSON.parse(read('package.json')).scripts['test:import-aero-wizard'] === 'node scripts/test-import-aero-wizard.js', 'npm run test:import-aero-wizard');

// the block in app.html
const start = html.indexOf('<!-- Unified Upload Modal -->');
const end = html.indexOf('<!-- Explorer Modal -->', start);
assert.ok(start > 0 && end > start, 'the Unified Upload Modal block exists');
const block = html.slice(start, end);
assert.ok(block.includes('id="unifiedUploadModal" class="modal hidden tool-window on-top"'), 'the modal keeps its classes');

// the light client: vistaDialogs.js tags the modal as a form dialog (data-window-client="light" + .win7)
assert.ok(dialogs.FORM_IDS.includes('unifiedUploadModal'), 'the modal is a light form dialog');
assert.ok(read('public/scripts/comp/vistaDialogs.js').includes("el.dataset.windowClient = 'light'"), 'light client mechanism');

// every id the handlers look up is still there
const IDS = ['unifiedUploadModal', 'closeUnifiedUploadBtn', 'unifiedUploadBackgroundImage', 'unifiedUploadModalTitle',
    'unifiedUploadOverlayContent', 'unifiedUploadModeDisplay', 'unifiedUploadFileInfo', 'galleryMoveRightPanelCover',
    'unifiedUploadBackBtn', 'unifiedUploadModalSubtitle', 'unifiedUploadModalSubtitleText', 'unifiedUploadModeSelector',
    'unifiedUploadInitialOptions', 'unifiedUploadSelectBtn', 'unifiedUploadClipboardBtn', 'unifiedUploadUrlPreview',
    'unifiedUploadUrlPreviewContent', 'unifiedUploadVibeBundlePreview', 'unifiedUploadVibeBundleList',
    'unifiedUploadBlueprintPreview', 'unifiedUploadWarnings', 'unifiedUploadBlueprintInfo', 'unifiedUploadVibeControls',
    'unifiedUploadModelDropdown', 'unifiedUploadModelDropdownBtn', 'unifiedUploadModelSelected', 'unifiedUploadModelDropdownMenu',
    'unifiedUploadIeInput', 'unifiedUploadCommentInputContainer', 'unifiedUploadCommentInput', 'unifiedUploadImportMetadataControls',
    'unifiedUploadPreciseReferenceToggle', 'unifiedUploadReferenceTypeGroup', 'unifiedUploadRefTypeCharacterBtn',
    'unifiedUploadRefTypeStyleBtn', 'unifiedUploadExplanationReference', 'unifiedUploadExplanationBlueprint',
    'unifiedUploadExplanationCharacter', 'unifiedUploadExplanationVibe', 'unifiedUploadWorkspaceDropdown',
    'unifiedUploadWorkspaceDropdownBtn', 'unifiedUploadWorkspaceColorDot', 'unifiedUploadSiteDomain', 'unifiedUploadSiteDomainText',
    'unifiedUploadWorkspaceDropdownMenu', 'unifiedUploadNavigation', 'unifiedUploadPrevBtn', 'unifiedUploadNextBtn',
    'unifiedUploadCurrentIndex', 'unifiedUploadTotalCount', 'unifiedUploadCancelBtn', 'unifiedUploadOpenInEditorBtn',
    'unifiedUploadConfirmBtn', 'unifiedUploadConfirmText'];
for (const id of IDS) assert.strictEqual(block.split(`id="${id}"`).length, 2, `${id} is in the block once`);
for (const mode of ['blueprint', 'reference', 'vibe', 'character']) {
    assert.ok(block.includes(`class="mode-slider-btn${mode === 'reference' ? ' active' : mode === 'blueprint' ? ' blueprint-mode-btn' : ''}" data-mode="${mode}"`), `${mode} mode button`);
}

// the pages: the four modes as command links wired to the mode buttons, the file sources as command links
assert.ok(block.includes('<div class="vista-wizard-page">\n                        <div class="vista-wizard-instruction">What do you want to import?</div>'), 'page 1 and its instruction');
for (const mode of ['blueprint', 'reference', 'vibe', 'character']) {
    assert.ok(block.includes(`<button type="button" class="vista-command-link" data-wizard-mode="${mode}">`), `${mode} command link`);
}
assert.strictEqual(block.split('class="vista-command-link-note"').length, 7, 'a note under each of the six command links');
assert.ok(block.includes('<div id="unifiedUploadInitialOptions" class="upload-options-container">\n                        <div class="vista-wizard-instruction">Where is the file?</div>'), 'page 2 instruction');
assert.ok(block.includes('<p>Supports Images, Generated Images, and NovelAI Vibe Bundles</p>'), 'the supports hint stays');

// the page state
assert.ok(js.includes("const PAGE_ATTR = 'data-wizard-page'"), 'data-wizard-page on the modal');
assert.ok(js.includes("if (modal.hasAttribute('data-mode')) return 3;") && js.includes('return chosenMode ? 2 : 1;'), 'page 3 while content is loaded, else 2 after a mode, else 1');
assert.ok(js.includes("if (modal.classList.contains('hidden')) chosenMode = null;"), 'closing starts over');
assert.ok(js.includes("attributeFilter: ['data-mode', 'class']"), 'a narrow observer on the modal');
assert.ok(js.includes('pageObserver.disconnect()') && js.includes('modal.removeAttribute(PAGE_ATTR)') && js.includes('caption.remove()'), 'everything comes off outside Vista');
assert.ok(js.includes(".closest('.vista-command-link[data-wizard-mode]')") && js.includes(".mode-slider-btn[data-mode=\"' + mode + '\"]") && js.includes('btn.click()'), 'command links click the mode buttons');
assert.ok(js.includes('unifiedUploadModalManager.reset();') && js.includes('if (mode) clickMode(mode);'), 'Back from page 3 resets and re-picks the mode');
assert.ok(js.includes("if (event.target.closest('#unifiedUploadCancelBtn')) unifiedUploadModalManager.hide();"), 'Cancel leaves the wizard');

// the caption: Back orb, icon, title
assert.ok(js.includes("caption.className = 'modal-window-title'") && js.includes('<button type="button" class="vista-wizard-back" title="Back" disabled></button>'), 'the Back button in the caption');
assert.ok(js.includes("'/static_images/app_icons/32/vista-easy-transfer.png'") && js.includes("const TITLE = 'Import'"), 'the Easy Transfer icon and the title');
// the taskbar reads both caption icons (modalUtils.js getModalIcons): the <i> on Luna / workspace, the image on the orb
assert.ok(js.includes('<i class="nai-import icon-fa"></i>') && js.includes('<img class="icon-image" alt="" src="\' + ICON + \'">'), 'the launchable\'s nai-import and vista-easy-transfer.png icons sit in the caption for the taskbar');
assert.ok(css.includes('.modal-window-title .modal-window-title-main > .icon-fa {\n    display: none;'), 'the caption shows the image, not the Font Awesome twin');
assert.ok(js.includes("backBtn.disabled = page === '1'"), 'Back is greyed on page 1');
assert.ok(css.includes(`${G} #unifiedUploadModal {\n    --modal-title-chrome-height: 40px;\n    width: 766px;`) && css.includes('height: 554px;'), 'a 750x505 client under the 40 px caption');
assert.ok(css.includes("background: url('/static_images/vista-explorer/nav-back.png') no-repeat 0 0;") && css.includes('.vista-wizard-back:disabled {\n    background-position: 0 -81px;'), "the theme's navigation orb, greyed when disabled");
assert.ok(fs.existsSync(path.join(ROOT, 'public/static_images/vista-explorer/nav-back.png')), 'the orb sprite exists');

// the look
assert.ok(css.includes(`${G} #unifiedUploadModal > .modal-content {\n    position: relative;\n    display: flex;\n    flex-direction: column;\n    padding: 0;\n    overflow: hidden;\n    background: #fff;`), 'a white page');
assert.ok(css.includes('color: #003399;\n    font-family: "Segoe UI", "SegoeUI", "Noto Sans", sans-serif;\n    font-size: 12pt;') && css.includes('padding: 18px 19px 11px 38px;'), 'the main instruction, 12 pt #003399, 38 px in and 18 px down');
assert.ok(css.includes(`${G} #unifiedUploadModal :is(.vista-command-link, .upload-option-btn) {\n    display: grid;\n    grid-template-columns: 25px minmax(0, 1fr);`) && css.includes('color: #151c55;'), 'command links: the glyph column and the text');
assert.ok(css.includes('background: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABkAAAB9') && css.includes('background-position: 0 -25px;'), "the theme's green arrow glyph, hot state");
assert.ok(css.includes('background: linear-gradient(#fff, #f6f6f6);\n        border-color: #c6c6c6;') && css.includes('color: #074ae5;'), 'hover: the light gradient, the 1 px border, the hot text');
assert.ok(css.includes('.vista-command-link-note {\n    display: block;\n    grid-column: 2;\n    margin-top: 1px;\n    font-size: 9pt;\n    line-height: 15px;'), 'the 9 pt note');
assert.ok(css.includes(`${G} #unifiedUploadModal:not([data-wizard-page="1"]) .vista-wizard-page,\n${G} #unifiedUploadModal[data-wizard-page="1"] #unifiedUploadInitialOptions {\n    display: none !important;`), 'pages 1 and 2 by data-wizard-page');
assert.ok(css.includes(`${G} #unifiedUploadModal[data-wizard-page="3"] > .modal-content {\n    display: grid;`) && css.includes('"actions actions";'), 'page 3: the grid with the footer along the bottom');
assert.ok(css.includes(`${G} #unifiedUploadModal > .modal-content .gallery-move-actions {\n    grid-area: actions;\n    display: flex !important;`) && css.includes('gap: 7px;\n    margin: 0;\n    padding: 11px;\n    background: #f0f0f0;\n    border: 0;\n    border-top: 1px solid #dfdfdf;'), 'footer: always shown, #f0f0f0 under the etched line, 75x23 buttons 7 px apart 11 px from the edge');
assert.ok(css.includes('.gallery-move-actions > #unifiedUploadConfirmBtn {\n    order: 4;') && css.includes('.gallery-move-actions > #unifiedUploadCancelBtn {\n    order: 5;'), '[Upload] [Cancel] at the right');
assert.ok(read('public/css/vista-dialogs.css').includes('animation: pulse-anim 1s ease infinite alternate;'), "the default button's glow comes from vista-dialogs.css");
for (const src of [css, js, block]) assert.ok(!/[^\x00-\x7f]/.test(src), 'keyboard characters only');
assert.ok(!/motion/i.test(block) && !/motion/i.test(js), 'no motion in the markup');
console.log('test-import-aero-wizard: ok');

#!/usr/bin/env node
// Vista dialog boxes (Yozora #465): vistaDialogs.js tags every dialog on the Vista desktop, the
// sheet lays them out as Vista message boxes / task dialogs / property sheets with 7.css
// controls, the confirmation dialog opens over its owner window, and the message box icons
// ripped from the VM's user32.dll exist. Run: node scripts/test-vista-dialogs.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const css = read('public/css/vista-dialogs.css');
const js = read('public/scripts/comp/vistaDialogs.js');
const html = read('public/app.html');
const confirm = read('public/scripts/comp/confirmationDialog.js');
const G = 'body.desktop-mode:not(.windows-classic-theme)';

// wiring
assert.ok(html.includes('<link rel="stylesheet" href="/css/vista-scrollbars.css">\n    <link rel="stylesheet" href="/css/vista-dialogs.css">'), 'sheet linked after vista-scrollbars.css');
assert.ok(html.includes('<script src="scripts/comp/confirmationDialog.js"></script>\n    <script src="scripts/comp/vistaDialogs.js"></script>'), 'script loads after confirmationDialog.js');
assert.ok(confirm.includes('window.vistaDialogs.ownerCenter(event) || point'), 'the confirmation dialog centres on its owner on the desktop');
assert.ok(confirm.includes("if (point && event && event.target && typeof window.vistaDialogs === 'object'"), 'only real events are re-placed; synthetic centre events keep their point');

// the tagged set: every id exists in app.html or is created by its script
const api = require(path.join(ROOT, 'public/scripts/comp/vistaDialogs.js'));
assert.deepStrictEqual(api.MESSAGE_IDS.slice(0, 3), ['confirmationDialog', 'creditCostDialog', 'agentClientUpdateDialog'], 'message boxes');
const created = { confirmationDialog: 'public/scripts/comp/confirmationDialog.js', creditCostDialog: 'public/scripts/comp/creditCostDialog.js', agentClientUpdateDialog: 'public/scripts/comp/agentClientUpdateDialog.js' };
for (const id of api.MESSAGE_IDS.concat(api.FORM_IDS)) {
    const inHtml = html.includes(`id="${id}"`);
    const inJs = created[id] && read(created[id]).includes(`'${id}'`);
    assert.ok(inHtml || inJs, `${id} exists`);
}
assert.ok(api.FORM_IDS.length >= 20, 'the tool-window form dialogs are tagged');
assert.ok(js.includes("el.dataset.windowClient = 'light'") && js.includes("content.classList.add('win7')"), 'light client mechanism');
assert.ok(js.includes('TASK_CLASSES') && js.includes("'task'") && js.includes('vista-dialog-text'), 'confirmation: message box vs task dialog, text cell for the icon grid');
assert.ok(js.includes('ensureCaption') && js.includes("el.id !== 'creditCostDialog'"), 'the credit cost dialog gets the shared caption');
assert.ok(js.includes('function untag') && js.includes('delete el.dataset.vistaDialog'), 'tags come off outside Vista mode');
assert.ok(js.includes("attributeFilter: ['class']"), 'dialogs are re-read when they open');

// the look
assert.ok(css.includes(`${G} .modal[data-vista-dialog] > .modal-content {`) && css.includes('background: #f0f0f0;') && css.includes('font: 9pt "Segoe UI"'), 'light client, Segoe UI 9pt');
assert.ok(css.includes(`${G} .modal[data-vista-dialog] .modal-window-title-main > :is(i:first-child, .icon-fa, .icon-image) {\n    display: none;`), 'no caption icon');
assert.ok(css.includes('background: linear-gradient(#f2f2f2 45%, #ebebeb 45%, #cfcfcf);\n    border: 1px solid #8e8f8f;'), "7.css's standard button face");
assert.ok(css.includes('animation: vista-default-pulse 1s ease infinite alternate;'), "the default button's glow");
assert.ok(css.includes('animation-name: vista-default-pulse-in;') && !/animation:\s*pulse-anim/.test(css), "the glow cross-fades two layers by opacity (box-shadow animations run on the main thread)");
assert.ok(css.includes('.vista-dialog-footer {\n    display: flex;\n    flex-wrap: wrap;\n    justify-content: flex-end;\n    align-items: center;\n    gap: 8px;\n    margin: 0;\n    padding: 12px 8px 11px 11px;\n    background: #f0f0f0;'), 'footer: buttons right-aligned, 8 px apart, 8 px from the edge, 12 px above and 11 below');
assert.ok(css.includes('min-width: 88px;\n    min-height: 26px;'), 'message box buttons are 88x26');
assert.ok(css.includes('grid-template-columns: 32px minmax(0, 1fr);\n    column-gap: 9px;') && css.includes('padding: 27px 25px 25px;'), 'icon 32 px, 25 px in, 27 px down, text 9 px to its right');
for (const icon of ['question', 'warning', 'error', 'info']) {
    const file = `public/static_images/vista-icons/msgbox-${icon}-32.png`;
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} exists`);
    const buf = fs.readFileSync(path.join(ROOT, file));
    assert.strictEqual(`${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`, '32x32', `${file} is 32x32`);
    assert.ok(css.includes(`msgbox-${icon}-32.png`), `${icon} icon used`);
}
assert.ok(css.includes('#confirmationDialog[data-vista-dialog="task"] > .modal-content {') && css.includes('#creditCostDialog[data-vista-dialog] .credit-cost-header {') && css.includes('color: #003399;'), "task dialogs with Vista's blue main instruction");
assert.ok(css.includes('.modal[data-vista-dialog="form"] > .modal-content {\n    padding: 11px;\n    background: #f0f0f0;'), 'form dialogs: property sheet, 11 px margins');
assert.ok(css.includes('height: 23px;\n    min-height: 23px;\n    padding: 2px 4px;\n    background: #fff;') && css.includes('border-color: #abadb3 #dbdfe6 #e3e9ef #e2e3ea;'), "text boxes at Vista's 23 px with 7.css's edge");
console.log('test-vista-dialogs: ok');

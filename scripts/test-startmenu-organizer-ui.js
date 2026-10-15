'use strict';

// Start menu organizer client UI: Organize Start Menu editor, drag-and-drop reorder
// (including into/out of folders), and the custom context menu for New Folder / Rename /
// Move to folder / Move out of folder / Delete folder / Reset to default. This file is
// browser-only (document/wsClient/contextMenu globals), so there is no jsdom harness here —
// same static-assertion style as test-dovecote-windows.js.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const organizerJs = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/desktop-apps/startMenuOrganizer.js'), 'utf8');
const modalUtilsJs = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/modalUtils.js'), 'utf8');
const appHtml = fs.readFileSync(path.join(__dirname, '..', 'public/app.html'), 'utf8');

function main() {
    // 1. Entry point: the "All Apps" flyout's trailing "Organize Start Menu…" row opens the
    // editor, and the editor is wired into app.html as its own script.
    assert.match(modalUtilsJs, /text: 'Organize Start Menu…',[\s\S]{0,400}loadFeature\('start_menu_organizer'\)[\s\S]{0,200}openStartMenuOrganizer\(\)/);
    assert.match(modalUtilsJs, /'all-apps': \(\) => buildAllAppsSubmenuWithOrganizeRow\(\)/);
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/featureLoader.js'), 'utf8'), /scripts\/comp\/desktop-apps\/startMenuOrganizer\.js/);

    // 2. The editor renders the saved layout merged with the catalog (missing apps appended),
    // matching the server's node shape (type: item/folder, folders one level deep).
    assert.match(organizerJs, /function smoBuildWorkingLayout/);
    assert.match(organizerJs, /function openStartMenuOrganizer/);
    assert.match(organizerJs, /function ensureStartMenuOrganizerModal/);

    // 3. Drag and drop: pointer-based (mouse + touch), delegated on the list container so it
    // survives re-renders; folders cannot be dropped into other folders.
    assert.match(organizerJs, /function smoWireDragAndDrop/);
    assert.match(organizerJs, /listEl\.addEventListener\('mousedown', startDrag\)/);
    assert.match(organizerJs, /listEl\.addEventListener\('touchstart', startDrag/);
    assert.match(organizerJs, /draggedType === 'folder' \? null : folderChildrenHit/);
    assert.match(organizerJs, /function smoCommitFromDom/);

    // 4. Context menu actions: New Folder, Rename (inline, no prompt()), Move to folder /
    // Move out of folder, Delete folder (items return to top level), Reset to default.
    assert.match(organizerJs, /text: 'New Folder'/);
    assert.match(organizerJs, /text: 'New Folder…'/);
    assert.match(organizerJs, /text: 'Move to Folder'/);
    assert.match(organizerJs, /text: 'Move out of Folder'/);
    assert.match(organizerJs, /text: 'Delete Folder'/);
    assert.match(organizerJs, /text: 'Reset to Default'/);
    assert.match(organizerJs, /function smoDeleteFolder/);
    assert.match(organizerJs, /smoWorkingLayout\.splice\(idx, 0, \.\.\.folder\.children\)/); // items return to top level
    assert.match(organizerJs, /wireInlineNameEditable\(header\.querySelector\('\.smo-folder-name'\)/);
    assert.doesNotMatch(organizerJs, /\bprompt\(/);

    // 5. Custom context menu / design-system classes only — no native <select>, no inline
    // style="..." attributes baked into the markup.
    assert.match(organizerJs, /contextMenu\.attachToElement/);
    assert.doesNotMatch(organizerJs, /createElement\(['"]select['"]\)/);
    assert.doesNotMatch(organizerJs, /style="/);

    // 6. Saves server-side on each structural change and on every drag-drop commit.
    assert.match(organizerJs, /function smoSaveLayout/);
    assert.match(organizerJs, /start_menu_save_layout/);
    assert.match(organizerJs, /start_menu_reset_layout/);
    assert.match(organizerJs, /function smoApplyChange/);

    console.log('start menu organizer UI tests passed');
}

main();

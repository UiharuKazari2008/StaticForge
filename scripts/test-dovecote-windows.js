'use strict';

// Dovecote desktop windows (#b24): compose and double-click-to-read each open as their own
// top-level window (not an inline overlay), a tray icon mirrors the human's own unread count,
// and the launcher lives on the main app menu with an image icon — same conventions as every
// other multi-window desktop app (guacRemote.js, director.js). Source-level checks: this file
// is browser-only (document/wsClient/contextMenu globals), so there is no jsdom harness here —
// same static-assertion style as test-modal-close-btn-null-guard.js.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dovecoteJs = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/desktop-apps/dovecote.js'), 'utf8');
const appHtml = fs.readFileSync(path.join(__dirname, '..', 'public/app.html'), 'utf8');
const modalUtilsJs = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/modalUtils.js'), 'utf8');
const systemTrayJs = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/systemTrayManager.js'), 'utf8');

function main() {
    // 1. Compose is a standalone top-level window, not an overlay inside the main modal:
    // a dedicated builder that stamps the shared window chrome (resizeable-window +
    // windowIdentifier so modalUtils' generic window plumbing — drag/resize/minimize/taskbar —
    // picks it up the same way it does any other app window.
    assert.match(dovecoteJs, /doveOpenComposeWindow = function/);
    assert.match(dovecoteJs, /dovecote-compose-window/);
    assert.match(dovecoteJs, /modal\.className = 'modal resizeable-window dovecote-compose-window/);
    assert.match(dovecoteJs, /modal\.dataset\.windowIdentifier = 'desktopDovecoteCompose'/);
    // The old inline overlay is gone.
    assert.doesNotMatch(dovecoteJs, /dovecote-compose-overlay/);
    assert.doesNotMatch(dovecoteJs, /doveRenderComposeOverlay/);

    // 2. Double-clicking a message row opens a standalone reader window.
    assert.match(dovecoteJs, /rows\.addEventListener\('dblclick'/);
    assert.match(dovecoteJs, /doveOpenReaderWindow\(row\.dataset\.doveMailId\)/);
    assert.match(dovecoteJs, /doveOpenReaderWindow = function/);
    assert.match(dovecoteJs, /modal\.className = 'modal resizeable-window toolbar-visible dovecote-reader-window/);
    assert.match(dovecoteJs, /modal\.dataset\.windowIdentifier = 'desktopDovecoteReader'/);
    // Reply / Reply All / Forward are available from the reader's own toolbar.
    assert.match(dovecoteJs, /doveBuildReaderToolbar/);
    assert.match(dovecoteJs, /case 'reply': doveOpenCompose\('reply', mail\); return;/);
    assert.match(dovecoteJs, /case 'replyAll': doveOpenCompose\('replyAll', mail\); return;/);
    assert.match(dovecoteJs, /doveMakeForwardMenuConfig\(getMail\)/);

    // Multiple reader/compose windows can be open at once, keyed independently (guacSessionModals pattern).
    assert.match(dovecoteJs, /const doveComposeWindows = new Map\(\)/);
    assert.match(dovecoteJs, /const doveReaderWindows = new Map\(\)/);

    // 3. Tray icon: hidden by default, follows the taskbar-tray-icon + conditional-reveal
    // convention used by directorTrayIcon / naxtBagTrayIcon, carries an unread-count badge,
    // hides entirely at zero, and clicking it opens Dovecote.
    assert.match(appHtml, /<div class="dovecote-tray-icon taskbar-tray-icon hidden" id="dovecoteTrayIcon"/);
    assert.match(appHtml, /<span class="dovecote-tray-badge hidden" id="dovecoteTrayBadge">0<\/span>/);
    assert.match(dovecoteJs, /function initializeDovecoteTray/);
    assert.match(dovecoteJs, /icon\.addEventListener\('click', \(e\) => \{\s*e\.preventDefault\(\);\s*openDesktopDovecote\(\);/);
    assert.match(dovecoteJs, /const doveApplyTrayBadge = function/);
    // Hidden at 0 unread.
    assert.match(dovecoteJs, /badge\.classList\.add\('hidden'\);\s*icon\.title = 'Dovecote';\s*icon\.classList\.add\('hidden'\);/);
    assert.match(systemTrayJs, /'dovecoteTrayIcon',/);
    assert.match(systemTrayJs, /initializeDovecoteTray\(\);/);
    assert.match(systemTrayJs, /doveRefreshTrayUnread/);

    // 4. Dovecote launches from the main app menu (startMenuLaunchables, appMenu: true) with an
    // image icon, and is no longer under the Tools submenu.
    assert.match(
        modalUtilsJs,
        /\{ launchId: 'dovecote', icon: 'fas fa-envelope', imageIcon: 'dovecote\.png', text: 'Dovecote', appMenu: true,/
    );
    const toolsSubmenuSection = modalUtilsJs.slice(
        modalUtilsJs.indexOf('function buildToolsSubmenuItems'),
        modalUtilsJs.indexOf('function buildToolsSubmenuItems') + 4000
    );
    assert.doesNotMatch(toolsSubmenuSection, /launchId: 'dovecote'/);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public/static_images/app_icons/dovecote.png')), 'dovecote.png icon asset must exist');

    // No inline styles, no native <select> — custom context menu / design-system classes only.
    assert.doesNotMatch(dovecoteJs, /\.style\./);
    assert.doesNotMatch(dovecoteJs, /style=/);
    assert.doesNotMatch(dovecoteJs, /createElement\(['"]select['"]\)/);
    assert.match(dovecoteJs, /contextMenu\.attachClickMenuToElement/);

    // 5. Inline search bar (#1): the old toggle-triggered Find button is gone, the filter
    // input lives in the same toolbar slot and is never hidden.
    assert.doesNotMatch(dovecoteJs, /doveToggleFind/);
    assert.doesNotMatch(dovecoteJs, /searchGroup\.className = 'button-group hidden'/);
    assert.match(dovecoteJs, /searchGroup\.className = 'button-group'/);
    assert.match(dovecoteJs, /searchInput\.id = 'desktopDovecoteSearchInput'/);

    // 6. Folder dropdown button (#5): custom click-menu, not a native select, showing the
    // active folder's icon/label on the button itself.
    assert.match(dovecoteJs, /const doveBuildFolderButton = function/);
    assert.match(dovecoteJs, /const doveFolderMenuConfig = \{/);
    assert.match(dovecoteJs, /contextMenu\.attachClickMenuToElement\(button, doveFolderMenuConfig\)/);
    assert.match(dovecoteJs, /const doveRenderFolderButton = function/);

    // 7. Rendered/Raw toggle + Safe badge live in the header block's right-aligned tools
    // column (doveBuildOeHeader), never overlaid on the body, and not in the main toolbar.
    assert.match(dovecoteJs, /const doveBuildBodyViewToggle = function/);
    assert.match(dovecoteJs, /const doveBuildOeHeader = function/);
    assert.match(dovecoteJs, /'dovecote-oe-header-tools'/);
    assert.doesNotMatch(dovecoteJs, /dovecote-body-tools/);
    assert.match(dovecoteJs, /'button-group dovecote-body-view-toggle'/);
    assert.match(dovecoteJs, /const doveBuildSanitizedBadge = function/);
    assert.doesNotMatch(dovecoteJs, /doveBuildToolbar[\s\S]{0,2000}data-dove-body-view/);

    // 8. Mail row context menu (#4): Open / Open in Window / Reply / Forward submenu /
    // Mark read-unread / Archive / Delete, attached to the rows container.
    assert.match(dovecoteJs, /contextMenu\.attachToElement\(rows, doveMailRowMenuConfig\)/);
    assert.match(dovecoteJs, /const doveMailRowMenuConfig = \{/);
    assert.match(dovecoteJs, /action: 'dove-row-open'/);
    assert.match(dovecoteJs, /action: 'dove-row-open-window'/);
    assert.match(dovecoteJs, /action: 'dove-row-reply'/);
    assert.match(dovecoteJs, /action: 'dove-row-forward'/);
    assert.match(dovecoteJs, /action: 'dove-row-toggle-read'/);
    assert.match(dovecoteJs, /action: 'dove-row-archive'/);
    assert.match(dovecoteJs, /action: 'dove-row-delete'/);

    // 9. Read receipts (#2): sent rows show a check once readByRecipient is true.
    assert.match(dovecoteJs, /mail\.readByRecipient/);
    assert.match(dovecoteJs, /fa-check-double dovecote-read-receipt/);

    // 10. Attachments (#3): compose has an attach control with client-side size checks
    // matching the server limits; the reading pane renders thumbnails/download links via
    // the new dovecote_get_attachment call, which never inlines bytes into list/preview state.
    assert.match(dovecoteJs, /const DOVE_MAX_ATTACHMENT_BYTES = 10 \* 1024 \* 1024/);
    assert.match(dovecoteJs, /const DOVE_MAX_TOTAL_ATTACHMENT_BYTES = 25 \* 1024 \* 1024/);
    assert.match(dovecoteJs, /fileToBase64\(file\)/);
    assert.match(dovecoteJs, /wsClient\.sendMessage\('dovecote_get_attachment', request\)/);
    assert.match(dovecoteJs, /const doveRenderAttachmentsInto = function/);
    assert.match(dovecoteJs, /dovecote-compose-field-row/);

    console.log('dovecote windows (compose/reader/tray/menu) tests passed');
}

main();

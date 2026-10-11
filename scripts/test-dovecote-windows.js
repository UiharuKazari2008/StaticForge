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
    assert.match(dovecoteJs, /modal\.className = 'modal resizeable-window dovecote-reader-window/);
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

    console.log('dovecote windows (compose/reader/tray/menu) tests passed');
}

main();

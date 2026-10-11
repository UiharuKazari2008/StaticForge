'use strict';

// eMotion desktop app (image-to-video, #b26): same conventions as every other desktop-apps
// window (calculator.js, dovecote.js) — standardized title-bar toolbar, inset panels, custom
// dropdown/context-menu for every picker (no native <select>), scroll-wheel number inputs with
// a <=200ms debounce, CSS classes not inline layout styles, Start menu entry under Tools.
// Source-level checks only: this file is browser-only (document/wsClient/contextMenu globals),
// same static-assertion style as test-dovecote-windows.js.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const emotionJs = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/desktop-apps/emotion.js'), 'utf8');
const emotionCss = fs.readFileSync(path.join(__dirname, '..', 'public/css/desktop-apps/emotion.css'), 'utf8');
const appHtml = fs.readFileSync(path.join(__dirname, '..', 'public/app.html'), 'utf8');
const modalUtilsJs = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/modalUtils.js'), 'utf8');

function main() {
    // 1. Standard desktop-app window scaffold: open entry point, lazy modal builder, standard
    // title bar (icon + text), minimize/maximize/close controls, windowIdentifier for the
    // shared drag/resize/minimize/taskbar plumbing (modalUtils.js).
    assert.match(emotionJs, /function openDesktopEmotion\(\)/);
    assert.match(emotionJs, /const ensureDesktopEmotionModal = function/);
    assert.match(emotionJs, /modal\.dataset\.windowIdentifier = 'desktopEmotion'/);
    assert.match(emotionJs, /modal\.className = 'modal resizeable-window toolbar-visible hidden'/);
    assert.match(emotionJs, /titleMain\.className = 'modal-window-title-main'/);
    assert.match(emotionJs, /toolbar\.className = 'modal-window-title-toolbar'/);
    assert.match(emotionJs, /'btn-secondary minimize-btn btn-small'/);
    assert.match(emotionJs, /'btn-secondary btn-small modal-work-area-maximize'/);
    assert.match(emotionJs, /'btn-danger close-btn btn-small'/);
    assert.match(emotionJs, /closeBtn\.addEventListener\('click', \(\) => \{\s*closeModal\(modal\);/);

    // 2. Mockup layout: 1:1 preview panel (left) that also carries the progress overlay and the
    // result badge, prompt editor + controls column (right), Start/Stop bottom-right.
    assert.match(emotionJs, /emotion-preview-panel emotion-inset-panel/);
    assert.match(emotionCss, /\.emotion-preview-panel\s*{[^}]*aspect-ratio:\s*1\s*\/\s*1/s);
    assert.match(emotionJs, /emotion-prompt-panel emotion-inset-panel/);
    assert.match(emotionJs, /emotion-controls-panel emotion-inset-panel/);
    assert.match(emotionJs, /emotion-start-row/);
    assert.match(emotionJs, /emotionHandleStartStopClick/);
    assert.match(emotionCss, /\.emotion-start-row\s*{[^}]*justify-content:\s*flex-end/s);

    // Inset-panel recipe matches director.css's .director-expandable-content (glass-inset-bg-4
    // background, glass-border-4 border, inset glass-shadow-3 box-shadow).
    assert.match(emotionCss, /\.emotion-inset-panel\s*{\s*background:\s*var\(--glass-inset-bg-4\);\s*border-radius:\s*8px;\s*border:\s*1px solid var\(--glass-border-4\);\s*box-shadow:\s*inset var\(--glass-shadow-3\);/);

    // 3. No native <select> anywhere; every picker goes through dropdown.js's custom-dropdown
    // or contextMenu.js's click-menu, same as animateImageDialog.js / dovecote.js.
    assert.doesNotMatch(emotionJs, /createElement\(['"]select['"]\)/);
    assert.match(emotionJs, /className = 'custom-dropdown dark'/);
    assert.match(emotionJs, /setupDropdown\(wrap, btn, menu,/);
    assert.match(emotionJs, /contextMenu\.attachClickMenuToElement\(loadBtn, emotionLoadImageMenuConfig\)/);

    // 4. Scroll-wheel adjustable number inputs (frames/fps) via the shared wheelTickGate.js
    // helper, gated at <=200ms (150ms here).
    assert.match(emotionJs, /createWheelTickGate\(150\)/);
    assert.match(emotionJs, /guardWheelTick\(e, allowTick\)/);
    assert.match(emotionJs, /emotionWireWheelNumberInput\(framesInput,/);
    assert.match(emotionJs, /emotionWireWheelNumberInput\(fpsInput,/);

    // 5. Mode picker reuses the Studio animate dialog's backend catalog (loop/wan/ltx) instead
    // of redefining it — public/scripts/comp/animateImageDialog.js.
    assert.match(emotionJs, /knownLocalAnimateBackends\(\)/);
    assert.match(emotionJs, /fetchLocalAnimateStatus\(\)/);
    assert.doesNotMatch(emotionJs, /LOCAL_ANIMATE_BACKENDS\s*=\s*\[/);

    // 6. Animate job goes through the same wsClient.animateImage() wire path as Studio/MCP, with
    // mode/frames/fps/loop and no fabricated "seed" control (the animate backend has no seed
    // parameter — see modules/mcpAgentFacade.js's animate_image inputSchema).
    assert.match(emotionJs, /ws\.animateImage\(params\)/);
    assert.match(emotionJs, /backend: desktopEmotion\.mode/);
    assert.doesNotMatch(emotionJs, /seed/i);

    // 7. Stop abandons/cancels: resets running state immediately, ignores a result that lands
    // after Stop was pressed (compared by this job's own requestId, not a shared flag a later
    // job could reset), and best-effort notifies the server via the same cancel_generation
    // packet other generation types use.
    assert.match(emotionJs, /function emotionStopJob\(\)/);
    assert.match(emotionJs, /sendAcklessMessage\('cancel_generation', \{ cancelledRequestIds: \[requestId\] \}\)/);
    assert.match(emotionJs, /if \(desktopEmotion\.requestId !== requestId\) return;/);

    // 8. Progress comes from the real server keep-alive channel (request_keep_alive), filtered
    // by this job's own requestId — not a fake/synthetic timer.
    assert.match(emotionJs, /ws\.on\('request_keep_alive', onKeepAlive\)/);
    assert.match(emotionJs, /data\.requestId !== requestId/);
    assert.doesNotMatch(emotionJs, /setInterval/);

    // 9. Auto prompt via Director: a toggle in the title-bar toolbar that asks the real Director
    // session pipeline (sendMessage/pendingAttachments) to write the motion prompt from the
    // loaded image, not a hand-rolled raw websocket reimplementation of the chat protocol.
    assert.match(emotionJs, /Auto prompt via Director/);
    assert.match(emotionJs, /director\.pendingAttachments = \[\{/);
    assert.match(emotionJs, /director\.sendMessage\(EMOTION_DIRECTOR_INSTRUCTION\)/);
    assert.match(emotionJs, /desktopEmotion\.autoPromptViaDirector/);

    // 10. Load image: Gallery selection or Studio's current image (agentClientBridge.js's
    // readOpenFilename() precedence, replicated here since it isn't exported globally there).
    assert.match(emotionJs, /function emotionLoadFromGallery\(\)/);
    assert.match(emotionJs, /getSelectedFilenames\(\)/);
    assert.match(emotionJs, /function emotionLoadFromStudio\(\)/);
    assert.match(emotionJs, /function emotionReadStudioCurrentFilename\(\)/);
    assert.match(emotionJs, /window\.currentManualPreviewImage/);

    // 11. Start menu: registered under Tools with an entry + icon (FontAwesome, same convention
    // as the other simple Tools apps — calculator/alarm/pomodoro/music/video have no imageIcon
    // either), and the launcher calls openDesktopEmotion().
    assert.match(
        modalUtilsJs,
        /\{ launchId: 'emotion', icon: 'fas fa-photo-film', imageIcon: 'emotion\.png', text: 'eMotion', appMenuLocation: 'tools', action: \(\) => \{ \/\* public\/scripts\/comp\/desktop-apps\/emotion\.js \*\/ openDesktopEmotion\(\); \} \},/
    );
    const toolsSubmenuSection = modalUtilsJs.slice(
        modalUtilsJs.indexOf('function buildToolsSubmenuItems'),
        modalUtilsJs.indexOf('function buildToolsSubmenuItems') + 4000
    );
    assert.match(toolsSubmenuSection, /launchId: 'emotion'/);

    // 12. Wired into app.html: stylesheet + script tag, both after the other desktop-apps assets.
    assert.match(appHtml, /<link rel="stylesheet" href="\/css\/desktop-apps\/emotion\.css">/);
    assert.match(appHtml, /<script src="scripts\/comp\/desktop-apps\/emotion\.js"><\/script>/);

    console.log('✅ test-emotion-desktop-app.js passed');
}

main();

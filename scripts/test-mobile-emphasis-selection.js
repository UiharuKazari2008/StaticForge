#!/usr/bin/env node
/**
 * Mobile prompt-emphasis selection: Playwright Pixel 7 + iPhone 13 (hasTouch)
 * plus desktop mouse. Loads the real Studio scripts in a harness.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const PORT = 0;

function contentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.js') return 'application/javascript; charset=utf-8';
    if (ext === '.css') return 'text/css; charset=utf-8';
    if (ext === '.html') return 'text/html; charset=utf-8';
    return 'application/octet-stream';
}

function startServer() {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
            const rel = urlPath === '/' ? '/emphasis-selection-harness.html' : urlPath;
            const filePath = rel === '/emphasis-selection-harness.html'
                ? HARNESS_PATH
                : path.join(ROOT, rel.replace(/^\/+/, ''));
            if (filePath !== HARNESS_PATH && !filePath.startsWith(ROOT)) {
                res.writeHead(403);
                res.end();
                return;
            }
            fs.readFile(filePath, (err, data) => {
                if (err) {
                    res.writeHead(404);
                    res.end(String(err.message));
                    return;
                }
                res.writeHead(200, { 'Content-Type': contentType(filePath) });
                res.end(data);
            });
        });
        server.listen(PORT, '127.0.0.1', () => {
            resolve({ server, port: server.address().port });
        });
        server.on('error', reject);
    });
}

const HARNESS_PATH = path.join('/tmp', 'emphasis-selection-harness.html');

const HARNESS_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Emphasis selection harness</title>
<link rel="stylesheet" href="/public/css/context-menu.css">
<link rel="stylesheet" href="/public/css/emphasis-manager.css">
<style>
body { margin: 0; background: #1a1d21; color: #eee; font-family: sans-serif; }
.prompt-textarea-container { position: relative; padding: 12px; }
.prompt-textarea-emphasis-wrap { position: relative; }
.prompt-textarea {
    width: 100%; min-height: 120px; font-size: 16px;
    background: #111; color: #eee; border: 1px solid #444; padding: 8px;
}
.prompt-textarea-toolbar { display: flex; gap: 8px; margin-top: 8px; }
.toolbar-btn { min-width: 44px; min-height: 44px; }
.emphasis-highlight-overlay {
    pointer-events: none; position: absolute; inset: 0;
    white-space: pre-wrap; word-wrap: break-word; overflow: hidden;
}
</style>
</head>
<body>
<div class="prompt-textarea-container">
    <div class="prompt-textarea-emphasis-wrap">
        <textarea id="manualPrompt" class="prompt-textarea">liberalio (nikke), plump, side view, looking at viewer</textarea>
    </div>
    <div class="prompt-textarea-toolbar">
        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="emphasis-group-chip" title="Emphasis">
            <i class="fas fa-dial"></i>
        </button>
        <button type="button" class="btn-secondary btn-small toolbar-btn" data-action="emphasis" title="Edit Emphasis">
            Edit
        </button>
    </div>
</div>
<script>
var promptTextareaToolbar = null;
window.wsClient = {
    registerInitStep: function () {},
    isConnected: function () { return false; },
    sendMessage: function () { return Promise.resolve({}); }
};
window.emphasisNormalizationByField = {};
function getEmphasisNormalizationFieldStore() { return window.emphasisNormalizationByField; }
function syncEmphasisNormalizationPreviewMetadata() {}
function refreshEmphasisGroupsToolInstancesFromForgeState() {}
function hideCharacterAutocomplete() {}
function autoResizeTextarea() {}
function addSafeEventListener(el, type, fn) { if (el) el.addEventListener(type, fn); }
function cancelTextInputSideEffect() {}
function wirePromptTextareaVisualUpdates() {}
function getU1TagPattern() { return null; }
function showGlassToast() {}
function extractFirstTag(text) { return String(text || '').split(/[,\s]/)[0] || ''; }
function getWikiTermFromPromptTextareaForKeyboard() { return ''; }
function getPromptContextMenuFavorites() { return { tags: [], textReplacements: [] }; }
function copyTextToClipboard(text) { return Promise.resolve(text); }
function readClipboardTextFast() { return Promise.resolve(''); }
function featureLoader() {}
featureLoader.loadFeature = function () { return Promise.resolve(); };
var emphasisGroupsToolManager = null;
var requestBodyReplacements = [];
var currentCharacterAutocompleteTarget = null;
function injectAutocompleteSuggestionAtCursor() {}
function selectDynamicPlaceholder() {}
function getTagInsertStringForAutocomplete(t) { return t; }
function fetchWordLookupForTerm() { return Promise.resolve({ hasData: false }); }
function applyWordLookupInsert() {}
function primeWordLookupReplaceContext() {}
function ensureFavoritesLoadedForPromptMenu() { return Promise.resolve(); }
function showAddToFavoritesDialog() {}
function showDatasetTagToolbar() {}
function openStudioChangeExportDialog() {}
function openStudioVSliderTool() {}
function openPhasewalkerEditor() {}
function buildPhasewalkerContextSubmenuItems() { return []; }
function handlePhasewalkerContextSubmenuAction() {}
function getMappedManualModel() { return 'v4'; }
function getPromptTokenizer() { return null; }
function getPromptTokenLimit() { return 0; }
function ensurePromptTokenizerForModel() { return Promise.resolve(null); }
function isV5Model() { return false; }
function updatePromptStatusIcons() {}
function renderDropdown() {}
function initDropdowns() {}
function setupDropdown() {}
function closeDropdown() {}
function createWheelTickGate() { return function () { return true; }; }
function guardWheelTick() { return true; }
function getEmphasisAdjustStep() { return 0.1; }
function showShortcutActionToast() {}
function stripDisabledPromptBlocks(v) { return v; }
function isCursorInsideDisableBlock() { return false; }
function isCursorInsideProtectBlock() { return false; }
function toggleDisableSyntax() {}
function toggleProtectSyntax() {}
function splitEmphasisBlock() { return false; }
function splitEmphasisGroupAtCommasAtCursor() {}
function canSplitEmphasisGroupAtCommasAtCursor() { return false; }
function removeAllEmphasisFromSelection() {}
function positionCustomDialog() {}
function showConfirmationDialog() { return Promise.resolve(null); }
function stripEmphasisFromText(v) { return v; }
</script>
<script src="/public/scripts/comp/textareaUtils.js"></script>
<script src="/public/scripts/comp/emphasisWeightMath.js"></script>
<script src="/public/scripts/comp/emphasisParse.js"></script>
<script src="/public/scripts/comp/emphasisGroupIdCodec.js"></script>
<script src="/public/scripts/comp/emphasisSelection.js"></script>
<script src="/public/scripts/comp/emphasisHighlight.js"></script>
<script src="/public/scripts/comp/emphasisEditing.js"></script>
<script src="/public/scripts/comp/emphasisSyntaxToggles.js"></script>
<script src="/public/scripts/comp/contextMenu.js"></script>
<script src="/public/scripts/comp/promptTextareaToolbar.js"></script>
<script src="/public/scripts/comp/promptTextareaContextMenu.js"></script>
<script>
promptTextareaToolbar = new PromptTextareaToolbar();
initPromptTextareaContextMenu();
window.__emphasisHarnessReady = true;
</script>
</body>
</html>
`;

function writeHarness() {
    fs.writeFileSync(HARNESS_PATH, HARNESS_HTML);
}

function removeHarness() {
    try { fs.unlinkSync(HARNESS_PATH); } catch (_e) { /* ignore */ }
}

function collectWrapState() {
    const ta = document.getElementById('manualPrompt');
    const value = ta.value || '';
    const visible = value.replace(/[\u200B-\u200D\u2060-\u2064\uFEFF\u00AD]/g, '');
    const overlay = document.querySelector('.emphasis-highlight-overlay');
    const overlayHtml = overlay ? overlay.innerHTML : '';
    const classic = /1\.5::\s*plump\s*::/.test(value);
    const managed = visible.includes('plump') && value !== visible
        && /emphasis-weight-group/.test(overlayHtml);
    const highlighted = /emphasis-weight-group/.test(overlayHtml)
        && /plump/i.test(overlay ? overlay.textContent : '');
    return {
        value,
        visible,
        classic,
        managed,
        highlighted,
        overlayHtml: overlayHtml.slice(0, 400),
        hasOverlay: !!overlay,
        sel: [ta.selectionStart, ta.selectionEnd],
        saved: ta._emphasisSavedSelection || null
    };
}

async function selectPlump(page) {
    await page.evaluate(() => {
        const ta = document.getElementById('manualPrompt');
        const value = ta.value;
        const start = value.indexOf('plump');
        const end = start + 5;
        ta.focus();
        ta.setSelectionRange(start, end);
        document.dispatchEvent(new Event('selectionchange'));
        capturePromptTextareaSelection(ta);
    });
}

async function collapseLikeMobileBlur(page) {
    await page.evaluate(() => {
        const ta = document.getElementById('manualPrompt');
        ta.blur();
        ta.setSelectionRange(ta.value.length, ta.value.length);
    });
}

async function applyViaContextMenu(page, { collapseBeforePick }) {
    await page.evaluate(() => {
        const ta = document.getElementById('manualPrompt');
        ta.focus();
    });
    await selectPlump(page);
    await page.evaluate(() => {
        const ta = document.getElementById('manualPrompt');
        const rect = ta.getBoundingClientRect();
        const ev = {
            touches: [{ clientX: rect.left + 40, clientY: rect.top + 20 }],
            clientX: rect.left + 40,
            clientY: rect.top + 20
        };
        beginPromptTextareaSelectionGesture(ta);
        contextMenu.showMenu(ev, ta, true);
    });
    if (collapseBeforePick) {
        await collapseLikeMobileBlur(page);
    }
    const applyItem = page.locator('.context-menu-item', { hasText: 'Apply Emphasis' }).first();
    await applyItem.waitFor({ state: 'visible', timeout: 5000 });
    await applyItem.click();
    const weightBtn = page.locator('.context-menu-grid-btn', { hasText: /^1\.5$/ }).first();
    await weightBtn.waitFor({ state: 'visible', timeout: 5000 });
    await weightBtn.click();
    return page.evaluate(collectWrapState);
}

async function applyViaToolbar(page, { collapseBeforeApply, usePointer }) {
    await page.evaluate(() => {
        const ta = document.getElementById('manualPrompt');
        ta.value = 'liberalio (nikke), plump, side view, looking at viewer';
        ta.focus();
    });
    await selectPlump(page);
    const chip = page.locator('.prompt-textarea-toolbar [data-action="emphasis"]').first();
    if (usePointer) {
        const box = await chip.boundingBox();
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    } else {
        await chip.click();
    }
    if (collapseBeforeApply) {
        await collapseLikeMobileBlur(page);
    }
    await page.evaluate(() => {
        const ta = document.getElementById('manualPrompt');
        applySetEmphasisWeight(ta, 1.5);
        updateEmphasisHighlighting(ta);
    });
    return page.evaluate(collectWrapState);
}

async function applyDesktopMouse(page) {
    await page.evaluate(() => {
        const ta = document.getElementById('manualPrompt');
        ta.value = 'liberalio (nikke), plump, side view, looking at viewer';
        ta.focus();
    });
    await selectPlump(page);
    const before = await page.evaluate(() => {
        const ta = document.getElementById('manualPrompt');
        return { start: ta.selectionStart, end: ta.selectionEnd, text: ta.value.slice(ta.selectionStart, ta.selectionEnd) };
    });
    await page.evaluate(() => {
        const ta = document.getElementById('manualPrompt');
        applySetEmphasisWeight(ta, 1.5);
        updateEmphasisHighlighting(ta);
    });
    const after = await page.evaluate(collectWrapState);
    return { before, after };
}

function passWrap(result, label) {
    if (!result.classic && !result.managed) {
        throw new Error(`${label} did not wrap plump: ${JSON.stringify(result)}`);
    }
    if (!result.highlighted) {
        throw new Error(`${label} missing highlight overlay: ${JSON.stringify(result)}`);
    }
}

async function resolvePlaywright() {
    const candidates = [
        'playwright-core',
        'playwright',
        path.join(ROOT, 'node_modules/playwright-core'),
        path.join(ROOT, 'node_modules/playwright')
    ];
    for (const id of candidates) {
        try {
            return require(id);
        } catch (_e) { /* try next */ }
    }
    const { execSync } = require('child_process');
    execSync('npm install --no-save --prefix /tmp/pw-emphasis playwright-core@1.55.0', { stdio: 'inherit' });
    return require('/tmp/pw-emphasis/node_modules/playwright-core');
}

async function launchBrowser(pw) {
    const launchOpts = { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] };
    try {
        return await pw.chromium.launch({ ...launchOpts, channel: 'chrome' });
    } catch (_e) {
        return await pw.chromium.launch(launchOpts);
    }
}

async function run() {
    writeHarness();
    const { server, port } = await startServer();
    const base = `http://127.0.0.1:${port}/emphasis-selection-harness.html`;
    const pw = await resolvePlaywright();
    const browser = await launchBrowser(pw);
    const results = [];

    const mobileProfiles = [
        { name: 'Pixel 7', device: (pw.devices && pw.devices['Pixel 7']) || { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36' } },
        { name: 'iPhone 13', device: (pw.devices && pw.devices['iPhone 13']) || { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Version/15.0 Mobile/15E148 Safari/604.1' } }
    ];

    try {
        for (const profile of mobileProfiles) {
            const context = await browser.newContext({
                ...profile.device,
                hasTouch: true
            });
            const page = await context.newPage();
            page.on('pageerror', (err) => {
                console.warn(profile.name, 'pageerror', String(err));
            });
            await page.goto(base, { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => window.__emphasisHarnessReady === true);

            const menu = await applyViaContextMenu(page, { collapseBeforePick: true });
            passWrap(menu, `${profile.name} context menu`);
            results.push({ profile: profile.name, case: 'context-menu-1.5', result: 'PASS', wrap: menu.classic ? 'classic' : 'managed' });

            const toolbar = await applyViaToolbar(page, { collapseBeforeApply: true, usePointer: true });
            passWrap(toolbar, `${profile.name} toolbar`);
            results.push({ profile: profile.name, case: 'toolbar-1.5', result: 'PASS', wrap: toolbar.classic ? 'classic' : 'managed' });

            await context.close();
        }

        const desktop = await browser.newContext({
            viewport: { width: 1280, height: 800 },
            hasTouch: false,
            isMobile: false
        });
        const page = await desktop.newPage();
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__emphasisHarnessReady === true);
        const mouse = await applyDesktopMouse(page);
        if (mouse.before.text !== 'plump') {
            throw new Error(`desktop selection lost before apply: ${JSON.stringify(mouse.before)}`);
        }
        passWrap(mouse.after, 'desktop mouse');
        results.push({ profile: 'desktop', case: 'mouse-1.5', result: 'PASS', wrap: mouse.after.classic ? 'classic' : 'managed' });

        await page.evaluate(() => {
            const ta = document.getElementById('manualPrompt');
            ta.value = 'liberalio (nikke), plump, side view, looking at viewer';
            ta.focus();
        });
        await selectPlump(page);
        await page.evaluate(() => {
            const ta = document.getElementById('manualPrompt');
            const pos = ta.value.indexOf('side view') + 2;
            ta.focus();
            ta.setSelectionRange(pos, pos);
            document.dispatchEvent(new Event('selectionchange'));
            capturePromptTextareaSelection(ta, { clearIfCollapsed: true });
            applySetEmphasisWeight(ta, 1.5);
            updateEmphasisHighlighting(ta);
        });
        const caretApply = await page.evaluate(() => {
            const ta = document.getElementById('manualPrompt');
            const inners = listManagedEmphasisBlocks(ta.value || '').map((b) => b.innerText);
            const overlay = document.querySelector('.emphasis-highlight-overlay');
            return {
                inners,
                value: ta.value,
                highlighted: !!(overlay && overlay.querySelector('.emphasis-weight-group'))
            };
        });
        if (!caretApply.inners.some((t) => /side view/.test(t))) {
            throw new Error(`desktop caret apply did not wrap side view: ${JSON.stringify(caretApply)}`);
        }
        if (caretApply.inners.some((t) => t.trim() === 'plump')) {
            throw new Error(`desktop caret apply reused stale plump selection: ${JSON.stringify(caretApply)}`);
        }
        if (!caretApply.highlighted) {
            throw new Error(`desktop caret apply missing highlight: ${JSON.stringify(caretApply)}`);
        }
        results.push({ profile: 'desktop', case: 'caret-autodetect-not-stale-plump', result: 'PASS' });
        await desktop.close();
    } finally {
        await browser.close();
        server.close();
        removeHarness();
    }

    const failed = results.filter((r) => r.result !== 'PASS');
    console.log(JSON.stringify({ results }, null, 2));
    if (failed.length) {
        process.exit(1);
    }
    console.log('test-mobile-emphasis-selection: ok');
}

run().catch((err) => {
    removeHarness();
    console.error(err);
    process.exit(1);
});

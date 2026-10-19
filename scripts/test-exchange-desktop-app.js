'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const exchangeJs = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/desktop-apps/exchange.js'), 'utf8');
const exchangeCss = fs.readFileSync(path.join(__dirname, '..', 'public/css/desktop-apps/exchange.css'), 'utf8');
const appHtml = fs.readFileSync(path.join(__dirname, '..', 'public/app.html'), 'utf8');
const modalUtilsJs = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/modalUtils.js'), 'utf8');
const loader = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/featureLoader.js'), 'utf8');
const manifests = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/dsapManifests.js'), 'utf8');
const registry = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/dsapRegistry.js'), 'utf8');
const reserved = fs.readFileSync(path.join(__dirname, '..', 'modules/melatonPackageStore.js'), 'utf8');

function main() {
    assert.match(exchangeJs, /function openDesktopExchange\(\)/);
    assert.match(exchangeJs, /const ensureDesktopExchangeModal = function/);
    assert.match(exchangeJs, /modal\.dataset\.windowIdentifier = 'desktopExchange'/);
    assert.match(exchangeJs, /modal\.className = 'modal resizeable-window toolbar-visible hidden'/);
    assert.match(exchangeJs, /titleMain\.className = 'modal-window-title-main'/);
    assert.match(exchangeJs, /'btn-secondary minimize-btn btn-small'/);
    assert.match(exchangeJs, /'btn-secondary btn-small modal-work-area-maximize'/);
    assert.match(exchangeJs, /'btn-danger close-btn btn-small'/);
    assert.match(exchangeJs, /titleText\.textContent = 'Dreamscape Exchange Server'/);
    assert.match(exchangeJs, /explorer-actions-header/);
    assert.match(exchangeJs, /explorer-command-btn/);
    assert.match(exchangeJs, /'btn-secondary btn-small explorer-command-btn indicator'/);
    assert.match(exchangeJs, /dataset\.state/);
    assert.match(exchangeJs, /modal-content modal-padding dark/);
    assert.match(exchangeJs, /exchange-inset-panel/);
    assert.match(exchangeCss, /background: var\(--glass-layer-dark-4\);\s*border: 1px solid var\(--glass-border-4\);/);
    assert.doesNotMatch(exchangeJs, /createElement\(['"]select['"]\)/);
    assert.doesNotMatch(exchangeJs, /custom-dropdown/);
    assert.match(exchangeJs, /contextMenu\.attachClickMenuToElement/);
    assert.match(exchangeJs, /kazari\.ops@dream\.737\.jp\.net/);
    assert.match(exchangeJs, /confirmText: 'DELETE'/);
    assert.match(exchangeJs, /showInputDialog/);
    assert.doesNotMatch(exchangeJs, /relayReadToken|relayAdminToken/);
    assert.doesNotMatch(exchangeJs, /\bwindow\./);

    assert.match(loader, /css\/desktop-apps\/exchange\.css/);
    assert.match(loader, /scripts\/comp\/desktop-apps\/exchange\.js/);
    assert.doesNotMatch(appHtml, /desktop-apps\/exchange\.(css|js)/);

    assert.match(modalUtilsJs, /launchId: 'exchange'/);
    assert.match(modalUtilsJs, /openDesktopExchange\(\)/);
    assert.match(modalUtilsJs, /adminOnly: true/);
    const toolsSubmenuSection = modalUtilsJs.slice(
        modalUtilsJs.indexOf('function buildToolsSubmenuItems'),
        modalUtilsJs.indexOf('function buildToolsSubmenuItems') + 5000
    );
    assert.match(toolsSubmenuSection, /launchId: 'exchange'/);

    assert.match(manifests, /exchange\.dreamscape\.jp/);
    assert.match(manifests, /adminOnly: true/);
    assert.match(registry, /adminOnly: !!me\.adminOnly/);
    assert.match(reserved, /exchange\.dreamscape\.jp/);

    console.log('test-exchange-desktop-app: ok');
}

main();

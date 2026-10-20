'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const exchangeJs = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/desktop-apps/exchange.js'), 'utf8');
const exchangeCss = fs.readFileSync(path.join(__dirname, '..', 'public/css/desktop-apps/exchange.css'), 'utf8');
const appletJs = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/exchangeDsapApplet.js'), 'utf8');
const appHtml = fs.readFileSync(path.join(__dirname, '..', 'public/app.html'), 'utf8');
const modalUtilsJs = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/modalUtils.js'), 'utf8');
const loader = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/featureLoader.js'), 'utf8');
const manifests = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/dsapManifests.js'), 'utf8');
const registry = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/dsapRegistry.js'), 'utf8');
const reserved = fs.readFileSync(path.join(__dirname, '..', 'modules/melatonPackageStore.js'), 'utf8');

function stripCommentsAndStrings(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/'(?:\\.|[^'\\])*'/g, "''")
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

function main() {
    assert.match(appletJs, /const EXCHANGE_DSAP_URL = 'exchange\.dreamscape\.jp'/);
    assert.match(appletJs, /function exchangeDsapResolveActiveTab/);
    assert.match(appletJs, /function exchangeDsapBuildTabUrl/);
    assert.match(appletJs, /dsap:\/\/\$\{EXCHANGE_DSAP_URL\}\//);
    assert.match(appletJs, /data-dsap="exchange"/);
    assert.match(appletJs, /exchange-dsap win7/);
    assert.match(appletJs, /exchange-inset-panel/);
    assert.match(appletJs, /exchange-status-bar/);
    assert.match(appletJs, /explorer-actions-header/);
    assert.match(appletJs, /getContent\(/);
    assert.match(appletJs, /host\.navigate/);
    assert.match(appletJs, /registerDsap\(/);
    assert.doesNotMatch(appletJs, /activate\s*\(/);
    assert.doesNotMatch(appletJs, /desktopOnly/);
    assert.doesNotMatch(appletJs, /createElement\(['"]select['"]\)/);
    assert.doesNotMatch(appletJs, /custom-dropdown/);

    assert.match(exchangeJs, /function openDesktopExchange\(\)/);
    assert.match(exchangeJs, /openDsapInGrimoire\('dsap:\/\/exchange\.dreamscape\.jp\/'\)/);
    assert.match(exchangeJs, /function exchangeBindHost/);
    assert.match(exchangeJs, /function exchangeSend/);
    assert.match(exchangeJs, /explorer-command-btn/);
    assert.match(exchangeJs, /'btn-secondary btn-small indicator'/);
    assert.match(exchangeJs, /dataset\.state/);
    assert.match(exchangeJs, /button-group/);
    assert.match(exchangeJs, /showIndicator: true/);
    assert.match(exchangeJs, /indicatorMark: 'radio'/);
    assert.match(exchangeJs, /kazari\.ops@dream\.737\.jp\.net/);
    assert.match(exchangeJs, /function exchangeRelayFriendly/);
    assert.match(exchangeJs, /UNKNOWN_MAILBOX/);
    assert.match(exchangeJs, /UNKNOWN_SERVICE/);
    assert.match(exchangeJs, /BAD_BODY/);
    assert.match(exchangeJs, /ACTOR_REQUIRED/);
    assert.match(exchangeJs, /exchange-from-list/);
    assert.match(exchangeJs, /Lookup answered correctly/);
    assert.match(exchangeJs, /Our IP listed/);
    assert.match(exchangeJs, /refreshed_at/);
    assert.match(exchangeJs, /function exchangeFormatAge/);
    assert.match(exchangeJs, /confirmText: 'DELETE'/);
    assert.match(exchangeJs, /showInputDialog/);
    assert.match(exchangeJs, /exchangeMailboxAddress/);
    assert.doesNotMatch(exchangeJs, /fas fa-circle/);
    assert.doesNotMatch(exchangeJs, /desktopExchangeModal/);
    assert.doesNotMatch(exchangeJs, /data-window-min-width/);
    assert.doesNotMatch(exchangeJs, /createElement\(['"]select['"]\)/);
    assert.doesNotMatch(exchangeJs, /custom-dropdown/);
    assert.doesNotMatch(exchangeJs, /relayReadToken|relayAdminToken/);
    assert.doesNotMatch(exchangeJs, /\bwindow\./);
    assert.doesNotMatch(exchangeJs, /indicatorStyle:\s*'dot'/);

    assert.match(exchangeCss, /background: var\(--glass-layer-dark-4\);\s*border: 1px solid var\(--glass-border-4\);/);
    assert.match(exchangeCss, /border-radius: var\(--border-radius-md\);/);
    assert.match(exchangeCss, /body:not\(\.windows-classic-theme\) \[data-dsap="exchange"\] \.exchange-inset-panel/);
    assert.match(exchangeCss, /background: #fff;/);
    assert.match(exchangeCss, /border-color: #828790;/);
    assert.match(exchangeCss, /exchange-from-list/);
    assert.match(exchangeCss, /exchange-status-bar/);
    assert.match(exchangeCss, /exchange-table-wrap/);
    assert.match(exchangeCss, /overflow-wrap: anywhere/);
    assert.match(exchangeCss, /min-width: 0/);
    assert.doesNotMatch(exchangeCss, /box-shadow/);
    assert.doesNotMatch(exchangeCss, /exchange-card/);
    assert.doesNotMatch(exchangeCss, /#c9a227/);
    assert.doesNotMatch(exchangeCss, /#desktopExchangeModal/);
    assert.doesNotMatch(exchangeCss, /padding:\s*\d+px/);
    assert.doesNotMatch(exchangeCss, /margin:\s*[^;]*\d+px/);
    assert.doesNotMatch(exchangeCss, /gap:\s*\d+px/);

    const cssCode = stripCommentsAndStrings(exchangeCss);
    assert.doesNotMatch(cssCode, /(?:padding|margin|gap)\s*:[^;{]*\d+px/);

    assert.match(loader, /css\/desktop-apps\/exchange\.css/);
    assert.match(loader, /scripts\/comp\/desktop-apps\/exchange\.js/);
    assert.match(loader, /scripts\/comp\/exchangeDsapApplet\.js/);
    assert.doesNotMatch(appHtml, /desktop-apps\/exchange\.(css|js)/);

    assert.match(modalUtilsJs, /launchId: 'exchange'/);
    assert.match(modalUtilsJs, /openDsapInGrimoire\('dsap:\/\/exchange\.dreamscape\.jp\/'\)/);
    assert.match(modalUtilsJs, /imageIcon: 'vista-mail\.png'/);
    assert.match(modalUtilsJs, /adminOnly: true/);
    const toolsSubmenuSection = modalUtilsJs.slice(
        modalUtilsJs.indexOf('function buildToolsSubmenuItems'),
        modalUtilsJs.indexOf('function buildToolsSubmenuItems') + 5000
    );
    assert.match(toolsSubmenuSection, /launchId: 'exchange'/);
    assert.doesNotMatch(toolsSubmenuSection, /desktopOnly: true, appMenuLocation: 'tools', action: .*exchange/);

    assert.match(manifests, /exchange\.dreamscape\.jp/);
    assert.match(manifests, /adminOnly: true/);
    const exchangeManifest = manifests.slice(
        manifests.indexOf('EXCHANGE_DSAP_MANIFEST_URL'),
        manifests.indexOf('MCP_DSAP_MANIFEST_URL')
    );
    assert.match(exchangeManifest, /appMenu: true/);
    assert.match(exchangeManifest, /openDsapInGrimoire/);
    assert.match(exchangeManifest, /exchangeDsapApplet\.js/);
    assert.match(exchangeManifest, /imageIcon: 'vista-mail\.png'/);
    assert.doesNotMatch(exchangeManifest, /appMenu: false/);
    assert.doesNotMatch(exchangeManifest, /desktopOnly/);
    assert.doesNotMatch(exchangeManifest, /activate\s*\(/);
    assert.match(registry, /adminOnly: !!me\.adminOnly/);
    const smf = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/dsapSmfMarkup.js'), 'utf8');
    assert.match(smf, /dsap:\/\/exchange\.dreamscape\.jp\//);
    assert.match(smf, /Exchange Server/);
    assert.match(modalUtilsJs, /item\.adminOnly && localStorage\.getItem\('userType'\) !== 'admin'/);
    assert.match(reserved, /exchange\.dreamscape\.jp/);

    console.log('test-exchange-desktop-app: ok');
}

main();

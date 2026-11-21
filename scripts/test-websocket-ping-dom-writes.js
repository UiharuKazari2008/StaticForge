const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, '../public/scripts/websocket.js'), 'utf8');

try {
    // the ping tooltip is kept in memory and written on pointerenter (#998), never on every pong
    assert.ok(source.includes('this._setIndicatorStatusTitle(indicator.status, pingText, false)'), 'updatePingDisplay defers the ping tooltip');
    assert.ok(/_setIndicatorStatusTitle\(el, text, now\) \{[\s\S]*?'pointerenter'[\s\S]*?getAttribute\('title'\) !== /.test(source), '_setIndicatorStatusTitle writes on hover, only when changed');
    assert.ok(source.includes('setClassNameIfChanged(glyph, iconClass)'), '_updateModemTrayIcon uses setClassNameIfChanged');
    assert.ok(source.includes('setAttrIfChanged(icon, \'title\', title)'), '_updateModemTrayIcon uses setAttrIfChanged');
    assert.ok(source.includes('setClassNameIfChanged(glyph, iconClass)'), '_updateServiceWorkerTrayIcon uses setClassNameIfChanged');
    assert.ok(source.includes('setAttrIfChanged(trayIcon, \'title\', title)'), '_updateServiceWorkerTrayIcon uses setAttrIfChanged');
    assert.ok(source.includes('setAttrIfChanged(warningIcon, \'title\', reason)'), 'updatePingWarningIcon uses setAttrIfChanged');
    assert.ok(source.includes('setClassNameIfChanged(indicator.status, targetClass)'), 'updateStatus uses setClassNameIfChanged');

    console.log('test-websocket-ping-dom-writes: ok');
} catch (e) {
    console.error(e.message);
    process.exit(1);
}

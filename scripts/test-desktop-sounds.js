#!/usr/bin/env node
// Unit test for the Vista sound scheme map, enable default, path whitelist, and play skip.
// Run: node scripts/test-desktop-sounds.js
const assert = require('assert');
const path = require('path');
const sounds = require('../public/scripts/comp/desktopSounds.js');
const staticServe = require('../modules/desktopSoundsStatic.js');

(async () => {
    const storage = new Map();
    const localStorage = {
        getItem: (k) => (storage.has(k) ? storage.get(k) : null),
        setItem: (k, v) => storage.set(k, String(v)),
        removeItem: (k) => storage.delete(k)
    };

    assert.strictEqual(sounds.normalizeEvent('dialog'), 'dialog');
    assert.strictEqual(sounds.normalizeEvent('nope'), null);
    assert.strictEqual(sounds.eventFile('error'), 'Windows Error.wav');
    assert.strictEqual(sounds.eventFile('unlock'), 'Windows Logon Sound.wav');
    assert.strictEqual(sounds.eventFile('lock'), 'Windows Logoff Sound.wav');
    assert.strictEqual(sounds.eventFile('planet-enter'), 'Windows Logoff Sound.wav');
    assert.strictEqual(sounds.eventFile('planet-activate'), 'Windows Navigation Start.wav');
    assert.strictEqual(sounds.eventFile('planet-switch'), 'Windows Logon Sound.wav');
    assert.strictEqual(sounds.eventFile('print-complete'), 'Windows Print complete.wav');
    assert.strictEqual(sounds.eventFile('print-error'), 'Windows Hardware Fail.wav');
    assert.strictEqual(sounds.eventFile('balloon'), 'Windows Balloon.wav');
    assert.strictEqual(sounds.eventFile('default'), 'Windows Ding.wav');
    assert.strictEqual(sounds.eventFile('dialog'), 'Windows Ding.wav');
    assert.strictEqual(sounds.eventFile('notify'), 'Windows Notify.wav');
    assert.strictEqual(sounds.eventFile('recycle'), 'Windows Recycle.wav');
    assert.strictEqual(sounds.eventFile('critical-stop'), 'Windows Critical Stop.wav');
    assert.strictEqual(sounds.eventFile('uac'), 'Windows User Account Control.wav');
    assert.ok(sounds.isPrintRequestType('upscale_image'));
    assert.ok(sounds.isPrintRequestType('enhance_image'));
    assert.ok(sounds.isPrintRequestType('animate_image'));
    assert.strictEqual(sounds.soundUrl('navigate'), '/sounds/vista/Windows%20Navigation%20Start.wav');
    assert.ok(sounds.isPrintRequestType('generate_image'));
    assert.ok(sounds.isPrintRequestType('generate_preset'));
    assert.ok(sounds.isPrintRequestType('reroll_image'));
    assert.strictEqual(sounds.isPrintRequestType('save_preset'), false);
    assert.strictEqual(sounds.shouldSkipBalloon('Generation Complete'), true);
    assert.strictEqual(sounds.shouldSkipBalloon('Generation Failed'), true);
    assert.strictEqual(sounds.shouldSkipBalloon('Upscaling Receipt'), true);
    assert.strictEqual(sounds.shouldSkipBalloon('High Latency Detected'), false);
    assert.strictEqual(sounds.shouldSkipBalloon('Remote Access', { silent: true }), true);
    assert.strictEqual(await sounds.playBalloon('Generation Complete'), false);
    assert.strictEqual(sounds.isCancelError({ code: 'CLIENT_CANCELLED', message: 'Generation cancelled' }), true);
    assert.strictEqual(sounds.isCancelError(new Error('Generation cancelled')), true);
    assert.strictEqual(sounds.isCancelError(new Error('NovelAI 500')), false);
    assert.strictEqual(await sounds.playPrint('save_preset', null), false);
    sounds._test.state.enabled = false;
    assert.strictEqual(await sounds.playPrint('generate_image', { code: 'CLIENT_CANCELLED' }), false);
    assert.strictEqual(await sounds.playPrint('generate_image', null), false);
    assert.strictEqual(sounds.bootIconEvent('warning'), 'warning');
    assert.strictEqual(sounds.bootIconEvent('info'), 'dialog');
    assert.strictEqual(sounds.bootIconEvent('error'), 'error');

    assert.strictEqual(sounds.readEnabled(localStorage), true, 'missing key is on');
    localStorage.setItem(sounds.STORAGE_KEY, 'off');
    assert.strictEqual(sounds.readEnabled(localStorage), false);
    sounds.writeEnabled(true, localStorage);
    assert.strictEqual(localStorage.getItem(sounds.STORAGE_KEY), 'on');
    sounds.writeEnabled(false, localStorage);
    assert.strictEqual(localStorage.getItem(sounds.STORAGE_KEY), 'off');

    assert.strictEqual(staticServe.decodeSoundName('Windows Ding.wav'), 'Windows Ding.wav');
    assert.strictEqual(staticServe.decodeSoundName('Windows%20Ding.wav'), 'Windows Ding.wav');
    assert.strictEqual(staticServe.decodeSoundName('../Windows Ding.wav'), null);
    assert.strictEqual(staticServe.decodeSoundName('Windows Print complete.wav'), 'Windows Print complete.wav');
    assert.strictEqual(staticServe.decodeSoundName('Windows Balloon.wav'), 'Windows Balloon.wav');
    assert.strictEqual(staticServe.decodeSoundName('Windows Notify.wav'), 'Windows Notify.wav');
    assert.strictEqual(staticServe.decodeSoundName('Windows Recycle.wav'), 'Windows Recycle.wav');
    assert.strictEqual(staticServe.decodeSoundName('Windows Critical Stop.wav'), 'Windows Critical Stop.wav');
    assert.strictEqual(staticServe.decodeSoundName('Windows Startup.wav'), null, 'unmapped pack file is not served');
    assert.strictEqual(staticServe.decodeSoundName('Windows Ding.wav/../x'), null);

    const root = path.join(__dirname, '..');
    const ding = staticServe.resolveSoundPath(root, 'Windows Ding.wav');
    assert.ok(ding.endsWith(path.join('public', 'sounds', 'vista', 'Windows Ding.wav')));
    assert.strictEqual(staticServe.resolveSoundPath(root, '../etc/passwd'), null);
    assert.ok(staticServe.resolveSoundPath(root, 'Windows Notify.wav').endsWith(path.join('public', 'sounds', 'vista', 'Windows Notify.wav')));
    assert.strictEqual(staticServe.resolveSoundPath(root, 'Windows Startup.wav'), null);

    sounds._test.state.enabled = false;
    assert.strictEqual(await sounds.play('dialog'), false);

    sounds._test.state.enabled = true;
    // No AudioContext / desktop in node: play still no-ops without throwing
    assert.strictEqual(await sounds.play('dialog'), false);

    console.log('test-desktop-sounds: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});

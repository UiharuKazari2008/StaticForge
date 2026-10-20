'use strict';

// Control Panel Mail: the two Windows Mail checkboxes (play sound, show a dialog)
// and the new-mail tool window they gate. Source checks, same style as
// scripts/test-dovecote-windows.js.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const cpl = require('../public/scripts/comp/cplMail.js');
const root = path.join(__dirname, '..');
const dovecoteJs = fs.readFileSync(path.join(root, 'public/scripts/comp/desktop-apps/dovecote.js'), 'utf8');
const appHtml = fs.readFileSync(path.join(root, 'public/app.html'), 'utf8');
const modalUtilsJs = fs.readFileSync(path.join(root, 'public/scripts/comp/modalUtils.js'), 'utf8');
const vistaDialogsJs = fs.readFileSync(path.join(root, 'public/scripts/comp/vistaDialogs.js'), 'utf8');

function memoryStore(initial) {
    const data = Object.assign({}, initial);
    return {
        getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
        setItem(key, value) { data[key] = String(value); }
    };
}

function main() {
    const fresh = memoryStore();
    assert.strictEqual(cpl.soundOn(fresh), true);
    assert.strictEqual(cpl.dialogOn(fresh), true);

    cpl.setSound(false, fresh);
    cpl.setDialog(false, fresh);
    assert.strictEqual(fresh.getItem(cpl.SOUND_KEY), 'off');
    assert.strictEqual(fresh.getItem(cpl.DIALOG_KEY), 'off');
    assert.strictEqual(cpl.soundOn(fresh), false);
    assert.strictEqual(cpl.dialogOn(fresh), false);

    cpl.setSound(true, fresh);
    cpl.setDialog(true, fresh);
    assert.strictEqual(cpl.soundOn(fresh), true);
    assert.strictEqual(cpl.dialogOn(fresh), true);
    assert.strictEqual(cpl.soundOn(memoryStore({ [cpl.SOUND_KEY]: 'on' })), true);

    assert.match(fs.readFileSync(path.join(root, 'public/scripts/comp/featureLoader.js'), 'utf8'), /scripts\/comp\/cplMail\.js/);
    assert.match(dovecoteJs, /doveMenuItem\('Options\.\.\.', 'options'\)/);
    assert.match(dovecoteJs, /cplMail\.open\(\)/);
    assert.match(dovecoteJs, /Play sound when new messages arrive|mailSettings\.soundOn\(\)/);
    assert.match(dovecoteJs, /if \(!mailSettings \|\| mailSettings\.soundOn\(\)\)/);
    assert.match(dovecoteJs, /doveNoteMailIds/);
    assert.match(dovecoteJs, /doveCollectFreshMailIds/);
    assert.match(dovecoteJs, /if \(announce && fresh\.length\) dovePlayNewMailAlert/);
    assert.doesNotMatch(dovecoteJs, /const fresh = prev != null && unread > prev/);
    assert.match(dovecoteJs, /className = 'modal hidden transient tool-window on-top'/);
    assert.match(dovecoteJs, /readBtn\.textContent = 'Read'/);
    assert.match(dovecoteJs, /dismissBtn\.textContent = 'Close'/);
    assert.match(dovecoteJs, /dovePlaceNewMail/);
    assert.match(dovecoteJs, /placeDesktopWindow/);
    assert.match(dovecoteJs, /unreadOnly: true/);
    assert.match(dovecoteJs, /ownMailbox: true/);
    assert.match(modalUtilsJs, /'dovecoteNewMailModal'/);
    assert.match(vistaDialogsJs, /'dovecoteNewMailModal'/);
    assert.doesNotMatch(dovecoteJs, /\.style\./);

    console.log('cpl mail tests passed');
}

main();

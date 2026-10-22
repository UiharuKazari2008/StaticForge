'use strict';

// Mail Options (Dovecote Express's Tools > Options, public/scripts/comp/mailOptions.js) and
// Control Panel's Mail item, which opens it instead of a page of its own; the new-mail sound /
// notification flags and the signature (desktop-apps/dovecote.js doveMailOptions), and the
// server's userGlobalSettings.mail. Source checks plus the signature placement, same style as
// scripts/test-dovecote-windows.js.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const dovecoteJs = read('public/scripts/comp/desktop-apps/dovecote.js');
const cplMailJs = read('public/scripts/comp/cplMail.js');
const mailOptionsJs = read('public/scripts/comp/mailOptions.js');
const featureLoaderJs = read('public/scripts/comp/featureLoader.js');
const modalUtilsJs = read('public/scripts/comp/modalUtils.js');
const vistaDialogsJs = read('public/scripts/comp/vistaDialogs.js');

function memoryStore(initial) {
    const data = Object.assign({}, initial);
    return {
        getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
        setItem(key, value) { data[key] = String(value); },
        data
    };
}

// The mail options block of dovecote.js, run on its own with a stub localStorage
function loadMailOptions(store) {
    const start = dovecoteJs.indexOf('const DOVE_SOUND_KEY');
    const end = dovecoteJs.indexOf('// Tools > Options... and Control Panel');
    assert.ok(start > 0 && end > start, 'mail options block found');
    const window = { localStorage: store };
    const ctx = { window, console, JSON, Object, wsClient: undefined };
    vm.runInNewContext(dovecoteJs.slice(start, end) + '\nthis.doveWithSignature = doveWithSignature;', ctx);
    return { api: window.dovecoteMailSettings, withSignature: ctx.doveWithSignature };
}

async function main() {
    // flags: on by default, same keys as the old Control Panel page
    const store = memoryStore();
    let { api, withSignature } = loadMailOptions(store);
    assert.strictEqual(api.soundOn(), true);
    assert.strictEqual(api.notifyOn(), true);
    api.setSound(false);
    api.setNotify(false);
    assert.strictEqual(store.getItem('dovecote-mail-sound'), 'off');
    assert.strictEqual(store.getItem('dovecote-mail-dialog'), 'off');
    assert.strictEqual(api.soundOn(), false);
    assert.strictEqual(api.notifyOn(), false);

    // no signature: bodies unchanged
    assert.strictEqual(withSignature('reply', ''), '');
    assert.strictEqual(withSignature('forward', 'orig'), 'orig');

    // a signature saved without a server stays pending on this computer
    assert.strictEqual(await api.saveSignature({ signature: 'Yukimi\r\nDreamscape\n\n' }), false);
    assert.strictEqual(JSON.parse(store.getItem('dovecote-mail-signature')).pendingSync, true);
    assert.strictEqual(withSignature('reply', ''), '\n\nYukimi\nDreamscape');
    assert.strictEqual(withSignature('replyAll', ''), '\n\nYukimi\nDreamscape');
    assert.strictEqual(withSignature('create', ''), '\n\nYukimi\nDreamscape');
    assert.strictEqual(withSignature('forward', 'orig'), '\n\nYukimi\nDreamscape\n\norig');

    // Don't add signatures to Replies and Forwards / Add signatures to all outgoing messages
    await api.saveSignature({ signatureSkipReplies: true });
    assert.strictEqual(withSignature('reply', ''), '');
    assert.strictEqual(withSignature('create', ''), '\n\nYukimi\nDreamscape');
    await api.saveSignature({ signatureSkipReplies: false, signatureOutgoing: false });
    assert.strictEqual(withSignature('create', ''), '');

    // a fresh load reads the local copy; the server's copy wins once nothing is pending
    ({ api, withSignature } = loadMailOptions(store));
    assert.strictEqual(api.signature().signature, 'Yukimi\nDreamscape\n\n');
    store.setItem('dovecote-mail-signature', JSON.stringify(Object.assign(api.signature(), { pendingSync: false })));
    api.applyServer({ signature: 'From the server', signatureOutgoing: true });
    assert.strictEqual(api.signature().signature, 'From the server');
    assert.strictEqual(withSignature('reply', ''), '\n\nFrom the server');

    // wiring: Tools > Options and Control Panel's Mail item open Mail Options
    assert.match(dovecoteJs, /doveMenuItem\('Options\.\.\.', 'options'\)/);
    assert.match(dovecoteJs, /case 'options': doveOpenMailOptions\(\); return;/);
    assert.match(dovecoteJs, /featureLoader\.loadFeature\('mail_options'\)/);
    assert.match(dovecoteJs, /doveWithSignature\(initial\.mode, initial\.body\)/);
    assert.doesNotMatch(dovecoteJs, /window\.cplMail/);
    assert.match(featureLoaderJs, /mail_options: \{\s*styles: \['css\/taskbar-properties\.css', 'css\/mail-options\.css'\],\s*scripts: \['scripts\/comp\/mailOptions\.js'\]/);
    assert.match(featureLoaderJs, /scripts\/comp\/cplMail\.js/);
    assert.match(cplMailJs, /root\.openDovecoteMailOptions\(tab\)/);
    assert.doesNotMatch(cplMailJs, /registerPage/);
    assert.match(mailOptionsJs, /Play <u>s<\/u>ound when new messages arrive/);
    assert.match(mailOptionsJs, /Show a <u>n<\/u>otification when new messages arrive/);
    assert.match(mailOptionsJs, /<u>A<\/u>dd signatures to all outgoing messages/);
    assert.match(mailOptionsJs, /<u>D<\/u>on\\'t add signatures to Replies and Forwards/);
    assert.match(modalUtilsJs, /window\.dovecoteMailSettings\.applyServer\(settings\.mail\)/);

    // new-mail alert still gated by the flags
    assert.match(dovecoteJs, /if \(doveMailOptions\.soundOn\(\)\)/);
    assert.match(dovecoteJs, /if \(doveMailOptions\.notifyOn\(\)\) doveShowNewMail\(count\)/);
    assert.match(dovecoteJs, /doveNoteMailIds/);
    assert.match(dovecoteJs, /doveCollectFreshMailIds/);
    assert.match(dovecoteJs, /if \(newer\.length\) dovePlayNewMailAlert/);
    assert.match(dovecoteJs, /className = 'modal hidden transient tool-window on-top'/);
    assert.match(dovecoteJs, /readBtn\.textContent = 'Read'/);
    assert.match(dovecoteJs, /dismissBtn\.textContent = 'Close'/);
    assert.match(dovecoteJs, /dovePlaceNewMail/);
    assert.match(dovecoteJs, /unreadOnly: true/);
    assert.match(dovecoteJs, /ownMailbox: true/);
    assert.match(modalUtilsJs, /'dovecoteNewMailModal'/);
    assert.match(vistaDialogsJs, /'dovecoteNewMailModal'/);

    // server: userGlobalSettings.mail
    const handlers = require('../modules/websocketHandlers.js');
    const proto = (handlers.WebSocketMessageHandlers || handlers).prototype;
    const self = Object.create(proto);
    self.globalResources = {};
    assert.deepStrictEqual(proto.normalizeUserGlobalSettings.call(self, {}).mail,
        { signature: '', signatureOutgoing: true, signatureSkipReplies: false });
    const merged = proto.mergeUserGlobalSettingsPatch.call(self, { mail: { signature: 'old' } },
        { mail: { signature: 'a\r\nb', signatureSkipReplies: true } });
    assert.deepStrictEqual(merged.mail, { signature: 'a\nb', signatureOutgoing: true, signatureSkipReplies: true });
    assert.strictEqual(proto.mergeUserGlobalSettingsPatch.call(self, {}, { mail: { signature: 'x'.repeat(5000) } }).mail.signature.length, 4000);

    console.log('mail options / cpl mail tests passed');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

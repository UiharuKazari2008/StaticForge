#!/usr/bin/env node
/**
 * Text Messaging: an Android app account's Communities switches (Discord's servers, #978; Yukimi, Nov 21 2026: "there should be
 * a option on disocrd in accounts to not count unread for communities and to not show notifications for communities").
 * The core with a Discord account fed fake ActiveSync notify.posted / notify.removed; device calls are recorded, nothing
 * reaches a phone. Config and the store live in a scratch folder under ~/.cache (not /tmp).
 *   node scripts/test-textmessaging-communities.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const base = process.env.TM_TEST_DIR || path.join(os.homedir(), '.cache', 'claude-run');
fs.mkdirSync(base, { recursive: true });
const tmp = fs.mkdtempSync(path.join(base, 'tm-communities-'));
const config = { textMessaging: { accounts: [] } };
const calls = [];
let tap = null;

const stub = (name, exports) => { require.cache[require.resolve(`../modules/${name}`)] = { id: name, filename: name, loaded: true, exports }; };
stub('globalResources', {
    getPath: () => tmp,
    getConfig: ({ path: p }) => config[p],
    getSecureConfig: () => undefined,
    updateConfigValue: (which, keys, value) => { if (which === 'config') config[keys[0]] = value; },
    getWebSocketServer: () => ({ broadcast: () => {} }),
    getVfsManager: () => { throw new Error('no vfs in the test'); },
    getWorkspaceManager: () => ({ getWorkspaces: () => ({}) })
});
stub('activeSync', {
    onDeviceEvent: (fn) => { tap = fn; },
    onDeviceHello: () => {},
    partnerLinks: () => [],
    serverCall: async (_g, _w, deviceId, op, args) => { calls.push({ deviceId, op, args }); return op === 'notify.list' ? { notifications: [] } : true; }
});
const notices = [];
stub('notificationInboxSources', { onTextEvent: (p) => notices.push(p) });

const tm = require('../modules/textMessaging');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const device = { id: 'dev-fold', name: 'Galaxy Z Fold7' };
const post = (d) => tap('notify.posted', Object.assign({ package: 'com.discord', app: 'Discord' }, d), device);
const discord = () => tm.summary().then((list) => list.find((a) => a.id === 'app-discord'));

(async () => {
    try {
        tm.init(require('../modules/globalResources'));
        tm.saveAccount({ kind: 'android', package: 'com.discord', label: 'Discord' });
        await wait(20);
        // a direct message (the Inbox) and a server channel's message (Communities)
        post({ key: '0|com.discord|1|dm|1', title: 'Mio', text: 'hi', time: 1000, channel: 'directMessages', conv: { title: 'Mio' } });
        post({ key: '0|com.discord|1|srv|2', title: 'Midwest Safety Squad #daily-polls: Blaz', text: 'poll', time: 2000, channel: 'messages', conv: { title: 'Midwest Safety Squad #daily-polls', group: true } });
        await wait(30);

        let d = await discord();
        assert.strictEqual(d.unread, 2, 'both count by default');
        assert.strictEqual(d.communityUnread, 1);
        assert.strictEqual(d.communityCounted, true);
        assert.strictEqual(d.settings.communityUnread, true);
        assert.strictEqual(d.settings.communityNotify, true);
        assert.ok(!calls.some((c) => c.op === 'notify.dismiss'), 'nothing taken off the phone by default');

        // Count unread for Communities off: the account total leaves them out, the folder keeps its count
        tm.saveAccount({ id: 'app-discord', kind: 'android', package: 'com.discord', label: 'Discord', settings: { communityUnread: false } });
        await wait(30);
        d = await discord();
        assert.strictEqual(d.unread, 1, 'the server message no longer counts');
        assert.strictEqual(d.communityUnread, 1, 'Communities still shows its own');
        assert.strictEqual(d.communityCounted, false);
        assert.strictEqual(d.settings.notify, false, 'other switches kept');

        // Show notifications for Communities off: no Messaging notice, and the app's notification goes from the phone
        tm.saveAccount({ id: 'app-discord', kind: 'android', package: 'com.discord', label: 'Discord', settings: { communityNotify: false, notify: true } });
        await wait(30);
        notices.length = 0;
        calls.length = 0;
        post({ key: '0|com.discord|1|srv|3', title: 'Midwest Safety Squad #daily-polls: Blaz', text: 'poll 2', time: 3000, channel: 'messages', conv: { title: 'Midwest Safety Squad #daily-polls', group: true } });
        post({ key: '0|com.discord|1|dm|4', title: 'Mio', text: 'again', time: 3100, channel: 'directMessages', conv: { title: 'Mio' } });
        await wait(40);
        const dismissed = calls.filter((c) => c.op === 'notify.dismiss').map((c) => c.args.key);
        assert.deepStrictEqual(dismissed, ['0|com.discord|1|srv|3'], 'only the server channel\'s notification is taken off the phone');
        const said = notices.filter((n) => n.event === 'message' && n.notify);
        assert.ok(said.every((n) => !/daily-polls/.test(n.chatTitle || '')), 'no Messaging notice for the server channel');
        assert.ok(said.some((n) => /Mio/.test(n.chatTitle || '')), 'the direct message still notifies (notify on)');

        // the phone reports that notification gone (our own dismissal): the conversation stays unread
        tap('notify.removed', { package: 'com.discord', key: '0|com.discord|1|srv|3' }, device);
        await wait(30);
        tm.saveAccount({ id: 'app-discord', kind: 'android', package: 'com.discord', label: 'Discord', settings: { communityUnread: true, communityNotify: false } });
        await wait(30);
        d = await discord();
        assert.strictEqual(d.communityUnread, 2, 'still unread after its notification was taken off the phone (both polls)');

        console.log('textmessaging communities: all checks passed');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
    process.exit(0);
})().catch((e) => { console.error(e); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* gone */ } process.exit(1); });

#!/usr/bin/env node
/**
 * Text Messaging contact names (Yukimi, Nov 18 2026: "imessage shows the phone number instead of matching the
 * contacts on the server and on the phone"). The handle normaliser, the vCard handle reader (every TEL / EMAIL
 * line) and a BlueBubbles-style live message whose chat comes without participants: its title and sender must
 * be the contact's name from the Contacts folder (the phone's mirror). Nothing reaches a server or a phone.
 *   node scripts/test-textmessaging-contacts.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const stub = (name, exports) => { require.cache[require.resolve(`../modules/${name}`)] = { id: name, filename: name, loaded: true, exports }; };
const inbox = [];
stub('notificationInboxSources', { onTextEvent: (p) => inbox.push(p) });

const { handleKey } = require('../modules/textMessagingBlueBubbles');
const VC = require('../public/scripts/comp/vcard.js');

// ---- the normaliser
const same = [
    ['+13015550100', '3015550100'], ['13015550100', '3015550100'], ['(301) 555-0100', '3015550100'],
    ['+1 (301) 555-0100', '3015550100'], ['301.555.0100', '3015550100'], ['tel:+13015550100', '3015550100'],
    ['TEL:+1-301-555-0100', '3015550100'], ['sms:+13015550100', '3015550100'], ['+1 301 555 0100 ext. 12', '3015550100'],
    ['+1 301-555-0100;ext=4', '3015550100'], ['mailto:Ana.Example@iCloud.com', 'ana.example@icloud.com'],
    [' Ana.Example@icloud.com ', 'ana.example@icloud.com'], ['<ana@example.com>', 'ana@example.com'],
    ['+819012345678', '9012345678'], ['090-1234-5678', '9012345678'], ['24255', '24255'], ['', '']
];
for (const [a, k] of same) assert.strictEqual(handleKey(a), k, `handleKey(${JSON.stringify(a)})`);

// ---- vCards: every number on a card, faxes and pagers left out
const vcf = [
    'BEGIN:VCARD', 'VERSION:3.0', 'FN:Carla Braddy', 'N:Braddy;Carla;;;',
    'TEL;TYPE=CELL:(240) 507-7292', 'TEL;TYPE=CELL:+1 240 555 0001', 'TEL;TYPE=HOME,VOICE:+1 (301) 638-2450',
    'TEL;TYPE=OTHER:301-555-0002', 'TEL;TYPE=WORK,FAX:301-555-0099', 'item1.EMAIL;TYPE=INTERNET:Carla.B@Gmail.com', 'END:VCARD',
    'BEGIN:VCARD', 'VERSION:3.0', 'FN:Doug Shelton', 'TEL;VALUE=uri:tel:+13015032140', 'END:VCARD',
    'BEGIN:VCARD', 'VERSION:3.0', 'TEL:3015550003', 'END:VCARD'
].join('\r\n');
const pairs = new Map(require('../modules/textMessaging')._test.vcfHandles(VC, vcf));
for (const k of ['2405077292', '2405550001', '3016382450', '3015550002', 'carla.b@gmail.com']) assert.strictEqual(pairs.get(k), 'Carla Braddy', k);
assert.strictEqual(pairs.get('3015032140'), 'Doug Shelton');
assert.ok(!pairs.has('3015550099'), 'a fax is not a texting number');
assert.strictEqual(pairs.get('3015550003'), '', 'a card with no name only marks the number known');

// ---- a live iMessage whose chat has no participants
(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-contacts-'));
    const blob = path.join(tmp, 'h1');
    fs.writeFileSync(blob, vcf);
    stub('vfsDatabase', { getUserFilesByLocation: async () => [{ original_name: 'Phone contacts (Test).vcf', content_hash: 'h1' }] });
    const tm = require('../modules/textMessaging');
    const broadcasts = [];
    tm._test.setResources({
        getConfig: () => ({ accounts: [{ id: 'im', kind: 'bluebubbles', enabled: false }] }),
        getPath: () => tmp,
        getWorkspaceManager: () => ({ getWorkspaces: () => ({ default: {} }) }),
        getVfsManager: () => ({ _findWorkspaceFolderByName: async () => ({ id: 1 }), getFileBlobPath: () => blob }),
        getWebSocketServer: () => ({ broadcast: (m) => broadcasts.push(m) })
    });
    let asked = 0;
    const chat = (participants) => ({ guid: 'iMessage;-;+12405077292', identifier: '+12405077292', title: participants.length ? '' : '+12405077292', named: false, isGroup: false, participants, last: null });
    tm._test.setProvider('im', {
        kind: 'bluebubbles',
        // as BlueBubblesProvider.normalizeChat makes it from the socket's chat (no participants): the bare handle
        normalizeChat: () => chat([]),
        getChat: async () => { asked += 1; return chat([{ address: '+12405077292', name: '', service: 'iMessage' }]); },
        listMessages: async () => ({ messages: [{ fromMe: true }] })
    });
    const message = { guid: 'm1', chatGuid: 'iMessage;-;+12405077292', text: 'hi', fromMe: false, sender: { address: '+12405077292', name: '', me: false }, date: Date.now(), attachments: [] };
    await tm._test.onProviderEvent('im', 'message', { accountId: 'im', chatGuid: message.chatGuid, message, chat: { guid: message.chatGuid } });
    assert.strictEqual(asked, 1, 'the stored conversation was read for its participants');
    const out = broadcasts.map((b) => b.data).find((d) => d.event === 'message');
    assert.ok(out, 'the event went out');
    assert.strictEqual(out.chatTitle, 'Carla Braddy', 'the conversation title is the contact');
    assert.strictEqual(out.message.sender.name, 'Carla Braddy', 'the sender is the contact');
    assert.strictEqual(inbox.length, 1);
    assert.strictEqual(inbox[0].chatTitle, 'Carla Braddy', 'the notice gets the name');

    // a contacts change is read on the next lookup (only the changed file)
    fs.writeFileSync(blob, vcf.replace('Carla Braddy', 'Carla B.'));
    stub('vfsDatabase', { getUserFilesByLocation: async () => [{ original_name: 'Phone contacts (Test).vcf', content_hash: 'h2' }] });
    tm.contactsChanged();
    assert.strictEqual(await tm.resolveName('nobody', '(240) 507-7292'), 'Carla B.');
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('test-textmessaging-contacts: ok');
})().catch((error) => { console.error(error); process.exit(1); });

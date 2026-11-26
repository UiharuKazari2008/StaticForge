#!/usr/bin/env node
'use strict';
// The deck a save's own screen reads back (Yukimi, Nov 26 2026: a search term added on the radio was in the state file
// but the screen still listed none, and nothing recorded). The recorder service pushes its deck 150 ms after a change;
// the read right after a save must not fall into that gap. No network, no SiriusXM: a stand-in service on a Unix
// socket, the real modules/xmRadioRecorderClient.js.
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(process.env.XMRADIO_TEST_TMP || os.tmpdir(), 'xmdeck-'));
const account = path.join(dir, 'xmradio-account.json');
fs.writeFileSync(account, '{}');
const socket = path.join(dir, 'xmradio-recorder.sock');

const xmRadio = require('../modules/xmRadio');
xmRadio.useExternalAuth(); // links to the service never sign in (a second session is refused)
xmRadio.accountFilePath = () => account;

// the service's deck, and the push it makes 150 ms after a change (server.js deckChanged)
const deck = { tape: 'Tape 1', workspaceId: 'default', mode: 'song', recordings: [], timers: [], alerts: [], terms: [], queue: [] };
const PUSH_MS = 150;
let pushes = 0;
let nextId = 0;

const server = net.createServer((sock) => {
    const send = (o) => { if (!sock.destroyed) sock.write(`${JSON.stringify(o)}\n`); };
    send({ ev: 'deck', deck });
    const push = () => { pushes++; send({ ev: 'deck', deck }); };
    let buf = '';
    sock.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            if (!line) continue;
            const m = JSON.parse(line);
            const args = m.args || {};
            if (m.op === 'setTerms') {
                deck.terms = (args.terms || []).map((t) => ({ id: /^[0-9a-f]{12}$/.test(t.id || '') ? t.id : `id${nextId++}`.padEnd(12, '0'), text: String(t.text || ''), channelId: t.channelId || null }));
                send({ id: m.id, ok: true, result: deck.terms });
                setTimeout(push, PUSH_MS);
            } else if (m.op === 'setTimers') {
                deck.timers = (args.timers || []).map((t) => Object.assign({ id: `id${nextId++}`.padEnd(12, '0') }, t));
                send({ id: m.id, ok: true, result: deck.timers });
                setTimeout(push, PUSH_MS);
            } else if (m.op === 'auth') {
                send({ id: m.id, ok: true, result: true });
            } else {
                send({ id: m.id, ok: true, result: m.op === 'deck' ? deck : null });
            }
        }
    });
    sock.on('error', () => {});
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    await new Promise((ok) => server.listen(socket, ok));
    const client = require('../modules/xmRadioRecorderClient');
    client.init(xmRadio, null, { changed: () => {} });
    for (let i = 0; i < 100 && !client.online(); i++) await sleep(20);
    assert.ok(client.online(), 'the link to the recorder service is up');
    assert.deepStrictEqual(client.deck().terms, [], 'the deck starts empty');

    // the search term a person just added: its own screen reads the deck straight after the save
    const reply = await client.setTerms([{ text: 'Trancegiving' }]);
    assert.strictEqual(reply.length, 1, 'the save answers with the terms it kept');
    assert.strictEqual(client.deck().terms.length, 1, 'the term is in the deck at once, not 150 ms later');
    assert.strictEqual(client.deck().terms[0].text, 'Trancegiving');

    // ...and the service's own push lands on the same deck, not an older one
    await sleep(PUSH_MS + 80);
    assert.ok(pushes >= 1, 'the service pushed its deck');
    assert.strictEqual(client.deck().terms.length, 1, 'the term survives the push');
    assert.strictEqual(client.deck().tape, 'Tape 1', 'the rest of the deck is kept');

    // a timer takes the same path
    await client.setTimers([{ channelId: 'abcd1234abcd1234abcd1234', start: '07:30', minutes: 60, days: [1] }]);
    assert.strictEqual(client.deck().timers.length, 1, 'the timer is in the deck at once');
    assert.strictEqual(client.deck().timers[0].start, '07:30');

    console.log('xmradio deck cache: ok');
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
    process.exit(0);
})().catch((err) => { console.error(err); server.close(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(1); });

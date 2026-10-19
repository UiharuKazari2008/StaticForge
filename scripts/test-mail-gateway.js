'use strict';

const assert = require('assert');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-gateway-'));
const { initializeDovecoteDatabase } = require('../modules/dovecoteDatabase');
assert.strictEqual(initializeDovecoteDatabase(tmpDir), true);
const mail = require('../modules/dovecoteMail');
const gateway = require('../modules/mailGateway');
const addresses = require('../modules/mailGatewayAddresses');
const inboundMod = require('../modules/mailGatewayInbound');
const mime = require('../modules/mailGatewayMime');
const spam = require('../modules/mailGatewaySpam');

function mapping() {
    return addresses.createMapping({
        mailboxes: addresses.DEFAULT_MAILBOXES,
        domain: addresses.DEFAULT_DOMAIN
    });
}

function writeCert(dir, commonName) {
    fs.mkdirSync(dir, { recursive: true });
    const keyPath = path.join(dir, `${commonName.replace(/[^a-z0-9]+/gi, '_')}.key`);
    const certPath = path.join(dir, `${commonName.replace(/[^a-z0-9]+/gi, '_')}.crt`);
    const result = spawnSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048',
        '-keyout', keyPath, '-out', certPath,
        '-days', '1', '-nodes',
        '-subj', `/CN=${commonName}`,
        '-addext', `subjectAltName=DNS:${commonName}`
    ], { encoding: 'utf8' });
    if (result.status !== 0) {
        throw new Error(`openssl failed: ${result.stderr || result.stdout}`);
    }
    return {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
        keyPath,
        certPath
    };
}

function createLineReader(socket) {
    let buffer = '';
    const queue = [];
    let waiters = [];
    socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
            let line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            if (line.endsWith('\r')) line = line.slice(0, -1);
            if (waiters.length) waiters.shift()(line);
            else queue.push(line);
        }
    });
    socket.on('end', () => waiters.splice(0).forEach((fn) => fn(null)));
    return {
        queuedCount() { return queue.length; },
        readLine() {
            if (queue.length) return Promise.resolve(queue.shift());
            return new Promise((resolve) => waiters.push(resolve));
        }
    };
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function connectSmtp(port) {
    return new Promise((resolve, reject) => {
        const s = net.connect({ host: '127.0.0.1', port }, () => resolve(s));
        s.on('error', reject);
    });
}

async function expectCode(reader, code) {
    const reply = await readReply(reader);
    assert.strictEqual(reply.code, code, reply.text);
    return reply;
}

async function clientStartTls(socket) {
    socket.removeAllListeners('data');
    const secure = tls.connect({
        socket,
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2'
    });
    await new Promise((resolve, reject) => {
        secure.once('secureConnect', resolve);
        secure.once('error', reject);
    });
    return { socket: secure, reader: createLineReader(secure) };
}

async function startOpenInbound(extra) {
    const delivered = [];
    const inbound = await gateway.startInbound(Object.assign({
        port: 0,
        bind: '127.0.0.1',
        allowFrom: ['127.0.0.1'],
        mapping: mapping(),
        deliver: async (msg) => { delivered.push(msg); }
    }, extra || {}));
    return { inbound, delivered };
}

async function readReply(reader) {
    const lines = [];
    while (true) {
        const line = await reader.readLine();
        if (line == null) break;
        lines.push(line);
        if (/^\d{3} /.test(line)) break;
    }
    return { code: lines[0] ? parseInt(lines[0], 10) : 0, lines, text: lines.join('\n') };
}

function startMockSmtp(options) {
    const recorded = { mailFrom: null, rcpt: [], data: '', authed: false, ehloCount: 0 };
    const password = options.password || 'secret';
    const user = options.authUser || 'dreamscape@dream.737.jp.net';
    const advertiseStarttls = options.advertiseStarttls !== false;
    const implicit = options.implicit === true;

    function attachSession(socket, onReady) {
        let reader = createLineReader(socket);
        let secureDone = false;

        async function loop() {
            try {
                socket.write('220 mock ESMTP\r\n');
                while (true) {
                    const line = await reader.readLine();
                    if (line == null) return;
                    const upper = line.toUpperCase();
                    if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
                        recorded.ehloCount += 1;
                        if (advertiseStarttls && !secureDone && !implicit) {
                            socket.write('250-mock\r\n250-STARTTLS\r\n250 AUTH PLAIN\r\n');
                        } else {
                            socket.write('250-mock\r\n250 AUTH PLAIN\r\n');
                        }
                    } else if (upper === 'STARTTLS') {
                        if (!advertiseStarttls || implicit) {
                            socket.write('502 STARTTLS not available\r\n');
                            continue;
                        }
                        socket.write('220 ready to start TLS\r\n');
                        socket.removeAllListeners('data');
                        const secure = new tls.TLSSocket(socket, {
                            isServer: true,
                            key: options.key,
                            cert: options.cert
                        });
                        await new Promise((resolve, reject) => {
                            secure.once('secure', resolve);
                            secure.once('error', reject);
                        });
                        secureDone = true;
                        socket = secure;
                        reader = createLineReader(secure);
                    } else if (upper.startsWith('AUTH PLAIN')) {
                        const decoded = Buffer.from(line.slice(11).trim(), 'base64').toString('utf8');
                        const parts = decoded.split('\0');
                        const authUser = parts[1] || '';
                        const authPass = parts[2] || '';
                        if (authUser === user && authPass === password) {
                            recorded.authed = true;
                            socket.write('235 2.7.0 OK\r\n');
                        } else {
                            socket.write('535 5.7.8 Authentication failed\r\n');
                        }
                    } else if (upper.startsWith('MAIL FROM:')) {
                        recorded.mailFrom = (line.match(/<([^>]*)>/) || [])[1] || '';
                        socket.write('250 OK\r\n');
                    } else if (upper.startsWith('RCPT TO:')) {
                        recorded.rcpt.push((line.match(/<([^>]+)>/) || [])[1] || '');
                        socket.write('250 OK\r\n');
                    } else if (upper === 'DATA') {
                        socket.write('354 go\r\n');
                        const chunks = [];
                        while (true) {
                            const dataLine = await reader.readLine();
                            if (dataLine == null || dataLine === '.') break;
                            chunks.push(dataLine.startsWith('.') ? dataLine.slice(1) : dataLine);
                        }
                        recorded.data = chunks.join('\n');
                        socket.write('250 queued\r\n');
                    } else if (upper === 'QUIT') {
                        socket.write('221 bye\r\n');
                        socket.end();
                        return;
                    } else {
                        socket.write('502 unimplemented\r\n');
                    }
                }
            } catch (_err) {
                socket.destroy();
            }
        }

        loop();
        if (onReady) onReady();
    }

    return new Promise((resolve, reject) => {
        const server = implicit
            ? tls.createServer({ key: options.key, cert: options.cert }, (socket) => attachSession(socket))
            : net.createServer((socket) => attachSession(socket));
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            resolve({
                port: server.address().port,
                recorded,
                close: () => new Promise((done) => server.close(() => done()))
            });
        });
    });
}

async function smtpTalk(port, script) {
    const socket = await new Promise((resolve, reject) => {
        const s = net.connect({ host: '127.0.0.1', port }, () => resolve(s));
        s.on('error', reject);
    });
    const reader = createLineReader(socket);
    const replies = [];
    try {
        replies.push(await readReply(reader));
        for (const command of script) {
            socket.write(`${command}\r\n`);
            replies.push(await readReply(reader));
        }
    } finally {
        socket.end();
    }
    return replies;
}

function testMapping() {
    const map = mapping();
    assert.strictEqual(addresses.toMailbox('sala.ops@dream.737.jp.net', map), 'sala');
    assert.strictEqual(addresses.toMailbox('Menma.Dev@Dream.737.jp.net', map), 'menma');
    assert.strictEqual(addresses.toMailbox('rook.dev@dream.737.jp.net', map), 'rook');
    assert.strictEqual(addresses.toMailbox('cursor.dev@dream.737.jp.net', map), 'cursor');
    assert.strictEqual(addresses.toMailbox('claude.dev@dream.737.jp.net', map), 'claude');
    assert.strictEqual(addresses.toMailbox('frost.dev@dream.737.jp.net', map), 'frost');
    assert.strictEqual(addresses.toMailbox('hoshino.apocrypha@dream.737.jp.net', map), 'hoshino');
    assert.strictEqual(addresses.toMailbox('ivory.studio@dream.737.jp.net', map), 'ivory');
    assert.strictEqual(addresses.toMailbox('guren.lab@dream.737.jp.net', map), 'guren');
    assert.strictEqual(addresses.toMailbox('chiyo.web@dream.737.jp.net', map), 'chiyo');
    assert.strictEqual(addresses.toMailbox('tsubame.ops@dream.737.jp.net', map), 'tsubame');
    assert.strictEqual(addresses.toMailbox('mailroom.ops@dream.737.jp.net', map), 'tsubame');
    assert.strictEqual(addresses.toMailbox('Mailroom.Ops@Dream.737.jp.net', map), 'tsubame');
    assert.strictEqual(addresses.toMailbox('postmaster@dream.737.jp.net', map), 'tsubame');
    assert.strictEqual(addresses.toMailbox('Postmaster@Dream.737.jp.net.', map), 'tsubame');
    assert.strictEqual(addresses.toMailbox('postmaster@mx.dream.737.jp.net', map), null);
    assert.strictEqual(addresses.toMailbox('tifa.ops@dream.737.jp.net', map), null);
    assert.strictEqual(addresses.toMailbox('pyra.dev@dream.737.jp.net', map), null);
    assert.strictEqual(addresses.toMailbox('unknown@dream.737.jp.net', map), null);
    assert.strictEqual(addresses.toMailbox('menma@gmail.com', map), null);
    assert.strictEqual(addresses.toMailbox('kazari.ops@dream.737.jp.net', map), 'yukimi');
    assert.strictEqual(addresses.toMailbox('Kazari.Ops@Dream.737.jp.net', map), 'yukimi');
    assert.strictEqual(addresses.toMailbox('kazari@dream.737.jp.net', map), 'yukimi');
    assert.strictEqual(addresses.toMailbox('yukimi.kazari@dream.737.jp.net', map), 'yukimi');
    assert.strictEqual(addresses.toMailbox('yukimi@dream.737.jp.net', map), 'yukimi');
    assert.strictEqual(addresses.toMailbox('ykazari@icloud.com', map), null);
    assert.strictEqual(addresses.toMailbox('yukimi@icloud.com', map), null);

    assert.strictEqual(addresses.toExternal('sala', map), 'sala.ops@dream.737.jp.net');
    assert.strictEqual(addresses.toExternal('menma', map), 'menma.dev@dream.737.jp.net');
    assert.strictEqual(addresses.toExternal('rook', map), 'rook.dev@dream.737.jp.net');
    assert.strictEqual(addresses.toExternal('yukimi', map), 'kazari.ops@dream.737.jp.net');
    assert.strictEqual(map.ownerToLocal.yukimi, 'kazari.ops');
    assert.strictEqual(addresses.toExternal('tsubame', map), 'tsubame.ops@dream.737.jp.net');
    for (const local of ['kazari.ops', 'kazari', 'yukimi.kazari', 'yukimi']) {
        const classified = addresses.classifyRecipient(`${local}@dream.737.jp.net`, {
            mapping: map, enabled: true, isValidOwner: mail.isValidOwner
        });
        assert.strictEqual(classified.kind, 'internal', local);
        assert.strictEqual(classified.owner, 'yukimi', local);
    }
    assert.strictEqual(addresses.toExternal('tifa', map), null);
    assert.strictEqual(addresses.toExternal('pyra', map), null);

    const poisoned = addresses.createMapping({
        mailboxes: Object.assign({}, addresses.DEFAULT_MAILBOXES, {
            'ykazari@icloud.com': 'yukimi',
            'yukimi@icloud.com': 'yukimi'
        })
    });
    assert.strictEqual(poisoned.mailboxes['ykazari@icloud.com'], undefined);
    assert.strictEqual(poisoned.mailboxes['yukimi@icloud.com'], undefined);
    assert.strictEqual(addresses.toMailbox('ykazari@icloud.com', poisoned), null);
    assert.strictEqual(addresses.toMailbox('yukimi@dream.737.jp.net', poisoned), 'yukimi');

    const icloud = addresses.classifyRecipient('ykazari@icloud.com', {
        mapping: map, enabled: true, isValidOwner: mail.isValidOwner
    });
    assert.strictEqual(icloud.kind, 'external');
    assert.strictEqual(icloud.address, 'ykazari@icloud.com');
    assert.ok(!icloud.owner);

    const classified = addresses.classifyRecipients(
        ['rook', 'alice@example.com', 'menma.dev@dream.737.jp.net'],
        'yukimi',
        { mapping: map, enabled: true, isValidOwner: mail.isValidOwner }
    );
    assert.deepStrictEqual(classified.toList, ['rook', 'menma']);
    assert.deepStrictEqual(classified.ccList, ['yukimi']);
    assert.deepStrictEqual(classified.externalTo, ['alice@example.com']);

    assert.throws(
        () => addresses.classifyRecipients('tifa.ops@dream.737.jp.net', [], {
            mapping: map, enabled: true, isValidOwner: mail.isValidOwner
        }),
        (err) => err.code === 'UNKNOWN_RECIPIENT'
    );
    assert.throws(
        () => addresses.classifyRecipients('nobody@dream.737.jp.net', [], {
            mapping: map, enabled: true, isValidOwner: mail.isValidOwner
        }),
        (err) => err.code === 'UNKNOWN_RECIPIENT'
    );
    assert.throws(
        () => addresses.classifyRecipients('cron@mx.dream.737.jp.net', [], {
            mapping: map, enabled: true, isValidOwner: mail.isValidOwner
        }),
        (err) => err.code === 'UNKNOWN_RECIPIENT'
    );
    const postmaster = addresses.classifyRecipient('postmaster@dream.737.jp.net', {
        mapping: map, enabled: true, isValidOwner: mail.isValidOwner
    });
    assert.strictEqual(postmaster.kind, 'internal');
    assert.strictEqual(postmaster.owner, 'tsubame');
}

async function testAllowlistReject() {
    const inbound = await gateway.startInbound({
        port: 0,
        bind: '127.0.0.1',
        allowFrom: ['192.168.255.1'],
        mapping: mapping()
    });
    try {
        const replies = await smtpTalk(inbound.port, []);
        assert.strictEqual(replies[0].code, 554);
        assert.match(replies[0].text, /Connection refused|5\.7\.1/);
    } finally {
        await inbound.close();
    }
}

async function testUnknownRecipientReject() {
    const inbound = await gateway.startInbound({
        port: 0,
        bind: '127.0.0.1',
        allowFrom: ['127.0.0.1'],
        mapping: mapping()
    });
    try {
        const replies = await smtpTalk(inbound.port, [
            'LHLO postfix',
            'MAIL FROM:<alice@example.com>',
            'RCPT TO:<nobody@dream.737.jp.net>',
            'RCPT TO:<tifa.ops@dream.737.jp.net>',
            'RCPT TO:<pyra.dev@dream.737.jp.net>',
            'RCPT TO:<ykazari@icloud.com>',
            'RCPT TO:<kazari.ops@dream.737.jp.net>',
            'RCPT TO:<kazari@dream.737.jp.net>',
            'RCPT TO:<yukimi.kazari@dream.737.jp.net>',
            'RCPT TO:<yukimi@dream.737.jp.net>',
            'RCPT TO:<mailroom.ops@dream.737.jp.net>',
            'RCPT TO:<tsubame.ops@dream.737.jp.net>'
        ]);
        assert.strictEqual(replies[0].code, 220);
        assert.strictEqual(replies[1].code, 250);
        assert.strictEqual(replies[2].code, 250);
        assert.strictEqual(replies[3].code, 550);
        assert.strictEqual(replies[4].code, 550);
        assert.strictEqual(replies[5].code, 550);
        assert.strictEqual(replies[6].code, 550);
        assert.strictEqual(replies[7].code, 250);
        assert.strictEqual(replies[8].code, 250);
        assert.strictEqual(replies[9].code, 250);
        assert.strictEqual(replies[10].code, 250);
        assert.strictEqual(replies[11].code, 250);
        assert.strictEqual(replies[12].code, 250);
        assert.match(replies[3].text, /User unknown/);
        assert.match(replies[6].text, /User unknown/);
    } finally {
        await inbound.close();
    }
}

async function testInboundDelivery() {
    const delivered = [];
    const inbound = await gateway.startInbound({
        port: 0,
        bind: '127.0.0.1',
        allowFrom: ['127.0.0.1'],
        mapping: mapping(),
        deliver: async (msg) => { delivered.push(msg); }
    });
    try {
        const socket = await new Promise((resolve, reject) => {
            const s = net.connect({ host: '127.0.0.1', port: inbound.port }, () => resolve(s));
            s.on('error', reject);
        });
        const reader = createLineReader(socket);
        assert.strictEqual((await readReply(reader)).code, 220);
        socket.write('EHLO test\r\n');
        assert.strictEqual((await readReply(reader)).code, 250);
        socket.write('MAIL FROM:<alice@example.com>\r\n');
        assert.strictEqual((await readReply(reader)).code, 250);
        socket.write('RCPT TO:<menma.dev@dream.737.jp.net>\r\n');
        assert.strictEqual((await readReply(reader)).code, 250);
        socket.write('DATA\r\n');
        assert.strictEqual((await readReply(reader)).code, 354);
        socket.write('From: Alice <alice@example.com>\r\n');
        socket.write('To: menma.dev@dream.737.jp.net\r\n');
        socket.write('Subject: hello menma\r\n');
        socket.write('\r\n');
        socket.write('body from the outside\r\n');
        socket.write('.\r\n');
        assert.strictEqual((await readReply(reader)).code, 250);
        socket.write('QUIT\r\n');
        await readReply(reader);
        socket.end();
    } finally {
        await inbound.close();
    }
    assert.strictEqual(delivered.length, 1);
    assert.strictEqual(delivered[0].fromAddress, 'alice@example.com');
    assert.strictEqual(delivered[0].toOwner, 'menma');
    assert.deepStrictEqual(delivered[0].to, ['menma.dev@dream.737.jp.net']);
    assert.strictEqual(delivered[0].subject, 'hello menma');
    assert.match(delivered[0].body, /body from the outside/);

    const stored = mail.deliverInboundMail({
        fromAddress: 'bob@outside.example',
        toOwner: 'ivory',
        subject: 'stored full',
        body: 'ping'
    });
    const inbox = mail.listMail('ivory', { folder: 'inbox' });
    assert.strictEqual(inbox[0].from, 'bob@outside.example');
    assert.strictEqual(inbox[0].id, stored.id);
}

async function testInboundRelaySenders() {
    const { inbound, delivered } = await startOpenInbound();
    try {
        const socket = await connectSmtp(inbound.port);
        const reader = createLineReader(socket);
        await expectCode(reader, 220);
        socket.write('EHLO lantis\r\n');
        await expectCode(reader, 250);

        socket.write('MAIL FROM:<kazari.ops@dream.737.jp.net>\r\n');
        await expectCode(reader, 250);
        socket.write('RCPT TO:<menma.dev@dream.737.jp.net>\r\n');
        await expectCode(reader, 250);
        socket.write('DATA\r\n');
        await expectCode(reader, 354);
        socket.write('From: Alice <alice@example.com>\r\nSubject: our-domain\r\n\r\nvia relay\r\n.\r\n');
        await expectCode(reader, 250);

        socket.write('MAIL FROM:<double-bounce@mx.dream.737.jp.net>\r\n');
        await expectCode(reader, 250);
        socket.write('RCPT TO:<ivory.studio@dream.737.jp.net>\r\n');
        await expectCode(reader, 250);
        socket.write('DATA\r\n');
        await expectCode(reader, 354);
        socket.write('From: Mailer-Daemon@mx.example.com\r\nSubject: subdomain-env\r\n\r\nprobe bounce\r\n.\r\n');
        await expectCode(reader, 250);

        socket.write('MAIL FROM:<>\r\n');
        await expectCode(reader, 250);
        socket.write('RCPT TO:<ivory.studio@dream.737.jp.net>\r\n');
        await expectCode(reader, 250);
        socket.write('DATA\r\n');
        await expectCode(reader, 354);
        socket.write('From: Mailer-Daemon@mx.example.com\r\nSubject: null-sender\r\n\r\nbounce\r\n.\r\n');
        await expectCode(reader, 250);

        socket.write('MAIL FROM:<alice@example.com>\r\n');
        await expectCode(reader, 250);
        socket.write('RCPT TO:<guren.lab@dream.737.jp.net>\r\n');
        await expectCode(reader, 250);
        socket.write('DATA\r\n');
        await expectCode(reader, 354);
        socket.write('From: Alice <alice@example.com>\r\nSubject: foreign\r\n\r\nstill ok\r\n.\r\n');
        await expectCode(reader, 250);

        socket.write('MAIL FROM:<kazari.ops@dream.737.jp.net>\r\n');
        await expectCode(reader, 250);
        socket.write('RCPT TO:<ivory.studio@dream.737.jp.net>\r\n');
        await expectCode(reader, 250);
        socket.write('DATA\r\n');
        await expectCode(reader, 354);
        socket.write('From: menma\r\nSubject: spoof-label\r\n\r\nlabel check\r\n.\r\n');
        await expectCode(reader, 250);

        socket.write('QUIT\r\n');
        await readReply(reader);
        socket.end();

        const probe = await smtpTalk(inbound.port, [
            'EHLO verify',
            'MAIL FROM:<double-bounce@mx.dream.737.jp.net>',
            'RCPT TO:<menma.dev@dream.737.jp.net>',
            'RCPT TO:<nobody@dream.737.jp.net>',
            'RSET',
            'MAIL FROM:<>',
            'RCPT TO:<kazari.ops@dream.737.jp.net>',
            'RCPT TO:<unknown@dream.737.jp.net>',
            'QUIT'
        ]);
        assert.strictEqual(probe[1].code, 250);
        assert.strictEqual(probe[2].code, 250);
        assert.strictEqual(probe[3].code, 250);
        assert.strictEqual(probe[4].code, 550);
        assert.match(probe[4].text, /5\.1\.1/);
        assert.strictEqual(probe[5].code, 250);
        assert.strictEqual(probe[6].code, 250);
        assert.strictEqual(probe[7].code, 250);
        assert.strictEqual(probe[8].code, 550);
        assert.match(probe[8].text, /5\.1\.1/);
        assert.strictEqual(probe[9].code, 221);
    } finally {
        await inbound.close();
    }

    assert.strictEqual(delivered.length, 5);

    const ourDomain = delivered.find((msg) => msg.subject === 'our-domain');
    assert.ok(ourDomain);
    assert.strictEqual(ourDomain.fromAddress, 'kazari.ops@dream.737.jp.net');
    const ourStored = mail.deliverInboundMail(ourDomain);
    assert.strictEqual(ourStored.route, 'inbound');
    assert.strictEqual(ourStored.external, true);
    assert.notStrictEqual(ourStored.route, 'internal');
    const ourRow = mail.readMail('menma', ourStored.id);
    assert.strictEqual(ourRow.from, 'kazari.ops@dream.737.jp.net');
    assert.strictEqual(ourRow.route, 'inbound');
    assert.strictEqual(ourRow.external, true);
    assert.notStrictEqual(ourRow.route, 'internal');

    const sub = delivered.find((msg) => msg.subject === 'subdomain-env');
    assert.strictEqual(sub.fromAddress, 'double-bounce@mx.dream.737.jp.net');
    const subStored = mail.deliverInboundMail(sub);
    assert.strictEqual(subStored.route, 'inbound');
    assert.strictEqual(subStored.external, true);

    const nullMsg = delivered.find((msg) => msg.subject === 'null-sender');
    assert.strictEqual(nullMsg.fromAddress, addresses.NULL_SENDER);
    const nullStored = mail.deliverInboundMail(nullMsg);
    assert.strictEqual(nullStored.from, 'mailer-daemon');
    assert.strictEqual(nullStored.route, 'inbound');

    const foreign = delivered.find((msg) => msg.subject === 'foreign');
    assert.strictEqual(foreign.fromAddress, 'alice@example.com');
    const foreignStored = mail.deliverInboundMail(foreign);
    assert.strictEqual(foreignStored.route, 'inbound');

    const spoof = delivered.find((msg) => msg.subject === 'spoof-label');
    assert.strictEqual(spoof.fromAddress, 'kazari.ops@dream.737.jp.net');
    const spoofStored = mail.deliverInboundMail(spoof);
    assert.strictEqual(spoofStored.labelSuspicious, true);
    assert.strictEqual(spoofStored.route, 'inbound');
    assert.strictEqual(spoofStored.external, true);
}

async function testInboundPlaintextUnchanged() {
    const { inbound } = await startOpenInbound();
    try {
        const replies = await smtpTalk(inbound.port, [
            'EHLO lantis',
            'STARTTLS',
            'MAIL FROM:<alice@example.com>',
            'RCPT TO:<menma.dev@dream.737.jp.net>'
        ]);
        assert.strictEqual(replies[0].code, 220);
        assert.strictEqual(replies[1].code, 250);
        assert.doesNotMatch(replies[1].text, /STARTTLS/);
        assert.strictEqual(replies[2].code, 502);
        assert.strictEqual(replies[3].code, 250);
        assert.strictEqual(replies[4].code, 250);
    } finally {
        await inbound.close();
    }
}

async function testInboundStarttlsHandshake() {
    const certs = writeCert(path.join(tmpDir, 'inbound-starttls'), 'intake.dream.737.jp.net');
    const { inbound, delivered } = await startOpenInbound({
        tls: { certPath: certs.certPath, keyPath: certs.keyPath }
    });
    try {
        const socket = await connectSmtp(inbound.port);
        const reader = createLineReader(socket);
        assert.strictEqual((await readReply(reader)).code, 220);
        socket.write('EHLO lantis\r\n');
        const ehlo = await readReply(reader);
        assert.strictEqual(ehlo.code, 250);
        assert.match(ehlo.text, /STARTTLS/);
        socket.write('STARTTLS\r\n');
        assert.strictEqual((await readReply(reader)).code, 220);
        const tlsClient = await clientStartTls(socket);
        tlsClient.socket.write('EHLO lantis\r\n');
        const ehlo2 = await readReply(tlsClient.reader);
        assert.strictEqual(ehlo2.code, 250);
        assert.doesNotMatch(ehlo2.text, /STARTTLS/);
        tlsClient.socket.write('MAIL FROM:<alice@example.com>\r\n');
        assert.strictEqual((await readReply(tlsClient.reader)).code, 250);
        tlsClient.socket.write('RCPT TO:<menma.dev@dream.737.jp.net>\r\n');
        assert.strictEqual((await readReply(tlsClient.reader)).code, 250);
        tlsClient.socket.write('DATA\r\n');
        assert.strictEqual((await readReply(tlsClient.reader)).code, 354);
        tlsClient.socket.write('From: Alice <alice@example.com>\r\n');
        tlsClient.socket.write('To: menma.dev@dream.737.jp.net\r\n');
        tlsClient.socket.write('Subject: via starttls\r\n');
        tlsClient.socket.write('\r\n');
        tlsClient.socket.write('tls body\r\n');
        tlsClient.socket.write('.\r\n');
        assert.strictEqual((await readReply(tlsClient.reader)).code, 250);
        tlsClient.socket.write('QUIT\r\n');
        await readReply(tlsClient.reader);
        tlsClient.socket.end();
    } finally {
        await inbound.close();
    }
    assert.strictEqual(delivered.length, 1);
    assert.strictEqual(delivered[0].toOwner, 'menma');
    assert.match(delivered[0].body, /tls body/);
}

async function testInboundStarttlsInjection() {
    const certs = writeCert(path.join(tmpDir, 'inbound-inject'), 'intake.dream.737.jp.net');
    const { inbound, delivered } = await startOpenInbound({
        tls: { certPath: certs.certPath, keyPath: certs.keyPath }
    });
    try {
        const socket = await connectSmtp(inbound.port);
        const reader = createLineReader(socket);
        assert.strictEqual((await readReply(reader)).code, 220);
        socket.write('EHLO lantis\r\n');
        assert.strictEqual((await readReply(reader)).code, 250);
        socket.write('STARTTLS\r\nMAIL FROM:<evil@example.com>\r\nRCPT TO:<menma.dev@dream.737.jp.net>\r\n');
        assert.strictEqual((await readReply(reader)).code, 220);
        assert.strictEqual(reader.queuedCount(), 0, 'pipelined commands before TLS must not be answered');
        const tlsClient = await clientStartTls(socket);
        tlsClient.socket.write('RCPT TO:<menma.dev@dream.737.jp.net>\r\n');
        const rcpt = await readReply(tlsClient.reader);
        assert.strictEqual(rcpt.code, 503, 'pre-TLS MAIL/RCPT must be discarded (RFC 3207 reset)');
        tlsClient.socket.write('EHLO lantis\r\n');
        assert.strictEqual((await readReply(tlsClient.reader)).code, 250);
        tlsClient.socket.write('MAIL FROM:<alice@example.com>\r\n');
        assert.strictEqual((await readReply(tlsClient.reader)).code, 250);
        tlsClient.socket.write('RCPT TO:<menma.dev@dream.737.jp.net>\r\n');
        assert.strictEqual((await readReply(tlsClient.reader)).code, 250);
        tlsClient.socket.write('DATA\r\n');
        assert.strictEqual((await readReply(tlsClient.reader)).code, 354);
        tlsClient.socket.write('Subject: after inject\r\n\r\nclean\r\n.\r\n');
        assert.strictEqual((await readReply(tlsClient.reader)).code, 250);
        tlsClient.socket.end();
    } finally {
        await inbound.close();
    }
    assert.strictEqual(delivered.length, 1);
    assert.strictEqual(delivered[0].fromAddress, 'alice@example.com');
}

async function testInboundRequireTls() {
    const certs = writeCert(path.join(tmpDir, 'inbound-require'), 'intake.dream.737.jp.net');
    const { inbound } = await startOpenInbound({
        tls: { certPath: certs.certPath, keyPath: certs.keyPath, requireTls: true }
    });
    try {
        const socket = await connectSmtp(inbound.port);
        const reader = createLineReader(socket);
        assert.strictEqual((await readReply(reader)).code, 220);
        socket.write('EHLO lantis\r\n');
        assert.strictEqual((await readReply(reader)).code, 250);
        socket.write('MAIL FROM:<alice@example.com>\r\n');
        const refused = await readReply(reader);
        assert.strictEqual(refused.code, 530);
        assert.match(refused.text, /STARTTLS/);
        socket.write('STARTTLS\r\n');
        assert.strictEqual((await readReply(reader)).code, 220);
        const tlsClient = await clientStartTls(socket);
        tlsClient.socket.write('EHLO lantis\r\n');
        assert.strictEqual((await readReply(tlsClient.reader)).code, 250);
        tlsClient.socket.write('MAIL FROM:<alice@example.com>\r\n');
        assert.strictEqual((await readReply(tlsClient.reader)).code, 250);
        tlsClient.socket.end();
    } finally {
        await inbound.close();
    }

    const { inbound: plain } = await startOpenInbound({
        tls: { requireTls: true }
    });
    try {
        const replies = await smtpTalk(plain.port, [
            'EHLO lantis',
            'MAIL FROM:<alice@example.com>'
        ]);
        assert.doesNotMatch(replies[1].text, /STARTTLS/);
        assert.strictEqual(replies[2].code, 250, 'requireTls without a cert must not change plaintext MAIL');
    } finally {
        await plain.close();
    }
}

async function testYukimiAliasDelivery() {
    const delivered = [];
    const inbound = await gateway.startInbound({
        port: 0,
        bind: '127.0.0.1',
        allowFrom: ['127.0.0.1'],
        mapping: mapping(),
        deliver: async (msg) => { delivered.push(msg); }
    });
    const aliases = ['kazari.ops', 'kazari', 'yukimi.kazari', 'yukimi'];
    try {
        const socket = await new Promise((resolve, reject) => {
            const s = net.connect({ host: '127.0.0.1', port: inbound.port }, () => resolve(s));
            s.on('error', reject);
        });
        const reader = createLineReader(socket);
        assert.strictEqual((await readReply(reader)).code, 220);
        socket.write('EHLO test\r\n');
        assert.strictEqual((await readReply(reader)).code, 250);
        for (const local of aliases) {
            socket.write('MAIL FROM:<alice@example.com>\r\n');
            assert.strictEqual((await readReply(reader)).code, 250);
            socket.write(`RCPT TO:<${local}@dream.737.jp.net>\r\n`);
            assert.strictEqual((await readReply(reader)).code, 250);
            socket.write('DATA\r\n');
            assert.strictEqual((await readReply(reader)).code, 354);
            socket.write('From: Alice <alice@example.com>\r\n');
            socket.write(`To: ${local}@dream.737.jp.net\r\n`);
            socket.write(`Subject: for ${local}\r\n`);
            socket.write('\r\n');
            socket.write(`body for ${local}\r\n`);
            socket.write('.\r\n');
            assert.strictEqual((await readReply(reader)).code, 250);
            socket.write('RSET\r\n');
            assert.strictEqual((await readReply(reader)).code, 250);
        }
        socket.write('QUIT\r\n');
        await readReply(reader);
        socket.end();
    } finally {
        await inbound.close();
    }
    assert.strictEqual(delivered.length, aliases.length);
    aliases.forEach((local, i) => {
        assert.strictEqual(delivered[i].toOwner, 'yukimi', local);
        assert.deepStrictEqual(delivered[i].to, [`${local}@dream.737.jp.net`]);
        assert.strictEqual(delivered[i].subject, `for ${local}`);
    });
}

async function testOutboundRewrite() {
    const certs = writeCert(tmpDir, 'mx.dream.737.jp.net');
    const mock = await startMockSmtp({
        key: certs.key,
        cert: certs.cert,
        advertiseStarttls: true,
        password: 'test-pass'
    });
    try {
        const result = await gateway.submitOutbound({
            fromOwner: 'menma',
            to: ['alice@example.com'],
            cc: ['cc@example.com'],
            subject: 'rewrite me',
            body: 'hello alice',
            smtpPassword: 'test-pass',
            mapping: mapping(),
            outbound: {
                host: '127.0.0.1',
                port: mock.port,
                mode: 'starttls',
                tlsServername: 'mx.dream.737.jp.net',
                caPath: certs.certPath,
                authUser: 'dreamscape@dream.737.jp.net'
            }
        });
        assert.strictEqual(result.envelopeFrom, 'menma.dev@dream.737.jp.net');
        assert.strictEqual(mock.recorded.mailFrom, 'menma.dev@dream.737.jp.net');
        assert.deepStrictEqual(mock.recorded.rcpt, ['alice@example.com', 'cc@example.com']);
        assert.match(mock.recorded.data, /^From: menma\.dev@dream\.737\.jp\.net/m);
        assert.match(mock.recorded.data, /^Reply-To: menma\.dev@dream\.737\.jp\.net/m);
        assert.match(mock.recorded.data, /^To: alice@example\.com/m);
        assert.match(mock.recorded.data, /^Message-ID: <[^>]+@dream\.737\.jp\.net>$/m);
        assert.match(mock.recorded.data, /hello alice/);
        assert.ok(mock.recorded.authed);

        const yukimiOut = await gateway.submitOutbound({
            fromOwner: 'yukimi',
            to: ['alice@example.com'],
            subject: 'yukimi rewrite',
            body: 'from kazari.ops',
            smtpPassword: 'test-pass',
            mapping: mapping(),
            outbound: {
                host: '127.0.0.1',
                port: mock.port,
                mode: 'starttls',
                tlsServername: 'mx.dream.737.jp.net',
                caPath: certs.certPath,
                authUser: 'dreamscape@dream.737.jp.net'
            }
        });
        assert.strictEqual(yukimiOut.envelopeFrom, 'kazari.ops@dream.737.jp.net');
        assert.strictEqual(yukimiOut.from, 'kazari.ops@dream.737.jp.net');
        assert.strictEqual(mock.recorded.mailFrom, 'kazari.ops@dream.737.jp.net');
        assert.match(mock.recorded.data, /^From: kazari\.ops@dream\.737\.jp\.net/m);
        assert.match(mock.recorded.data, /^Reply-To: kazari\.ops@dream\.737\.jp\.net/m);
        assert.doesNotMatch(mock.recorded.data, /^From: yukimi@dream\.737\.jp\.net/m);
    } finally {
        await mock.close();
    }
}

async function testMissingStarttls() {
    const certs = writeCert(tmpDir, 'mx.dream.737.jp.net');
    const mock = await startMockSmtp({
        key: certs.key,
        cert: certs.cert,
        advertiseStarttls: false,
        password: 'test-pass'
    });
    try {
        await assert.rejects(
            () => gateway.submitOutbound({
                fromOwner: 'rook',
                to: ['alice@example.com'],
                subject: 'no tls',
                body: 'x',
                smtpPassword: 'test-pass',
                mapping: mapping(),
                outbound: {
                    host: '127.0.0.1',
                    port: mock.port,
                    mode: 'starttls',
                    tlsServername: 'mx.dream.737.jp.net',
                    caPath: certs.certPath
                }
            }),
            (err) => err.code === 'STARTTLS_REQUIRED' && /STARTTLS is required/.test(err.message)
        );
        assert.strictEqual(mock.recorded.mailFrom, null);
    } finally {
        await mock.close();
    }
}

async function testCertVerificationFailure() {
    const wrong = writeCert(tmpDir, 'wrong.example');
    const expected = writeCert(path.join(tmpDir, 'expected'), 'mx.dream.737.jp.net');
    const mock = await startMockSmtp({
        key: wrong.key,
        cert: wrong.cert,
        advertiseStarttls: true,
        password: 'test-pass'
    });
    try {
        await assert.rejects(
            () => gateway.submitOutbound({
                fromOwner: 'guren',
                to: ['alice@example.com'],
                subject: 'bad cert',
                body: 'x',
                smtpPassword: 'test-pass',
                mapping: mapping(),
                outbound: {
                    host: '127.0.0.1',
                    port: mock.port,
                    mode: 'starttls',
                    tlsServername: 'mx.dream.737.jp.net',
                    caPath: expected.certPath
                }
            }),
            (err) => err.code === 'TLS_VERIFY_FAILED'
        );
        assert.strictEqual(mock.recorded.mailFrom, null);
    } finally {
        await mock.close();
    }
}

async function testImplicitTls() {
    const certs = writeCert(path.join(tmpDir, 'implicit'), 'mx.dream.737.jp.net');
    const mock = await startMockSmtp({
        key: certs.key,
        cert: certs.cert,
        implicit: true,
        password: 'test-pass'
    });
    try {
        const result = await gateway.submitOutbound({
            fromOwner: 'chiyo',
            to: ['bob@example.com'],
            subject: 'implicit',
            body: 'via 465',
            smtpPassword: 'test-pass',
            mapping: mapping(),
            outbound: {
                host: '127.0.0.1',
                port: mock.port,
                mode: 'implicit',
                tlsServername: 'mx.dream.737.jp.net',
                caPath: certs.certPath
            }
        });
        assert.strictEqual(result.from, 'chiyo.web@dream.737.jp.net');
        assert.strictEqual(mock.recorded.mailFrom, 'chiyo.web@dream.737.jp.net');
        assert.match(mock.recorded.data, /^Reply-To: chiyo\.web@dream\.737\.jp\.net/m);
    } finally {
        await mock.close();
    }
}

function testInternalUnchangedAndDisabled() {
    gateway.setTestOverrides({ config: { enabled: false } });
    const before = mail.sendMail({ fromOwner: 'menma', to: 'rook', subject: 'internal-off', body: 'same' });
    assert.deepStrictEqual(before.to, ['rook']);
    assert.strictEqual(before.outbound, undefined);
    const offInbox = mail.listMail('rook', { folder: 'inbox' }).find((row) => row.subject === 'internal-off');
    const offSent = mail.listMail('menma', { folder: 'sent' }).find((row) => row.subject === 'internal-off');
    assert.strictEqual(offInbox.route, 'internal');
    assert.strictEqual(offInbox.external, false);
    assert.strictEqual(offSent.route, 'internal');
    assert.strictEqual(offSent.external, false);
    assert.strictEqual(mail.listMail('rook', { folder: 'inbox' }).filter((row) => row.subject === 'internal-off').length, 1);
    assert.throws(
        () => mail.sendMail({ fromOwner: 'menma', to: 'alice@example.com', subject: 'ext-off', body: 'nope' }),
        (err) => err.code === 'UNKNOWN_RECIPIENT'
    );

    gateway.setTestOverrides({
        config: {
            enabled: true,
            domain: 'dream.737.jp.net',
            mailboxes: addresses.DEFAULT_MAILBOXES
        }
    });
    const stillInternal = mail.sendMail({ fromOwner: 'menma', to: 'sala', cc: 'rook', subject: 'internal-on', body: 'still local' });
    assert.deepStrictEqual(stillInternal.to, ['sala']);
    assert.deepStrictEqual(stillInternal.cc, ['rook']);
    assert.strictEqual(stillInternal.outbound, undefined);
    assert.strictEqual(mail.listMail('sala', { folder: 'inbox' }).filter((row) => row.subject === 'internal-on').length, 1);
    assert.strictEqual(mail.listMail('rook', { folder: 'inbox' }).filter((row) => row.subject === 'internal-on').length, 1);

    const mappedInternal = mail.sendMail({
        fromOwner: 'cursor',
        to: 'ivory.studio@dream.737.jp.net',
        subject: 'mapped-internal',
        body: 'stays inside'
    });
    assert.deepStrictEqual(mappedInternal.to, ['ivory']);
    assert.strictEqual(mappedInternal.outbound, undefined);
    assert.strictEqual(mail.listMail('ivory', { folder: 'inbox' }).some((row) => row.subject === 'mapped-internal'), true);

    gateway.setTestOverrides({ config: { enabled: false } });
}

async function testSendMailOutboundHook() {
    const certs = writeCert(path.join(tmpDir, 'hook'), 'mx.dream.737.jp.net');
    const mock = await startMockSmtp({
        key: certs.key,
        cert: certs.cert,
        password: 'hook-pass'
    });
    gateway.setTestOverrides({
        config: {
            enabled: true,
            domain: 'dream.737.jp.net',
            mailboxes: addresses.DEFAULT_MAILBOXES,
            outbound: {
                host: '127.0.0.1',
                port: mock.port,
                mode: 'starttls',
                tlsServername: 'mx.dream.737.jp.net',
                caPath: certs.certPath,
                authUser: 'dreamscape@dream.737.jp.net'
            }
        },
        smtpPassword: 'hook-pass'
    });
    try {
        const result = mail.sendMail({
            fromOwner: 'frost',
            to: 'friend@example.net',
            subject: 'from sendMail',
            body: 'external path'
        });
        assert.ok(result.outbound);
        await result.outbound;
        assert.deepStrictEqual(result.to, ['friend@example.net']);
        assert.strictEqual(mock.recorded.mailFrom, 'frost.dev@dream.737.jp.net');
        assert.match(mock.recorded.data, /^From: frost\.dev@dream\.737\.jp\.net/m);
        const sent = mail.listMail('frost', { folder: 'sent' }).find((row) => row.subject === 'from sendMail');
        assert.ok(sent);
        assert.deepStrictEqual(sent.to, ['friend@example.net']);
        assert.strictEqual(sent.route, 'outbound');
        assert.strictEqual(sent.external, true);
    } finally {
        gateway.setTestOverrides({ config: { enabled: false } });
        await mock.close();
    }
}

function testCrlfBufferAndSenderRules() {
    const buf = new inboundMod.CrlfBuffer();
    buf.push('EHLO a\nMAIL FROM:<evil@evil.com>\n');
    assert.strictEqual(buf.nextLine(512), null, 'bare LF is not a line delimiter');
    buf.push('RCPT TO:<menma.dev@dream.737.jp.net>\r\nDATA\r\n');
    const first = buf.nextLine(512);
    assert.ok(first && first.line.includes('EHLO a\nMAIL FROM:'));
    assert.strictEqual(buf.nextLine(512).line, 'DATA');

    const split = new inboundMod.CrlfBuffer();
    split.push('NOOP\r');
    assert.strictEqual(split.nextLine(512), null);
    split.push('\nQUIT\r\n');
    assert.strictEqual(split.nextLine(512).line, 'NOOP');
    assert.strictEqual(split.nextLine(512).line, 'QUIT');

    const map = mapping();
    assert.strictEqual(addresses.validateEnvelopeSender('menma', map).ok, false);
    assert.strictEqual(addresses.validateEnvelopeSender('<menma>', map).ok, false);
    const bounce = addresses.validateEnvelopeSender('<>', map);
    assert.strictEqual(bounce.ok, true);
    assert.strictEqual(bounce.address, addresses.NULL_SENDER);
    assert.strictEqual(addresses.validateEnvelopeSender('menma@dream.737.jp.net', map).ok, true);
    assert.strictEqual(addresses.validateEnvelopeSender('double-bounce@mx.dream.737.jp.net', map).ok, true);
    // r1: anchored, case/trailing-dot/IDNA-dot folded; look-alikes stay external.
    for (const bad of ['<a@dream.co.jp.>', '<a@DREAM.CO.JP>', '<a@x.dream.co.jp..>', '<a@dream\u3002co\u3002jp>', '<a@dream\uff0eco\uff0ejp>']) {
        assert.strictEqual(addresses.validateEnvelopeSender(bad, map).code, 550, bad);
    }
    for (const ok of ['<a@evil-dream.co.jp>', '<a@dream.co.jp.evil.com>', '<a@evil-dream.737.jp.net>', '<a@dream.737.jp.net.evil.com>']) {
        assert.strictEqual(addresses.validateEnvelopeSender(ok, map).ok, true, ok);
    }
    assert.strictEqual(addresses.validateFromHeader('a@dream.co.jp.', map).ok, false);
    const ownFrom = addresses.validateFromHeader('x <a@dream.737.jp.net.>', map);
    assert.strictEqual(ownFrom.ok, true);
    assert.strictEqual(ownFrom.ownDomain, true);
    assert.strictEqual(addresses.validateEnvelopeSender('menma@dream.co.jp', map).code, 550);
    assert.strictEqual(addresses.validateEnvelopeSender('alice@example.com', map).ok, true);
    assert.strictEqual(addresses.validateFromHeader('menma', map).ok, true);
    assert.strictEqual(addresses.validateFromHeader('Alice <alice@example.com>', map).ok, true);
    const publicFrom = addresses.validateFromHeader('menma@dream.737.jp.net', map);
    assert.strictEqual(publicFrom.ok, true);
    assert.strictEqual(publicFrom.ownDomain, true);
    const subFrom = addresses.validateFromHeader('Menma <menma@lists.dream.737.jp.net>', map);
    assert.strictEqual(subFrom.ok, true);
    assert.strictEqual(subFrom.ownDomain, true);
    assert.strictEqual(addresses.validateFromHeader('menma@dream.co.jp', map).ok, false);

    const owners = mail.BOT_OWNERS.concat([mail.HUMAN_OWNER]);
    const spoofOpts = { mapping: map, owners };
    assert.strictEqual(addresses.inspectFromLabel('menma', spoofOpts).suspicious, true);
    assert.strictEqual(addresses.inspectFromLabel('Yukimi Kazari <x@ext.com>', spoofOpts).suspicious, true);
    assert.strictEqual(addresses.inspectFromLabel('"menma.dev@dream.737.jp.net" <evil@ext.com>', spoofOpts).suspicious, true);
    assert.strictEqual(addresses.inspectFromLabel('yukimi', spoofOpts).suspicious, true);
    assert.strictEqual(addresses.inspectFromLabel('Rook', spoofOpts).suspicious, true);
    assert.strictEqual(addresses.inspectFromLabel('chiyo.web@dream.737.jp.net', spoofOpts).suspicious, true);
    assert.strictEqual(addresses.inspectFromLabel('Alice <alice@example.com>', spoofOpts).suspicious, false);
    assert.strictEqual(addresses.inspectFromLabel('Mailer-Daemon@mx.example.com', spoofOpts).suspicious, false);

    const lookalikes = [
        'Ｍｅｎｍａ',
        'Ꮇenma',
        'me\u200bnma',
        'MenmaBot',
        'menma-bot',
        'r o o k',
        'ykazari',
        'menm\u00e1',
        'menma\u0301',
        'Y Kazari',
        'yuki mi'
    ];
    lookalikes.forEach((fromLabel) => {
        assert.strictEqual(addresses.inspectFromLabel(fromLabel, spoofOpts).suspicious, true, fromLabel);
    });

    ['Ivory', 'Sala', 'Frost Bank', 'Guren Lab', 'Claude', 'Cursor'].forEach((fromLabel) => {
        assert.strictEqual(addresses.inspectFromLabel(fromLabel, spoofOpts).suspicious, true, fromLabel);
    });
    assert.strictEqual(addresses.inspectFromLabel('Claude Monet', spoofOpts).suspicious, false);
    assert.strictEqual(addresses.inspectFromLabel('Cursor Inc', spoofOpts).suspicious, false);
    assert.strictEqual(addresses.inspectFromLabel('Claude Monet <claude@example.com>', spoofOpts).suspicious, false);
}

function testResolveConfigDefaults() {
    gateway.setTestOverrides({ config: {} });
    const cfg = gateway.resolveConfig();
    assert.strictEqual(cfg.enabled, false);
    assert.strictEqual(cfg.inbound.bind, gateway.DEFAULT_INBOUND_BIND);
    assert.strictEqual(cfg.inbound.bind, '192.168.200.101');
    assert.strictEqual(cfg.inbound.maxConnections, gateway.DEFAULT_MAX_CONNECTIONS);
    assert.strictEqual(cfg.spam.flagHeader, 'X-Spam-Flag');
    assert.strictEqual(cfg.spam.reportHeader, 'X-Spam-Report');
    assert.strictEqual(cfg.spam.originalToHeader, 'X-Original-To');
    assert.strictEqual(cfg.spam.authservId, 'mx.dream.737.jp.net');
    assert.strictEqual(cfg.inbound.tls.certPath, '');
    assert.strictEqual(cfg.inbound.tls.keyPath, '');
    assert.strictEqual(cfg.inbound.tls.requireTls, false);
    assert.strictEqual(gateway.toExternal('yukimi'), 'kazari.ops@dream.737.jp.net');
    assert.ok(!Object.prototype.hasOwnProperty.call(cfg.outbound, 'rejectUnauthorized'));
    const tlsOpts = gateway.tlsVerifyOptions(Object.assign({}, cfg.outbound, { rejectUnauthorized: false }));
    assert.strictEqual(tlsOpts.rejectUnauthorized, true);
    const built = gateway.buildOutboundMessage({
        fromAddress: 'menma.dev@dream.737.jp.net',
        to: ['a@b.com'],
        subject: 'id',
        body: 'x',
        domain: 'custom.example'
    });
    assert.match(built, /^Message-ID: <[^>]+@custom\.example>$/m);
    gateway.setTestOverrides({ config: { enabled: false } });
}

function testMimeDecode() {
    const qp = mime.extractTextBody([
        'Subject: qp',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        'hello=20there='
    ].join('\r\n'));
    assert.strictEqual(qp.headers.subject, 'qp');
    assert.match(qp.body, /hello there/);

    const b64 = mime.extractTextBody([
        'From: a@b.com',
        'Content-Type: text/plain',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from('decoded body', 'utf8').toString('base64')
    ].join('\r\n'));
    assert.strictEqual(b64.body, 'decoded body');

    const multi = mime.extractTextBody([
        'To: menma.dev@dream.737.jp.net',
        'Cc: sala.ops@dream.737.jp.net',
        'Content-Type: multipart/alternative; boundary="bnd"',
        '',
        '--bnd',
        'Content-Type: text/plain',
        '',
        'plain part',
        '--bnd',
        'Content-Type: text/html',
        '',
        '<p>html part</p>',
        '--bnd--'
    ].join('\r\n'));
    assert.strictEqual(multi.body.trim(), 'plain part');
    assert.strictEqual(multi.format, 'text');
    assert.deepStrictEqual(addresses.parseAddressList(multi.headers.cc), ['sala.ops@dream.737.jp.net']);

    const nested = mime.extractTextBody([
        'Content-Type: multipart/mixed; boundary="outer"',
        '',
        '--outer',
        'Content-Type: multipart/alternative; boundary="inner"',
        '',
        '--inner',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'nested plain',
        '--inner',
        'Content-Type: text/html',
        '',
        '<p>nested html</p>',
        '--inner--',
        '--outer',
        'Content-Type: application/octet-stream',
        '',
        'blob',
        '--outer--'
    ].join('\r\n'));
    assert.strictEqual(nested.body.trim(), 'nested plain');

    const latin = mime.extractTextBody([
        'Content-Type: text/plain; charset=iso-8859-1',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        'caf=E9'
    ].join('\r\n'));
    assert.strictEqual(latin.body, 'café');

    const b64latin = mime.extractTextBody([
        'Content-Type: text/plain; charset=iso-8859-1',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from([0x63, 0x61, 0x66, 0xe9]).toString('base64')
    ].join('\r\n'));
    assert.strictEqual(b64latin.body, 'café');
}

async function testOutboundRateAndAllowlist() {
    await gateway.resetForTests();
    const limited = gateway.resolveConfig({ outbound: { rateLimitPerMinute: 1 } });
    gateway.assertOutboundAllowed({ fromOwner: 'sala', to: ['ok@example.com'], config: limited });
    assert.throws(
        () => gateway.assertOutboundAllowed({ fromOwner: 'sala', to: ['ok@example.com'], config: limited }),
        (err) => err.code === 'RATE_LIMITED'
    );
    gateway.assertOutboundAllowed({ fromOwner: 'rook', to: ['ok@example.com'], config: limited });

    const allow = gateway.resolveConfig({ outbound: { recipientAllowlist: ['@good.example', 'exact@list.test'] } });
    gateway.assertOutboundAllowed({ fromOwner: 'ivory', to: ['user@good.example'], config: allow });
    gateway.assertOutboundAllowed({ fromOwner: 'ivory', to: ['exact@list.test'], config: allow });
    assert.throws(
        () => gateway.assertOutboundAllowed({ fromOwner: 'ivory', to: ['nope@evil.example'], config: allow }),
        (err) => err.code === 'RECIPIENT_NOT_ALLOWED'
    );
}

async function testSpoofCases() {
    const { inbound, delivered } = await startOpenInbound();
    try {
        const replies = await smtpTalk(inbound.port, [
            'EHLO test',
            'MAIL FROM:<menma>',
            'MAIL FROM:menma',
            'MAIL FROM:<menma@dream.737.jp.net>',
            'MAIL FROM:<menma@mx.dream.737.jp.net>',
            'MAIL FROM:<menma@dream.co.jp>',
            'MAIL FROM:<alice@example.com>',
            'RCPT TO:<menma.dev@dream.737.jp.net>',
            'DATA'
        ]);
        assert.strictEqual(replies[1].code, 250);
        assert.strictEqual(replies[2].code, 501);
        assert.strictEqual(replies[3].code, 501);
        assert.strictEqual(replies[4].code, 250);
        assert.strictEqual(replies[5].code, 250);
        assert.strictEqual(replies[6].code, 550);
        assert.strictEqual(replies[7].code, 250);
        assert.strictEqual(replies[8].code, 250);
        assert.strictEqual(replies[9].code, 354);

        const socket = await connectSmtp(inbound.port);
        const reader = createLineReader(socket);
        await expectCode(reader, 220);
        socket.write('EHLO test\r\n');
        await expectCode(reader, 250);
        socket.write('MAIL FROM:<alice@example.com>\r\n');
        await expectCode(reader, 250);
        socket.write('RCPT TO:<ivory.studio@dream.737.jp.net>\r\n');
        await expectCode(reader, 250);
        socket.write('DATA\r\n');
        await expectCode(reader, 354);
        socket.write('From: menma\r\nSubject: list-like\r\n\r\nlooks like bot mail\r\n.\r\n');
        await expectCode(reader, 250);

        socket.write('MAIL FROM:<alice@example.com>\r\n');
        await expectCode(reader, 250);
        socket.write('RCPT TO:<ivory.studio@dream.737.jp.net>\r\n');
        await expectCode(reader, 250);
        socket.write('DATA\r\n');
        await expectCode(reader, 354);
        socket.write('From: menma@dream.737.jp.net\r\nSubject: reserved-from\r\n\r\nx\r\n.\r\n');
        await expectCode(reader, 250);

        socket.write('MAIL FROM:<>\r\n');
        await expectCode(reader, 250);
        socket.write('RCPT TO:<ivory.studio@dream.737.jp.net>\r\n');
        await expectCode(reader, 250);
        socket.write('DATA\r\n');
        await expectCode(reader, 354);
        socket.write('From: Mailer-Daemon@mx.example.com\r\nSubject: bounce\r\n\r\nundelivered\r\n.\r\n');
        await expectCode(reader, 250);

        socket.write('QUIT\r\n');
        await readReply(reader);
        socket.end();
    } finally {
        await inbound.close();
    }
    assert.strictEqual(delivered.length, 3);
    assert.strictEqual(delivered[0].fromAddress, 'alice@example.com');
    assert.strictEqual(delivered[0].fromLabel, 'menma');
    assert.notStrictEqual(delivered[0].fromAddress, 'menma');
    assert.strictEqual(delivered[1].toOwner, 'tsubame');
    assert.strictEqual(delivered[1].ownDomainFrom, true);
    assert.strictEqual(delivered[2].fromAddress, addresses.NULL_SENDER);
    assert.match(delivered[2].fromLabel, /Mailer-Daemon@mx\.example\.com/);

    const storedList = mail.deliverInboundMail({
        fromAddress: 'alice@example.com',
        fromLabel: 'menma',
        toOwner: 'ivory',
        subject: 'stored label',
        body: 'x',
        route: 'internal'
    });
    const row = mail.readMail('ivory', storedList.id);
    assert.strictEqual(row.from, 'alice@example.com');
    assert.strictEqual(row.fromLabel, 'alice@example.com');
    assert.strictEqual(row.labelSuspicious, true);
    assert.strictEqual(row.route, 'inbound');
    assert.strictEqual(row.external, true);
    assert.throws(
        () => mail.deliverInboundMail({ fromAddress: 'menma', toOwner: 'ivory', subject: 'nope', body: 'x' }),
        (err) => err.code === 'UNKNOWN_SENDER'
    );

    const bounce = mail.deliverInboundMail({
        fromAddress: addresses.NULL_SENDER,
        fromLabel: 'Mailer-Daemon@mx.example.com',
        toOwner: 'ivory',
        subject: 'stored bounce',
        body: 'x'
    });
    const bounceRow = mail.readMail('ivory', bounce.id);
    assert.strictEqual(bounceRow.from, 'mailer-daemon');
    assert.strictEqual(bounceRow.route, 'inbound');
    assert.strictEqual(bounceRow.external, true);
}

async function testBareLfSmuggling() {
    const { inbound, delivered } = await startOpenInbound();
    try {
        const socket = await connectSmtp(inbound.port);
        const reader = createLineReader(socket);
        await expectCode(reader, 220);
        socket.write('EHLO test\r\n');
        await expectCode(reader, 250);
        socket.write('MAIL FROM:<alice@example.com>\r\n');
        await expectCode(reader, 250);
        socket.write('RCPT TO:<guren.lab@dream.737.jp.net>\r\n');
        await expectCode(reader, 250);
        socket.write('DATA\r\n');
        await expectCode(reader, 354);
        socket.write('From: alice@example.com\r\nSubject: smuggle\r\n\r\n');
        socket.write('hello\n.\nMAIL FROM:<evil@evil.com>\r\nRCPT TO:<sala.ops@dream.737.jp.net>\r\nDATA\r\nowned\r\n');
        await delay(40);
        assert.strictEqual(reader.queuedCount(), 0, 'bare-LF dot must not end DATA');
        socket.write('visible tail\r\n.\r\n');
        await expectCode(reader, 250);
        socket.write('QUIT\r\n');
        await readReply(reader);
        socket.end();
    } finally {
        await inbound.close();
    }
    assert.strictEqual(delivered.length, 1);
    assert.strictEqual(delivered[0].toOwner, 'guren');
    assert.match(delivered[0].body, /MAIL FROM:<evil@evil.com>/);
    assert.match(delivered[0].body, /visible tail/);
}

async function testOverlongLineTailDoesNotEndData() {
    const { inbound, delivered } = await startOpenInbound({
        maxDataLine: 64,
        maxDataBytes: 1024 * 1024
    });
    try {
        const socket = await connectSmtp(inbound.port);
        const reader = createLineReader(socket);
        await expectCode(reader, 220);
        socket.write('EHLO test\r\n');
        await expectCode(reader, 250);
        socket.write('MAIL FROM:<alice@example.com>\r\n');
        await expectCode(reader, 250);
        socket.write('RCPT TO:<guren.lab@dream.737.jp.net>\r\n');
        await expectCode(reader, 250);
        socket.write('DATA\r\n');
        await expectCode(reader, 354);
        socket.write('From: alice@example.com\r\nSubject: overlong\r\n\r\n');
        socket.write('A'.repeat(80));
        await delay(20);
        socket.write('.\r\n');
        socket.write('MAIL FROM:<evil@evil.com>\r\n');
        socket.write('RCPT TO:<sala.ops@dream.737.jp.net>\r\n');
        socket.write('DATA\r\n');
        socket.write('From: evil@evil.com\r\nSubject: hidden\r\n\r\npwned\r\n.\r\n');
        await delay(40);
        socket.write('QUIT\r\n');
        const codes = [];
        for (let i = 0; i < 6; i++) {
            const reply = await Promise.race([
                readReply(reader),
                delay(250).then(() => null)
            ]);
            if (!reply || !reply.code) break;
            codes.push(reply.code);
            if (reply.code === 221) break;
        }
        socket.end();
        assert.ok(codes.includes(552), `expected 552 after overlong line, got ${codes.join(',')}`);
        assert.strictEqual(
            delivered.filter((msg) => msg.subject === 'hidden').length,
            0,
            'overlong-line tail "." must not end DATA'
        );
        assert.strictEqual(delivered.length, 0);
    } finally {
        await inbound.close();
    }
}

async function connectSmtpFrom(port, localAddress) {
    return new Promise((resolve, reject) => {
        const s = net.connect({ host: '127.0.0.1', port, localAddress }, () => resolve(s));
        s.on('error', reject);
    });
}

async function testDeniedPeersDoNotConsumeCap() {
    const { inbound } = await startOpenInbound({
        maxConnections: 1,
        allowFrom: ['127.0.0.1']
    });
    const denied = [];
    try {
        for (let i = 0; i < 4; i++) {
            const socket = await connectSmtpFrom(inbound.port, '127.0.0.2');
            denied.push(socket);
            const reader = createLineReader(socket);
            await expectCode(reader, 554);
        }
        const allowed = await connectSmtp(inbound.port);
        const allowedReader = createLineReader(allowed);
        await expectCode(allowedReader, 220);
        await new Promise((resolve) => {
            allowed.once('close', resolve);
            allowed.write('QUIT\r\n');
            allowed.end();
        });

        const held = await connectSmtp(inbound.port);
        const heldReader = createLineReader(held);
        try {
            await expectCode(heldReader, 220);
            const extraDenied = await connectSmtpFrom(inbound.port, '127.0.0.2');
            denied.push(extraDenied);
            await expectCode(createLineReader(extraDenied), 554);
            const secondAllowed = await connectSmtp(inbound.port);
            try {
                await expectCode(createLineReader(secondAllowed), 421);
            } finally {
                secondAllowed.end();
            }
        } finally {
            held.end();
        }
    } finally {
        denied.forEach((socket) => socket.destroy());
        await inbound.close();
    }
}

async function testOversizeDiscard() {
    const { inbound, delivered } = await startOpenInbound({ maxDataBytes: 64 });
    try {
        const socket = await connectSmtp(inbound.port);
        const reader = createLineReader(socket);
        await expectCode(reader, 220);
        socket.write('EHLO test\r\n');
        await expectCode(reader, 250);
        socket.write('MAIL FROM:<alice@example.com>\r\n');
        await expectCode(reader, 250);
        socket.write('RCPT TO:<chiyo.web@dream.737.jp.net>\r\n');
        await expectCode(reader, 250);
        socket.write('DATA\r\n');
        await expectCode(reader, 354);
        socket.write('From: alice@example.com\r\nSubject: huge\r\n\r\n');
        socket.write(`${'x'.repeat(80)}\r\n`);
        socket.write('MAIL FROM:<evil@evil.com>\r\nRCPT TO:<sala.ops@dream.737.jp.net>\r\nDATA\r\nsmuggled\r\n');
        await delay(40);
        assert.strictEqual(reader.queuedCount(), 0, 'oversize must stay in DATA until CRLF.CRLF');
        socket.write('.\r\n');
        const oversize = await expectCode(reader, 552);
        assert.match(oversize.text, /too large/);
        socket.write('MAIL FROM:<bob@outside.example>\r\n');
        await expectCode(reader, 250);
        socket.write('RCPT TO:<chiyo.web@dream.737.jp.net>\r\n');
        await expectCode(reader, 250);
        socket.write('DATA\r\n');
        await expectCode(reader, 354);
        socket.write('From: bob@outside.example\r\nSubject: after oversize\r\n\r\nok\r\n.\r\n');
        await expectCode(reader, 250);
        socket.write('QUIT\r\n');
        await readReply(reader);
        socket.end();
    } finally {
        await inbound.close();
    }
    assert.strictEqual(delivered.length, 1);
    assert.strictEqual(delivered[0].fromAddress, 'bob@outside.example');
    assert.strictEqual(delivered[0].subject, 'after oversize');
}

async function testCommandSplitAcrossChunks() {
    const { inbound, delivered } = await startOpenInbound();
    try {
        const socket = await connectSmtp(inbound.port);
        const reader = createLineReader(socket);
        await expectCode(reader, 220);
        socket.write('EHLO te');
        await delay(20);
        socket.write('st\r\n');
        await expectCode(reader, 250);
        socket.write('MAIL FROM:<ali');
        await delay(20);
        socket.write('ce@example.com>\r\n');
        await expectCode(reader, 250);
        socket.write('RCPT TO:<frost.dev@dream.737.jp.net>\r');
        await delay(20);
        socket.write('\n');
        await expectCode(reader, 250);
        socket.write('DATA\r\n');
        await expectCode(reader, 354);
        socket.write('From: alice@example.com\r\nSubject: split\r\n\r\n');
        socket.write('..dotstuffed\r\n.\r\n');
        await expectCode(reader, 250);
        socket.write('QUIT\r\n');
        await readReply(reader);
        socket.end();
    } finally {
        await inbound.close();
    }
    assert.strictEqual(delivered.length, 1);
    assert.strictEqual(delivered[0].toOwner, 'frost');
    assert.match(delivered[0].body, /^\.dotstuffed/m);
}

async function testConnectionCap() {
    const { inbound } = await startOpenInbound({ maxConnections: 1 });
    const first = await connectSmtp(inbound.port);
    const firstReader = createLineReader(first);
    try {
        await expectCode(firstReader, 220);
        const second = await connectSmtp(inbound.port);
        const secondReader = createLineReader(second);
        try {
            await expectCode(secondReader, 421);
        } finally {
            second.end();
        }
        first.end();
        await delay(30);
        const third = await connectSmtp(inbound.port);
        const thirdReader = createLineReader(third);
        try {
            await expectCode(thirdReader, 220);
            third.write('QUIT\r\n');
            await readReply(thirdReader);
        } finally {
            third.end();
        }
    } finally {
        first.end();
        await inbound.close();
    }
}

async function testOutboundFailureOutbox() {
    gateway.setTestOverrides({
        config: {
            enabled: true,
            domain: 'dream.737.jp.net',
            mailboxes: addresses.DEFAULT_MAILBOXES,
            outbound: {
                host: '127.0.0.1',
                port: 1,
                mode: 'starttls',
                tlsServername: 'mx.dream.737.jp.net'
            }
        },
        smtpPassword: 'unused'
    });
    try {
        const result = mail.sendMail({
            fromOwner: 'menma',
            to: 'nobody@example.com',
            subject: 'relay-down',
            body: 'should stay in outbox'
        });
        await assert.rejects(() => result.outbound, (err) => !!err.code);
        const outbox = mail.listMail('menma', { folder: 'outbox' }).find((row) => row.subject === 'relay-down');
        assert.ok(outbox);
        assert.strictEqual(
            mail.listMail('menma', { folder: 'sent' }).some((row) => row.subject === 'relay-down'),
            false
        );
    } finally {
        gateway.setTestOverrides({ config: { enabled: false } });
    }
}

async function testInboundMimeAndCc() {
    const { inbound, delivered } = await startOpenInbound();
    try {
        const socket = await connectSmtp(inbound.port);
        const reader = createLineReader(socket);
        await expectCode(reader, 220);
        socket.write('EHLO test\r\n');
        await expectCode(reader, 250);
        socket.write('MAIL FROM:<Carol <carol@example.com>>\r\n');
        await expectCode(reader, 250);
        socket.write('RCPT TO:<ivory.studio@dream.737.jp.net>\r\n');
        await expectCode(reader, 250);
        socket.write('DATA\r\n');
        await expectCode(reader, 354);
        socket.write('From: Carol <carol@example.com>\r\n');
        socket.write('To: ivory.studio@dream.737.jp.net\r\n');
        socket.write('Cc: sala.ops@dream.737.jp.net, friend@example.net\r\n');
        socket.write('Subject: mime cc\r\n');
        socket.write('Content-Type: multipart/mixed; boundary="x"\r\n\r\n');
        socket.write('--x\r\nContent-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n\r\n');
        socket.write(`${Buffer.from('plain from mime', 'utf8').toString('base64')}\r\n`);
        socket.write('--x\r\nContent-Type: text/html\r\n\r\n<p>html</p>\r\n--x--\r\n.\r\n');
        await expectCode(reader, 250);
        socket.write('QUIT\r\n');
        await readReply(reader);
        socket.end();
    } finally {
        await inbound.close();
    }
    assert.strictEqual(delivered.length, 1);
    assert.strictEqual(delivered[0].fromAddress, 'carol@example.com');
    assert.deepStrictEqual(delivered[0].to, ['ivory.studio@dream.737.jp.net']);
    assert.deepStrictEqual(delivered[0].cc, ['sala.ops@dream.737.jp.net', 'friend@example.net']);
    assert.match(delivered[0].body, /plain from mime/);

    const stored = mail.deliverInboundMail({
        fromAddress: delivered[0].fromAddress,
        toOwner: 'ivory',
        to: delivered[0].to,
        cc: delivered[0].cc,
        subject: delivered[0].subject,
        body: delivered[0].body
    });
    const row = mail.readMail('ivory', stored.id);
    assert.deepStrictEqual(row.to, ['ivory.studio@dream.737.jp.net']);
    assert.deepStrictEqual(row.cc, ['sala.ops@dream.737.jp.net', 'friend@example.net']);
    assert.strictEqual(row.from, 'carol@example.com');
}

function testRouteTagging() {
    gateway.setTestOverrides({ config: { enabled: false } });
    const internal = mail.sendMail({ fromOwner: 'sala', to: 'chiyo', subject: 'route-internal', body: 'in' });
    const inbox = mail.listMail('chiyo', { folder: 'inbox' }).find((row) => row.id !== internal.id && row.subject === 'route-internal');
    const sent = mail.listMail('sala', { folder: 'sent' }).find((row) => row.id === internal.id);
    assert.strictEqual(inbox.route, 'internal');
    assert.strictEqual(inbox.external, false);
    assert.strictEqual(sent.route, 'internal');
    assert.strictEqual(sent.external, false);

    const inbound = mail.deliverInboundMail({
        fromAddress: 'list@lists.example.com',
        fromLabel: 'Alice <alice@example.com>',
        toOwner: 'guren',
        subject: 'route-inbound',
        body: 'from outside',
        route: 'internal'
    });
    const inboundRow = mail.readMail('guren', inbound.id);
    assert.strictEqual(inbound.route, 'inbound');
    assert.strictEqual(inbound.external, true);
    assert.strictEqual(inboundRow.route, 'inbound');
    assert.strictEqual(inboundRow.external, true);
    assert.strictEqual(inboundRow.fromLabel, 'Alice <alice@example.com>');
    assert.strictEqual(inboundRow.labelSuspicious, false);

    const daemon = mail.deliverInboundMail({
        fromAddress: addresses.NULL_SENDER,
        toOwner: 'guren',
        subject: 'route-bounce',
        body: 'bounce'
    });
    assert.strictEqual(mail.readMail('guren', daemon.id).route, 'inbound');
    assert.strictEqual(mail.readMail('guren', daemon.id).external, true);

    const legacyId = require('crypto').randomUUID();
    const now = new Date().toISOString();
    require('../modules/dovecoteDatabase').getDb().prepare(`
        INSERT INTO dovecote_message (
            id, owner, folder, archive_subfolder, thread_id, from_owner, to_owner,
            subject, body, format, reply_to_id, fwd_from_owner, fwd_from_message_id,
            read, flagged, created_at, updated_at, deleted_at, paired_message_id, attachments
        ) VALUES (?, 'rook', 'inbox', NULL, ?, 'menma', 'rook', 'legacy-route', 'old', 'text', NULL, NULL, NULL, 0, 0, ?, ?, NULL, NULL, NULL)
    `).run(legacyId, require('crypto').randomUUID(), now, now);
    const legacy = mail.readMail('rook', legacyId);
    assert.strictEqual(legacy.route, 'internal');
    assert.strictEqual(legacy.external, false);

    // MCP list_mail/read_mail re-assert route + external from the stored path only.
    const facade = fs.readFileSync(path.join(__dirname, '..', 'modules/mcpAgentFacade.js'), 'utf8');
    assert.match(facade, /external: route !== 'internal'/);
    assert.match(facade, /`external` is true for gateway inbound\/outbound mail/);
    const asMcp = (row) => {
        const route = row.route === 'inbound' || row.route === 'outbound' ? row.route : 'internal';
        return Object.assign({}, row, { route, external: route !== 'internal' });
    };
    const mcpInbound = asMcp(mail.readMail('guren', inbound.id));
    assert.strictEqual(mcpInbound.route, 'inbound');
    assert.strictEqual(mcpInbound.external, true);
    const mcpInternal = asMcp(inbox);
    assert.strictEqual(mcpInternal.route, 'internal');
    assert.strictEqual(mcpInternal.external, false);
}

async function testSpoofedFromLabels() {
    const cases = [
        { fromLabel: 'menma', subject: 'spoof-menma' },
        { fromLabel: 'Yukimi Kazari <x@ext.com>', subject: 'spoof-yukimi' },
        { fromLabel: '"menma.dev@dream.737.jp.net" <evil@ext.com>', subject: 'spoof-quoted' }
    ];
    for (const item of cases) {
        const stored = mail.deliverInboundMail({
            fromAddress: 'evil@ext.com',
            fromLabel: item.fromLabel,
            toOwner: 'ivory',
            subject: item.subject,
            body: 'spoof',
            route: 'internal'
        });
        const row = mail.readMail('ivory', stored.id);
        assert.strictEqual(row.route, 'inbound', item.subject);
        assert.strictEqual(row.external, true, item.subject);
        assert.strictEqual(row.from, 'evil@ext.com', item.subject);
        assert.strictEqual(row.fromLabel, 'evil@ext.com', item.subject);
        assert.strictEqual(row.labelSuspicious, true, item.subject);
        assert.notStrictEqual(row.from, 'menma');
        assert.notStrictEqual(row.from, 'yukimi');
    }

    // Same spoof through the SMTP gateway path: route stays inbound even
    // when the From header names a mailbox or Yukimi.
    const stored = [];
    const inbound = await gateway.startInbound({
        port: 0,
        bind: '127.0.0.1',
        allowFrom: ['127.0.0.1'],
        mapping: mapping(),
        deliver: async (msg) => stored.push(mail.deliverInboundMail(msg))
    });
    try {
        const socket = await connectSmtp(inbound.port);
        const reader = createLineReader(socket);
        await expectCode(reader, 220);
        socket.write('EHLO test\r\n');
        await expectCode(reader, 250);
        socket.write('MAIL FROM:<evil@ext.com>\r\n');
        await expectCode(reader, 250);
        socket.write('RCPT TO:<ivory.studio@dream.737.jp.net>\r\n');
        await expectCode(reader, 250);
        socket.write('DATA\r\n');
        await expectCode(reader, 354);
        socket.write('From: menma\r\nSubject: smtp-spoof-menma\r\n\r\nnope\r\n.\r\n');
        await expectCode(reader, 250);
        socket.write('MAIL FROM:<>\r\n');
        await expectCode(reader, 250);
        socket.write('RCPT TO:<guren.lab@dream.737.jp.net>\r\n');
        await expectCode(reader, 250);
        socket.write('DATA\r\n');
        await expectCode(reader, 354);
        socket.write('From: Mailer-Daemon@mx.example.com\r\nSubject: smtp-bounce\r\n\r\nbounce\r\n.\r\n');
        await expectCode(reader, 250);
        socket.write('QUIT\r\n');
        await readReply(reader);
        socket.end();
    } finally {
        await inbound.close();
    }
    assert.strictEqual(stored.length, 2);
    const spoof = mail.readMail('ivory', stored[0].id);
    assert.strictEqual(spoof.route, 'inbound');
    assert.strictEqual(spoof.external, true);
    assert.strictEqual(spoof.from, 'evil@ext.com');
    assert.strictEqual(spoof.fromLabel, 'evil@ext.com');
    assert.strictEqual(spoof.labelSuspicious, true);
    const bounce = mail.readMail('guren', stored[1].id);
    assert.strictEqual(bounce.route, 'inbound');
    assert.strictEqual(bounce.external, true);
    assert.strictEqual(bounce.from, addresses.NULL_SENDER);
}

function testSpamHeaderTrust() {
    const ham = [
        'From: alice@example.com',
        'Subject: clean'
    ].join('\r\n');
    assert.strictEqual(spam.isInboundSpam(ham).spam, false);

    const topYes = [
        'X-Spam-Flag: YES',
        'From: alice@example.com',
        'X-Spam-Flag: NO'
    ].join('\r\n');
    assert.strictEqual(spam.isInboundSpam(topYes).spam, true);

    const forgedLower = [
        'X-Spam-Flag: NO',
        'From: alice@example.com',
        'X-Spam-Flag: YES',
        'X-Spam-Status: Yes, score=99'
    ].join('\r\n');
    // Topmost flag is NO (does not rescue) but also does not count; the lower
    // YES / Yes copies sit at or below From and must be ignored.
    assert.strictEqual(spam.isInboundSpam(forgedLower).spam, false);

    const statusYes = [
        'X-Spam-Status: Yes, score=8.1 required=5.0 tests=BAYES_99',
        'X-Spam-Flag: NO',
        'From: alice@example.com'
    ].join('\r\n');
    const statusYesMark = spam.isInboundSpam(statusYes);
    assert.strictEqual(statusYesMark.spam, true, 'NO must not rescue a Yes status');
    assert.strictEqual(statusYesMark.score, 8.1);
    assert.strictEqual(statusYesMark.required, 5.0);

    const statusNo = [
        'X-Spam-Status: No, score=-1.2 required=5.0 tests=NONE',
        'From: alice@example.com'
    ].join('\r\n');
    const statusNoMark = spam.isInboundSpam(statusNo);
    assert.strictEqual(statusNoMark.spam, false);
    assert.strictEqual(statusNoMark.score, -1.2);
    assert.strictEqual(statusNoMark.required, 5.0);

    const flagThenStatus = [
        'X-Spam-Flag: NO',
        'X-Spam-Status: Yes, score=8.1',
        'From: alice@example.com'
    ].join('\r\n');
    assert.strictEqual(spam.isInboundSpam(flagThenStatus).spam, true, 'NO must not rescue a trusted Yes status');

    const lateSpf = [
        'From: alice@example.com',
        'Received-SPF: fail (sender)'
    ].join('\r\n');
    assert.strictEqual(spam.isInboundSpam(lateSpf).spam, false);

    const spfFail = [
        'Received-SPF: fail (mx: sender is not permitted)',
        'Received-SPF: pass (forged)',
        'From: alice@example.com'
    ].join('\r\n');
    const spfFailMark = spam.isInboundSpam(spfFail);
    assert.strictEqual(spfFailMark.spam, false, 'Received-SPF fail is display-only');
    assert.strictEqual(spfFailMark.receivedSpf, 'fail');
    const forgedSpf = [
        'Received-SPF: pass (relay)',
        'Received-SPF: fail (sender)',
        'From: alice@example.com'
    ].join('\r\n');
    assert.strictEqual(spam.isInboundSpam(forgedSpf).spam, false);
    assert.strictEqual(spam.isInboundSpam(forgedSpf).receivedSpf, 'pass');

    const dkimFail = [
        'Authentication-Results: mx.dream.737.jp.net; dkim=fail; dmarc=pass',
        'From: alice@example.com'
    ].join('\r\n');
    const dkimFailMark = spam.isInboundSpam(dkimFail);
    assert.strictEqual(dkimFailMark.spam, false, 'dkim=fail stays in Inbox');
    assert.strictEqual(dkimFailMark.dkim, 'fail');

    const dmarcNone = [
        'Authentication-Results: mx.dream.737.jp.net; dkim=pass; dmarc=fail (p=none dis=NONE) header.from=ext.com',
        'From: alice@example.com'
    ].join('\r\n');
    const dmarcNoneMark = spam.isInboundSpam(dmarcNone);
    assert.strictEqual(dmarcNoneMark.spam, false, 'dmarc=fail p=none stays in Inbox');
    assert.strictEqual(dmarcNoneMark.dmarc, 'fail');
    assert.strictEqual(dmarcNoneMark.dmarcP, 'none');

    const dmarcQuarantine = [
        'Authentication-Results: mx.dream.737.jp.net; dkim=pass; dmarc=fail (p=quarantine dis=NONE) header.from=ext.com',
        'From: alice@example.com'
    ].join('\r\n');
    assert.strictEqual(spam.isInboundSpam(dmarcQuarantine).spam, true);

    const dmarcDis = [
        'Authentication-Results: mx.dream.737.jp.net; dmarc=fail (p=none dis=QUARANTINE) header.from=ext.com',
        'From: alice@example.com'
    ].join('\r\n');
    assert.strictEqual(spam.isInboundSpam(dmarcDis).spam, true, 'dis=QUARANTINE files to Spam');

    const arFail = [
        'Authentication-Results: mx.dream.737.jp.net; dkim=pass; dmarc=fail header.from=ext.com',
        'Authentication-Results: evil.example; dkim=pass; dmarc=pass',
        'From: alice@example.com'
    ].join('\r\n');
    assert.strictEqual(spam.isInboundSpam(arFail).spam, false, 'dmarc=fail without p=quarantine stays in Inbox');
    const arForgedOnly = [
        'Authentication-Results: evil.example; dmarc=fail (p=quarantine dis=QUARANTINE)',
        'From: alice@example.com'
    ].join('\r\n');
    assert.strictEqual(spam.isInboundSpam(arForgedOnly).spam, false);
    assert.strictEqual(spam.isInboundSpam(arForgedOnly, { authservId: 'mx.dream.737.jp.net' }).spam, false);
    assert.strictEqual(spam.isInboundSpam(dmarcQuarantine, { authservId: 'mx.dream.737.jp.net' }).spam, true);
    assert.strictEqual(spam.isInboundSpam(dmarcQuarantine, { authservId: 'other.relay' }).spam, false);
    assert.strictEqual(spam.isInboundSpam(dmarcQuarantine, { authservId: '' }).spam, false);

    const arBelowReceived = [
        'Received: from sender by mx.dream.737.jp.net',
        'Authentication-Results: mx.dream.737.jp.net; dmarc=fail',
        'X-Spam-Flag: YES',
        'From: alice@example.com'
    ].join('\r\n');
    assert.strictEqual(spam.isInboundSpam(arBelowReceived).spam, false);

    const custom = [
        'X-Lantis-Spam: YES',
        'X-Spam-Flag: NO',
        'From: alice@example.com'
    ].join('\r\n');
    assert.strictEqual(spam.isInboundSpam(custom, { flagHeader: 'X-Lantis-Spam' }).spam, true);

    const reportOnly = [
        'X-Spam-Flag: NO',
        'X-Spam-Status: No, score=0.1 required=5.0',
        'X-Spam-Report: * 0.1 BAYES_00',
        'From: alice@example.com'
    ].join('\r\n');
    const reportMark = spam.isInboundSpam(reportOnly);
    assert.strictEqual(reportMark.spam, false, 'X-Spam-Report is display-only');
    assert.match(reportMark.report, /BAYES_00/);

    const arSpfFailReceivedPass = [
        'Authentication-Results: mx.dream.737.jp.net; spf=fail smtp.mailfrom=ext.com; dkim=pass; dmarc=pass',
        'Received-SPF: pass (relay: sender is permitted)',
        'From: alice@example.com'
    ].join('\r\n');
    assert.strictEqual(
        spam.isInboundSpam(arSpfFailReceivedPass).spam,
        false,
        'OpenDMARC A-R spf=fail is not the exact SPF result'
    );

    const forgedOurs = [
        'X-Spam-Status: No, score=2.0 required=5.0 tests=BAYES_00,LANTIS_FORGED_OURS',
        'From: alice@example.com'
    ].join('\r\n');
    const forgedMark = spam.isInboundSpam(forgedOurs);
    assert.strictEqual(forgedMark.spam, false, 'LANTIS_FORGED_OURS is a warning, not a folder rule');
    assert.strictEqual(forgedMark.forgedOurs, true);

    const dmarcInOtherComment = [
        'Authentication-Results: mx.dream.737.jp.net; spf=fail (dmarc=fail p=quarantine dis=QUARANTINE); dkim=pass; dmarc=pass (p=none dis=NONE)',
        'From: alice@example.com'
    ].join('\r\n');
    const nestedDmarc = spam.isInboundSpam(dmarcInOtherComment);
    assert.strictEqual(nestedDmarc.spam, false, 'dmarc= inside another method comment is not the method');
    assert.strictEqual(nestedDmarc.dmarc, 'pass');
    assert.strictEqual(nestedDmarc.dmarcP, 'none');
    assert.strictEqual(spam.parseDmarcComment('spf=fail (dmarc=fail p=quarantine); dkim=pass').quarantine, false);
    assert.strictEqual(spam.parseDmarcComment('spf=fail (dmarc=fail p=quarantine); dmarc=fail (p=quarantine)').quarantine, true);

    const trustedOrig = [
        'X-Original-To: <lost@dream.737.jp.net>',
        'X-Original-To: <forged@evil.example>',
        'Received: from sender by mx.dream.737.jp.net',
        'X-Original-To: <below@dream.737.jp.net>',
        'From: alice@example.com'
    ].join('\r\n');
    assert.strictEqual(spam.trustedOriginalTo(trustedOrig), 'lost@dream.737.jp.net');
    const lowerOnly = [
        'Received: from sender by mx.dream.737.jp.net',
        'X-Original-To: <below@dream.737.jp.net>',
        'From: alice@example.com'
    ].join('\r\n');
    assert.strictEqual(spam.trustedOriginalTo(lowerOnly), null);
    const belowFrom = [
        'From: alice@example.com',
        'X-Original-To: <below-from@dream.737.jp.net>'
    ].join('\r\n');
    assert.strictEqual(spam.trustedOriginalTo(belowFrom), null);
}

function testInternalNeverSpam() {
    const sent = mail.sendMail({ fromOwner: 'sala', to: 'chiyo', subject: 'not-spam-internal', body: 'hi' });
    const inbox = mail.listMail('chiyo', { folder: 'inbox' }).find((row) => row.subject === 'not-spam-internal');
    const spamList = mail.listMail('chiyo', { folder: 'spam' });
    assert.ok(inbox);
    assert.strictEqual(inbox.folder, 'inbox');
    assert.strictEqual(inbox.route, 'internal');
    assert.ok(!spamList.some((row) => row.subject === 'not-spam-internal'));
    assert.strictEqual(mail.listMail('sala', { folder: 'sent' }).find((row) => row.id === sent.id).folder, 'sent');
}

async function testInboundSpamDelivery() {
    const stored = [];
    const inbound = await gateway.startInbound({
        port: 0,
        bind: '127.0.0.1',
        allowFrom: ['127.0.0.1'],
        mapping: mapping(),
        deliver: async (msg) => stored.push(mail.deliverInboundMail(msg))
    });
    try {
        const socket = await connectSmtp(inbound.port);
        const reader = createLineReader(socket);
        await expectCode(reader, 220);
        socket.write('EHLO test\r\n');
        await expectCode(reader, 250);
        socket.write('MAIL FROM:<evil@ext.com>\r\n');
        await expectCode(reader, 250);
        socket.write('RCPT TO:<ivory.studio@dream.737.jp.net>\r\n');
        await expectCode(reader, 250);
        socket.write('DATA\r\n');
        await expectCode(reader, 354);
        socket.write('X-Spam-Flag: YES\r\nX-Spam-Status: Yes, score=8.1 required=5.0 tests=BAYES_99\r\nX-Spam-Report: * 8.1 BAYES_99\r\nX-Spam-Flag: NO\r\nFrom: alice@example.com\r\nSubject: gw-spam\r\n\r\nbody\r\n.\r\n');
        await expectCode(reader, 250);
        socket.write('MAIL FROM:<friend@ext.com>\r\n');
        await expectCode(reader, 250);
        socket.write('RCPT TO:<ivory.studio@dream.737.jp.net>\r\n');
        await expectCode(reader, 250);
        socket.write('DATA\r\n');
        await expectCode(reader, 354);
        socket.write('X-Spam-Flag: NO\r\nX-Spam-Flag: YES\r\nFrom: friend@ext.com\r\nSubject: gw-ham\r\n\r\nbody\r\n.\r\n');
        await expectCode(reader, 250);
        socket.write('QUIT\r\n');
        await readReply(reader);
        socket.end();
    } finally {
        await inbound.close();
    }
    assert.strictEqual(stored.length, 2);
    const flagged = mail.readMail('ivory', stored[0].id);
    assert.strictEqual(flagged.folder, 'spam');
    assert.strictEqual(flagged.route, 'inbound');
    assert.strictEqual(flagged.external, true);
    assert.strictEqual(flagged.spamScore, 8.1);
    assert.strictEqual(flagged.spamRequired, 5.0);
    assert.match(flagged.spamReport, /BAYES_99/);
    const ham = mail.readMail('ivory', stored[1].id);
    assert.strictEqual(ham.folder, 'inbox');
    assert.strictEqual(ham.route, 'inbound');
}

async function testMailroomRcptAndOriginalTo() {
    const stored = [];
    const inbound = await gateway.startInbound({
        port: 0,
        bind: '127.0.0.1',
        allowFrom: ['127.0.0.1'],
        mapping: mapping(),
        deliver: async (msg) => stored.push(mail.deliverInboundMail(msg))
    });
    try {
        const socket = await connectSmtp(inbound.port);
        const reader = createLineReader(socket);
        await expectCode(reader, 220);
        socket.write('EHLO test\r\n');
        await expectCode(reader, 250);
        socket.write('MAIL FROM:<alice@example.com>\r\n');
        await expectCode(reader, 250);
        socket.write('RCPT TO:<mailroom.ops@dream.737.jp.net>\r\n');
        await expectCode(reader, 250);
        socket.write('DATA\r\n');
        await expectCode(reader, 354);
        socket.write('X-Original-To: <lost.dept@dream.737.jp.net>\r\n');
        socket.write('X-Original-To: <forged@evil.example>\r\n');
        socket.write('Received: from sender by mx.dream.737.jp.net\r\n');
        socket.write('X-Original-To: <below@dream.737.jp.net>\r\n');
        socket.write('From: alice@example.com\r\n');
        socket.write('To: mailroom.ops@dream.737.jp.net\r\n');
        socket.write('Subject: catch-all\r\n\r\nbody\r\n.\r\n');
        await expectCode(reader, 250);
        socket.write('QUIT\r\n');
        await readReply(reader);
        socket.end();
    } finally {
        await inbound.close();
    }
    assert.strictEqual(stored.length, 1);
    assert.strictEqual(stored[0].owner, 'tsubame');
    assert.strictEqual(stored[0].originalTo, 'lost.dept@dream.737.jp.net');
    const row = mail.readMail('tsubame', stored[0].id);
    assert.strictEqual(row.originalTo, 'lost.dept@dream.737.jp.net');
    assert.strictEqual(row.folder, 'inbox');
    assert.strictEqual(row.route, 'inbound');
    assert.strictEqual(mail.listMail('ivory', { folder: 'inbox' }).some((m) => m.id === row.id), false);
}

function testForwardKeepsInboundRoute() {
    const inbound = mail.deliverInboundMail({
        fromAddress: 'evil@ext.com',
        fromLabel: 'menma',
        toOwner: 'ivory',
        subject: 'fwd-inbound',
        body: 'outside'
    });
    const source = mail.readMail('ivory', inbound.id);
    assert.strictEqual(source.route, 'inbound');
    assert.strictEqual(source.labelSuspicious, true);
    const fwd = mail.forwardMail('ivory', { id: inbound.id, to: 'rook' });
    const row = mail.readMail('rook', fwd.id);
    assert.strictEqual(row.route, 'inbound');
    assert.strictEqual(row.external, true);
    assert.strictEqual(row.labelSuspicious, true);
    assert.strictEqual(row.from, 'evil@ext.com');
    assert.strictEqual(row.fromLabel, 'evil@ext.com');
    assert.strictEqual(row.subject, 'Fwd: fwd-inbound');
}

async function testMixedSendRoutes() {
    const certs = writeCert(path.join(tmpDir, 'mixed-route'), 'mx.dream.737.jp.net');
    const mock = await startMockSmtp({
        key: certs.key,
        cert: certs.cert,
        password: 'mixed-pass'
    });
    gateway.setTestOverrides({
        config: {
            enabled: true,
            domain: 'dream.737.jp.net',
            mailboxes: addresses.DEFAULT_MAILBOXES,
            outbound: {
                host: '127.0.0.1',
                port: mock.port,
                mode: 'starttls',
                tlsServername: 'mx.dream.737.jp.net',
                caPath: certs.certPath,
                authUser: 'dreamscape@dream.737.jp.net'
            }
        },
        smtpPassword: 'mixed-pass'
    });
    try {
        const result = mail.sendMail({
            fromOwner: 'cursor',
            to: ['rook', 'friend@example.net'],
            subject: 'mixed-route',
            body: 'both'
        });
        await result.outbound;
        const sent = mail.listMail('cursor', { folder: 'sent' }).find((row) => row.subject === 'mixed-route');
        const inbox = mail.listMail('rook', { folder: 'inbox' }).find((row) => row.subject === 'mixed-route');
        assert.strictEqual(sent.route, 'outbound');
        assert.strictEqual(sent.external, true);
        assert.strictEqual(inbox.route, 'internal');
        assert.strictEqual(inbox.external, false);
    } finally {
        gateway.setTestOverrides({ config: { enabled: false } });
        await mock.close();
    }
}

async function testOwnDomainFromToPostmaster() {
    const { inbound, delivered } = await startOpenInbound();
    try {
        const socket = await connectSmtp(inbound.port);
        const reader = createLineReader(socket);
        await expectCode(reader, 220);
        socket.write('EHLO lantis\r\n');
        await expectCode(reader, 250);

        socket.write('MAIL FROM:<alice@example.com>\r\n');
        await expectCode(reader, 250);
        socket.write('RCPT TO:<ivory.studio@dream.737.jp.net>\r\n');
        await expectCode(reader, 250);
        socket.write('DATA\r\n');
        await expectCode(reader, 354);
        socket.write('From: DMARC Aggregate <dmarc-rua@dream.737.jp.net>\r\n');
        socket.write('Subject: dmarc report\r\n\r\nxml\r\n.\r\n');
        await expectCode(reader, 250);

        socket.write('MAIL FROM:<>\r\n');
        await expectCode(reader, 250);
        socket.write('RCPT TO:<menma.dev@dream.737.jp.net>\r\n');
        await expectCode(reader, 250);
        socket.write('DATA\r\n');
        await expectCode(reader, 354);
        socket.write('From: Cron <double-bounce@mx.dream.737.jp.net>\r\n');
        socket.write('Subject: cron bounce\r\n\r\nprobe\r\n.\r\n');
        await expectCode(reader, 250);

        socket.write('MAIL FROM:<alice@example.com>\r\n');
        await expectCode(reader, 250);
        socket.write('RCPT TO:<ivory.studio@dream.737.jp.net>\r\n');
        await expectCode(reader, 250);
        socket.write('DATA\r\n');
        await expectCode(reader, 354);
        socket.write('From: menma@dream.co.jp\r\nSubject: display-domain\r\n\r\nx\r\n.\r\n');
        const rejected = await expectCode(reader, 550);
        assert.match(rejected.text, /From domain is not allowed/);

        socket.write('QUIT\r\n');
        await readReply(reader);
        socket.end();
    } finally {
        await inbound.close();
    }
    assert.strictEqual(delivered.length, 2);
    assert.ok(delivered.every((msg) => msg.toOwner === 'tsubame'));
    assert.ok(delivered.every((msg) => msg.ownDomainFrom === true));
    const stored = delivered.map((msg) => mail.deliverInboundMail(msg));
    stored.forEach((row) => {
        assert.strictEqual(row.owner, 'tsubame');
        assert.strictEqual(row.route, 'inbound');
        assert.strictEqual(row.external, true);
        assert.strictEqual(row.ownDomainFrom, true);
        assert.notStrictEqual(row.route, 'internal');
        const read = mail.readMail('tsubame', row.id);
        assert.strictEqual(read.route, 'inbound');
        assert.strictEqual(read.external, true);
        assert.strictEqual(read.ownDomainFrom, true);
    });
    assert.strictEqual(
        mail.listMail('ivory', { folder: 'inbox' }).filter((row) => row.subject === 'dmarc report').length,
        0
    );
    assert.strictEqual(
        mail.listMail('menma', { folder: 'inbox' }).filter((row) => row.subject === 'cron bounce').length,
        0
    );
}

async function testOutboundKeepsOurDomainInternal() {
    const certs = writeCert(path.join(tmpDir, 'local-split'), 'mx.dream.737.jp.net');
    const mock = await startMockSmtp({
        key: certs.key,
        cert: certs.cert,
        password: 'split-pass'
    });
    gateway.setTestOverrides({
        config: {
            enabled: true,
            domain: 'dream.737.jp.net',
            mailboxes: addresses.DEFAULT_MAILBOXES,
            outbound: {
                host: '127.0.0.1',
                port: mock.port,
                mode: 'starttls',
                tlsServername: 'mx.dream.737.jp.net',
                caPath: certs.certPath,
                authUser: 'dreamscape@dream.737.jp.net'
            }
        },
        smtpPassword: 'split-pass'
    });
    try {
        const mixed = mail.sendMail({
            fromOwner: 'cursor',
            to: ['menma.dev@dream.737.jp.net', 'friend@example.net'],
            subject: 'split-local',
            body: 'x'
        });
        await mixed.outbound;
        const menmaCopy = mail.listMail('menma', { folder: 'inbox' }).find((row) => row.subject === 'split-local');
        assert.ok(menmaCopy);
        assert.strictEqual(menmaCopy.route, 'internal');
        assert.strictEqual(menmaCopy.external, false);
        assert.deepStrictEqual(mock.recorded.rcpt, ['friend@example.net']);
        assert.ok(!JSON.stringify(mock.recorded.rcpt).includes('dream.737.jp.net'));

        assert.throws(
            () => mail.sendMail({ fromOwner: 'cursor', to: 'nobody@dream.737.jp.net', subject: 'nope', body: 'x' }),
            (err) => err.code === 'UNKNOWN_RECIPIENT'
        );
        assert.throws(
            () => mail.sendMail({ fromOwner: 'cursor', to: 'cron@mx.dream.737.jp.net', subject: 'sub-nope', body: 'x' }),
            (err) => err.code === 'UNKNOWN_RECIPIENT'
        );

        await assert.rejects(
            () => gateway.submitOutbound({
                fromOwner: 'cursor',
                to: ['menma.dev@dream.737.jp.net'],
                subject: 'leak',
                body: 'x',
                smtpPassword: 'split-pass',
                mapping: mapping(),
                outbound: {
                    host: '127.0.0.1',
                    port: mock.port,
                    mode: 'starttls',
                    tlsServername: 'mx.dream.737.jp.net',
                    caPath: certs.certPath
                }
            }),
            (err) => err.code === 'LOCAL_RECIPIENT'
        );

        const localOnly = mail.sendMail({
            fromOwner: 'cursor',
            to: 'postmaster@dream.737.jp.net',
            subject: 'to-postmaster',
            body: 'x'
        });
        assert.ok(!localOnly.outbound);
        const post = mail.listMail('tsubame', { folder: 'inbox' }).find((row) => row.subject === 'to-postmaster');
        assert.ok(post);
        assert.strictEqual(post.route, 'internal');

        const src = mail.sendMail({ fromOwner: 'menma', to: 'ivory', subject: 'fwd-src', body: 'in' });
        assert.ok(src.id);
        const ivoryIn = mail.listMail('ivory', { folder: 'inbox' }).find((row) => row.subject === 'fwd-src');
        const fwdLocal = mail.forwardMail('ivory', { id: ivoryIn.id, to: 'rook.dev@dream.737.jp.net' });
        assert.strictEqual(mail.readMail('rook', fwdLocal.id).route, 'internal');
        assert.throws(
            () => mail.forwardMail('ivory', { id: ivoryIn.id, to: 'friend@example.net' }),
            (err) => err.code === 'LOCAL_ONLY'
        );
        assert.throws(
            () => mail.forwardMail('ivory', { id: ivoryIn.id, to: 'nobody@dream.737.jp.net' }),
            (err) => err.code === 'UNKNOWN_RECIPIENT'
        );
    } finally {
        gateway.setTestOverrides({ config: { enabled: false } });
        await mock.close();
    }
}

// r1 (#349): own-domain From anywhere in the From list diverts to postmaster,
// and LMTP still answers once per RCPT after the divert.
async function testOwnDomainFromDivertR1() {
    const map = mapping();
    assert.strictEqual(addresses.validateFromHeader('a@evil.com, kazari.ops@dream.737.jp.net', map).ownDomain, true);
    assert.strictEqual(addresses.validateFromHeader('a@evil.com, b@dream.co.jp', map).ok, false);
    assert.strictEqual(addresses.validateFromHeader('"x, y" <a@evil.com>', map).ownDomain, false);
    for (const from of ['kazari.ops@dream.737.jp.net', 'a@evil.com, kazari.ops@dream.737.jp.net']) {
        const { inbound, delivered } = await startOpenInbound();
        try {
            const socket = await connectSmtp(inbound.port);
            const reader = createLineReader(socket);
            await expectCode(reader, 220);
            socket.write('LHLO lantis\r\n');
            await expectCode(reader, 250);
            socket.write('MAIL FROM:<a@evil.com>\r\n');
            await expectCode(reader, 250);
            for (const rcpt of ['menma.dev', 'kazari.ops', 'sala.ops']) {
                socket.write(`RCPT TO:<${rcpt}@dream.737.jp.net>\r\n`);
                await expectCode(reader, 250);
            }
            socket.write('DATA\r\n');
            await expectCode(reader, 354);
            socket.write(`From: ${from}\r\nSubject: divert\r\n\r\nbody\r\n.\r\n`);
            for (let i = 0; i < 3; i++) await expectCode(reader, 250);
            socket.write('QUIT\r\n');
            await expectCode(reader, 221);
            socket.end();
        } finally {
            await inbound.close();
        }
        assert.deepStrictEqual(delivered.map((m) => m.toOwner), ['tsubame'], from);
        assert.strictEqual(delivered[0].ownDomainFrom, true);
    }
}

async function main() {
    testMapping();
    await testAllowlistReject();
    await testUnknownRecipientReject();
    await testInboundDelivery();
    await testOwnDomainFromDivertR1();
    await testInboundRelaySenders();
    await testInboundPlaintextUnchanged();
    await testInboundStarttlsHandshake();
    await testInboundStarttlsInjection();
    await testInboundRequireTls();
    await testYukimiAliasDelivery();
    await testOutboundRewrite();
    await testMissingStarttls();
    await testCertVerificationFailure();
    await testImplicitTls();
    testInternalUnchangedAndDisabled();
    await testSendMailOutboundHook();
    testCrlfBufferAndSenderRules();
    testResolveConfigDefaults();
    testMimeDecode();
    await testOutboundRateAndAllowlist();
    await testSpoofCases();
    await testBareLfSmuggling();
    await testOversizeDiscard();
    await testOverlongLineTailDoesNotEndData();
    await testDeniedPeersDoNotConsumeCap();
    await testCommandSplitAcrossChunks();
    await testConnectionCap();
    await testOutboundFailureOutbox();
    await testInboundMimeAndCc();
    testRouteTagging();
    await testSpoofedFromLabels();
    testForwardKeepsInboundRoute();
    testSpamHeaderTrust();
    testInternalNeverSpam();
    await testInboundSpamDelivery();
    await testMailroomRcptAndOriginalTo();
    await testMixedSendRoutes();
    await testOwnDomainFromToPostmaster();
    await testOutboundKeepsOurDomainInternal();
    await gateway.resetForTests();
    console.log('mail gateway tests passed');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

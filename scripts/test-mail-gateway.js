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
    assert.strictEqual(addresses.toMailbox('tifa.ops@dream.737.jp.net', map), null);
    assert.strictEqual(addresses.toMailbox('pyra.dev@dream.737.jp.net', map), null);
    assert.strictEqual(addresses.toMailbox('unknown@dream.737.jp.net', map), null);
    assert.strictEqual(addresses.toMailbox('menma@gmail.com', map), null);

    assert.strictEqual(addresses.toExternal('sala', map), 'sala.ops@dream.737.jp.net');
    assert.strictEqual(addresses.toExternal('menma', map), 'menma.dev@dream.737.jp.net');
    assert.strictEqual(addresses.toExternal('rook', map), 'rook.dev@dream.737.jp.net');
    assert.strictEqual(addresses.toExternal('tifa', map), null);
    assert.strictEqual(addresses.toExternal('pyra', map), null);
    assert.strictEqual(addresses.toExternal('yukimi', map), null);

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
            'RCPT TO:<pyra.dev@dream.737.jp.net>'
        ]);
        assert.strictEqual(replies[0].code, 220);
        assert.strictEqual(replies[1].code, 250);
        assert.strictEqual(replies[2].code, 250);
        assert.strictEqual(replies[3].code, 550);
        assert.strictEqual(replies[4].code, 550);
        assert.strictEqual(replies[5].code, 550);
        assert.match(replies[3].text, /User unknown/);
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
    assert.strictEqual(addresses.validateEnvelopeSender('menma@dream.737.jp.net', map).code, 550);
    assert.strictEqual(addresses.validateEnvelopeSender('menma@mx.dream.737.jp.net', map).code, 550);
    assert.strictEqual(addresses.validateEnvelopeSender('menma@dream.co.jp', map).code, 550);
    assert.strictEqual(addresses.validateEnvelopeSender('alice@example.com', map).ok, true);
    assert.strictEqual(addresses.validateFromHeader('menma', map).ok, true);
    assert.strictEqual(addresses.validateFromHeader('Alice <alice@example.com>', map).ok, true);
    assert.strictEqual(addresses.validateFromHeader('menma@dream.737.jp.net', map).ok, false);
    assert.strictEqual(addresses.validateFromHeader('Menma <menma@lists.dream.737.jp.net>', map).ok, false);
    assert.strictEqual(addresses.validateFromHeader('menma@dream.co.jp', map).ok, false);

    const owners = ['yukimi', 'menma', 'rook'];
    const spoofOpts = { mapping: map, owners };
    assert.strictEqual(addresses.inspectFromLabel('menma', spoofOpts).suspicious, true);
    assert.strictEqual(addresses.inspectFromLabel('Yukimi Kazari <x@ext.com>', spoofOpts).suspicious, true);
    assert.strictEqual(addresses.inspectFromLabel('"menma.dev@dream.737.jp.net" <evil@ext.com>', spoofOpts).suspicious, true);
    assert.strictEqual(addresses.inspectFromLabel('yukimi', spoofOpts).suspicious, true);
    assert.strictEqual(addresses.inspectFromLabel('Rook', spoofOpts).suspicious, true);
    assert.strictEqual(addresses.inspectFromLabel('chiyo.web@dream.737.jp.net', spoofOpts).suspicious, true);
    assert.strictEqual(addresses.inspectFromLabel('Alice <alice@example.com>', spoofOpts).suspicious, false);
    assert.strictEqual(addresses.inspectFromLabel('Mailer-Daemon@mx.example.com', spoofOpts).suspicious, false);
}

function testResolveConfigDefaults() {
    gateway.setTestOverrides({ config: {} });
    const cfg = gateway.resolveConfig();
    assert.strictEqual(cfg.enabled, false);
    assert.strictEqual(cfg.inbound.bind, gateway.DEFAULT_INBOUND_BIND);
    assert.strictEqual(cfg.inbound.bind, '192.168.200.101');
    assert.strictEqual(cfg.inbound.maxConnections, gateway.DEFAULT_MAX_CONNECTIONS);
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
        assert.strictEqual(replies[4].code, 550);
        assert.strictEqual(replies[5].code, 550);
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
        const reservedFrom = await expectCode(reader, 550);
        assert.match(reservedFrom.text, /From domain is not allowed/);

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
    assert.strictEqual(delivered.length, 2);
    assert.strictEqual(delivered[0].fromAddress, 'alice@example.com');
    assert.strictEqual(delivered[0].fromLabel, 'menma');
    assert.notStrictEqual(delivered[0].fromAddress, 'menma');
    assert.strictEqual(delivered[1].fromAddress, addresses.NULL_SENDER);
    assert.match(delivered[1].fromLabel, /Mailer-Daemon@mx\.example\.com/);

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

async function main() {
    testMapping();
    await testAllowlistReject();
    await testUnknownRecipientReject();
    await testInboundDelivery();
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
    await testMixedSendRoutes();
    await gateway.resetForTests();
    console.log('mail gateway tests passed');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
